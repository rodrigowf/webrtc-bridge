# 🎙️ Voice Terminal Assistant

A voice-controlled personal assistant that executes terminal commands on your local machine using OpenAI's Realtime Voice API.

## Overview

This project allows you to speak commands naturally, and the AI assistant will:
1. Understand your request
2. Determine the appropriate terminal command(s)
3. Ask for verbal confirmation for sensitive operations
4. Execute the command locally
5. Report the results back to you

## Features

- **Natural Voice Control**: Speak naturally - the AI understands context and intent
- **Safety First**: Requires verbal confirmation for potentially destructive commands
- **Real-time Transcription**: See what you said and what the AI responded
- **Terminal Output Display**: View command execution results in real-time
- **Multi-client Support**: Multiple browser tabs can connect to the same session
- **WebRTC Audio Streaming**: Low-latency audio communication

## Architecture

```
Browser (Frontend)
    ↓ WebRTC Audio
Node.js Server (Backend)
    ↓ OpenAI Realtime API
GPT-4 Realtime Voice Model
    ↓ Function Calling
Terminal Executor
    ↓ bash/Python
Local Machine
```

### Components

- **Frontend** (`public/`): Minimal HTML/JS interface for voice control
- **WebRTC Bridge** (`src/webrtc/`): Routes audio between browser and OpenAI
- **OpenAI Realtime** (`src/openai/`): Manages voice model connection and function calling
- **Terminal Executor** (`src/terminal/`): Safely executes commands locally
- **Express Server** (`src/server.ts`): HTTP API and SSE event streaming

## Prerequisites

- **Node.js** 18+ (for ES modules)
- **OpenAI API Key** with Realtime API access
- **openssl** (for SSL certificate generation)
- **Modern browser** with WebRTC support

## Installation

1. **Clone or navigate to the project:**
   ```bash
   cd voice-terminal-assistant
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure environment variables:**
   ```bash
   cp .env.example .env
   # Edit .env and add your OPENAI_API_KEY
   ```

4. **Build the TypeScript project:**
   ```bash
   npm run build
   ```

## Usage

1. **Start the server:**
   ```bash
   npm start
   ```

2. **Open in browser:**
   - HTTPS: `https://localhost:8765` (default)
   - HTTP: `http://localhost:8765`
   - Accept the self-signed certificate warning (first time only)

3. **Start services:**
   - Click "Start Services" button
   - Grant microphone access when prompted
   - Click "Unmute Mic" and "Unmute AI" to enable audio

4. **Start speaking:**
   - Example: "List the files in my home directory"
   - Example: "What's the current directory?"
   - Example: "Show me the last 10 lines of my bash history"

## Safety & Confirmation Workflow

The AI is programmed to ask for verbal confirmation before executing potentially dangerous commands:

### Requires Confirmation:
- File deletion (`rm`, `rmdir`)
- System modifications (`apt install`, `brew install`, `systemctl`)
- Permission changes (`chmod`, `chown`, `sudo`)
- Destructive git operations (`git reset --hard`, `push --force`)
- Database operations (`DROP`, `DELETE`)

### Safe to Execute Immediately:
- Read-only operations (`ls`, `cat`, `grep`, `find`)
- Information queries (`pwd`, `whoami`, `date`, `df`)
- Non-destructive analysis (`git status`, `git log`)

### Example Interaction:

**You:** "Delete all log files"

**AI:** "I need to delete log files, which could remove important data. The command would be: `rm *.log` - Should I proceed?"

**You:** "Yes, go ahead"

**AI:** *Executes command and reports results*

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENAI_API_KEY` | Your OpenAI API key | (required) |
| `REALTIME_MODEL` | OpenAI model to use | `gpt-4o-realtime-preview-2024-12-17` |
| `PORT` | Server port | `8765` |
| `SSL_ENABLED` | Enable HTTPS | `true` |
| `SSL_CERT_PATH` | Custom SSL cert path | (auto-generated) |
| `SSL_KEY_PATH` | Custom SSL key path | (auto-generated) |

### SSL Certificates

By default, the server generates a self-signed certificate on first run. For production or trusted certificates:

1. **Using mkcert (recommended for local development):**
   ```bash
   brew install mkcert  # macOS
   # or: apt install mkcert  # Linux
   mkcert -install
   mkcert localhost 127.0.0.1
   ```

2. **Configure .env:**
   ```env
   SSL_CERT_PATH=/path/to/localhost.pem
   SSL_KEY_PATH=/path/to/localhost-key.pem
   ```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/healthz` | GET | Health check |
