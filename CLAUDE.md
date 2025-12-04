# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Context

This is a **minimal standalone implementation** extracted from the TeleChat repository. It replaces TeleChat's WhatsApp voice interface with a browser-based WebRTC connection, serving as a **test and debug environment** for understanding and refining the WebRTC ↔ OpenAI Realtime API bridge.

**Current Status:** Active development, testing, and debugging. The codebase is trimmed to the core voice bridge, with a modern minimal frontend, animated background, and live dual meters.

**Purpose:** Demonstrate and validate the audio bridging pattern between browser WebRTC and OpenAI's Realtime API before integrating back into TeleChat or other projects. Frontend shows start/stop + mute controls, dual level meters (outgoing teal, incoming blue), and hides the audio element while keeping playback active.

## Project Architecture

The backend acts as a **dual WebRTC peer**:
- **PC-BROWSER:** WebRTC connection to the browser client
- **PC-OA:** WebRTC connection to OpenAI Realtime API

### Audio Flow

```
Browser mic → PC-BROWSER → browserSink → OpenAI Realtime API
OpenAI response → audioSink → browserSource → PC-BROWSER → Browser speakers
```

**Key Components:**
- `browserSink` (RTCAudioSink): Captures browser microphone audio frames
- `audioSink` (RTCAudioSink): Receives OpenAI assistant audio frames
- `browserSource` (RTCAudioSource): Sends audio back to browser
- `audioSource` (RTCAudioSource): Sends user audio to OpenAI

All audio is PCM16 format, bridged frame-by-frame without buffering. Both sides wait for ICE gathering before sending SDP to reduce early packet loss; first-frame metadata is logged.

## Development Commands

```bash
# Install dependencies
npm install

# Build TypeScript to CommonJS
npm run build

# Start production server (requires build first)
npm start

# Build and run in development (build + node dist/server.js)
npm run dev

# Run tests (health + interactive E2E)
npm test
```

## Comprehensive Logging & UI Meters

The entire codebase includes **extensive console logging** plus live dual audio meters in the UI. All components log their operations with structured prefixes for easy filtering and identification.

### Logging Prefixes

**Backend:**
- `[CONFIG]` - Environment configuration loading and validation
- `[SERVER]` - Express server, endpoints, HTTP requests/responses
- `[BROWSER-BRIDGE]` - WebRTC bridge lifecycle, peer connections, SDP exchange
- `[OPENAI-REALTIME]` - OpenAI Realtime API connection, events, data channel

**Frontend:**
- `[FRONTEND]` - Browser WebRTC client, connection setup, user interactions, meter lifecycle

### What Gets Logged

**Configuration ([config.env.ts](src/config.env.ts)):**
- Environment variable loading
- Configuration values (API key truncated for security)
- Validation results

**Server ([server.ts](src/server.ts)):**
- Application initialization
- Middleware setup
- Static file serving path
- Health check requests
- /signal endpoint calls with SDP lengths
- Success/error responses

**Browser Bridge ([browser-bridge.ts](src/webrtc/browser-bridge.ts)):**
- Bridge creation/cleanup
- Peer connection lifecycle
- Audio track attachment
- **Audio frame counters** (logs every 100 frames to avoid spam)
- SDP offer/answer processing
- Critical connection ordering confirmation
- Cleanup operations with detailed steps
- ICE gathering waits on the answer, connection state logs, first-frame metadata

**OpenAI Realtime ([openai.realtime.ts](src/openai/openai.realtime.ts)):**
- Session initialization
- Peer connection setup
- Audio sink/source creation
- Data channel state changes
- **Event counters** (first 10 events, then every 50th)
- Session.update and response.create events
- Text deltas and completions
- Server-side VAD enabled (`turn_detection: server_vad`)
- **Assistant audio frame counts** (every 100 frames)
- Connection errors and timeouts
- Cleanup operations

**Frontend ([public/main.js](public/main.js)):**
- Script initialization
- Button clicks
- Microphone permission requests
- Peer connection creation
- Track additions
- ICE connection state changes
- Connection state changes
- SDP offer/answer with lengths
- Remote track reception
- Audio playback status
- Live dual audio meters (mic → model, model → user) driven by Web Audio analysers
- All error conditions

### Log Output Features

✅ **Structured prefixes** - Easy to grep/filter by component
✅ **Frame counting** - Logs every 100 audio frames (both directions) to confirm data flow without spam
✅ **Event counting** - OpenAI events logged selectively (first 10, then every 50th)
✅ **Security-safe** - API keys truncated to first 10 characters
✅ **Error context** - All errors include detailed context
✅ **Success confirmation** - Explicit logs for successful operations
✅ **SDP length tracking** - Helps identify malformed offers/answers
✅ **State transitions** - Connection and channel state changes logged

