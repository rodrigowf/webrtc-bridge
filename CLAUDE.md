# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**vcode** - A voice-controlled coding agent that handles complex code and terminal tasks through natural speech.

The system bridges browser WebRTC audio to OpenAI's Realtime voice API, with an integrated Codex agent that can execute code generation, file operations, and terminal commands.

## Development Commands

```bash
npm install              # Install dependencies
npm run build            # Build TypeScript to ESM (src/ → dist/)
npm start                # Start server (requires build first)
npm run dev              # Build + start in one command

npm test                 # Run unit tests (health, codex service, SSE)
npm run test:e2e         # Interactive Playwright E2E test (opens browser)
npm run test:e2e:debug   # E2E with Playwright inspector

vcode                    # Global CLI launcher (after: npm install -g .)
```

## Architecture

### Voice Pipeline

Browser audio flows through the backend to OpenAI Realtime, with responses routed back:

```
Browser mic → PC-BROWSER → browserSink → audioSource → PC-OA → OpenAI Realtime
OpenAI Realtime → PC-OA → audioSink → browserSource → PC-BROWSER → Browser speakers
```

The backend acts as two simultaneous WebRTC peers:
- **PC-BROWSER**: Connection to the browser client
- **PC-OA**: Connection to OpenAI Realtime API

### Codex Agent

The Codex service ([codex.service.ts](src/codex/codex.service.ts)) runs OpenAI Codex with:
- `approvalPolicy: 'never'` - Autonomous execution
- `sandboxMode: 'workspace-write'` - Can modify files in workspace
- `networkAccessEnabled: true` - Can make network requests

Events stream via SSE at `/codex/events`.

### Critical: Connection Order

**ALWAYS establish OpenAI connection BEFORE accepting browser offer.** In [browser-bridge.ts](src/webrtc/browser-bridge.ts), `connectRealtimeSession()` is called first. This prevents audio jitter and packet loss.

### Key Files

| File | Purpose |
|------|---------|
| [src/server.ts](src/server.ts) | Express app, `/signal` WebRTC endpoint, `/codex/*` endpoints |
| [src/webrtc/browser-bridge.ts](src/webrtc/browser-bridge.ts) | Dual WebRTC bridging, single-session enforcement |
| [src/openai/openai.realtime.ts](src/openai/openai.realtime.ts) | OpenAI Realtime API connection, data channel |
| [src/codex/codex.service.ts](src/codex/codex.service.ts) | Codex SDK wrapper, thread management, event broadcasting |
| [src/memory/context.memory.ts](src/memory/context.memory.ts) | Persistent context memory across sessions |
| [src/cli.ts](src/cli.ts) | Global `vcode` command entrypoint |
| [public/main.js](public/main.js) | Browser WebRTC client, audio meters, UI |

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/healthz` | GET | Health check |
| `/signal` | POST | WebRTC signaling (accepts `{offer}`, returns `{answer}`) |
| `/codex/run` | POST | Run Codex with `{prompt}` |
| `/codex/stop` | POST | Abort current Codex turn |
| `/codex/reset` | POST | Reset Codex thread |
| `/codex/status` | GET | Get current thread ID |
| `/codex/events` | GET | SSE stream of Codex events |

## Build System

Uses **ESM** (ES2020 modules):
- `package.json`: `"type": "module"`
- `tsconfig.json`: `"module": "ES2020"`
- Output: `src/` → `dist/` (`.js` files with ESM imports)

## Environment Variables

Create `.env` from `.env.example`:
```env
OPENAI_API_KEY=sk-proj-...    # Required
REALTIME_MODEL=gpt-4o-realtime-preview-2024-10-01
PORT=8080
```

## Logging Prefixes

All components use structured logging:
- `[CONFIG]` - Environment configuration
- `[SERVER]` - Express server, HTTP endpoints
- `[BROWSER-BRIDGE]` - WebRTC bridge, audio frame counts
- `[OPENAI-REALTIME]` - OpenAI connection, data channel
- `[CODEX]` - Codex service operations
- `[MEMORY]` - Context memory operations
- `[FRONTEND]` - Browser client (in console)

Filter logs: `npm start 2>&1 | grep CODEX`

## Testing & Debugging

**Primary debugging method**: Two-terminal setup with Playwright:

```bash
# Terminal 1 - Backend logs
npm start

# Terminal 2 - Frontend logs + browser window
npm run test:interactive
```

Playwright opens Chromium with auto-granted mic permissions and captures all frontend console logs.

## wrtc Nonstandard APIs

The `wrtc` library provides raw audio frame access:
```typescript
const { RTCAudioSink, RTCAudioSource } = require('wrtc').nonstandard;
```

Audio frames are `{ samples: Int16Array }` - PCM16 format bridged frame-by-frame.

## Known Constraints

1. **Single concurrent user** - `currentBridge` singleton allows one active session
2. **No auto-reconnect** - Connection failures require page refresh
3. **Hardcoded Portuguese prompt** - System prompt in [openai.realtime.ts:26](src/openai/openai.realtime.ts#L26)
