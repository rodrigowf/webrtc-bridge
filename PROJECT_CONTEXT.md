# VCode Project Context

## Overview

**VCode** is a voice-controlled coding agent that handles complex code and terminal tasks through natural speech. The system bridges browser WebRTC audio to OpenAI's Realtime voice API, with integrated Codex (OpenAI) and Claude Code (Anthropic) agents.

## Origin

This project was extracted and adapted from the **TeleChat** repository.
- **Original Goal:** TeleChat connects WhatsApp Voice (via Cloud API) to OpenAI Realtime.
- **Adaptation:** VCode replaces the WhatsApp leg with a standard browser WebRTC connection to provide a standalone voice-controlled coding interface.
- **Key Logic Preserved:** The specific `RTCAudioSink`/`RTCAudioSource` bridging and the strict connection ordering required to prevent audio jitter were ported directly from TeleChat's architecture.

## Key Features

- **Voice-controlled coding** - Speak naturally to write code, run commands, and manage files
- **Dual AI agents** - OpenAI Codex and Claude Code for comprehensive coding capabilities
- **Multi-frontend support** - Multiple browser tabs can connect to the same session
- **Real-time transcription** - Live transcript of your conversation
- **Audio feedback** - Visual meters for mic and AI audio levels
- **PWA support** - Install as an app on desktop or mobile
- **HTTPS/SSL** - Secure connections enabled by default

## Project Structure

```
vcode/
├── package.json            # ESM project, scripts for build/dev/test
├── tsconfig.json           # Targets ES2020, outputs to dist/
├── vitest.config.ts        # Unit test configuration
├── playwright.config.ts    # E2E test configuration
├── .env.example            # Template for environment variables
├── README.md               # Quick start and usage guide
├── CLAUDE.md               # Architecture and development guide
├── DEBUGGING.md            # Interactive debugging guide
├── src/
│   ├── server.ts           # Express app, signaling endpoint, static file server
│   ├── cli.ts              # Global vcode CLI launcher
│   ├── config.env.ts       # Environment variable loading & validation
│   ├── types/
│   │   └── wrtc.d.ts       # Custom type definitions for wrtc non-standard APIs
│   ├── openai/
│   │   └── openai.realtime.ts  # OpenAI Realtime WebRTC client
│   ├── webrtc/
│   │   └── browser-bridge.ts   # Browser WebRTC handler & bridging logic
│   ├── codex/
│   │   └── codex.service.ts    # OpenAI Codex agent integration
│   ├── claude/
│   │   ├── claude.service.ts   # Claude Code agent integration
│   │   ├── claude.auth.ts      # Authentication handling
│   │   └── claude.oauth.ts     # OAuth implementation
│   ├── memory/
│   │   └── context.memory.ts   # Persistent context memory
│   └── conversations/
│       └── conversation.storage.ts  # Conversation history persistence
├── public/
│   ├── index.html          # Voice UI with audio meters and tabs
│   ├── main.js             # Frontend WebRTC logic, mute controls, audio meters
│   ├── manifest.json       # PWA manifest
│   └── sw.js               # Service worker for offline support
└── tests/
    ├── health.test.ts      # Health check test
    ├── codex.service.test.ts   # Codex service tests
    ├── codex.sse.test.ts       # Codex SSE tests
    ├── claude.service.test.ts  # Claude service tests
    ├── claude.sse.test.ts      # Claude SSE tests
    └── interactive.e2e.test.ts # Playwright E2E test
```

## Build System

VCode uses an **ESM build flow** for modern JavaScript compatibility:

- **`package.json`**: `"type": "module"`
- **`tsconfig.json`**: `"module": "ES2020"`, `"moduleResolution": "Node"`
- **Dev Workflow**: `npm run dev` compiles TypeScript to ES2020 modules in `dist/` and runs with plain `node`

## Configuration

Configuration is handled in `src/config.env.ts` using `dotenv`.

**Required Environment Variables:**
- `OPENAI_API_KEY`: Your OpenAI API key

**Optional Environment Variables:**
- `ANTHROPIC_API_KEY`: Claude API key (can authenticate via UI instead)
- `PORT`: Server port (defaults to 8765)
- `REALTIME_MODEL`: OpenAI model (defaults to `gpt-realtime`)
- `SSL_ENABLED`: Enable HTTPS (defaults to true)

## Backend Architecture

### Server (`src/server.ts`)
- **Express** server serving static files from `public/`
- WebRTC signaling endpoint (`POST /signal`)
- Health check endpoint (`GET /healthz`)
- Codex and Claude agent endpoints

### OpenAI Realtime (`src/openai/openai.realtime.ts`)
- Manages the long-lived PeerConnection to OpenAI
- Creates `RTCAudioSource` track for sending user audio
- Captures assistant audio via `RTCAudioSink`
- Data Channel for control messages with server-side VAD

### Browser Bridge (`src/webrtc/browser-bridge.ts`)
- Manages per-frontend WebRTC PeerConnections
- **Critical Pattern:** Establishes OpenAI connection BEFORE processing browser SDP
- Routes audio bidirectionally between browsers and OpenAI

### Agent Services
- **Codex Service** (`src/codex/codex.service.ts`): OpenAI Codex integration with autonomous execution
- **Claude Service** (`src/claude/claude.service.ts`): Claude Code integration with OAuth support

## Frontend Architecture

- **`public/index.html`**: UI with animated background, Start/Stop + Mute buttons, status indicator, and dual audio meters
- **`public/main.js`**: WebRTC client logic, audio stream handling, UI state management

## Testing

- **Framework:** `vitest` + `supertest` for unit tests
- **E2E:** Playwright for interactive browser testing
- **Commands:**
  - `npm test` - Run unit tests
  - `npm run test:e2e` - Interactive E2E test with visible browser
  - `npm run test:e2e:debug` - E2E with Playwright inspector

## How to Run

1. **Install Dependencies:**
   ```bash
   npm install
   ```

2. **Configure Environment:**
   ```bash
   cp .env.example .env
   # Edit .env and add your OPENAI_API_KEY
   ```

3. **Run in Development:**
   ```bash
   npm run dev
   ```
   Access at `https://localhost:8765`

4. **Build & Start (Production):**
   ```bash
   npm run build
   npm start
   ```

5. **Global CLI:**
   ```bash
   npm install -g .
   vcode
   ```
