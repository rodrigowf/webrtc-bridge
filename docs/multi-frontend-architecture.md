# Multi-Frontend Architecture in vcode

The system solves the N:1 problem (multiple browser tabs → single OpenAI Realtime session) through a layered architecture. Here's how it works.

## The Core Challenge

OpenAI's Realtime API provides a single WebSocket connection with bidirectional audio. But we want:
- Multiple users/tabs to share one session
- Independent audio control per frontend
- Graceful handling of connects/disconnects without disrupting the session

## Solution Architecture

```
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│ Frontend A  │  │ Frontend B  │  │ Frontend C  │
│  (Browser)  │  │  (Browser)  │  │  (Browser)  │
└──────┬──────┘  └──────┬──────┘  └──────┬──────┘
       │ WebRTC         │ WebRTC         │ WebRTC
       └────────────────┼────────────────┘
                        ▼
              ┌─────────────────────┐
              │ BrowserConnectionMgr │  ← Per-connection state
              │   connections Map    │     (N connections)
              └──────────┬──────────┘
                         │ Audio frames
                         ▼
              ┌─────────────────────┐
              │ RealtimeSessionMgr  │  ← Singleton, app-scoped
              │  (OpenAI WebSocket) │     (1 connection)
              └─────────────────────┘
```

## Key Components

### 1. RealtimeSessionManager - The Singleton

Located in `src/openai/openai.realtime.ts`, this maintains a **single long-lived OpenAI connection**:

```typescript
// Singleton pattern - one session for entire app
let instance: RealtimeSessionManager | null = null;

export function getRealtimeSessionManager(): RealtimeSessionManager {
  if (!instance) {
    instance = new RealtimeSessionManager();
  }
  return instance;
}
```

The session persists even when all frontends disconnect, avoiding reconnection latency.

### 2. BrowserConnectionManager - The Multiplexer

Located in `src/webrtc/browser-bridge.ts`, this manages N frontend connections:

```typescript
// Each frontend gets a unique connection entry
const connections = new Map<string, {
  pc: RTCPeerConnection;
  audioSink: RTCAudioSink;
  audioSource: RTCAudioSource;
  // ... per-connection state
}>();
```

### 3. Audio Flow Handling

**Inbound (Mic → OpenAI):**
- Each frontend's mic audio arrives via WebRTC
- The `RTCAudioSink` captures PCM16 frames
- Frames are forwarded to OpenAI (VAD handles overlapping speakers)

**Outbound (OpenAI → Speakers):**
- OpenAI sends assistant audio once
- Backend **broadcasts** to all connected frontends via their `RTCAudioSource`
- Each frontend can independently mute playback locally

### 4. Connection Lifecycle

**Connect (POST /signal):**
```typescript
// Critical: OpenAI connection FIRST, then WebRTC
const session = await realtimeSessionManager.getSession();  // Ensures OpenAI ready
const answer = await handleBrowserOffer(offer);              // Then accept browser
return { answer, connectionId };                             // Return unique ID
```

**Disconnect (POST /disconnect or beforeunload):**
```typescript
// Clean up just this frontend, session stays alive
connections.get(connectionId)?.pc.close();
connections.delete(connectionId);
// RealtimeSessionManager untouched - other frontends unaffected
```

## Architectural Challenges Solved

| Challenge | Solution |
|-----------|----------|
| **Connection order matters** | Always establish OpenAI first, prevents audio jitter |
| **Session persistence** | Singleton RealtimeSessionManager survives frontend disconnects |
| **Independent audio control** | Per-frontend mute state, local playback control |
| **Resource cleanup** | Map-based tracking with unique IDs, graceful teardown |
| **Overlapping speech** | OpenAI's VAD handles multiple speakers naturally |
| **Broadcast efficiency** | Single OpenAI response → fan-out to all frontends |

## Why This Design?

1. **Decoupling**: Frontend lifecycle is independent from OpenAI session lifecycle
2. **Efficiency**: One OpenAI connection regardless of frontend count
3. **Resilience**: Tab crashes don't kill the session for others
4. **Simplicity**: Each layer has a single responsibility
