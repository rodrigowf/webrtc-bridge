import express from 'express';
import https from 'https';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

import { env } from './config.env.js';
import { getSSLCerts } from './ssl/generate-cert.js';
import { handleBrowserOffer, handleBrowserDisconnect, getConnectionCount, getConnectionIds, disconnectAllBrowserConnections } from './webrtc/browser-bridge.js';
import { realtimeSessionManager } from './openai/openai.realtime.js';
import {
  promptCodex,
  pauseCodex,
  compactCodex,
  resetCodex,
  subscribeCodexEvents,
  getCurrentThreadId,
  hasActiveThread,
  isProcessing as isCodexProcessing,
} from './codex/codex.service.js';
import {
  promptClaude,
  pauseClaude,
  compactClaude,
  resetClaude,
  subscribeClaudeEvents,
  getCurrentSessionId,
  hasActiveSession,
  isProcessing as isClaudeProcessing,
} from './claude/claude.service.js';
import {
  checkClaudeAuth,
  setClaudeApiKey,
} from './claude/claude.auth.js';
import { subscribeTranscriptEvents } from './openai/openai.realtime.js';
import { displayServerInfo } from './utils/network-info.js';
import {
  listConversations,
  loadConversation,
  createConversation,
  deleteConversation,
  getCurrentConversationId,
  setCurrentConversationId,
  addTranscriptEntry,
  type TranscriptEntry,
} from './conversations/conversation.storage.js';
import {
  getShowInnerThoughts,
  setShowInnerThoughts,
  shouldSendEvent,
} from './config/verbosity.js';

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

// Start all services (OpenAI, Claude, Codex)
app.post('/services/start', async (_req, res) => {
  console.log('[SERVER] /services/start endpoint called');
  try {
    // Initialize OpenAI Realtime session
    await realtimeSessionManager.getSession();
    console.log('[SERVER] All services started successfully');
    res.json({
      status: 'ok',
      message: 'All services started',
      openaiConnected: true,
    });
  } catch (err) {
    console.error('[SERVER] Error starting services:', err);
    res.status(500).json({ error: 'Failed to start services' });
  }
});

// Stop all services (OpenAI, Claude, Codex)
app.post('/services/stop', (_req, res) => {
  console.log('[SERVER] /services/stop endpoint called');
  try {
    // Disconnect all browser connections first
    const { count } = disconnectAllBrowserConnections();
    console.log(`[SERVER] Disconnected ${count} browser connection(s)`);

    // Close OpenAI session
    realtimeSessionManager.closeSession();
    // Reset Codex
    resetCodex();
    // Reset Claude
    resetClaude();
    console.log('[SERVER] All services stopped successfully');
    res.json({
      status: 'ok',
      message: 'All services stopped',
      openaiConnected: false,
      disconnectedConnections: count,
    });
  } catch (err) {
    console.error('[SERVER] Error stopping services:', err);
    res.status(500).json({ error: 'Failed to stop services' });
  }
});

// Conversation endpoints
app.get('/conversations', async (_req, res) => {
  console.log('[SERVER] /conversations endpoint called');
  try {
    const conversations = await listConversations();
    res.json({
      conversations,
      currentId: getCurrentConversationId(),
    });
  } catch (err) {
    console.error('[SERVER] Error listing conversations:', err);
    res.status(500).json({ error: 'Failed to list conversations' });
  }
});

app.get('/conversations/:id', async (req, res) => {
  const { id } = req.params;
  console.log('[SERVER] /conversations/:id endpoint called for:', id);
  try {
    const conversation = await loadConversation(id);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    res.json(conversation);
  } catch (err) {
    console.error('[SERVER] Error loading conversation:', err);
    res.status(500).json({ error: 'Failed to load conversation' });
  }
});

app.post('/conversations', async (_req, res) => {
  console.log('[SERVER] POST /conversations endpoint called - creating new conversation');
  try {
    const conversation = await createConversation();
    res.json(conversation);
  } catch (err) {
    console.error('[SERVER] Error creating conversation:', err);
    res.status(500).json({ error: 'Failed to create conversation' });
  }
});

