# WebRTC Bridge Project Context

## 1. Context & Origin

This project was extracted and adapted from the **TeleChat** repository.
- **Original Goal:** TeleChat connects WhatsApp Voice (via Cloud API) to OpenAI Realtime.
- **Adaptation:** This project replaces the WhatsApp leg with a standard browser WebRTC connection to isolate and demonstrate the audio bridging architecture.
- **Key Logic Preserved:** The specific `RTCAudioSink`/`RTCAudioSource` bridging and the strict connection ordering required to prevent audio jitter were ported directly from TeleChat's `voice.flow.ts` and `openai.realtime.ts`.

## 2. High-level Goal

The goal of this subproject (`webrtc-bridge/`) is to provide a **minimal standalone implementation** of a voice bridge between a browser and OpenAI Realtime API, mediated by a Node.js backend.

It replicates the architecture used in the main TeleChat project (WhatsApp ↔ OpenAI) but replaces the WhatsApp leg with a browser WebRTC connection.

**Key Features:**
- **Frontend:** Simple HTML/JS using `getUserMedia` and `RTCPeerConnection`.
- **Backend:** Node.js + TypeScript using `wrtc` (node-webrtc).
- **Audio Routing:** Bridges audio frames between the Browser PC and the OpenAI PC using `RTCAudioSink` and `RTCAudioSource`.
- **Jitter Handling:** Implements the specific connection ordering (OpenAI first, then Client) to prevent initial audio packet loss.

---

## 2. Project Structure

Root: `webrtc-bridge/`

```text
webrtc-bridge/
├── package.json            # CommonJS project, scripts for build/dev/test
├── tsconfig.json           # Targets CommonJS, outputs to dist/
├── vitest.config.ts        # Test configuration
├── .env.example            # Template for environment variables
├── README.md               # Basic usage instructions
├── src/
│   ├── server.ts           # Express app, signaling endpoint, static file server
│   ├── config.env.ts       # Environment variable loading & validation
│   ├── types/
│   │   └── wrtc.d.ts       # Custom type definitions for wrtc non-standard APIs
│   ├── openai/
│   │   └── openai.realtime.ts  # OpenAI Realtime WebRTC client (PC-OA)
│   └── webrtc/
│       └── browser-bridge.ts   # Browser WebRTC handler (PC-BROWSER) & bridging logic
├── public/
│   ├── index.html          # Minimal UI
│   └── main.js             # Frontend WebRTC logic
└── tests/
    └── health.test.ts      # Basic health check test
```

---

## 3. Runtime Model & Build System

To ensure maximum compatibility with `nvm` and avoid fragility with experimental ESM loaders in Node.js (specifically v22+), this project uses a **CommonJS build flow**.

- **`package.json`**: `"type": "commonjs"`
- **`tsconfig.json`**: `"module": "CommonJS"`, `"moduleResolution": "Node"`
- **Dev Workflow**:
  - `npm run dev` runs `npm run build && node dist/server.js`.
  - It compiles TypeScript to standard CommonJS JavaScript in `dist/` and runs it with plain `node`.
  - **Why?** We initially attempted a `ts-node` + ESM loader setup (`node --loader ts-node/esm`). On Node 22+, this resulted in opaque internal loader errors and `ERR_UNKNOWN_FILE_EXTENSION` conflicts. Switching to a standard "Build (tsc) -> Run (node)" flow with CommonJS proved robust and compatible with `nvm`.

---

## 4. Configuration

Configuration is handled in `src/config.env.ts` using `dotenv`.

**Required Environment Variables:**
- `OPENAI_API_KEY`: Your OpenAI API key.
- `PORT`: (Optional) Server port, defaults to 8080.
- `REALTIME_MODEL`: (Optional) Defaults to `gpt-realtime`.

**Behavior:**
- Throws an error on startup if `OPENAI_API_KEY` is missing (unless `NODE_ENV=test`).

---

## 5. Backend Architecture