| `/signal` | POST | WebRTC signaling |
| `/disconnect` | POST | Disconnect client |
| `/session/status` | GET | Get connection status |
| `/services/start` | POST | Start OpenAI session |
| `/services/stop` | POST | Stop all services |
| `/events` | GET | SSE stream (transcripts, terminal output) |

## Project Structure

```
voice-terminal-assistant/
├── src/
│   ├── config.env.ts           # Environment configuration
│   ├── server.ts               # Express server & endpoints
│   ├── openai/
│   │   └── openai.realtime.ts  # OpenAI Realtime integration
│   ├── webrtc/
│   │   └── browser-bridge.ts   # WebRTC audio routing
│   ├── terminal/
│   │   └── executor.ts         # Command execution
│   ├── ssl/
│   │   └── generate-cert.ts    # SSL certificate handling
│   └── types/
│       └── wrtc.d.ts           # TypeScript definitions
├── public/
│   ├── index.html              # Frontend UI
│   └── main.js                 # Frontend logic
├── dist/                       # Compiled JavaScript (auto-generated)
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

## How It Works

### 1. Voice Capture
- Browser captures microphone audio via `getUserMedia()`
- WebRTC peer connection streams audio to backend

### 2. OpenAI Realtime Processing
- Backend forwards audio to OpenAI Realtime API via WebRTC data channel
- GPT-4 Realtime model:
  - Transcribes speech (Whisper)
  - Understands intent
  - Generates voice response
  - Calls `execute_command` function when appropriate

### 3. Command Execution
- Backend receives function call with command
- Checks if command requires confirmation (heuristic safety check)
- Executes command using `child_process.exec`
- Captures stdout, stderr, and exit code

### 4. Result Reporting
- Backend sends result back to OpenAI as function output
- AI generates natural language response with results
- Voice response streamed back to browser
- Terminal output displayed in UI

## Development

```bash
# Build TypeScript
npm run build

# Start server
npm start

# Watch mode (requires additional setup)
npm run dev
```

## Security Considerations

⚠️ **WARNING**: This application executes arbitrary commands on your local machine. Use with caution:

1. **API Key Security**: Never expose your OpenAI API key
2. **Network Access**: Be cautious when exposing the server to your network
3. **Command Validation**: The AI prompt includes safety instructions, but is not foolproof
4. **Confirmation Workflow**: Always listen to confirmation requests carefully
5. **Sandbox**: Consider running in a VM or container for additional isolation

## Limitations

1. **No Persistent State**: Commands run independently (no shell session state)
2. **Timeout**: Commands are limited to 30 seconds execution time
3. **Single Shell**: Each command runs in a fresh `/bin/bash` shell
4. **No Interactive Commands**: Cannot handle commands requiring stdin input
5. **Buffer Limit**: Output capped at 10MB

## Troubleshooting

### "Services not started" error
- Make sure you click "Start Services" before trying to connect
- Check that `OPENAI_API_KEY` is set correctly in `.env`

### SSL Certificate Warnings
- Expected for self-signed certificates
- Click "Advanced" → "Proceed to localhost" (varies by browser)
- Or use mkcert for trusted local certificates

### Microphone Access Denied
- WebRTC requires HTTPS (or localhost HTTP)
- Check browser permissions for microphone access
- Ensure no other application is using the microphone

### Connection Drops
- Check OpenAI API status
- Verify network connectivity
- Look at server logs for errors

## License

This project is private and for educational/personal use.

## Acknowledgments

- Built on [OpenAI Realtime API](https://platform.openai.com/docs/guides/realtime)
- Uses [wrtc](https://github.com/node-webrtc/node-webrtc) for Node.js WebRTC support
- Based on the VCode voice-coding agent architecture