app.post('/conversations/:id/select', async (req, res) => {
  const { id } = req.params;
  console.log('[SERVER] /conversations/:id/select endpoint called for:', id);
  try {
    const conversation = await loadConversation(id);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    setCurrentConversationId(id);
    // Note: Conversation history is loaded into OpenAI session at connection time,
    // not when switching conversations (switching is disabled during active sessions)
    res.json({ status: 'ok', conversation });
  } catch (err) {
    console.error('[SERVER] Error selecting conversation:', err);
    res.status(500).json({ error: 'Failed to select conversation' });
  }
});

app.delete('/conversations/:id', async (req, res) => {
  const { id } = req.params;
  console.log('[SERVER] DELETE /conversations/:id endpoint called for:', id);
  try {
    const success = await deleteConversation(id);
    if (!success) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    res.json({ status: 'ok' });
  } catch (err) {
    console.error('[SERVER] Error deleting conversation:', err);
    res.status(500).json({ error: 'Failed to delete conversation' });
  }
});

// Codex endpoints
app.post('/codex/prompt', async (req, res) => {
  console.log('[SERVER] /codex/prompt endpoint called');
  const { prompt } = req.body ?? {};
  if (!prompt || typeof prompt !== 'string') {
    console.error('[SERVER] Invalid request: missing or invalid prompt');
    return res.status(400).json({ error: 'Missing prompt' });
  }

  try {
    console.log('[SERVER] Calling promptCodex with prompt length:', prompt.length);
    const result = await promptCodex(prompt);
    console.log('[SERVER] Codex prompt completed with status:', result.status);
    res.json(result);
  } catch (err) {
    console.error('[SERVER] Error running Codex:', err);
    res.status(500).json({ error: 'Failed to run Codex', status: 'error' });
  }
});

app.post('/codex/pause', (_req, res) => {
  console.log('[SERVER] /codex/pause endpoint called');
  try {
    const result = pauseCodex();
    console.log('[SERVER] Codex pause result:', result.status);
    res.json(result);
  } catch (err) {
    console.error('[SERVER] Error pausing Codex:', err);
    res.status(500).json({ error: 'Failed to pause Codex' });
  }
});

app.post('/codex/compact', async (_req, res) => {
  console.log('[SERVER] /codex/compact endpoint called');
  try {
    const result = await compactCodex();
    console.log('[SERVER] Codex compact result:', result.status);
    res.json(result);
  } catch (err) {
    console.error('[SERVER] Error compacting Codex:', err);
    res.status(500).json({ error: 'Failed to compact Codex' });
  }
});

app.post('/codex/reset', (_req, res) => {
  console.log('[SERVER] /codex/reset endpoint called');
  try {
    const result = resetCodex();
    console.log('[SERVER] Codex reset result:', result.status);
    res.json(result);
  } catch (err) {
    console.error('[SERVER] Error resetting Codex:', err);
    res.status(500).json({ error: 'Failed to reset Codex' });
  }
});

app.get('/codex/status', (_req, res) => {
  console.log('[SERVER] /codex/status endpoint called');
  try {
    res.json({
      threadId: getCurrentThreadId(),
      hasActiveThread: hasActiveThread(),
      isProcessing: isCodexProcessing(),
    });
  } catch (err) {
    console.error('[SERVER] Error getting Codex status:', err);
    res.status(500).json({ error: 'Failed to get Codex status' });
  }
});

// Claude Code endpoints
app.post('/claude/prompt', async (req, res) => {
  console.log('[SERVER] /claude/prompt endpoint called');
  const { prompt } = req.body ?? {};
  if (!prompt || typeof prompt !== 'string') {
    console.error('[SERVER] Invalid request: missing or invalid prompt');
    return res.status(400).json({ error: 'Missing prompt' });
  }

  try {
    console.log('[SERVER] Calling promptClaude with prompt length:', prompt.length);
    const result = await promptClaude(prompt);
    console.log('[SERVER] Claude prompt completed with status:', result.status);
    res.json(result);
  } catch (err) {
    console.error('[SERVER] Error running Claude:', err);
    res.status(500).json({ error: 'Failed to run Claude', status: 'error' });
  }
});

app.post('/claude/pause', async (_req, res) => {
  console.log('[SERVER] /claude/pause endpoint called');
  try {
    const result = await pauseClaude();
    console.log('[SERVER] Claude pause result:', result.status);
    res.json(result);
  } catch (err) {
    console.error('[SERVER] Error pausing Claude:', err);
    res.status(500).json({ error: 'Failed to pause Claude' });
  }
});

