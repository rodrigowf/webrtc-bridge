import wrtc, { type MediaStreamTrack, type RTCPeerConnection } from 'wrtc';
import { realtimeSessionManager, type RealtimeAudioFrame } from '../openai/openai.realtime.js';
import { randomBytes } from 'crypto';

const RTCPeerConnectionClass = wrtc.RTCPeerConnection;
const { RTCAudioSink, RTCAudioSource } = wrtc.nonstandard;

type RTCAudioSinkEvent = { samples: Int16Array };

// ============================================================================
// Multi-connection support - each frontend gets its own connection
// ============================================================================

type BrowserConnection = {
  id: string;
  pc: RTCPeerConnection;
  browserSink: any;
  browserSource: any;
  browserTrack: MediaStreamTrack;
  unsubscribeAudio: () => void;
  close: () => void;
};

const connections = new Map<string, BrowserConnection>();

function generateConnectionId(): string {
  return randomBytes(8).toString('hex');
}

export function getConnectionCount(): number {
  return connections.size;
}

export function getConnectionIds(): string[] {
  return [...connections.keys()];
}

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

export async function handleBrowserOffer(offerSdp: string): Promise<{ answerSdp: string; connectionId: string }> {
  const connectionId = generateConnectionId();
  console.log(`[BROWSER-BRIDGE] handleBrowserOffer called, new connection: ${connectionId}`);
  console.log(`[BROWSER-BRIDGE] Current active connections: ${connections.size}`);

  console.log('[BROWSER-BRIDGE] Creating new RTCPeerConnection for browser');
  const browserPC = new RTCPeerConnectionClass();

  // Track connection state for auto-cleanup
  browserPC.oniceconnectionstatechange = () => {
    console.log(`[BROWSER-BRIDGE:${connectionId}] ICE connection state:`, browserPC.iceConnectionState);
    if (browserPC.iceConnectionState === 'disconnected' || browserPC.iceConnectionState === 'failed') {
      console.log(`[BROWSER-BRIDGE:${connectionId}] Connection lost, cleaning up...`);
      handleBrowserDisconnect(connectionId);
    }
  };
  browserPC.onconnectionstatechange = () => {
    console.log(`[BROWSER-BRIDGE:${connectionId}] Peer connection state:`, browserPC.connectionState);
    if (browserPC.connectionState === 'disconnected' || browserPC.connectionState === 'failed' || browserPC.connectionState === 'closed') {
      console.log(`[BROWSER-BRIDGE:${connectionId}] Connection closed, cleaning up...`);
      handleBrowserDisconnect(connectionId);
    }
  };
  browserPC.onicegatheringstatechange = () => {
    console.log(`[BROWSER-BRIDGE:${connectionId}] ICE gathering state:`, browserPC.iceGatheringState);
  };

  console.log('[BROWSER-BRIDGE] Creating audio source for browser output');
  const browserSource = new RTCAudioSource();
  const browserTrack = browserSource.createTrack();
  browserPC.addTrack(browserTrack);
  console.log('[BROWSER-BRIDGE] Browser audio track added to peer connection');

  let browserSink: any = null;
  let audioFrameCount = 0;
  let assistantFrameCount = 0;

  console.log('[BROWSER-BRIDGE] Getting long-lived OpenAI Realtime session...');
  await realtimeSessionManager.getSession();
  console.log('[BROWSER-BRIDGE] OpenAI Realtime session ready');

  browserPC.ontrack = (event: { track: MediaStreamTrack }) => {
    console.log(`[BROWSER-BRIDGE:${connectionId}] ontrack event received, track kind:`, event.track.kind);
    if (event.track.kind === 'audio') {
      console.log(`[BROWSER-BRIDGE:${connectionId}] Audio track detected - setting up browser audio sink`);
      browserSink = new RTCAudioSink(event.track);
      browserSink.ondata = (frame: RTCAudioSinkEvent) => {
        audioFrameCount++;
        if (audioFrameCount === 1) {
          console.log(
            `[BROWSER-BRIDGE:${connectionId}] First browser frame - sampleRate:`,
            (frame as any)?.sampleRate,
            'channels:',
            (frame as any)?.channelCount,
            'frames:',
            (frame as any)?.numberOfFrames,
          );
        }
        if (audioFrameCount % 100 === 0) {
          console.log(`[BROWSER-BRIDGE:${connectionId}] Browser → OpenAI audio frames sent:`, audioFrameCount);
        }
        // Forward this frontend's audio to OpenAI
        realtimeSessionManager.sendUserAudio(frame);
      };
      console.log(`[BROWSER-BRIDGE:${connectionId}] Browser audio sink configured - forwarding to OpenAI`);
    }
  };

  // Register this connection's audio listener for assistant audio
  console.log(`[BROWSER-BRIDGE:${connectionId}] Setting up OpenAI → Browser audio forwarding`);
  const unsubscribeAudio = realtimeSessionManager.addAssistantAudioListener(connectionId, (frame: RealtimeAudioFrame) => {
    assistantFrameCount++;
    if (assistantFrameCount === 1) {
      console.log(
        `[BROWSER-BRIDGE:${connectionId}] First assistant frame heading to browser - sampleRate:`,
        (frame as any)?.sampleRate,
        'channels:',
        (frame as any)?.channelCount,
        'frames:',
        (frame as any)?.numberOfFrames,
      );
    }
    if (assistantFrameCount % 100 === 0) {
      console.log(`[BROWSER-BRIDGE:${connectionId}] OpenAI → Browser audio frames sent:`, assistantFrameCount);
    }
    browserSource.onData(frame);
  });
  console.log(`[BROWSER-BRIDGE:${connectionId}] Audio bridge fully configured (bidirectional)`);

  console.log('[BROWSER-BRIDGE] Setting remote description from browser offer...');
  await browserPC.setRemoteDescription({ type: 'offer', sdp: offerSdp });
  console.log('[BROWSER-BRIDGE] Remote description set successfully');

  console.log('[BROWSER-BRIDGE] Creating SDP answer...');
  const answer = await browserPC.createAnswer();
  console.log('[BROWSER-BRIDGE] SDP answer created');

  console.log('[BROWSER-BRIDGE] Setting local description...');
  await browserPC.setLocalDescription(answer);
  console.log('[BROWSER-BRIDGE] Local description set successfully - awaiting ICE candidates');
  await waitForIceGatheringComplete(browserPC, `BROWSER-BRIDGE:${connectionId}`);

  const answerSdp = browserPC.localDescription?.sdp ?? answer.sdp!;
  const candidateCount = (answerSdp.match(/a=candidate/g) || []).length;
  console.log(`[BROWSER-BRIDGE:${connectionId}] Answer SDP ready with ICE candidates:`, candidateCount, 'length:', answerSdp.length);

  // Create cleanup function for this connection
  const close = () => {
    console.log(`[BROWSER-BRIDGE:${connectionId}] Closing connection - cleanup started`);
    try {
      // Unsubscribe from assistant audio
      unsubscribeAudio();

      if (browserSink) {
        console.log(`[BROWSER-BRIDGE:${connectionId}] Stopping browser audio sink`);
        browserSink.stop();
      }
      console.log(`[BROWSER-BRIDGE:${connectionId}] Stopping browser audio track`);
      browserTrack.stop();
      console.log(`[BROWSER-BRIDGE:${connectionId}] Closing browser peer connection`);
      browserPC.close();
      // NOTE: We do NOT close the OpenAI session - it's long-lived
      console.log(`[BROWSER-BRIDGE:${connectionId}] Connection cleanup completed successfully`);
    } catch (err) {
      console.error(`[BROWSER-BRIDGE:${connectionId}] Error during cleanup:`, err);
    }
  };

  // Store connection in map
  const connection: BrowserConnection = {
    id: connectionId,
    pc: browserPC,
    browserSink,
    browserSource,
    browserTrack,
    unsubscribeAudio,
    close,
  };
  connections.set(connectionId, connection);

  console.log(`[BROWSER-BRIDGE:${connectionId}] Connection setup complete! Active connections: ${connections.size}`);
  console.log(`[BROWSER-BRIDGE:${connectionId}] Returning answer SDP to server`);
  return { answerSdp, connectionId };
}

/**
 * Disconnect a specific browser connection by ID
 */
export function handleBrowserDisconnect(connectionId: string): { status: string } {
  const connection = connections.get(connectionId);
  if (!connection) {
    console.log(`[BROWSER-BRIDGE] Disconnect requested for unknown connection: ${connectionId}`);
    return { status: 'not_found' };
  }

  console.log(`[BROWSER-BRIDGE] Disconnecting connection: ${connectionId}`);
  connection.close();
  connections.delete(connectionId);
  console.log(`[BROWSER-BRIDGE] Connection ${connectionId} removed. Active connections: ${connections.size}`);

  return { status: 'disconnected' };
}