### Example Log Output

```
[CONFIG] Loading environment configuration...
[CONFIG] PORT: 8080
[CONFIG] OPENAI_API_KEY: sk-proj-I0...
[CONFIG] REALTIME_MODEL: gpt-realtime
[CONFIG] Configuration validated successfully
[SERVER] Initializing Express application...
[SERVER] Setting up middleware...
[SERVER] Static files served from: /home/user/project/public
Server listening on http://localhost:8080
[SERVER] /signal endpoint called - new WebRTC connection request
[SERVER] Valid offer received, SDP length: 1234
[BROWSER-BRIDGE] handleBrowserOffer called
[BROWSER-BRIDGE] Creating new RTCPeerConnection for browser
[BROWSER-BRIDGE] Connecting to OpenAI Realtime session (critical: BEFORE processing browser offer)...
[OPENAI-REALTIME] connectRealtimeSession called
[OPENAI-REALTIME] Creating RTCPeerConnection for OpenAI
[OPENAI-REALTIME] Data channel OPENED successfully!
[OPENAI-REALTIME] Sending session.update with system prompt
[BROWSER-BRIDGE] OpenAI Realtime session established successfully
[BROWSER-BRIDGE] Browser → OpenAI audio frames sent: 100
[BROWSER-BRIDGE] OpenAI → Browser audio frames sent: 100
[OPENAI-REALTIME] Assistant audio frames received: 100
```

## Interactive Testing & Debugging (PRIMARY FEATURE)

This project includes a **comprehensive interactive debugging system** built with Playwright that allows you to manually test the WebRTC bridge while monitoring both frontend and backend logs in real-time.

### Quick Start - Two Terminal Setup

**Terminal 1 - Backend Logs:**
```bash
source ~/.nvm/nvm.sh && npm start
```

**Terminal 2 - Frontend Logs + Browser:**
```bash
source ~/.nvm/nvm.sh && npm run test:interactive
```

### What You Get

**Terminal 1 (Backend):**
With the comprehensive logging system, you'll see:
- `[CONFIG]` Configuration loading and validation
- `[SERVER]` Server startup and HTTP endpoints
- `[BROWSER-BRIDGE]` WebRTC bridge operations and audio frame counts
- `[OPENAI-REALTIME]` OpenAI connection, data channel events, audio frames
- Detailed error messages with full context

**Terminal 2 (Frontend):**
Playwright test captures and displays:
- 🔵 **[BROWSER]** - Console logs from webpage (includes `[FRONTEND]` prefixed logs)
- 🔴 **[BROWSER ERROR]** - JavaScript errors
- 🟡 **[BROWSER WARN]** - Warnings
- 🟣 **[NETWORK →]** - Outgoing HTTP requests
- 🟢/🔴 **[NETWORK ←]** - Response status codes
- 🔷 **[STATUS]** - Connection status updates from UI
- ⚡ **[USER ACTION]** - UI interaction detection

**Browser Window:**
- Chromium opens automatically in headed mode
- Microphone permission auto-granted (fake device)
- Full DevTools access (F12) - shows same `[FRONTEND]` logs
- Manual interaction while watching logs
- Live dual meters: teal = outgoing/mic, blue = incoming/assistant. Audio element is hidden but active for playback.

### Available Commands

```bash
# Standard interactive test (10-minute timeout)
npm run test:interactive

# Same as above (alias)
npm run test:e2e

# Debug mode with Playwright inspector
npm run test:e2e:debug
```

### Key Features

✅ Real-time frontend logging (every console event)
✅ Network request/response monitoring
✅ Automatic status tracking
✅ Color-coded, timestamped output
✅ Auto-screenshot/video on failure
✅ Extended timeout for manual testing (configurable)
✅ Fake media device (no real microphone needed)
✅ Error summary at test completion

### Debugging Workflow

1. **Start server** → Terminal 1: `npm start`
2. **Run interactive test** → Terminal 2: `npm run test:interactive`
3. **Browser opens** → Click "Start Call" and test manually
4. **Monitor both terminals** → Watch for errors (highlighted in red)
5. **Identify issues** → Check file:line references
6. **Fix code** → Edit source files
7. **Rebuild** → `npm run build`
8. **Restart server** → Ctrl+C then `npm start`
9. **Test again** → Run `npm run test:interactive`

### Testing Files

- **[tests/interactive.e2e.test.ts](tests/interactive.e2e.test.ts)** - Interactive Playwright test with comprehensive logging
- **[playwright.config.ts](playwright.config.ts)** - Playwright configuration (headed mode, timeouts, permissions)
- **[DEBUGGING.md](DEBUGGING.md)** - Complete debugging guide with tips and troubleshooting