app.post('/claude/compact', async (_req, res) => {
  console.log('[SERVER] /claude/compact endpoint called');
  try {
    const result = await compactClaude();
    console.log('[SERVER] Claude compact result:', result.status);
    res.json(result);
  } catch (err) {
    console.error('[SERVER] Error compacting Claude:', err);
    res.status(500).json({ error: 'Failed to compact Claude' });
  }
});

app.post('/claude/reset', async (_req, res) => {
  console.log('[SERVER] /claude/reset endpoint called');
  try {
    const result = await resetClaude();
    console.log('[SERVER] Claude reset result:', result.status);
    res.json(result);
  } catch (err) {
    console.error('[SERVER] Error resetting Claude:', err);
    res.status(500).json({ error: 'Failed to reset Claude' });
  }
});

app.get('/claude/status', (_req, res) => {
  console.log('[SERVER] /claude/status endpoint called');
  try {
    res.json({
      sessionId: getCurrentSessionId(),
      hasActiveSession: hasActiveSession(),
      isProcessing: isClaudeProcessing(),
    });
  } catch (err) {
    console.error('[SERVER] Error getting Claude status:', err);
    res.status(500).json({ error: 'Failed to get Claude status' });
  }
});

// Claude authentication endpoints
app.get('/claude/auth/status', async (_req, res) => {
  console.log('[SERVER] /claude/auth/status endpoint called');
  try {
    const authStatus = await checkClaudeAuth();
    console.log('[SERVER] Claude auth status:', authStatus);
    res.json(authStatus);
  } catch (err) {
    console.error('[SERVER] Error checking Claude auth:', err);
    res.status(500).json({
      isAuthenticated: false,
      needsLogin: true,
      error: 'Failed to check authentication status'
    });
  }
});

app.post('/claude/auth/set-key', (req, res) => {
  console.log('[SERVER] /claude/auth/set-key endpoint called');
  const { apiKey } = req.body ?? {};

  if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
    console.error('[SERVER] Invalid request: missing or invalid API key');
    return res.status(400).json({ error: 'API key is required' });
  }

  try {
    setClaudeApiKey(apiKey.trim());
    console.log('[SERVER] Claude API key set successfully');
    res.json({
      success: true,
      message: 'API key set successfully'
    });
  } catch (err) {
    console.error('[SERVER] Error setting Claude API key:', err);
    res.status(500).json({ error: 'Failed to set API key' });
  }
});

// Inner thoughts visibility endpoints
app.get('/agents/inner-thoughts', (_req, res) => {
  console.log('[SERVER] /agents/inner-thoughts endpoint called');
  try {
    res.json({
      showInnerThoughts: getShowInnerThoughts(),
    });
  } catch (err) {
    console.error('[SERVER] Error getting inner thoughts setting:', err);
    res.status(500).json({ error: 'Failed to get inner thoughts setting' });
  }
});

app.post('/agents/inner-thoughts', (req, res) => {
  console.log('[SERVER] POST /agents/inner-thoughts endpoint called');
  const { show } = req.body ?? {};
  if (typeof show !== 'boolean') {
    console.error('[SERVER] Invalid request: show must be a boolean');
    return res.status(400).json({ error: 'show must be a boolean' });
  }

  try {
    const result = setShowInnerThoughts(show);
    console.log('[SERVER] Inner thoughts set to:', result.showInnerThoughts);
    res.json(result);
  } catch (err) {
    console.error('[SERVER] Error setting inner thoughts:', err);
    res.status(500).json({ error: 'Failed to set inner thoughts' });
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

  // Subscribe to Codex events (with inner thoughts filtering)
  const unsubscribeCodex = subscribeCodexEvents((event) => {
    try {
      if (shouldSendEvent(event.type, getShowInnerThoughts())) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[SERVER] Error writing SSE Codex event:', err);
    }
  });

  // Subscribe to transcript events (always sent, they're essential)
  const unsubscribeTranscript = subscribeTranscriptEvents((event) => {
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[SERVER] Error writing SSE transcript event:', err);
    }
  });

  // Subscribe to Claude events (with inner thoughts filtering)
  const unsubscribeClaude = subscribeClaudeEvents((event) => {
    try {
      if (shouldSendEvent(event.type, getShowInnerThoughts())) {
        res.write(`data: ${JSON.stringify({ ...event, source: 'claude' })}\n\n`);
      }
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
