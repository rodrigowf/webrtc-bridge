import axios from 'axios';
import { RTCPeerConnection } from 'wrtc';
import type { MediaStreamTrack, RTCRtpReceiver, RTCDataChannel } from 'wrtc';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { RTCAudioSink, RTCAudioSource } = require('wrtc').nonstandard;

type RTCAudioSinkEvent = { samples: Int16Array };

import { env } from '../config.env';
import { runCodex } from '../codex/codex.service';

export type RealtimeAudioFrame = RTCAudioSinkEvent;

async function waitForIceGatheringComplete(pc: RTCPeerConnection, label: string, timeoutMs = 10_000) {
  if (pc.iceGatheringState === 'complete') {
    console.log(`[${label}] ICE gathering already complete`);
    return;
  }

  console.log(`[${label}] Waiting for ICE gathering to complete...`);
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      console.warn(`[${label}] ICE gathering timed out after ${timeoutMs}ms - proceeding with current SDP`);
      resolve();
    }, timeoutMs);

    const handler = () => {
      console.log(`[${label}] ICE gathering state:`, pc.iceGatheringState);
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

export async function connectRealtimeSession(): Promise<RealtimeSession> {
  console.log('[OPENAI-REALTIME] connectRealtimeSession called');
  const systemPrompt = `You are a helpful voice assistant with access to Codex, an AI coding assistant.

You can help users with:
- Voice conversations and general questions
- Code analysis and understanding (use run_codex function)
- Finding and reading files in the codebase (use run_codex function)
- Explaining how code works (use run_codex function)
- Searching for patterns or TODO items (use run_codex function)

When a user asks about code, files, or development tasks, use the run_codex function to analyze the codebase.
Be conversational and friendly. Always explain what Codex found in a clear, natural way.`;
  console.log('[OPENAI-REALTIME] System prompt:', systemPrompt);

  console.log('[OPENAI-REALTIME] Creating RTCPeerConnection for OpenAI');
  const pc = new RTCPeerConnection({
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require',
  });
  pc.oniceconnectionstatechange = () => {
    console.log('[OPENAI-REALTIME] ICE connection state:', pc.iceConnectionState);
  };
  pc.onconnectionstatechange = () => {
    console.log('[OPENAI-REALTIME] Peer connection state:', pc.connectionState);
  };
  pc.onicegatheringstatechange = () => {
    console.log('[OPENAI-REALTIME] ICE gathering state:', pc.iceGatheringState);
  };

  console.log('[OPENAI-REALTIME] Creating audio source for user audio');
  const audioSource = new RTCAudioSource();
  const track = audioSource.createTrack();
  pc.addTrack(track);
  console.log('[OPENAI-REALTIME] Audio track added to peer connection');

  let audioSink: any = null;
  let audioFrameReceived = 0;

  pc.ontrack = (event: { receiver: RTCRtpReceiver; track: MediaStreamTrack }) => {
    console.log('[OPENAI-REALTIME] ontrack event - track kind:', event.track.kind);
    const receiver: RTCRtpReceiver = event.receiver;
    const incomingTrack = event.track;
    if (incomingTrack.kind === 'audio') {
      console.log('[OPENAI-REALTIME] Audio track received from OpenAI - creating audio sink');
      audioSink = new RTCAudioSink(incomingTrack);
      console.log('[OPENAI-REALTIME] Audio sink created and ready to receive assistant audio');
    } else {
      console.log('[OPENAI-REALTIME] Non-audio track received, stopping:', incomingTrack.kind);
      receiver.track.stop();
    }
  };

  console.log('[OPENAI-REALTIME] Creating data channel "oai-events" for control messages');
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
      console.error('[OPENAI-REALTIME] Failed to parse data channel message:', err);
      return;
    }

    if (!payload?.type) {
      console.warn('[OPENAI-REALTIME] Received message without type field:', payload);
      return;
    }

    eventCount++;
    if (eventCount <= 10 || eventCount % 50 === 0) {
      console.log('[OPENAI-REALTIME] Data channel event #' + eventCount + ':', payload.type);
    }

    switch (payload.type) {
      case 'response.output_item.added': {
        // This event fires for ALL output items (messages AND function calls)
        // We ONLY want to process function_call items
        const itemType = payload.item?.type ?? 'unknown';

        // DEBUG logging (limited to first 20 events)
        if (eventCount <= 20) {
          console.log('[OPENAI-REALTIME] output_item.added - itemType:', itemType, 'name:', payload.item?.name);
        }

        // ONLY process if this is a function_call (NOT a message)
        if (itemType === 'function_call') {
          const callId = `${payload.response_id ?? 'unknown'}:${payload.item?.call_id ?? 'call'}`;
          const functionName = payload.item?.name ?? 'unknown';
          console.log('[OPENAI-REALTIME] Function call detected:', functionName, 'callId:', callId);
        }
        break;
      }
      case 'response.function_call_arguments.done': {
        const functionName = payload.name;
        const callId = payload.call_id;
        const rawArgs = payload.arguments;

        console.log('[OPENAI-REALTIME] Function call arguments complete:', functionName, 'callId:', callId);

        if (functionName === 'run_codex') {
          let codexPrompt: string | null = null;

          if (typeof rawArgs === 'string') {
            try {
              const parsed = JSON.parse(rawArgs);
              if (typeof parsed === 'string') {
                codexPrompt = parsed;
              } else if (parsed && typeof parsed === 'object' && typeof parsed.prompt === 'string') {
                codexPrompt = parsed.prompt;
              }
            } catch {
              codexPrompt = rawArgs;
            }
          } else if (rawArgs && typeof rawArgs === 'object' && typeof rawArgs.prompt === 'string') {
            codexPrompt = rawArgs.prompt;
          }

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

          console.log('[OPENAI-REALTIME] Executing Codex with prompt:', codexPrompt.slice(0, 160));

          // Execute Codex asynchronously and send result back
          (async () => {
            try {
              const result = await runCodex(codexPrompt);
              const output = result.status === 'ok'
                ? result.finalResponse || 'Codex execution completed but no response was generated.'
                : `Codex error: ${result.error || 'Unknown error'}`;

              console.log('[OPENAI-REALTIME] Codex execution completed, sending result back to assistant');

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
              const responseCreate = {
                type: 'response.create',
              };
              dataChannel.send(JSON.stringify(responseCreate));
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

              const responseCreate = {
                type: 'response.create',
              };
              dataChannel.send(JSON.stringify(responseCreate));
            }
          })();
        }
        break;
      }
      case 'response.output_text.delta':
        if (payload.response_id && textResponseTrackers.has(payload.response_id)) {
          console.log('[OPENAI-REALTIME] Text delta received for response:', payload.response_id);
          textResponseTrackers.get(payload.response_id)?.buffer.push(payload.delta ?? '');
        }
        break;
      case 'response.audio_transcript.delta': {
        const transcript = payload?.delta ?? '';
        if (transcript && eventCount <= 50) {
          console.log('[OPENAI-REALTIME] Transcript delta:', transcript.slice(0, 200));
        }
        break;
      }
      case 'response.completed':
        if (payload.response?.id) {
          console.log('[OPENAI-REALTIME] Response completed:', payload.response.id);
          flushTracker(payload.response.id);
        }
        break;
      case 'response.error':
      case 'error':
        console.error('[OPENAI-REALTIME] Error event received:', payload.error?.message || payload);
        if (payload.response_id && textResponseTrackers.has(payload.response_id)) {
          flushTracker(payload.response_id, new Error(payload.error?.message ?? 'Erro na resposta Realtime'));
        }
        break;
      default:
        if (eventCount <= 20) {
          console.log('[OPENAI-REALTIME] Unhandled event type:', payload.type);
        }
        break;
    }
  };

  (dataChannel as any).onmessage = handleMessage;

  console.log('[OPENAI-REALTIME] Setting up data channel ready promise');
  let readyResolve!: () => void;
  let readyReject!: (error: Error) => void;
  const channelReady = new Promise<void>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });

  const channelTimeout = setTimeout(() => {
    console.error('[OPENAI-REALTIME] Data channel timeout - failed to open within 10 seconds');
    readyReject(new Error('Timeout ao aguardar canal de dados Realtime'));
  }, 10_000);

  const handleOpen = () => {
    console.log('[OPENAI-REALTIME] Data channel OPENED successfully!');
    clearTimeout(channelTimeout);
    channelOpened = true;

    console.log('[OPENAI-REALTIME] Sending session.update with system prompt, modalities, and Codex tools');
    const sessionUpdate = {
      type: 'session.update',
      session: {
        instructions: systemPrompt,
        turn_detection: { type: 'server_vad' },
        modalities: ['audio', 'text'],
        voice: 'alloy',
        tools: [
          {
            type: 'function',
            name: 'run_codex',
            description: 'Run Codex AI assistant to analyze code, search files, read documentation, or perform complex coding tasks. Codex has full access to the codebase and can read, search, and analyze files. Use this when the user asks to analyze code, find files, read documentation, or perform any development task.',
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
        ],
      },
    };
    dataChannel.send(JSON.stringify(sessionUpdate));

    console.log('[OPENAI-REALTIME] Sending response.create for initial greeting');
    const initialResponse = {
      type: 'response.create',
      response: {
        instructions: 'Inicie a conversa com uma breve saudação e convide a pessoa a falar.',
      },
    };
    dataChannel.send(JSON.stringify(initialResponse));

    console.log('[OPENAI-REALTIME] Initial setup complete - channel ready for use');
    readyResolve();
  };

  const handleError = (event: unknown) => {
    console.error('[OPENAI-REALTIME] Data channel error event:', event);
    if (!channelOpened) {
      clearTimeout(channelTimeout);
      readyReject(new Error('Erro ao estabelecer canal de dados Realtime'));
    }
  };

  (dataChannel as any).onopen = handleOpen;
  (dataChannel as any).onerror = handleError;

  console.log('[OPENAI-REALTIME] Creating SDP offer for OpenAI...');
  const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: false });
  await pc.setLocalDescription(offer);
  console.log('[OPENAI-REALTIME] Local description set - awaiting ICE candidates');
  await waitForIceGatheringComplete(pc, 'OPENAI-REALTIME');

  const offerSdp = pc.localDescription?.sdp ?? offer.sdp!;
  const candidateCount = (offerSdp.match(/a=candidate/g) || []).length;
  console.log('[OPENAI-REALTIME] SDP ready with ICE candidates:', candidateCount, 'length:', offerSdp.length);

  console.log('[OPENAI-REALTIME] Sending offer to OpenAI API, model:', env.REALTIME_MODEL);
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
  console.log('[OPENAI-REALTIME] Received SDP answer from OpenAI, length:', answer.data.length);

  console.log('[OPENAI-REALTIME] Setting remote description...');
  await pc.setRemoteDescription({ type: 'answer', sdp: answer.data });
  console.log('[OPENAI-REALTIME] Remote description set, waiting for channel ready...');
  await channelReady;
  console.log('[OPENAI-REALTIME] Channel ready confirmed!');

  const sendUserAudio = (frame: RealtimeAudioFrame) => {
    audioSource.onData(frame);
  };

  const onAssistantAudio = (handler: (frame: RealtimeAudioFrame) => void) => {
    if (audioSink) {
      console.log('[OPENAI-REALTIME] Audio sink available - attaching handler immediately');
      audioSink.ondata = (frame: RealtimeAudioFrame) => {
        audioFrameReceived++;
        if (audioFrameReceived === 1) {
          console.log(
            '[OPENAI-REALTIME] First assistant frame - sampleRate:',
            (frame as any)?.sampleRate,
            'channels:',
            (frame as any)?.channelCount,
            'frames:',
            (frame as any)?.numberOfFrames,
          );
        }
        if (audioFrameReceived % 100 === 0) {
          console.log('[OPENAI-REALTIME] Assistant audio frames received:', audioFrameReceived);
        }
        handler(frame);
      };
    } else {
      console.log('[OPENAI-REALTIME] Audio sink not ready yet - polling every 100ms...');
      const interval = setInterval(() => {
        if (audioSink) {
          console.log('[OPENAI-REALTIME] Audio sink now available - attaching handler');
          audioSink.ondata = (frame: RealtimeAudioFrame) => {
            audioFrameReceived++;
            if (audioFrameReceived === 1) {
              console.log(
                '[OPENAI-REALTIME] First assistant frame - sampleRate:',
                (frame as any)?.sampleRate,
                'channels:',
                (frame as any)?.channelCount,
                'frames:',
                (frame as any)?.numberOfFrames,
              );
            }
            if (audioFrameReceived % 100 === 0) {
              console.log('[OPENAI-REALTIME] Assistant audio frames received:', audioFrameReceived);
            }
            handler(frame);
          };
          clearInterval(interval);
        }
      }, 100);
    }
  };

  const sendEvent = (event: Record<string, unknown>) => {
    if (!channelOpened) {
      console.error('[OPENAI-REALTIME] Attempted to send event before channel opened:', event.type);
      throw new Error('Canal de dados Realtime ainda não está pronto');
    }
    console.log('[OPENAI-REALTIME] Sending event:', event.type);
    dataChannel.send(JSON.stringify(event));
  };

  const waitForTextResponse = (responseId: string, timeoutMs = 10_000): Promise<string> => {
    if (!channelOpened) {
      return Promise.reject(new Error('Canal de dados Realtime ainda não está pronto'));
    }

    return new Promise<string>((resolve, reject) => {
      const tracker: TextResponseTracker = {
        buffer: [],
        resolve,
        reject,
        timeout: setTimeout(() => {
          flushTracker(responseId, new Error(`Timeout ao aguardar resposta ${responseId}`));
        }, timeoutMs),
      };

      textResponseTrackers.set(responseId, tracker);
    });
  };

  const close = () => {
    console.log('[OPENAI-REALTIME] Closing Realtime session - cleanup started');
    try {
      if (audioSink) {
        console.log('[OPENAI-REALTIME] Stopping audio sink');
        audioSink.stop();
      }
      console.log('[OPENAI-REALTIME] Stopping audio track');
      track.stop();
      console.log('[OPENAI-REALTIME] Clearing', textResponseTrackers.size, 'pending text response trackers');
      for (const [responseId, tracker] of textResponseTrackers.entries()) {
        if (tracker.timeout) clearTimeout(tracker.timeout);
        tracker.reject(new Error(`Sessão encerrada antes de concluir a resposta ${responseId}`));
      }
      textResponseTrackers.clear();
      console.log('[OPENAI-REALTIME] Closing peer connection');
      pc.close();
      console.log('[OPENAI-REALTIME] Cleanup complete - session closed');
    } catch (err) {
      console.error('[OPENAI-REALTIME] Error during cleanup:', err);
    }
  };

  console.log('[OPENAI-REALTIME] Returning RealtimeSession object');
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
