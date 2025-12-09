import axios from 'axios';
import wrtc, { type MediaStreamTrack, type RTCRtpReceiver, type RTCDataChannel, type RTCPeerConnection } from 'wrtc';
import { env } from '../config.env.js';
import {
  promptCodex,
  pauseCodex,
  compactCodex,
  resetCodex,
  subscribeCodexEvents,
} from '../codex/codex.service.js';
import {
  promptClaude,
  pauseClaude,
  compactClaude,
  resetClaude,
} from '../claude/claude.service.js';
import { setShowInnerThoughts } from '../config/verbosity.js';
import { loadContextMemory, recordMemoryRun, saveMemory } from '../memory/context.memory.js';
import {
  getCurrentConversation,
  addTranscriptEntry,
  formatConversationHistory,
} from '../conversations/conversation.storage.js';

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

  // Save completed transcripts to conversation storage
  if (type === 'transcript_done' || type === 'user_transcript_done') {
    addTranscriptEntry({ role, text, timestamp: event.timestamp }).catch(err => {
      console.error('[OPENAI-REALTIME] Failed to save transcript entry:', err);
    });
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

/**
 * Build the system prompt with context memory and conversation history
 */
function buildSystemPrompt(contextMemory: string, conversationHistory: string): string {
  return `# Voice Assistant for Code

You are a voice-controlled coding assistant that orchestrates two AI agents: **Codex** (OpenAI) and **Claude Code** (Anthropic).

## Conversation Behavior

**CRITICAL: Never interrupt the user.** Wait for the user to finish speaking completely before responding. Be patient and let them complete their thoughts, even if there are pauses. Only respond when they have clearly finished.

Keep responses concise and natural for voice. Avoid lengthy explanations unless asked.

## Available Tools

### codex_prompt
Fast agent for quick tasks:
- Reading and analyzing files
- Simple code searches (grep, find)
- Quick questions about the codebase
- Small, focused tasks

Also: codex_pause, codex_compact, codex_reset

### claude_prompt
Powerful agent for complex work:
- Multi-step refactoring
- Implementing new features
- Complex debugging
- Architectural changes
- Tasks requiring deep analysis

Also: claude_pause, claude_compact, claude_reset

### save_memory
Persist information to CONTEXT_MEMORY.md (survives restarts).

### show_inner_thoughts
Control whether you see agent reasoning (true) or just final results (false).

## Agent Selection Rules

1. **User specifies agent** → Use what they asked for ("use Claude", "ask Codex")
2. **Complex/multi-step task** → claude_prompt
3. **Quick lookup or simple task** → codex_prompt
4. **Uncertain** → Default to codex_prompt (faster), escalate to claude_prompt if needed

## Memory System

Your persistent memory is loaded below. When the user says "remember this", "save this", or similar:
- Use save_memory to update CONTEXT_MEMORY.md
- The function REPLACES the entire file - include ALL content you want to keep
- Keep it organized with clear sections

---
## Persistent Memory (CONTEXT_MEMORY.md)
${contextMemory}
---

${conversationHistory ? `## Recent Conversation History\n${conversationHistory}\n---\n\n` : ''}## Response Style

- Be conversational and friendly
- Summarize what the coding agents found in plain language
- Ask clarifying questions if the request is ambiguous
- Confirm before destructive operations (delete, overwrite)`;
}

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

  // Load conversation history
  let conversationHistory = '';
  try {
    const conversation = await getCurrentConversation();
    conversationHistory = formatConversationHistory(conversation);
    if (conversationHistory) {
      console.log('[OPENAI-REALTIME] Loaded conversation history:', conversation.id, 'with', conversation.transcript.length, 'messages');
    }
  } catch (err) {
    console.error('[OPENAI-REALTIME] Failed to load conversation history:', err);
  }

  const systemPrompt = buildSystemPrompt(contextMemory, conversationHistory);

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

        // Helper to send function result back to OpenAI
        const sendFunctionResult = (output: string) => {
          const functionResult = {
            type: 'conversation.item.create',
            item: {
              type: 'function_call_output',
              call_id: callId,
              output: JSON.stringify({ result: output }),
            },
          };
          dataChannel.send(JSON.stringify(functionResult));
          dataChannel.send(JSON.stringify({ type: 'response.create' }));
        };

        const sendFunctionError = (error: string) => {
          const errorResult = {
            type: 'conversation.item.create',
            item: {
              type: 'function_call_output',
              call_id: callId,
              output: JSON.stringify({ error }),
            },
          };
          dataChannel.send(JSON.stringify(errorResult));
          dataChannel.send(JSON.stringify({ type: 'response.create' }));
        };

        // Codex functions
        if (functionName === 'codex_prompt') {
          const prompt = extractPrompt(rawArgs);
          if (!prompt) {
            sendFunctionError('Codex prompt was missing or invalid.');
            break;
          }
          console.log('[OPENAI-REALTIME] Codex prompt:', prompt.slice(0, 100));
          (async () => {
            try {
              const result = await promptCodex(prompt);
              const output = result.status === 'ok'
                ? result.finalResponse || 'Codex execution completed.'
                : `Codex error: ${result.error || 'Unknown error'}`;
              sendFunctionResult(output);
            } catch (err: any) {
              console.error('[OPENAI-REALTIME] Codex error:', err);
              sendFunctionError(err?.message || 'Failed to execute Codex');
            }
          })();
        } else if (functionName === 'codex_pause') {
          console.log('[OPENAI-REALTIME] Codex pause');
          const result = pauseCodex();
          sendFunctionResult(`Codex ${result.status}. Thread preserved.`);
        } else if (functionName === 'codex_compact') {
          console.log('[OPENAI-REALTIME] Codex compact');
          (async () => {
            try {
              const result = await compactCodex();
              if (result.status === 'ok') {
                sendFunctionResult('Codex context compacted successfully. Ready to continue.');
              } else {
                sendFunctionError(result.error || 'Failed to compact Codex context');
              }
            } catch (err: any) {
              console.error('[OPENAI-REALTIME] Codex compact error:', err);
              sendFunctionError(err?.message || 'Failed to compact Codex');
            }
          })();
        } else if (functionName === 'codex_reset') {
          console.log('[OPENAI-REALTIME] Codex reset');
          resetCodex();
          sendFunctionResult('Codex reset. All context cleared.');
        }
        // Claude functions
        else if (functionName === 'claude_prompt') {
          const prompt = extractPrompt(rawArgs);
          if (!prompt) {
            sendFunctionError('Claude prompt was missing or invalid.');
            break;
          }
          console.log('[OPENAI-REALTIME] Claude prompt:', prompt.slice(0, 100));
          (async () => {
            try {
              const result = await promptClaude(prompt);
              const output = result.status === 'ok'
                ? result.finalResponse || 'Claude execution completed.'
                : `Claude error: ${result.error || 'Unknown error'}`;
              sendFunctionResult(output);
            } catch (err: any) {
              console.error('[OPENAI-REALTIME] Claude error:', err);
              sendFunctionError(err?.message || 'Failed to execute Claude');
            }
          })();
        } else if (functionName === 'claude_pause') {
          console.log('[OPENAI-REALTIME] Claude pause');
          (async () => {
            try {
              const result = await pauseClaude();
              sendFunctionResult(`Claude ${result.status}. Session preserved.`);
            } catch (err: any) {
              console.error('[OPENAI-REALTIME] Claude pause error:', err);
              sendFunctionError(err?.message || 'Failed to pause Claude');
            }
          })();
        } else if (functionName === 'claude_compact') {
          console.log('[OPENAI-REALTIME] Claude compact');
          (async () => {
            try {
              const result = await compactClaude();
              if (result.status === 'ok') {
                sendFunctionResult('Claude context compacted successfully. Ready to continue.');
              } else {
                sendFunctionError(result.error || 'Failed to compact Claude context');
              }
            } catch (err: any) {
              console.error('[OPENAI-REALTIME] Claude compact error:', err);
              sendFunctionError(err?.message || 'Failed to compact Claude');
            }
          })();
        } else if (functionName === 'claude_reset') {
          console.log('[OPENAI-REALTIME] Claude reset');
          (async () => {
            try {
              await resetClaude();
              sendFunctionResult('Claude reset. All context cleared.');
            } catch (err: any) {
              console.error('[OPENAI-REALTIME] Claude reset error:', err);
              sendFunctionError(err?.message || 'Failed to reset Claude');
            }
          })();
        }
        // Inner thoughts control
        else if (functionName === 'show_inner_thoughts') {
          let show: boolean | undefined;
          try {
            const args = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs;
            show = args?.show;
          } catch {
            show = undefined;
          }
          if (typeof show !== 'boolean') {
            sendFunctionError('show parameter must be a boolean (true or false).');
            break;
          }
          console.log('[OPENAI-REALTIME] Set show inner thoughts:', show);
          const result = setShowInnerThoughts(show);
          const modeDescription = result.showInnerThoughts
            ? 'Inner thoughts ON - you will now see detailed reasoning, tool calls, and intermediate messages from agents.'
            : 'Inner thoughts OFF - you will now only see final responses from agents.';
          sendFunctionResult(modeDescription);
        }
        // Memory saving
        else if (functionName === 'save_memory') {
          let content: string | undefined;
          try {
            const args = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs;
            content = args?.content;
          } catch {
            content = undefined;
          }
          if (!content) {
            sendFunctionError('content is required.');
            break;
          }
          console.log('[OPENAI-REALTIME] Save memory, length:', content.length);
          (async () => {
            try {
              const result = await saveMemory(content);
              if (result.success) {
                sendFunctionResult('Memory saved. I will remember this in future sessions.');
              } else {
                sendFunctionError(result.error || 'Failed to save memory');
              }
            } catch (err: any) {
              console.error('[OPENAI-REALTIME] Save memory error:', err);
              sendFunctionError(err?.message || 'Failed to save memory');
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
          // Codex tools
          {
            type: 'function',
            name: 'codex_prompt',
            description: 'Send a prompt to Codex AI assistant (OpenAI) for code analysis, file searches, or quick coding tasks. Maintains conversation context across calls.',
            parameters: {
              type: 'object',
              properties: {
                prompt: {
                  type: 'string',
                  description: 'The task or question for Codex.',
                },
              },
              required: ['prompt'],
            },
          },
          {
            type: 'function',
            name: 'codex_pause',
            description: 'Pause/interrupt the current Codex execution without losing context. The conversation can be resumed with a new prompt.',
            parameters: { type: 'object', properties: {} },
          },
          {
            type: 'function',
            name: 'codex_compact',
            description: 'Summarize and compact the Codex conversation context. Use when the context is getting too long or to free up memory while preserving key information.',
            parameters: { type: 'object', properties: {} },
          },
          {
            type: 'function',
            name: 'codex_reset',
            description: 'Completely reset Codex, clearing all conversation context. Use when starting a completely new task unrelated to previous work.',
            parameters: { type: 'object', properties: {} },
          },
          // Claude tools
          {
            type: 'function',
            name: 'claude_prompt',
            description: 'Send a prompt to Claude Code AI assistant (Anthropic) for complex multi-step coding tasks, refactoring, or deep code analysis. Maintains conversation context across calls.',
            parameters: {
              type: 'object',
              properties: {
                prompt: {
                  type: 'string',
                  description: 'The task or question for Claude Code.',
                },
              },
              required: ['prompt'],
            },
          },
          {
            type: 'function',
            name: 'claude_pause',
            description: 'Pause/interrupt the current Claude execution without losing context. The conversation can be resumed with a new prompt.',
            parameters: { type: 'object', properties: {} },
          },
          {
            type: 'function',
            name: 'claude_compact',
            description: 'Summarize and compact the Claude conversation context. Use when the context is getting too long or to free up memory while preserving key information.',
            parameters: { type: 'object', properties: {} },
          },
          {
            type: 'function',
            name: 'claude_reset',
            description: 'Completely reset Claude, clearing all conversation context. Use when starting a completely new task unrelated to previous work.',
            parameters: { type: 'object', properties: {} },
          },
          // Inner thoughts control
          {
            type: 'function',
            name: 'show_inner_thoughts',
            description: 'Control whether you can see the inner thoughts of Codex and Claude agents. When enabled (true), you see all their reasoning, tool calls, file reads, and intermediate thinking. When disabled (false), you only see final responses. Enable this when you want to understand what the agents are doing step by step.',
            parameters: {
              type: 'object',
              properties: {
                show: {
                  type: 'boolean',
                  description: 'true to see inner thoughts, false to hide them.',
                },
              },
              required: ['show'],
            },
          },
          // Memory tool
          {
            type: 'function',
            name: 'save_memory',
            description: 'Replace the entire CONTEXT_MEMORY.md file with new content. This file persists across sessions. IMPORTANT: This replaces the whole file, so include ALL information you want to keep (existing + new). The current memory is in your system prompt.',
            parameters: {
              type: 'object',
              properties: {
                content: {
                  type: 'string',
                  description: 'The complete new content for CONTEXT_MEMORY.md. Use markdown format with sections. Include all existing info you want to preserve plus new additions.',
                },
              },
              required: ['content'],
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
