import axios from 'axios';
import wrtc, { type MediaStreamTrack, type RTCRtpReceiver, type RTCDataChannel, type RTCPeerConnection } from 'wrtc';
import { env } from '../config.env.js';
import { runCodex, subscribeCodexEvents } from '../codex/codex.service.js';
import { queryClaudeSession } from '../claude/claude.service.js';
import { loadContextMemory, recordMemoryRun } from '../memory/context.memory.js';

const RTCPeerConnectionClass = wrtc.RTCPeerConnection;
const { RTCAudioSink, RTCAudioSource } = wrtc.nonstandard;
type RTCAudioSinkEvent = { samples: Int16Array };

// ============================================================================
// RealtimeSessionManager - Long-lived singleton for OpenAI Realtime connection
// ============================================================================

type AssistantAudioListener = (frame: RealtimeAudioFrame) => void;

class RealtimeSessionManager {
  private session: RealtimeSession | null = null;
  private sessionPromise: Promise<RealtimeSession> | null = null;
  private assistantAudioListeners = new Map<string, AssistantAudioListener>();

  /**
   * Get or create the long-lived OpenAI Realtime session.
   * Multiple calls during initialization will return the same promise.
   */
  async getSession(): Promise<RealtimeSession> {
    if (this.session) {
      return this.session;
    }

    if (this.sessionPromise) {
      return this.sessionPromise;
    }

    console.log('[SESSION-MANAGER] Creating new long-lived session');
    this.sessionPromise = this.createSession();

    try {
      this.session = await this.sessionPromise;
      console.log('[SESSION-MANAGER] Session created successfully');
      return this.session;
    } catch (err) {
      console.error('[SESSION-MANAGER] Failed to create session:', err);
      this.sessionPromise = null;
      throw err;
    }
  }

  private async createSession(): Promise<RealtimeSession> {
    const session = await connectRealtimeSessionInternal();

    // Set up broadcast handler for assistant audio
    session.onAssistantAudio((frame: RealtimeAudioFrame) => {
      for (const [id, listener] of this.assistantAudioListeners) {
        try {
          listener(frame);
        } catch (err) {
          console.error(`[SESSION-MANAGER] Error in audio listener ${id}:`, err);
        }
      }
    });

    return session;
  }

  /**
   * Add a listener for assistant audio. Each frontend connection gets its own listener.
   * Returns an unsubscribe function.
   */
  addAssistantAudioListener(connectionId: string, listener: AssistantAudioListener): () => void {
    this.assistantAudioListeners.set(connectionId, listener);
    return () => {
      this.assistantAudioListeners.delete(connectionId);
    };
  }

  /**
   * Send user audio to OpenAI (from any connected frontend)
   */
  sendUserAudio(frame: RealtimeAudioFrame): void {
    if (this.session) {
      this.session.sendUserAudio(frame);
    }
  }

  /**
   * Check if session is connected
   */
  isConnected(): boolean {
    return this.session !== null;
  }

  /**
   * Get number of active audio listeners (connected frontends)
   */
  getListenerCount(): number {
    return this.assistantAudioListeners.size;
  }

  /**
   * Close the session (for shutdown only)
   */
  closeSession(): void {
    if (this.session) {
      console.log('[SESSION-MANAGER] Closing session');
      this.session.close();
      this.session = null;
      this.sessionPromise = null;
      this.assistantAudioListeners.clear();
    }
  }
}

// Export singleton instance
export const realtimeSessionManager = new RealtimeSessionManager();

// Transcript event broadcasting - shares the same SSE channel as Codex events
export type TranscriptEvent = {
  type: 'transcript_delta' | 'transcript_done' | 'user_transcript_delta' | 'user_transcript_done';
  text: string;
  role: 'assistant' | 'user';
  timestamp: number;
};

type TranscriptListener = (event: TranscriptEvent) => void;
const transcriptListeners = new Set<TranscriptListener>();

export function subscribeTranscriptEvents(listener: TranscriptListener) {
  transcriptListeners.add(listener);
  return () => transcriptListeners.delete(listener);
}

