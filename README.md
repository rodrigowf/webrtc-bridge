# VCode

A voice-controlled coding agent that handles complex code and terminal tasks through natural speech. VCode bridges browser WebRTC audio to OpenAI's Realtime voice API, with integrated Codex (OpenAI) and Claude Code (Anthropic) agents that can execute code generation, file operations, and terminal commands.

## Features

- **Voice-controlled coding** - Speak naturally to write code, run commands, and manage files
- **Dual AI agents** - OpenAI Codex and Claude Code for comprehensive coding capabilities
- **Multi-frontend support** - Multiple browser tabs can connect to the same session
- **Real-time transcription** - Live transcript of your conversation
- **Audio feedback** - Visual meters for mic (teal) and AI (blue) audio levels
- **PWA support** - Install as an app on desktop or mobile
- **HTTPS/SSL** - Secure connections enabled by default

## Quick Start

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env and add your OPENAI_API_KEY

# Build and run
npm run dev
```

Open `https://localhost:8765` in your browser. The page auto-connects with mic and AI audio muted by default.

## Global CLI

Install globally to run VCode from anywhere:

```bash
npm run build
npm install -g .
vcode
```

## UI Controls

| Control | Description |
|---------|-------------|
| **Unmute / Mute** | Toggle your microphone |
| **Unmute AI / Mute AI** | Toggle assistant audio playback |
| **Start / Stop** | Control the voice session |
| **Transcript tab** | Real-time conversation transcription |
| **Codex tab** | OpenAI Codex agent activity |
| **Claude tab** | Claude Code agent activity |

## Multi-Device Usage

Open multiple browser tabs or devices pointing to the same server:
- All connect to the same OpenAI Realtime session
- Speak from any unmuted device - the assistant hears all
- Each device can independently control mic and AI audio
- Use case: Listen from your phone while speaking from your laptop

## Architecture

```
Browser A ──┐
Browser B ──┼─→ VCode Server (Node.js) ─→ OpenAI Realtime API
Browser C ──┘          │
                       ├─→ Codex Agent (code tasks)
                       └─→ Claude Agent (complex tasks)
```

**Key components:**
- **RealtimeSessionManager** - Long-lived singleton OpenAI connection
- **BrowserConnectionManager** - Per-frontend WebRTC connections with unique IDs
- **Codex/Claude Services** - AI coding agents triggered by voice commands

## Development

```bash
npm run dev          # Build and start server
npm run build        # Build TypeScript only
npm start            # Start server (requires build)
npm test             # Run unit tests
npm run test:e2e     # Interactive E2E test with Playwright
```

## Environment Variables

Create `.env` from `.env.example`:

```env
OPENAI_API_KEY=sk-proj-...    # Required
ANTHROPIC_API_KEY=sk-ant-...  # Optional (can authenticate via UI)
PORT=8765                      # Server port
SSL_ENABLED=true               # HTTPS (default: true)
```

## Documentation

- [CLAUDE.md](CLAUDE.md) - Architecture and development guide
- [DEBUGGING.md](DEBUGGING.md) - Interactive debugging guide
- [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md) - Project history and context

## License

MIT
