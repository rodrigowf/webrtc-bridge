# WebRTC ↔ OpenAI Realtime Voice Bridge

This project bridges a browser WebRTC connection to OpenAI's Realtime voice API via a Node.js backend. It now ships a minimal, modern voice UI with live meters for both directions, animated background, and inline status indicators.

- Frontend: HTML/CSS/JS that captures microphone audio, performs signaling, shows start/stop + mute controls, and renders dual audio level meters (outgoing = mic → model, incoming = assistant → you). Audio plays via a hidden element.
- Backend: Node.js + TypeScript server that accepts a WebRTC connection from the browser and forwards audio to OpenAI Realtime via another WebRTC connection, with ICE-gathering waits and detailed logging.

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
REALTIME_MODEL=gpt-realtime
PORT=8080
```

## Running in development

```bash
npm run dev
```

Then open `http://localhost:8080` in your browser and click **Start**. Use **Mute** to toggle your mic; meters show live levels for you (teal) and the assistant (blue).

## UI at a Glance

- Start/Stop and Mute controls in a compact header.
- Dual live audio meters (outgoing teal, incoming blue) driven by real audio levels.
- Hidden audio player keeps playback active while keeping the UI minimal.
- Animated gradient background with streamlined cards for indicators and transcripts.

## Build & run

```bash
npm run build
npm start
```

## Tests

```bash
npm test
```

Currently there is a minimal test that checks the `/healthz` endpoint.
