import axios from 'axios';
import wrtc, { type MediaStreamTrack, type RTCRtpReceiver, type RTCDataChannel, type RTCPeerConnection } from 'wrtc';
import { env } from '../config.env.js';
import { executeCommand } from '../terminal/executor.js';

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

// Transcript event broadcasting
export type TranscriptEvent = {
  type: 'transcript_delta' | 'transcript_done' | 'user_transcript_delta' | 'user_transcript_done';
  text: string;
  role: 'assistant' | 'user';
  timestamp: number;
};

// Terminal event broadcasting
export type TerminalEvent = {
  type: 'terminal_command' | 'terminal_output' | 'terminal_error';
  command?: string;
  output?: string;
  error?: string;
  timestamp: number;
};

type TranscriptListener = (event: TranscriptEvent) => void;
type TerminalListener = (event: TerminalEvent) => void;

const transcriptListeners = new Set<TranscriptListener>();
const terminalListeners = new Set<TerminalListener>();

export function subscribeTranscriptEvents(listener: TranscriptListener) {
  transcriptListeners.add(listener);
  return () => transcriptListeners.delete(listener);
}

export function subscribeTerminalEvents(listener: TerminalListener) {
  terminalListeners.add(listener);
  return () => terminalListeners.delete(listener);
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

function broadcastTerminal(event: TerminalEvent) {
  for (const listener of terminalListeners) {
    try {
      listener(event);
    } catch (err) {
      console.error('[OPENAI-REALTIME] Terminal listener error:', err);
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

/**
 * Build the system prompt for voice-controlled terminal assistant
 */
function buildSystemPrompt(): string {
  return `# Voice-Controlled Terminal Assistant

You are a voice-controlled personal assistant that executes terminal commands based on user requests.

## Core Functionality

When the user speaks a request, you analyze it and determine what terminal command(s) should be executed. You have access to:
- **execute_command** - Execute a bash or Python command on the local machine

## Command Execution Safety

CRITICAL SAFETY RULES:
1. **Always ask for verbal confirmation** before executing potentially destructive or sensitive commands
2. Commands requiring confirmation include:
   - File deletion (rm, rmdir)
   - System modifications (apt, yum, brew install/uninstall, systemctl)
   - Network operations that modify state (curl/wget with POST/PUT/DELETE)
   - Permission changes (chmod, chown)
   - Any command with sudo/su
   - Git operations that modify history (rebase, reset --hard, push --force)
   - Database operations (DROP, DELETE, TRUNCATE)

3. **Safe to execute without confirmation**:
   - Read-only operations (ls, cat, grep, find, git status, git log)
   - Information queries (pwd, whoami, date, df, du)
   - Non-destructive analysis (file, stat, head, tail)

4. **Confirmation workflow**:
   - Explain what the command will do in plain language
   - Ask: "Should I execute this command: [command]?"
   - Wait for the user to say "yes", "confirm", "go ahead", or similar affirmative
   - If they say "no", "cancel", "stop", do not execute
   - Only execute after receiving clear verbal confirmation

## Response Style

- Be conversational and natural
- Explain what commands you're running and why
- Report results clearly
- If a command fails, explain the error in plain language
- Ask clarifying questions if the request is ambiguous

## Examples

User: "What files are in my home directory?"
You: "Let me check your home directory." [Execute: ls ~]
[Report results naturally]

User: "Delete all log files"
You: "I need to delete log files, which could remove important data. The command would be: rm *.log - Should I proceed?"
[Wait for confirmation]
User: "Yes, go ahead"
You: [Execute command and report results]

User: "Install docker"
You: "Installing Docker requires system modifications. I'll need to run: sudo apt install docker.io - Do you want me to proceed?"
[Wait for confirmation]`;
}

// Internal function - use realtimeSessionManager.getSession() instead
async function connectRealtimeSessionInternal(): Promise<RealtimeSession> {
  const systemPrompt = buildSystemPrompt();

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

        // Execute terminal command
        if (functionName === 'execute_command') {
          let command: string | undefined;
          try {
            const args = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs;
            command = args?.command;
          } catch {
            command = undefined;
          }

          if (!command || typeof command !== 'string') {
            sendFunctionError('Command was missing or invalid.');
            break;
          }

          console.log('[OPENAI-REALTIME] Executing command:', command);
          broadcastTerminal({ type: 'terminal_command', command, timestamp: Date.now() });

          (async () => {
            try {
              const result = await executeCommand(command!);
              const output = `Command executed successfully.\nExit code: ${result.exitCode}\n\nOutput:\n${result.stdout}${result.stderr ? `\n\nErrors:\n${result.stderr}` : ''}`;

              broadcastTerminal({
                type: 'terminal_output',
                command,
                output: result.stdout,
                error: result.stderr,
                timestamp: Date.now(),
              });

              sendFunctionResult(output);
            } catch (err: any) {
              console.error('[OPENAI-REALTIME] Command execution error:', err);
              const errorMsg = err?.message || 'Failed to execute command';

              broadcastTerminal({
                type: 'terminal_error',
                command,
                error: errorMsg,
                timestamp: Date.now(),
              });

              sendFunctionError(errorMsg);
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
            name: 'execute_command',
            description: 'Execute a bash or Python command on the local machine. Returns stdout, stderr, and exit code. IMPORTANT: Always ask for user confirmation before executing potentially destructive or sensitive commands.',
            parameters: {
              type: 'object',
              properties: {
                command: {
                  type: 'string',
                  description: 'The terminal command to execute (bash or Python)',
                },
              },
              required: ['command'],
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
