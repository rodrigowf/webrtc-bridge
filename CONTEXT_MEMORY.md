# Context Memory

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
- App: WebRTC <-> OpenAI Realtime voice bridge (Node.js + TypeScript backend, minimal frontend UI).
- Default port: 8080 (configurable via .env PORT).
- CLI: `vcode` -> `dist/cli.js` starts the built server.
- Build/dev: `npm run dev`, `npm run build`, `npm start`.
- Tests: `npm test` (healthz + Codex endpoints), Playwright E2E available.

## Run Log
- Initialized context memory; entries will be appended automatically on each assistant startup.
