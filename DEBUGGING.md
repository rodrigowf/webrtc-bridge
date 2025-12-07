# Interactive Debugging Guide

This project includes **comprehensive logging throughout the entire codebase** plus interactive E2E testing tools built with Playwright that allow you to manually test the WebRTC bridge while monitoring both frontend and backend logs in real-time. The UI now exposes live dual audio meters (outgoing mic → model, incoming model → you) so you can visually confirm levels in both directions.

## Comprehensive Logging System

All code includes structured console logs with prefixes for easy filtering:

**Backend Prefixes:**
- `[CONFIG]` - Environment configuration
- `[SERVER]` - Express server and HTTP endpoints
- `[BROWSER-BRIDGE]` - WebRTC bridge operations
- `[OPENAI-REALTIME]` - OpenAI Realtime API connection

**Frontend Prefix:**
- `[FRONTEND]` - Browser WebRTC client

**Key Features:**
- ✅ Audio frame counters (every 100 frames, both directions)
- ✅ Event counters (first 10, then every 50th)
- ✅ SDP length tracking
- ✅ Connection state changes (plus ICE gathering waits)
- ✅ API key security (truncated in logs)
- ✅ Detailed error context
- ✅ First-frame metadata (sample rate/channels) and transcript deltas from Realtime

## Quick Start

### 1. Start the Server (Terminal 1)

```bash
source ~/.nvm/nvm.sh && npm start
```

You'll immediately see detailed startup logs:
```
[CONFIG] Loading environment configuration...
[CONFIG] PORT: 8765
[CONFIG] OPENAI_API_KEY: sk-proj-I0...
[CONFIG] REALTIME_MODEL: gpt-realtime
[CONFIG] Configuration validated successfully
[SERVER] Initializing Express application...
[SERVER] Setting up middleware...
[SERVER] Static files served from: /home/user/project/public
Server listening on http://localhost:8765
```

Leave this running and watch for connection logs when you start testing.

### 2. Run Interactive Test (Terminal 2)

```bash
source ~/.nvm/nvm.sh && npm run test:interactive
```

This will:
- Open a Chromium browser in headed mode (visible)
- Navigate to the application
- Show the page with the "Start Call" button
- Monitor and log all frontend activity

## What You'll See

### Terminal 1 (Backend Logs)

With comprehensive logging, you'll see the entire connection flow:

```
[SERVER] /signal endpoint called - new WebRTC connection request
[SERVER] Valid offer received, SDP length: 1234
[BROWSER-BRIDGE] handleBrowserOffer called
[BROWSER-BRIDGE] Creating new RTCPeerConnection for browser
[BROWSER-BRIDGE] Connecting to OpenAI Realtime session (critical: BEFORE processing browser offer)...
[OPENAI-REALTIME] connectRealtimeSession called
[OPENAI-REALTIME] Creating RTCPeerConnection for OpenAI
[OPENAI-REALTIME] Sending offer to OpenAI API, model: gpt-realtime
[OPENAI-REALTIME] Received SDP answer from OpenAI, length: 2345
[OPENAI-REALTIME] Data channel OPENED successfully!
[OPENAI-REALTIME] Sending session.update with system prompt
[OPENAI-REALTIME] Sending response.create for initial greeting
[BROWSER-BRIDGE] OpenAI Realtime session established successfully
[BROWSER-BRIDGE] Audio track detected - setting up browser audio sink
[BROWSER-BRIDGE] Browser → OpenAI audio frames sent: 100
[BROWSER-BRIDGE] OpenAI → Browser audio frames sent: 100
[OPENAI-REALTIME] Assistant audio frames received: 100
[OPENAI-REALTIME] Data channel event #1: session.created
[OPENAI-REALTIME] Data channel event #2: response.created
```

### Terminal 2 (Frontend Logs)

Playwright captures and color-codes:
- **[BROWSER]** (cyan) - Console logs from webpage, including `[FRONTEND]` prefixed logs
- **[BROWSER ERROR]** (red) - JavaScript errors
- **[BROWSER WARN]** (yellow) - Warnings
- **[NETWORK →]** (magenta) - Outgoing requests
- **[NETWORK ←]** (green/red) - Response status codes
- **[STATUS]** (blue) - Connection status updates from UI
- **[USER ACTION]** - When you click buttons

