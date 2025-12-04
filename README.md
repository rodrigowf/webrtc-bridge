# WebRTC ↔ OpenAI Realtime Voice Bridge

This is a minimal project that bridges a browser WebRTC connection to OpenAI's Realtime voice API via a Node.js backend.

- Frontend: simple HTML + JavaScript that captures microphone audio and connects to the backend via WebRTC.
- Backend: Node.js + TypeScript server that accepts a WebRTC connection from the browser and forwards audio to OpenAI Realtime via another WebRTC connection.

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

Then open `http://localhost:8080` in your browser and click **Start Call**.

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
