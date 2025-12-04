import express from 'express';
import path from 'path';

import { env } from './config.env';
import { handleBrowserOffer } from './webrtc/browser-bridge';

console.log('[SERVER] Initializing Express application...');
const app = express();

console.log('[SERVER] Setting up middleware...');
app.use(express.json());
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
    const { answerSdp } = await handleBrowserOffer(offer);
    console.log('[SERVER] Successfully created answer SDP, length:', answerSdp.length);
    res.json({ answer: answerSdp });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[SERVER] Error handling browser offer:', err);
    res.status(500).json({ error: 'Failed to establish WebRTC bridge' });
  }
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(env.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`Server listening on http://localhost:${env.PORT}`);
  });
}

export default app;
