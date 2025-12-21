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

export async function handleBrowserOffer(offerSdp: string): Promise<{ answerSdp: string; connectionId: string }> {
  const connectionId = generateConnectionId();
  console.log(`[BROWSER-BRIDGE] New connection: ${connectionId}`);

  // Check if OpenAI session is already running - only connect if services are started
  if (!realtimeSessionManager.isConnected()) {
    console.log(`[BROWSER-BRIDGE:${connectionId}] Services not started - waiting for user to start services`);
    throw new Error('Services not started. Please start services first.');
  }

  const browserPC = new RTCPeerConnectionClass();

  // Track connection state for auto-cleanup
  browserPC.oniceconnectionstatechange = () => {
    if (browserPC.iceConnectionState === 'disconnected' || browserPC.iceConnectionState === 'failed') {
      handleBrowserDisconnect(connectionId);
    }
  };
  browserPC.onconnectionstatechange = () => {
    if (browserPC.connectionState === 'disconnected' || browserPC.connectionState === 'failed' || browserPC.connectionState === 'closed') {
      handleBrowserDisconnect(connectionId);
    }
  };

  const browserSource = new RTCAudioSource();
  const browserTrack = browserSource.createTrack();
  browserPC.addTrack(browserTrack);

  let browserSink: any = null;

  await realtimeSessionManager.getSession();

  browserPC.ontrack = (event: { track: MediaStreamTrack }) => {
    if (event.track.kind === 'audio') {
      browserSink = new RTCAudioSink(event.track);
      browserSink.ondata = (frame: RTCAudioSinkEvent) => {
        realtimeSessionManager.sendUserAudio(frame);
      };
    }
  };

  const unsubscribeAudio = realtimeSessionManager.addAssistantAudioListener(connectionId, (frame: RealtimeAudioFrame) => {
    browserSource.onData(frame);
  });

  await browserPC.setRemoteDescription({ type: 'offer', sdp: offerSdp });
  const answer = await browserPC.createAnswer();
  await browserPC.setLocalDescription(answer);
  await waitForIceGatheringComplete(browserPC, `BROWSER-BRIDGE:${connectionId}`);

  const answerSdp = browserPC.localDescription?.sdp ?? answer.sdp!;

  const close = () => {
    try {
      unsubscribeAudio();
      if (browserSink) {
        browserSink.stop();
      }
      browserTrack.stop();
      browserPC.close();
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

  console.log(`[BROWSER-BRIDGE] Connection ${connectionId} ready (total: ${connections.size})`);
  return { answerSdp, connectionId };
}

/**
 * Disconnect a specific browser connection by ID
 */
export function handleBrowserDisconnect(connectionId: string): { status: string } {
  const connection = connections.get(connectionId);
  if (!connection) {
    return { status: 'not_found' };
  }

  connection.close();
  connections.delete(connectionId);
  console.log(`[BROWSER-BRIDGE] Disconnected ${connectionId} (remaining: ${connections.size})`);

  return { status: 'disconnected' };
}

/**
 * Disconnect ALL browser connections (used when stopping services)
 */
export function disconnectAllBrowserConnections(): { count: number } {
  const count = connections.size;
  console.log(`[BROWSER-BRIDGE] Disconnecting all ${count} browser connection(s)`);

  for (const [connectionId, connection] of connections.entries()) {
    try {
      connection.close();
      console.log(`[BROWSER-BRIDGE] Closed connection ${connectionId}`);
    } catch (err) {
      console.error(`[BROWSER-BRIDGE] Error closing connection ${connectionId}:`, err);
    }
  }

  connections.clear();
  console.log(`[BROWSER-BRIDGE] All browser connections disconnected`);

  return { count };
}
