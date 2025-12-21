import express from 'express';
import https from 'https';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

import { env } from './config.env.js';
import { getSSLCerts } from './ssl/generate-cert.js';
import { handleBrowserOffer, handleBrowserDisconnect, getConnectionCount, getConnectionIds, disconnectAllBrowserConnections } from './webrtc/browser-bridge.js';
import { realtimeSessionManager, subscribeTranscriptEvents, subscribeTerminalEvents } from './openai/openai.realtime.js';

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

// Start all services (OpenAI)
app.post('/services/start', async (_req, res) => {
  console.log('[SERVER] /services/start endpoint called');
  try {
    // Initialize OpenAI Realtime session
    await realtimeSessionManager.getSession();
    console.log('[SERVER] Services started successfully');
    res.json({
      status: 'ok',
      message: 'Services started',
      openaiConnected: true,
    });
  } catch (err) {
    console.error('[SERVER] Error starting services:', err);
    res.status(500).json({ error: 'Failed to start services' });
  }
});

// Stop all services (OpenAI)
app.post('/services/stop', (_req, res) => {
  console.log('[SERVER] /services/stop endpoint called');
  try {
    // Disconnect all browser connections first
    const { count } = disconnectAllBrowserConnections();
    console.log(`[SERVER] Disconnected ${count} browser connection(s)`);

    // Close OpenAI session
    realtimeSessionManager.closeSession();
    console.log('[SERVER] Services stopped successfully');
    res.json({
      status: 'ok',
      message: 'Services stopped',
      openaiConnected: false,
      disconnectedConnections: count,
    });
  } catch (err) {
    console.error('[SERVER] Error stopping services:', err);
    res.status(500).json({ error: 'Failed to stop services' });
  }
});

// SSE endpoint for events (transcript and terminal output)
app.get('/events', (req, res) => {
  console.log('[SERVER] /events SSE endpoint called');

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

  // Send initial connection success
  res.write('data: {"type":"connected"}\n\n');

  // Subscribe to transcript events
  const unsubscribeTranscript = subscribeTranscriptEvents((event) => {
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch (err) {
      console.error('[SERVER] Error writing SSE transcript event:', err);
    }
  });

  // Subscribe to terminal events
  const unsubscribeTerminal = subscribeTerminalEvents((event) => {
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch (err) {
      console.error('[SERVER] Error writing SSE terminal event:', err);
    }
  });

  // Handle client disconnect
  req.on('close', () => {
    console.log('[SERVER] SSE client disconnected');
    unsubscribeTranscript();
    unsubscribeTerminal();
  });
});

if (process.env.NODE_ENV !== 'test') {
  if (env.SSL_ENABLED) {
    try {
      const sslCerts = getSSLCerts(env.SSL_CERT_PATH, env.SSL_KEY_PATH);
      const httpsServer = https.createServer(sslCerts, app);
      httpsServer.listen(env.PORT, () => {
        console.log('[SERVER] ============================================');
        console.log('[SERVER] Voice Terminal Assistant');
        console.log('[SERVER] ============================================');
        console.log(`[SERVER] HTTPS server listening on port ${env.PORT}`);
        console.log(`[SERVER] Open in browser: https://localhost:${env.PORT}`);
        console.log('[SERVER] ============================================');
      });
    } catch (error) {
      console.error('[SERVER] Failed to start HTTPS server:', error);
      console.log('[SERVER] Falling back to HTTP...');
      app.listen(env.PORT, () => {
        console.log('[SERVER] ============================================');
        console.log('[SERVER] Voice Terminal Assistant');
        console.log('[SERVER] ============================================');
        console.log(`[SERVER] HTTP server listening on port ${env.PORT}`);
        console.log(`[SERVER] Open in browser: http://localhost:${env.PORT}`);
        console.log('[SERVER] WARNING: WebRTC may not work without HTTPS');
        console.log('[SERVER] ============================================');
      });
    }
  } else {
    app.listen(env.PORT, () => {
      console.log('[SERVER] ============================================');
      console.log('[SERVER] Voice Terminal Assistant');
      console.log('[SERVER] ============================================');
      console.log(`[SERVER] HTTP server listening on port ${env.PORT}`);
      console.log(`[SERVER] Open in browser: http://localhost:${env.PORT}`);
      console.log('[SERVER] WARNING: WebRTC may not work without HTTPS');
      console.log('[SERVER] ============================================');
    });
  }
}

export default app;