### 5.1. Server (`src/server.ts`)
- **Express** server.
- Serves static files from `public/`.
- Exposes `POST /signal`:
  - Accepts JSON `{ offer: string }` (Browser SDP Offer).
  - Calls `handleBrowserOffer(offer)`.
  - Returns JSON `{ answer: string }` (Server SDP Answer).
- Exposes `GET /healthz` for health checks.

### 5.2. OpenAI Client (`src/openai/openai.realtime.ts`)
- Manages the **PC-OA** (PeerConnection to OpenAI).
- **Setup:**
  1. Creates `RTCPeerConnection`.
  2. Adds an `RTCAudioSource` track (to send user audio).
  3. Sets up `ontrack` to capture assistant audio into an `RTCAudioSink`.
  4. Creates a Data Channel `oai-events` for control messages (session updates, response creation).
  5. Performs SDP handshake with OpenAI API via REST (`https://api.openai.com/v1/realtime`).
- **Exports:** `RealtimeSession` object with methods to send audio frames and receive assistant audio frames.

### 5.3. Browser Bridge (`src/webrtc/browser-bridge.ts`)
- Manages the **PC-BROWSER** (PeerConnection to Browser).
- **Constraints:** Supports **single active session**. A global `currentBridge` variable ensures that starting a new call cleans up the previous one.
- **Audio Routing (The "Anchors"):**
  - **User Mic → Model:**
    - Browser Mic → PC-BROWSER (Server) → `browserSink`
    - `browserSink.ondata` → `realtime.sendUserAudio`
    - `realtime.audioSource` → PC-OA → OpenAI Model
  - **Model Voice → User:**
    - OpenAI Model → PC-OA → `realtime.audioSink`
    - `realtime.onAssistantAudio` → `browserSource.onData`
    - `browserSource` → PC-BROWSER (Server) → Browser Speakers
- **Bridging Logic (The "Jitter Fix" Pattern):**
  1. Create `browserPC` and `browserSource` (for sending audio to browser).
  2. **Connect to OpenAI first** (`connectRealtimeSession`).
  3. **Setup Audio Routing:**
     - **Browser → OpenAI:** In `browserPC.ontrack`, attach `browserSink`. On data, call `realtime.sendUserAudio(frame)`.
     - **OpenAI → Browser:** Subscribe to `realtime.onAssistantAudio`. On data, call `browserSource.onData(frame)`.
  4. **Only then** set the Remote Description (Browser Offer) and create Answer.
  - *Why?* This ensures the sink/source pipeline is fully ready before media starts flowing, preventing dropped initial packets and audio jitter.

---

## 6. Frontend Architecture

- **`public/index.html`**: Simple "Start Call" button and `<audio autoplay>` element.
- **`public/main.js`**:
  1. Gets microphone stream (`navigator.mediaDevices.getUserMedia`).
  2. Creates `RTCPeerConnection`.
  3. Adds microphone track to PC.
  4. Sets up `ontrack` to play incoming audio in the `<audio>` element.
  5. Creates SDP Offer and POSTs it to `/signal`.
  6. Applies returned SDP Answer.

---

## 7. Testing

- **Framework:** `vitest` + `supertest`.
- **Config:** `vitest.config.ts`.
- **Tests:** `tests/health.test.ts` verifies the server starts and responds to `/healthz`.
- **Running:** `npm test` (sets `NODE_ENV=test` implicitly or via script to bypass API key check).

---

## 8. How to Run

1.  **Install Dependencies:**
    ```bash
    npm install
    ```
2.  **Configure Environment:**
    ```bash
    cp .env.example .env
    # Edit .env and add your OPENAI_API_KEY
    ```
3.  **Run in Development:**
    ```bash
    npm run dev
    ```
    - This builds the project (`tsc`) and runs `node dist/server.js`.
    - Access at `http://localhost:8080`.
4.  **Build & Start (Production):**
    ```bash
    npm run build
    npm start
    ```