function broadcastTranscript(type: TranscriptEvent['type'], text: string, role: 'assistant' | 'user') {
  const event: TranscriptEvent = { type, text, role, timestamp: Date.now() };
  for (const listener of transcriptListeners) {
    try {
      listener(event);
    } catch (err) {
      console.error('[OPENAI-REALTIME] Transcript listener error:', err);
    }
  }
}

export type RealtimeAudioFrame = RTCAudioSinkEvent;

async function waitForIceGatheringComplete(pc: RTCPeerConnection, label: string, timeoutMs = 10_000) {
  if (pc.iceGatheringState === 'complete') {
    return;
  }

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      console.warn(`[${label}] ICE gathering timed out after ${timeoutMs}ms`);
      resolve();
    }, timeoutMs);

    const handler = () => {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(timeout);
        resolve();
      }
    };

    if (typeof pc.addEventListener === 'function') {
      pc.addEventListener('icegatheringstatechange', handler);
    } else {
      pc.onicegatheringstatechange = handler;
    }
  });
}

export type RealtimeSession = {
  peerConnection: RTCPeerConnection;
  audioSink: any; // RTCAudioSink from nonstandard
  audioSource: any; // RTCAudioSource from nonstandard
  sendUserAudio: (frame: RealtimeAudioFrame) => void;
  onAssistantAudio: (handler: (frame: RealtimeAudioFrame) => void) => void;
  sendEvent: (event: Record<string, unknown>) => void;
  waitForTextResponse: (responseId: string, timeoutMs?: number) => Promise<string>;
  close: () => void;
};

