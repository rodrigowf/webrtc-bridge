# VCode Context Memory

Persistent notes the assistant should read on startup so context survives across runs.

## Purpose
- Keep debugging notes, user preferences, agreements, and project facts available to the assistant.
- Update this file instead of relying on transient conversation memory.

## User Preferences
- (add preferences here)

## Debugging Notes
- (record fixes, workarounds, test commands)

## Important Agreements
- (log decisions or agreements to honor later)

## Project Details
- App: VCode - Voice-controlled coding agent (Node.js + TypeScript backend, PWA frontend).
- Default port: 8765 (configurable via .env PORT).
- CLI: `vcode` -> `dist/cli.js` starts the built server.
- Build/dev: `npm run dev`, `npm run build`, `npm start`.
- Tests: `npm test` (healthz + agent endpoints), Playwright E2E available.
- Dual AI agents: OpenAI Codex and Claude Code for coding tasks.

## Run Log
- Initialized context memory; entries will be appended automatically on each assistant startup.
- 2025-12-06T19:09:34.332Z UTC - Started OpenAI Realtime session (voice bridge)
- 2025-12-06T19:22:21.321Z UTC - Started OpenAI Realtime session (voice bridge)
- 2025-12-07T10:28:31.462Z UTC - Started OpenAI Realtime session (voice bridge)
- 2025-12-07T10:37:32.374Z UTC - Started OpenAI Realtime session (voice bridge)
- 2025-12-07T10:40:12.832Z UTC - Started OpenAI Realtime session (voice bridge)
- 2025-12-07T10:43:29.788Z UTC - Started OpenAI Realtime session (voice bridge)
- 2025-12-09T20:35:56.338Z UTC - Started OpenAI Realtime session (voice bridge)
- 2025-12-09T21:01:34.286Z UTC - Started OpenAI Realtime session (voice bridge)
- 2025-12-09T23:04:55.444Z UTC - Started OpenAI Realtime session (voice bridge)
- 2025-12-09T23:14:21.251Z UTC - Started OpenAI Realtime session (voice bridge)
- 2025-12-09T23:26:32.230Z UTC - Started OpenAI Realtime session (voice bridge)
- 2025-12-09T23:30:32.685Z UTC - Started OpenAI Realtime session (voice bridge)
- 2025-12-09T23:35:22.080Z UTC - Started OpenAI Realtime session (voice bridge)
- 2025-12-10T19:29:14.292Z UTC - Started OpenAI Realtime session (voice bridge)
- 2025-12-10T19:39:37.110Z UTC - Started OpenAI Realtime session (voice bridge)
- 2025-12-10T19:40:34.766Z UTC - Started OpenAI Realtime session (voice bridge)
- 2025-12-20T07:10:27.480Z UTC - Started OpenAI Realtime session (voice bridge)
- 2025-12-20T07:48:21.657Z UTC - Started OpenAI Realtime session (voice bridge)
- 2025-12-21T04:56:33.585Z UTC - Started OpenAI Realtime session (voice bridge)
- 2025-12-21T05:03:31.352Z UTC - Started OpenAI Realtime session (voice bridge)