Example frontend logs you'll see:
```
[FRONTEND] Script loaded and initialized
[FRONTEND] Start button clicked
[FRONTEND] Requesting microphone access...
[FRONTEND] Microphone access granted, stream tracks: 1
[FRONTEND] Creating RTCPeerConnection...
[FRONTEND] ICE connection state: checking
[FRONTEND] ICE connection state: connected
[FRONTEND] Connection state: connected
[FRONTEND] ontrack event received!
[FRONTEND] Remote audio playback started successfully
[FRONTEND] Start/Stop button clicked
[FRONTEND] ✅ WebRTC connection established successfully!
```

### Browser Window
- Visible Chromium browser
- You can interact normally (click buttons, etc.)
- Microphone permission will be auto-granted (using fake device)
- You can use DevTools (F12) to see the same `[FRONTEND]` logs in real-time
- Dual meters show live levels: teal = your mic to the model, blue = assistant audio back to you. The audio player is hidden but active for playback.

## Testing Workflow

1. **Start the test** - Browser opens automatically
2. **Click "Start Call"** - Watch logs in Terminal 2
3. **Monitor connection** - Check both terminals for errors
4. **Test audio flow** - Logs show WebRTC events
5. **Press Ctrl+C** - Stop when done (or wait ~10 min timeout)

## Available Commands

```bash
# Standard interactive test (headed mode)
npm run test:interactive

# Same as above (alias)
npm run test:e2e

# Debug mode with Playwright inspector
npm run test:e2e:debug
```

## Debug Mode Features

Run with `npm run test:e2e:debug` to get:
- Playwright Inspector UI
- Step-by-step execution
- Pause/resume controls
- DOM inspector
- Console in the inspector

## Troubleshooting

### Browser doesn't open
- Make sure Playwright is installed: `npx playwright install chromium`
- Check that no other process is using port 8765

### No backend logs
- Ensure server is running in Terminal 1
- Check `http://localhost:8765/healthz` returns `{"status":"ok"}`
- Look for `[CONFIG]` and `[SERVER]` logs at startup

### Connection fails

Use the comprehensive logs to diagnose:

1. **Configuration errors** - Check `[CONFIG]` logs:
   ```
   [CONFIG] FATAL: OPENAI_API_KEY is required but not set
   ```

2. **SDP exchange issues** - Check `[SERVER]` and `[BROWSER-BRIDGE]`:
   ```
   [SERVER] Invalid request: missing or invalid offer
   [SERVER] Valid offer received, SDP length: 1234  # Should be >1000
   ```

3. **OpenAI connection issues** - Check `[OPENAI-REALTIME]`:
   ```
   [OPENAI-REALTIME] Data channel timeout - failed to open within 10 seconds
   [OPENAI-REALTIME] Error event received: ...
   ```

4. **No audio flow** - Check frame counters:
   ```bash
   # Should see these incrementing
   [BROWSER-BRIDGE] Browser → OpenAI audio frames sent: 100
   [BROWSER-BRIDGE] Browser → OpenAI audio frames sent: 200
   ```

5. **Frontend errors** - Check `[FRONTEND]` logs in Terminal 2 or browser console:
   ```
   [FRONTEND] Failed to start audio playback: ...
   ```

### Test times out
- Default timeout is 10 minutes
- Edit `playwright.config.ts` to increase timeout
- Or just stop with Ctrl+C when done testing

### Filtering Logs

Focus on specific components:

```bash
# Only browser bridge logs
npm start 2>&1 | grep BROWSER-BRIDGE

# Only OpenAI logs
npm start 2>&1 | grep OPENAI-REALTIME

# Only errors
npm start 2>&1 | grep -i error

# Audio frame counts only
npm start 2>&1 | grep "frames"

# Data channel events
npm start 2>&1 | grep "Data channel"
```

## Customizing the Test

### Change timeout

Edit [tests/interactive.e2e.test.ts](tests/interactive.e2e.test.ts):

```typescript
test.setTimeout(1200_000); // 20 minutes
```

### Add custom logging

The test captures these events:
- `page.on('console')` - Browser console
- `page.on('pageerror')` - JavaScript errors
- `page.on('request')` - Network requests
- `page.on('response')` - Network responses

Add more as needed in the test file.

### Monitor specific elements

```typescript
const statusText = await statusEl.textContent();
console.log('Current status:', statusText);
```

## Log Color Reference

- **Red** - Errors (critical)
- **Yellow** - Warnings
- **Cyan** - Info/logs
- **Magenta** - Network activity
- **Green** - Success responses
- **Blue** - Status updates
- **Gray** - Debug info

## Understanding the Logs