// Internal function - use realtimeSessionManager.getSession() instead
async function connectRealtimeSessionInternal(): Promise<RealtimeSession> {
  let contextMemory = '';
  try {
    contextMemory = await loadContextMemory();
    await recordMemoryRun('Started OpenAI Realtime session (voice bridge)');
  } catch (err) {
    console.error('[OPENAI-REALTIME] Failed to load context memory:', err);
    contextMemory = 'Context memory unavailable (read/write error).';
  }

  const systemPrompt = `You are a helpful voice assistant with access to two AI coding assistants: Codex (OpenAI) and Claude Code (Anthropic).

Persistent context memory from CONTEXT_MEMORY.md:
${contextMemory}

You can help users with:
- Voice conversations and general questions
- Code analysis and understanding (use run_codex or run_claude function)
- Finding and reading files in the codebase (use run_codex or run_claude function)
- Explaining how code works (use run_codex or run_claude function)
- Searching for patterns or TODO items (use run_codex or run_claude function)
- Complex multi-step coding tasks (use run_claude for more complex tasks)

When a user asks about code, files, or development tasks:
- Use run_codex for quick code analysis and simple tasks
- Use run_claude for complex multi-step tasks, refactoring, or when deeper analysis is needed
- If the user explicitly asks for Claude or Claude Code, use run_claude
- If the user explicitly asks for Codex, use run_codex

Be conversational and friendly. Always explain what the coding assistant found in a clear, natural way.`;

  const pc = new RTCPeerConnectionClass({
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require',
  });
  pc.oniceconnectionstatechange = () => {
    if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
      console.warn('[OPENAI-REALTIME] ICE connection:', pc.iceConnectionState);
    }
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
      console.warn('[OPENAI-REALTIME] Connection:', pc.connectionState);
    }
  };

  const audioSource = new RTCAudioSource();
  const track = audioSource.createTrack();
  pc.addTrack(track);

  let audioSink: any = null;

  pc.ontrack = (event: { receiver: RTCRtpReceiver; track: MediaStreamTrack }) => {
    const receiver: RTCRtpReceiver = event.receiver;
    const incomingTrack = event.track;
    if (incomingTrack.kind === 'audio') {
      audioSink = new RTCAudioSink(incomingTrack);
    } else {
      receiver.track.stop();
    }
  };

  const dataChannel: RTCDataChannel = pc.createDataChannel('oai-events');

  type TextResponseTracker = {
    buffer: string[];
    resolve: (text: string) => void;
    reject: (error: Error) => void;
    timeout?: NodeJS.Timeout;
  };

  const textResponseTrackers = new Map<string, TextResponseTracker>();
  let channelOpened = false;
  let eventCount = 0;

  const flushTracker = (responseId: string, err?: Error) => {
    const tracker = textResponseTrackers.get(responseId);
    if (!tracker) return;

    if (tracker.timeout) clearTimeout(tracker.timeout);

    if (err) {
      tracker.reject(err);
    } else {
      tracker.resolve(tracker.buffer.join(''));
    }
    textResponseTrackers.delete(responseId);
  };

  const handleMessage = (event: { data: string | Buffer }) => {
    const raw = typeof event.data === 'string' ? event.data : event.data.toString();

    let payload: any;
    try {
      payload = JSON.parse(raw);
    } catch (err) {
      console.error('[OPENAI-REALTIME] Failed to parse message:', err);
      return;
    }

    if (!payload?.type) {
      return;
    }

    eventCount++;

    switch (payload.type) {
      case 'response.output_item.added': {
        const itemType = payload.item?.type ?? 'unknown';
        if (itemType === 'function_call') {
          const functionName = payload.item?.name ?? 'unknown';
          console.log('[OPENAI-REALTIME] Function call:', functionName);
        }
        break;
      }
      case 'response.function_call_arguments.done': {
        const functionName = payload.name;
        const callId = payload.call_id;
        const rawArgs = payload.arguments;

        // Helper to extract prompt from various argument formats
        const extractPrompt = (args: unknown): string | null => {
          if (typeof args === 'string') {
            try {
              const parsed = JSON.parse(args);
              if (typeof parsed === 'string') {
                return parsed;
              } else if (parsed && typeof parsed === 'object' && typeof parsed.prompt === 'string') {
                return parsed.prompt;
              }
            } catch {
              return args;
            }
          } else if (args && typeof args === 'object' && typeof (args as any).prompt === 'string') {
            return (args as any).prompt;
          }
          return null;
        };

        if (functionName === 'run_codex') {
          const codexPrompt = extractPrompt(rawArgs);

          if (!codexPrompt) {
            console.error('[OPENAI-REALTIME] run_codex called without a valid prompt, raw args:', rawArgs);
            const errorResult = {
              type: 'conversation.item.create',
              item: {
                type: 'function_call_output',
                call_id: callId,
                output: JSON.stringify({ error: 'Codex prompt was missing or invalid.' }),
              },
            };
            dataChannel.send(JSON.stringify(errorResult));
            dataChannel.send(JSON.stringify({ type: 'response.create' }));
            break;
          }

          console.log('[OPENAI-REALTIME] Running Codex:', codexPrompt.slice(0, 100));

          // Execute Codex asynchronously and send result back
          (async () => {
            try {
              const result = await runCodex(codexPrompt);
              const output = result.status === 'ok'
                ? result.finalResponse || 'Codex execution completed but no response was generated.'
                : `Codex error: ${result.error || 'Unknown error'}`;

              // Send function call result back to assistant
              const functionResult = {
                type: 'conversation.item.create',
                item: {
                  type: 'function_call_output',
                  call_id: callId,
                  output: JSON.stringify({ result: output }),
                },
              };
              dataChannel.send(JSON.stringify(functionResult));

              // Trigger assistant to respond with the result
              dataChannel.send(JSON.stringify({ type: 'response.create' }));
            } catch (err: any) {
              console.error('[OPENAI-REALTIME] Error executing Codex:', err);
              const errorResult = {
                type: 'conversation.item.create',
                item: {
                  type: 'function_call_output',
                  call_id: callId,
                  output: JSON.stringify({ error: err?.message || 'Failed to execute Codex' }),
                },
              };
              dataChannel.send(JSON.stringify(errorResult));
              dataChannel.send(JSON.stringify({ type: 'response.create' }));
            }
          })();
        } else if (functionName === 'run_claude') {
          const claudePrompt = extractPrompt(rawArgs);

          if (!claudePrompt) {
            console.error('[OPENAI-REALTIME] run_claude called without a valid prompt, raw args:', rawArgs);
            const errorResult = {
              type: 'conversation.item.create',
              item: {
                type: 'function_call_output',
                call_id: callId,
                output: JSON.stringify({ error: 'Claude prompt was missing or invalid.' }),
              },
            };
            dataChannel.send(JSON.stringify(errorResult));
            dataChannel.send(JSON.stringify({ type: 'response.create' }));
            break;
          }

          console.log('[OPENAI-REALTIME] Running Claude:', claudePrompt.slice(0, 100));

          // Execute Claude asynchronously using persistent session (maintains conversation history)
          (async () => {
            try {
              const result = await queryClaudeSession(claudePrompt);
              const output = result.status === 'ok'
                ? result.finalResponse || 'Claude execution completed but no response was generated.'
                : `Claude error: ${result.error || 'Unknown error'}`;

              // Send function call result back to assistant
              const functionResult = {
                type: 'conversation.item.create',
                item: {
                  type: 'function_call_output',
                  call_id: callId,
                  output: JSON.stringify({ result: output }),
                },
              };
              dataChannel.send(JSON.stringify(functionResult));

              // Trigger assistant to respond with the result
              dataChannel.send(JSON.stringify({ type: 'response.create' }));
            } catch (err: any) {
              console.error('[OPENAI-REALTIME] Error executing Claude:', err);
              const errorResult = {
                type: 'conversation.item.create',
                item: {
                  type: 'function_call_output',
                  call_id: callId,
                  output: JSON.stringify({ error: err?.message || 'Failed to execute Claude' }),
                },
              };
              dataChannel.send(JSON.stringify(errorResult));
              dataChannel.send(JSON.stringify({ type: 'response.create' }));
            }
          })();
        }
        break;
      }
      case 'response.output_text.delta':
        if (payload.response_id && textResponseTrackers.has(payload.response_id)) {
          textResponseTrackers.get(payload.response_id)?.buffer.push(payload.delta ?? '');
        }
        break;
      case 'response.audio_transcript.delta': {
        const transcript = payload?.delta ?? '';
        if (transcript) {
          broadcastTranscript('transcript_delta', transcript, 'assistant');
        }
        break;
      }
      case 'response.audio_transcript.done': {
        const transcript = payload?.transcript ?? '';
        if (transcript) {
          broadcastTranscript('transcript_done', transcript, 'assistant');
        }
        break;
      }
      case 'conversation.item.input_audio_transcription.completed': {
        const transcript = payload?.transcript ?? '';
        if (transcript) {
          broadcastTranscript('user_transcript_done', transcript, 'user');
        }
        break;
      }
      case 'response.completed':
        if (payload.response?.id) {
          flushTracker(payload.response.id);
        }
        break;
      case 'response.error':
      case 'error':
        console.error('[OPENAI-REALTIME] Error:', payload.error?.message || payload);
        if (payload.response_id && textResponseTrackers.has(payload.response_id)) {
          flushTracker(payload.response_id, new Error(payload.error?.message ?? 'Realtime response error'));
        }
        break;
      default:
        break;
    }
  };

  (dataChannel as any).onmessage = handleMessage;

  let readyResolve!: () => void;
  let readyReject!: (error: Error) => void;
  const channelReady = new Promise<void>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });

  const channelTimeout = setTimeout(() => {
    console.error('[OPENAI-REALTIME] Data channel timeout');
    readyReject(new Error('Timeout waiting for Realtime data channel'));
  }, 10_000);

  const handleOpen = () => {
    clearTimeout(channelTimeout);
    channelOpened = true;

    const sessionUpdate = {
      type: 'session.update',
      session: {
        instructions: systemPrompt,
        turn_detection: { type: 'server_vad' },
        modalities: ['audio', 'text'],
        voice: 'alloy',
        input_audio_transcription: { model: 'whisper-1' },
        tools: [
          {
            type: 'function',
            name: 'run_codex',
            description: 'Run Codex AI assistant (OpenAI) to analyze code, search files, read documentation, or perform quick coding tasks. Use for simple code analysis and quick file searches.',
            parameters: {
              type: 'object',
              properties: {
                prompt: {
                  type: 'string',
                  description: 'The task or question for Codex. Be specific about what you want Codex to do (e.g., "analyze the browser-bridge.ts file", "find all TODO comments", "explain how the WebRTC connection works").',
                },
              },
              required: ['prompt'],
            },
          },
          {
            type: 'function',
            name: 'run_claude',
            description: 'Run Claude Code AI assistant (Anthropic) for complex multi-step coding tasks, refactoring, deep code analysis, or when the user explicitly asks for Claude. Use for more complex tasks requiring deeper reasoning.',
            parameters: {
              type: 'object',
              properties: {
                prompt: {
                  type: 'string',
                  description: 'The task or question for Claude Code. Be specific about what you want Claude to do (e.g., "refactor this function for better performance", "implement a new feature", "debug this complex issue").',
                },
              },
              required: ['prompt'],
            },
          },
        ],
      },
    };
    dataChannel.send(JSON.stringify(sessionUpdate));
    readyResolve();
  };

  const handleError = (event: unknown) => {
    console.error('[OPENAI-REALTIME] Data channel error event:', event);
    if (!channelOpened) {
      clearTimeout(channelTimeout);
      readyReject(new Error('Error establishing Realtime data channel'));
    }
  };

  (dataChannel as any).onopen = handleOpen;
  (dataChannel as any).onerror = handleError;

  const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: false });
  await pc.setLocalDescription(offer);
  await waitForIceGatheringComplete(pc, 'OPENAI-REALTIME');

  const offerSdp = pc.localDescription?.sdp ?? offer.sdp!;

  console.log('[OPENAI-REALTIME] Connecting to OpenAI, model:', env.REALTIME_MODEL);
  const answer = await axios.post<string>(
    `https://api.openai.com/v1/realtime?model=${env.REALTIME_MODEL}`,
    offerSdp,
    {
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': 'application/sdp',
      },
      responseType: 'text',
      timeout: 15_000,
    },
  );

  await pc.setRemoteDescription({ type: 'answer', sdp: answer.data });
  await channelReady;
  console.log('[OPENAI-REALTIME] Connected');

  const sendUserAudio = (frame: RealtimeAudioFrame) => {
    audioSource.onData(frame);
  };

  const onAssistantAudio = (handler: (frame: RealtimeAudioFrame) => void) => {
    if (audioSink) {
      audioSink.ondata = handler;
    } else {
      const interval = setInterval(() => {
        if (audioSink) {
          audioSink.ondata = handler;
          clearInterval(interval);
        }
      }, 100);
    }
  };

  const sendEvent = (event: Record<string, unknown>) => {
    if (!channelOpened) {
      throw new Error('Realtime data channel not ready yet');
    }
    dataChannel.send(JSON.stringify(event));
  };

  const waitForTextResponse = (responseId: string, timeoutMs = 10_000): Promise<string> => {
    if (!channelOpened) {
      return Promise.reject(new Error('Realtime data channel not ready yet'));
    }

    return new Promise<string>((resolve, reject) => {
      const tracker: TextResponseTracker = {
        buffer: [],
        resolve,
        reject,
        timeout: setTimeout(() => {
          flushTracker(responseId, new Error(`Timeout waiting for response ${responseId}`));
        }, timeoutMs),
      };

      textResponseTrackers.set(responseId, tracker);
    });
  };

  const close = () => {
    console.log('[OPENAI-REALTIME] Closing session');
    try {
      if (audioSink) {
        audioSink.stop();
      }
      track.stop();
      for (const [responseId, tracker] of textResponseTrackers.entries()) {
        if (tracker.timeout) clearTimeout(tracker.timeout);
        tracker.reject(new Error(`Session closed before completing response ${responseId}`));
      }
      textResponseTrackers.clear();
      pc.close();
    } catch (err) {
      console.error('[OPENAI-REALTIME] Error during cleanup:', err);
    }
  };

  return {
    peerConnection: pc,
    audioSink,
    audioSource,
    sendUserAudio,
    onAssistantAudio,
    sendEvent,
    waitForTextResponse,
    close,
  };
}

/**
 * Public wrapper - use realtimeSessionManager for new multi-connection code.
 * This is kept for backward compatibility.
 */
export async function connectRealtimeSession(): Promise<RealtimeSession> {
  return realtimeSessionManager.getSession();
}
