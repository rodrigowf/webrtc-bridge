declare module 'wrtc' {
  export type RTCAudioSinkEvent = {
    samples: Int16Array;
    sampleRate?: number;
    bitsPerSample?: number;
    channelCount?: number;
    numberOfFrames?: number;
  };

  export type RTCIceConnectionState = 'new' | 'checking' | 'connected' | 'completed' | 'failed' | 'disconnected' | 'closed';
  export type RTCIceGatheringState = 'new' | 'gathering' | 'complete';
  export type RTCPeerConnectionState = 'new' | 'connecting' | 'connected' | 'disconnected' | 'failed' | 'closed';

  export interface MediaStreamTrack {
    kind: string;
    stop(): void;
  }

  export class RTCRtpReceiver {
    readonly track: MediaStreamTrack;
  }

  export class RTCAudioSink {
    ondata?: (event: RTCAudioSinkEvent) => void;
    constructor(track: MediaStreamTrack);
    stop(): void;
  }

  export class RTCAudioSource {
    createTrack(): MediaStreamTrack;
    onData(event: RTCAudioSinkEvent): void;
    stop(): void;
  }

  export class RTCPeerConnection {
    iceConnectionState: RTCIceConnectionState;
    iceGatheringState: RTCIceGatheringState;
    connectionState: RTCPeerConnectionState;
    localDescription?: { type: 'offer' | 'answer'; sdp?: string };
    remoteDescription?: { type: 'offer' | 'answer'; sdp?: string };
    ontrack?: (event: { receiver: RTCRtpReceiver; track: MediaStreamTrack; streams: MediaStream[] }) => void;
    oniceconnectionstatechange?: () => void;
    onicegatheringstatechange?: () => void;
    onconnectionstatechange?: () => void;
    constructor(config?: unknown);
    addEventListener?(event: string, listener: () => void): void;
    addTrack(track: MediaStreamTrack, stream?: MediaStream): void;
    createAnswer(options?: unknown): Promise<{ type: 'answer'; sdp?: string }>;
    createOffer(options?: unknown): Promise<{ type: 'offer'; sdp?: string }>;
    setLocalDescription(desc: { type: 'offer' | 'answer'; sdp?: string }): Promise<void>;
    setRemoteDescription(desc: { type: 'offer' | 'answer'; sdp?: string }): Promise<void>;
    createDataChannel(label: string): RTCDataChannel;
    close(): void;
  }

  export class RTCDataChannel {
    onmessage?: (event: { data: string | Buffer }) => void;
    onopen?: () => void;
    onerror?: (event: unknown) => void;
    send(data: string | Buffer): void;
  }
}