### Connection Flow Order

The logs show the critical connection ordering pattern:

1. `[SERVER]` receives browser offer
2. `[BROWSER-BRIDGE]` creates browser peer connection
3. **`[OPENAI-REALTIME]` establishes OpenAI connection FIRST** (critical!)
4. `[BROWSER-BRIDGE]` processes browser SDP
5. Audio bridges are wired up
6. Data starts flowing

**Why this order matters:** Establishing OpenAI first prevents audio jitter and packet loss. The logs explicitly confirm this:
```
[BROWSER-BRIDGE] Connecting to OpenAI Realtime session (critical: BEFORE processing browser offer)...
```

### Audio Flow Confirmation

Look for these patterns to confirm audio is flowing:

**Outgoing (Browser → OpenAI):**
```
[BROWSER-BRIDGE] Browser → OpenAI audio frames sent: 100
[BROWSER-BRIDGE] Browser → OpenAI audio frames sent: 200
[BROWSER-BRIDGE] Browser → OpenAI audio frames sent: 300
```

**Incoming (OpenAI → Browser):**
```
[BROWSER-BRIDGE] OpenAI → Browser audio frames sent: 100
[OPENAI-REALTIME] Assistant audio frames received: 100
[BROWSER-BRIDGE] OpenAI → Browser audio frames sent: 200
[OPENAI-REALTIME] Assistant audio frames received: 200
```

If counters stop incrementing, audio has stopped flowing.

### Event Tracking

OpenAI Realtime events are logged selectively:
- First 10 events: All logged
- After event 10: Every 50th event

Common events to watch for:
```
[OPENAI-REALTIME] Data channel event #1: session.created
[OPENAI-REALTIME] Data channel event #2: session.updated
[OPENAI-REALTIME] Data channel event #3: response.created
[OPENAI-REALTIME] Data channel event #4: response.audio.delta
[OPENAI-REALTIME] Data channel event #5: response.audio.done
```

### State Transitions

Monitor peer connection states:

**Frontend (from `[FRONTEND]` logs):**
```
[FRONTEND] ICE connection state: new
[FRONTEND] ICE connection state: checking
[FRONTEND] ICE connection state: connected  # ✅ Success!
[FRONTEND] Connection state: connected      # ✅ Success!
```

**Expected Success Pattern:**
1. Configuration loads without errors
2. Server starts and serves static files
3. /signal endpoint receives valid SDP offer
4. OpenAI data channel opens successfully
5. Audio tracks attach
6. Frame counters start incrementing
7. Connection states reach "connected"

## Tips

1. **Split screen** - Keep both terminals visible
2. **Watch for red** - Errors are highlighted in red in Terminal 2
3. **Monitor frame counts** - Audio frames should increment continuously
4. **Check data channel** - Must see "Data channel OPENED successfully!"
5. **Verify connection order** - OpenAI connection happens BEFORE browser SDP processing
6. **Look for state: connected** - Both frontend and connection state should be "connected"
7. **Filter with grep** - Use grep to focus on specific log prefixes
8. **Multiple runs** - You can run the test multiple times to compare logs

## Next Steps

After identifying issues using the logs:

1. **Locate the problem** - Use the log prefix to identify which component is failing:
   - `[CONFIG]` → Check `.env` file and environment variables
   - `[SERVER]` → Check Express routes and HTTP handling
   - `[BROWSER-BRIDGE]` → Check WebRTC bridge logic
   - `[OPENAI-REALTIME]` → Check OpenAI API connection
   - `[FRONTEND]` → Check browser JavaScript

2. **Find the exact code** - Error logs include context and often file references

3. **Make changes** - Edit the source files in `src/` or `public/`

4. **Rebuild** - TypeScript changes require rebuild:
   ```bash
   npm run build
   ```
   Frontend changes (`.js`, `.html`) don't need rebuild.

5. **Restart server** - Kill Terminal 1 (Ctrl+C) and restart:
   ```bash
   npm start
   ```

6. **Test again** - Run interactive test and compare logs:
   ```bash
   npm run test:interactive
   ```

7. **Verify fix** - Check that:
   - Previous error messages are gone
   - Audio frame counters are incrementing
   - Connection states reach "connected"
   - No new errors appear

## Files

- [tests/interactive.e2e.test.ts](tests/interactive.e2e.test.ts) - Main test file
- [playwright.config.ts](playwright.config.ts) - Playwright configuration
- [package.json](package.json) - Scripts configuration
