# WebRTC ↔ OpenAI Realtime Voice Bridge

A voice-controlled coding agent that bridges browser WebRTC audio to OpenAI's Realtime voice API via a Node.js backend. Features integrated Codex (OpenAI) and Claude Code (Anthropic) agents for code generation, file operations, and terminal commands.

## Key Features

- **Multi-frontend support** - Multiple browser tabs can connect to the same long-lived OpenAI session
- **Auto-connect** - Frontend connects automatically on page load (no Start button)
- **Start muted** - Both mic and AI audio muted by default to prevent echo
- **Independent controls** - Each frontend can independently mute mic and AI audio
- **Dual AI agents** - Voice assistant can delegate tasks to Codex or Claude Code
- **Live transcription** - Real-time transcript of conversation in UI
- **Audio meters** - Visual feedback for mic (teal) and AI (blue) audio levels

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy `.env.example` to `.env` and fill in your OpenAI API key:

```bash
cp .env.example .env
```

Edit `.env`:

```env
OPENAI_API_KEY=sk-REPLACE_ME
REALTIME_MODEL=gpt-4o-realtime-preview-2024-10-01
PORT=8765
```

## Running in development

```bash
npm run dev
```

Then open `http://localhost:8765` in your browser. The page auto-connects and starts with both mic and AI muted. Click **Unmute** to enable your microphone and **Unmute AI** to hear the assistant.

## UI Controls

- **Unmute / Mute** - Toggle your microphone (starts muted)
- **Unmute AI / Mute AI** - Toggle assistant audio playback (starts muted)
- **Transcript tab** - Real-time conversation transcription
- **Codex tab** - OpenAI Codex agent activity
- **Claude tab** - Claude Code agent activity

## Multi-Tab Usage

Open multiple browser tabs pointing to the same server:
- All tabs connect to the same OpenAI Realtime session
- Speak in any tab - assistant hears from all unmuted mics
- Each tab can independently mute/unmute mic and AI audio
- Useful for: listening from one device while speaking from another

## Build & run

```bash
npm run build
npm start
```

## Tests

```bash
npm test
```

## Global CLI launcher (`vcode`)

Install globally to run from any terminal:

```bash
npm run build
npm install -g .
vcode
```

Starts the server and opens the voice UI. Each run creates a fresh session.

## Architecture

```
Frontend A ──┐
Frontend B ──┼─→ Backend (Node.js) ─→ OpenAI Realtime API
Frontend C ──┘     │
                   ├─→ Codex Agent (code tasks)
                   └─→ Claude Agent (complex tasks)
```

- **RealtimeSessionManager** - Long-lived singleton OpenAI connection
- **BrowserConnectionManager** - Per-frontend WebRTC connections
- **Codex/Claude Services** - AI coding agents triggered by voice

See [CLAUDE.md](CLAUDE.md) for detailed architecture documentation.
