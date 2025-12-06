import express from 'express';
import https from 'https';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

import { env } from './config.env.js';
import { getSSLCerts } from './ssl/generate-cert.js';
import { handleBrowserOffer, handleBrowserDisconnect, getConnectionCount, getConnectionIds } from './webrtc/browser-bridge.js';
import { realtimeSessionManager } from './openai/openai.realtime.js';
import {
  runCodex,
  stopCodex,
  resetCodex,
  subscribeCodexEvents,
  getCurrentThreadId,
} from './codex/codex.service.js';
import {
  runClaude,
  stopClaude,
  resetClaude,
  subscribeClaudeEvents,
  getCurrentSessionId,
  initClaudeSession,
  queryClaudeSession,
  hasActiveSession,
} from './claude/claude.service.js';
import { subscribeTranscriptEvents } from './openai/openai.realtime.js';
import { displayServerInfo } from './utils/network-info.js';

// ESM equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('[SERVER] Initializing Express application...');
const app = express();

console.log('[SERVER] Setting up middleware...');
app.use(express.json());
app.use(express.text()); // Support text/plain for sendBeacon
app.use(express.static(path.join(__dirname, '..', 'public')));
console.log('[SERVER] Static files served from:', path.join(__dirname, '..', 'public'));

app.get('/healthz', (_req, res) => {
  console.log('[SERVER] Health check requested');
  res.json({ status: 'ok' });
});

app.post('/signal', async (req, res) => {
  console.log('[SERVER] /signal endpoint called - new WebRTC connection request');
  const { offer } = req.body ?? {};
  if (!offer || typeof offer !== 'string') {
    console.error('[SERVER] Invalid request: missing or invalid offer');
    return res.status(400).json({ error: 'Missing offer' });
  }

  console.log('[SERVER] Valid offer received, SDP length:', offer.length);
  try {
    console.log('[SERVER] Calling handleBrowserOffer...');
    const { answerSdp, connectionId } = await handleBrowserOffer(offer);
    console.log('[SERVER] Successfully created answer SDP, length:', answerSdp.length, 'connectionId:', connectionId);
    res.json({ answer: answerSdp, connectionId });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[SERVER] Error handling browser offer:', err);
    res.status(500).json({ error: 'Failed to establish WebRTC bridge' });
  }
});

// Disconnect a specific frontend connection
app.post('/disconnect', (req, res) => {
  console.log('[SERVER] /disconnect endpoint called');

  // Handle both JSON body and text/plain body (from sendBeacon)
  let connectionId: string | undefined;
  if (typeof req.body === 'string') {
    try {
      const parsed = JSON.parse(req.body);
      connectionId = parsed.connectionId;
    } catch {
      console.error('[SERVER] Failed to parse text body as JSON');
    }
  } else {
    connectionId = req.body?.connectionId;
  }

  if (!connectionId || typeof connectionId !== 'string') {
    console.error('[SERVER] Invalid request: missing or invalid connectionId');
    return res.status(400).json({ error: 'Missing connectionId' });
  }

  try {
    const result = handleBrowserDisconnect(connectionId);
    console.log('[SERVER] Disconnect result:', result.status);
    res.json(result);
  } catch (err) {
    console.error('[SERVER] Error disconnecting:', err);
    res.status(500).json({ error: 'Failed to disconnect' });
  }
});

// Get session status (OpenAI connection + active frontends)
app.get('/session/status', (_req, res) => {
  console.log('[SERVER] /session/status endpoint called');
  try {
    res.json({
      openaiConnected: realtimeSessionManager.isConnected(),
      frontendCount: getConnectionCount(),
      frontendIds: getConnectionIds(),
    });
  } catch (err) {
    console.error('[SERVER] Error getting session status:', err);
    res.status(500).json({ error: 'Failed to get session status' });
  }
});

// Codex endpoints
app.post('/codex/run', async (req, res) => {
  console.log('[SERVER] /codex/run endpoint called');
  const { prompt } = req.body ?? {};
  if (!prompt || typeof prompt !== 'string') {
    console.error('[SERVER] Invalid request: missing or invalid prompt');
    return res.status(400).json({ error: 'Missing prompt' });
  }

  try {
    console.log('[SERVER] Calling runCodex with prompt length:', prompt.length);
    const result = await runCodex(prompt);
    console.log('[SERVER] Codex run completed with status:', result.status);
    res.json(result);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[SERVER] Error running Codex:', err);
    res.status(500).json({ error: 'Failed to run Codex', status: 'error' });
  }
});

app.post('/codex/stop', (_req, res) => {
  console.log('[SERVER] /codex/stop endpoint called');
  try {
    const result = stopCodex();
    console.log('[SERVER] Codex stop result:', result.status);
    res.json(result);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[SERVER] Error stopping Codex:', err);
    res.status(500).json({ error: 'Failed to stop Codex' });
  }
});

app.post('/codex/reset', (_req, res) => {
  console.log('[SERVER] /codex/reset endpoint called');
  try {
    const result = resetCodex();
    console.log('[SERVER] Codex reset result:', result.status);
    res.json(result);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[SERVER] Error resetting Codex:', err);
    res.status(500).json({ error: 'Failed to reset Codex' });
  }
});