### Legacy Testing

```bash
# Run specific test file
npx vitest run tests/health.test.ts

# Run tests in watch mode for development
npx vitest

# Check build output
npm run build && ls -la dist/
```

**Note:** Basic health endpoint test exists via Vitest. The **interactive E2E test is the primary debugging tool** as it provides full visibility into both frontend and backend behavior during WebRTC connection establishment and audio bridging.

## Critical Architecture Patterns

### 1. Connection Order is Non-Negotiable

**ALWAYS establish the OpenAI connection BEFORE accepting the browser offer.**

In [browser-bridge.ts:27](src/webrtc/browser-bridge.ts#L27), `connectRealtimeSession()` is called BEFORE processing the browser offer. This ordering prevents:
- Audio jitter during connection establishment
- Packet loss in initial audio frames
- Race conditions in track attachment

**Execution Flow:**
1. Browser sends offer to `/signal` endpoint
2. Backend creates `browserPC` peer connection
3. **Call `await connectRealtimeSession()`** ← OpenAI connection established first
4. Wire up audio bridges (`browserSink` → OpenAI, OpenAI → `browserSource`)
5. Process browser offer/answer exchange

This pattern was discovered during TeleChat development and is critical to audio quality.

### 2. Audio Bridging with wrtc Nonstandard APIs

The `wrtc` library provides non-standard APIs (`RTCAudioSource`, `RTCAudioSink`) for raw audio frame manipulation:

```javascript
const { RTCAudioSink, RTCAudioSource } = require('wrtc').nonstandard;
```

**Browser → OpenAI Bridge:**
```javascript
browserSink = new RTCAudioSink(event.track);
browserSink.ondata = (frame) => {
  realtime.sendUserAudio(frame);  // Forward to OpenAI
};
```

**OpenAI → Browser Bridge:**
```javascript
realtime.onAssistantAudio((frame) => {
  browserSource.onData(frame);  // Forward to browser
});
```

These are attached in `ontrack` event handlers AFTER peer connections are established, since tracks may not be immediately available.

### 3. Single Active Bridge Enforcement

Only one bridge instance is allowed at a time. See [browser-bridge.ts:15-18](src/webrtc/browser-bridge.ts#L15-L18):

```javascript
if (currentBridge) {
  currentBridge.close();  // Clean up previous connection
  currentBridge = null;
}
```

This prevents resource leaks and audio conflicts when users reconnect or refresh.

### 4. OpenAI Data Channel Protocol

OpenAI Realtime uses a WebRTC data channel (`oai-events`) for control messages and text responses:

**Session Initialization (on channel open):**
- `session.update` with system prompt
- `response.create` to trigger initial greeting

**Event Handling:**
- `response.output_text.delta` - Streaming text chunks (if text mode enabled)
- `response.completed` - Response finished
- `response.error` / `error` - Error handling

See [openai.realtime.ts:123-147](src/openai/openai.realtime.ts#L123-L147) for the channel open handler.

**Important:** The data channel must be fully opened (`onopen` fired) before sending events. The code waits for `channelReady` promise before allowing event sends.

### 5. System Prompt Configuration

Currently hardcoded in [openai.realtime.ts:26](src/openai/openai.realtime.ts#L26):

```javascript
const systemPrompt = 'Você é um assistente de voz amigável da TeleChat falando com o usuário pelo navegador.';
```

This is a remnant from TeleChat extraction. In production, this should be configurable via environment variables or constructor parameters.

## Build System Rationale

Uses **CommonJS** instead of ESM to avoid Node.js experimental loader issues:

- TypeScript config: `"module": "CommonJS"`
- Package.json: `"type": "commonjs"`
- Build output: `src/` → `dist/` (CommonJS `.js` files)
- Execution: Plain `node dist/server.js` (no loaders needed)

This decision was made for compatibility with nvm and Node 22+ environments, avoiding the fragility of `--experimental-loader` flags.

## Key Files & Responsibilities

### Backend

- **[src/server.ts](src/server.ts)** - Express app, `/signal` endpoint receives browser offers
- **[src/webrtc/browser-bridge.ts](src/webrtc/browser-bridge.ts)** - Core bridging logic, creates dual WebRTC connections
- **[src/openai/openai.realtime.ts](src/openai/openai.realtime.ts)** - OpenAI Realtime API connection (PC-OA)
- **[src/config.env.ts](src/config.env.ts)** - Environment variable loading and validation

### Frontend

- **[public/main.js](public/main.js)** - Browser WebRTC client (vanilla JavaScript, no framework)
- **[public/index.html](public/index.html)** - Minimal UI with "Start Call" button

### Testing

- **[tests/health.test.ts](tests/health.test.ts)** - Basic health endpoint test (Vitest + Supertest)

**Note:** Server exports the Express app without calling `.listen()` in test mode (see [server.ts:32-36](src/server.ts#L32-L36)) to enable Supertest integration.

## Environment Configuration

Create `.env` from `.env.example`:

```env
OPENAI_API_KEY=sk-proj-...           # Required: OpenAI API key
REALTIME_MODEL=gpt-4o-realtime-preview-2024-10-01  # Or gpt-realtime
PORT=8080                             # Server port
```

**Validation:** [config.env.ts](src/config.env.ts) throws an error if `OPENAI_API_KEY` is missing (except in test mode).

## Known Limitations & Debug Areas

1. **No Error Recovery:** Connection failures require page refresh. No automatic reconnection logic.

2. **Single Concurrent User:** The `currentBridge` singleton means only one user can connect at a time. Multiple users would require session management.

3. **Hardcoded Portuguese Prompt:** System prompt is in Portuguese (TeleChat legacy). Should be configurable.

4. **Minimal Test Coverage:** Only health endpoint tested. Audio bridging logic has no automated tests (requires WebRTC mocking).

5. **Basic Audio Monitoring:** Frame counting is available (logs every 100 frames) but no metrics for packet loss, jitter, or latency.

6. **Resource Cleanup:** Bridge cleanup relies on `currentBridge.close()`. Need verification that all tracks/sinks/sources are properly disposed.

## Development Notes

### When Modifying Audio Flow

- Preserve the connection order (OpenAI first, browser second)
- Audio frames are `{ samples: Int16Array }` from RTCAudioSink
- Both `browserSource.onData()` and `audioSource.onData()` expect this format
- Track attachment happens asynchronously via `ontrack` events

### When Adding Features

- This is meant to be **minimal**. Consider whether features belong here or in TeleChat.
- Keep the scope limited to demonstrating the core WebRTC ↔ OpenAI bridge pattern.
- Test manually via browser before adding automated tests.

### When Debugging Connection Issues

**PRIMARY METHOD:** Use the interactive E2E test with comprehensive logging (see "Interactive Testing & Debugging" section above):
```bash
# Terminal 1 - Backend logs with [CONFIG], [SERVER], [BROWSER-BRIDGE], [OPENAI-REALTIME] prefixes
npm start

# Terminal 2 - Frontend logs with [FRONTEND] prefix captured by Playwright
npm run test:interactive
```

This provides real-time visibility into both frontend and backend behavior with color-coded logs.

**Debugging with Logs:**

The comprehensive logging system helps identify issues at every stage:

1. **Configuration Issues** - Look for `[CONFIG]` errors at startup
2. **Connection Flow** - Track the entire WebRTC handshake:
   - `[SERVER]` logs show /signal endpoint calls and SDP lengths
   - `[BROWSER-BRIDGE]` confirms OpenAI-first connection ordering
   - `[OPENAI-REALTIME]` shows data channel opening
3. **Audio Flow** - Monitor frame counters:
   - `Browser → OpenAI audio frames sent: N` (every 100 frames)
   - `OpenAI → Browser audio frames sent: N` (every 100 frames)
   - `Assistant audio frames received: N` (every 100 frames)
4. **Events** - Track OpenAI Realtime events (first 10, then every 50th)
5. **State Changes** - ICE connection state and peer connection state logged

**Filtering Logs:**

Use grep to focus on specific components:
```bash
# Only browser bridge logs
npm start 2>&1 | grep BROWSER-BRIDGE

# Only OpenAI logs
npm start 2>&1 | grep OPENAI-REALTIME

# Only errors
npm start 2>&1 | grep -i error

# Audio frame counts only
npm start 2>&1 | grep "frames"
```

**Manual debugging checklist:**
- Check `[CONFIG]` logs for environment variable issues
- Look for `[OPENAI-REALTIME] Data channel OPENED successfully!` message
- Verify audio frame counters are incrementing (both directions)
- Check `[FRONTEND]` logs in browser console or Playwright output for client-side errors
- Ensure SDP lengths are reasonable (>1000 chars typically)
- Look for connection state: "connected" in logs
- Monitor for "Timeout" or "Error" messages with context

### When Integrating Back to TeleChat

- Extract configuration (system prompt, model) to parameters
- Add proper session management for multiple concurrent users
- Implement reconnection logic
- Add audio quality metrics and logging
- Consider replacing hardcoded messages with i18n
