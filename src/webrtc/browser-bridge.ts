import { RTCPeerConnection, type MediaStreamTrack } from 'wrtc';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { RTCAudioSink, RTCAudioSource } = require('wrtc').nonstandard;

type RTCAudioSinkEvent = { samples: Int16Array };

import { connectRealtimeSession } from '../openai/openai.realtime';

let currentBridge: {
  close: () => void;
} | null = null;

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

export async function handleBrowserOffer(offerSdp: string): Promise<{ answerSdp: string }> {
  console.log('[BROWSER-BRIDGE] handleBrowserOffer called');

  if (currentBridge) {
    console.log('[BROWSER-BRIDGE] Closing existing bridge before creating new one');
    currentBridge.close();
    currentBridge = null;
  }

  console.log('[BROWSER-BRIDGE] Creating new RTCPeerConnection for browser');
  const browserPC = new RTCPeerConnection();
  browserPC.oniceconnectionstatechange = () => {
    console.log('[BROWSER-BRIDGE] ICE connection state:', browserPC.iceConnectionState);
  };
  browserPC.onconnectionstatechange = () => {
    console.log('[BROWSER-BRIDGE] Peer connection state:', browserPC.connectionState);
  };
  browserPC.onicegatheringstatechange = () => {
    console.log('[BROWSER-BRIDGE] ICE gathering state:', browserPC.iceGatheringState);
  };

  console.log('[BROWSER-BRIDGE] Creating audio source for browser output');
  const browserSource = new RTCAudioSource();
  const browserTrack = browserSource.createTrack();
  browserPC.addTrack(browserTrack);
  console.log('[BROWSER-BRIDGE] Browser audio track added to peer connection');

  let browserSink: any = null;
  let audioFrameCount = 0;
  let assistantFrameCount = 0;

  console.log('[BROWSER-BRIDGE] Connecting to OpenAI Realtime session (critical: BEFORE processing browser offer)...');
  const realtime = await connectRealtimeSession();
  console.log('[BROWSER-BRIDGE] OpenAI Realtime session established successfully');

  browserPC.ontrack = (event: { track: MediaStreamTrack }) => {
    console.log('[BROWSER-BRIDGE] ontrack event received, track kind:', event.track.kind);
    if (event.track.kind === 'audio') {
      console.log('[BROWSER-BRIDGE] Audio track detected - setting up browser audio sink');
      browserSink = new RTCAudioSink(event.track);
      browserSink.ondata = (frame: RTCAudioSinkEvent) => {
        audioFrameCount++;
        if (audioFrameCount === 1) {
          console.log(
            '[BROWSER-BRIDGE] First browser frame - sampleRate:',
            (frame as any)?.sampleRate,
            'channels:',
            (frame as any)?.channelCount,
            'frames:',
            (frame as any)?.numberOfFrames,
          );
        }
        if (audioFrameCount % 100 === 0) {
          console.log('[BROWSER-BRIDGE] Browser → OpenAI audio frames sent:', audioFrameCount);
        }
        realtime.sendUserAudio(frame);
      };
      console.log('[BROWSER-BRIDGE] Browser audio sink configured - forwarding to OpenAI');
    }
  };

  console.log('[BROWSER-BRIDGE] Setting up OpenAI → Browser audio forwarding');
  realtime.onAssistantAudio((frame: RTCAudioSinkEvent) => {
    assistantFrameCount++;
    if (assistantFrameCount === 1) {
      console.log(
        '[BROWSER-BRIDGE] First assistant frame heading to browser - sampleRate:',
        (frame as any)?.sampleRate,
        'channels:',
        (frame as any)?.channelCount,
        'frames:',
        (frame as any)?.numberOfFrames,
      );
    }
    if (assistantFrameCount % 100 === 0) {
      console.log('[BROWSER-BRIDGE] OpenAI → Browser audio frames sent:', assistantFrameCount);
    }
    browserSource.onData(frame);
  });
  console.log('[BROWSER-BRIDGE] Audio bridge fully configured (bidirectional)');

  console.log('[BROWSER-BRIDGE] Setting remote description from browser offer...');
  await browserPC.setRemoteDescription({ type: 'offer', sdp: offerSdp });
  console.log('[BROWSER-BRIDGE] Remote description set successfully');

  console.log('[BROWSER-BRIDGE] Creating SDP answer...');
  const answer = await browserPC.createAnswer();
  console.log('[BROWSER-BRIDGE] SDP answer created');

  console.log('[BROWSER-BRIDGE] Setting local description...');
  await browserPC.setLocalDescription(answer);
  console.log('[BROWSER-BRIDGE] Local description set successfully - awaiting ICE candidates');
  await waitForIceGatheringComplete(browserPC, 'BROWSER-BRIDGE');

  const answerSdp = browserPC.localDescription?.sdp ?? answer.sdp!;
  const candidateCount = (answerSdp.match(/a=candidate/g) || []).length;
  console.log('[BROWSER-BRIDGE] Answer SDP ready with ICE candidates:', candidateCount, 'length:', answerSdp.length);

  console.log('[BROWSER-BRIDGE] Registering cleanup handler for current bridge');
  currentBridge = {
    close: () => {
      console.log('[BROWSER-BRIDGE] Closing bridge - cleanup started');
      try {
        if (browserSink) {
          console.log('[BROWSER-BRIDGE] Stopping browser audio sink');
          browserSink.stop();
        }
        console.log('[BROWSER-BRIDGE] Stopping browser audio track');
        browserTrack.stop();
        console.log('[BROWSER-BRIDGE] Closing browser peer connection');
        browserPC.close();
        console.log('[BROWSER-BRIDGE] Closing OpenAI Realtime session');
        realtime.close();
        console.log('[BROWSER-BRIDGE] Bridge cleanup completed successfully');
      } catch (err) {
        console.error('[BROWSER-BRIDGE] Error during cleanup:', err);
      }
    },
  };

  console.log('[BROWSER-BRIDGE] Bridge setup complete! Total audio frames - Browser→OpenAI:', audioFrameCount, 'OpenAI→Browser:', assistantFrameCount);
  console.log('[BROWSER-BRIDGE] Returning answer SDP to server');
  return { answerSdp: answerSdp };
}