app.get('/codex/status', (_req, res) => {
  console.log('[SERVER] /codex/status endpoint called');
  try {
    const threadId = getCurrentThreadId();
    res.json({ threadId });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[SERVER] Error getting Codex status:', err);
    res.status(500).json({ error: 'Failed to get Codex status' });
  }
});

// Claude Code endpoints
app.post('/claude/run', async (req, res) => {
  console.log('[SERVER] /claude/run endpoint called');
  const { prompt } = req.body ?? {};
  if (!prompt || typeof prompt !== 'string') {
    console.error('[SERVER] Invalid request: missing or invalid prompt');
    return res.status(400).json({ error: 'Missing prompt' });
  }

  try {
    console.log('[SERVER] Calling runClaude with prompt length:', prompt.length);
    const result = await runClaude(prompt);
    console.log('[SERVER] Claude run completed with status:', result.status);
    res.json(result);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[SERVER] Error running Claude:', err);
    res.status(500).json({ error: 'Failed to run Claude', status: 'error' });
  }
});

app.post('/claude/stop', (_req, res) => {
  console.log('[SERVER] /claude/stop endpoint called');
  try {
    const result = stopClaude();
    console.log('[SERVER] Claude stop result:', result.status);
    res.json(result);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[SERVER] Error stopping Claude:', err);
    res.status(500).json({ error: 'Failed to stop Claude' });
  }
});

app.post('/claude/reset', (_req, res) => {
  console.log('[SERVER] /claude/reset endpoint called');
  try {
    const result = resetClaude();
    console.log('[SERVER] Claude reset result:', result.status);
    res.json(result);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[SERVER] Error resetting Claude:', err);
    res.status(500).json({ error: 'Failed to reset Claude' });
  }
});

app.get('/claude/status', (_req, res) => {
  console.log('[SERVER] /claude/status endpoint called');
  try {
    const sessionId = getCurrentSessionId();
    const hasSession = hasActiveSession();
    res.json({ sessionId, hasActiveSession: hasSession });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[SERVER] Error getting Claude status:', err);
    res.status(500).json({ error: 'Failed to get Claude status' });
  }
});

// Claude persistent session endpoints
app.post('/claude/init', async (_req, res) => {
  console.log('[SERVER] /claude/init endpoint called');
  try {
    const result = await initClaudeSession();
    console.log('[SERVER] Claude init result:', result.status);
    res.json(result);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[SERVER] Error initializing Claude session:', err);
    res.status(500).json({ error: 'Failed to initialize Claude session', status: 'error' });
  }
});

app.post('/claude/query', async (req, res) => {
  console.log('[SERVER] /claude/query endpoint called');
  const { prompt } = req.body ?? {};
  if (!prompt || typeof prompt !== 'string') {
    console.error('[SERVER] Invalid request: missing or invalid prompt');
    return res.status(400).json({ error: 'Missing prompt' });
  }

  try {
    console.log('[SERVER] Calling queryClaudeSession with prompt length:', prompt.length);
    const result = await queryClaudeSession(prompt);
    console.log('[SERVER] Claude query completed with status:', result.status);
    res.json(result);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[SERVER] Error querying Claude session:', err);
    res.status(500).json({ error: 'Failed to query Claude session', status: 'error' });
  }
});

app.get('/codex/events', (req, res) => {
  console.log('[SERVER] /codex/events SSE endpoint called');

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

  // Send initial connection success
  res.write('data: {"type":"connected"}\n\n');

  // Subscribe to Codex events
  const unsubscribeCodex = subscribeCodexEvents((event) => {
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[SERVER] Error writing SSE Codex event:', err);
    }
  });

  // Subscribe to transcript events
  const unsubscribeTranscript = subscribeTranscriptEvents((event) => {
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[SERVER] Error writing SSE transcript event:', err);
    }
  });

  // Subscribe to Claude events
  const unsubscribeClaude = subscribeClaudeEvents((event) => {
    try {
      res.write(`data: ${JSON.stringify({ ...event, source: 'claude' })}\n\n`);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[SERVER] Error writing SSE Claude event:', err);
    }
  });

  // Handle client disconnect
  req.on('close', () => {
    console.log('[SERVER] SSE client disconnected');
    unsubscribeCodex();
    unsubscribeTranscript();
    unsubscribeClaude();
  });
});

if (process.env.NODE_ENV !== 'test') {
  if (env.SSL_ENABLED) {
    try {
      const sslCerts = getSSLCerts(env.SSL_CERT_PATH, env.SSL_KEY_PATH);
      const httpsServer = https.createServer(sslCerts, app);
      httpsServer.listen(env.PORT, () => {
        displayServerInfo(env.PORT, true);
      });
    } catch (error) {
      console.error('[SERVER] Failed to start HTTPS server:', error);
      console.log('[SERVER] Falling back to HTTP...');
      app.listen(env.PORT, () => {
        displayServerInfo(env.PORT, false);
        console.log('[SERVER] WARNING: WebRTC will not work on mobile without HTTPS');
      });
    }
  } else {
    app.listen(env.PORT, () => {
      displayServerInfo(env.PORT, false);
      console.log('[SERVER] WARNING: WebRTC will not work on mobile without HTTPS');
    });
  }
}

export default app;
