import { describe, it, expect } from 'vitest';
import app from '../src/server.js';

describe('Codex events SSE endpoint', () => {
  it('responds with text/event-stream', async () => {
    const server = app.listen(0);
    try {
      const addr = server.address();
      const base =
        typeof addr === 'string' ? addr : `http://127.0.0.1:${addr?.port ?? 0}`;

      const res = await fetch(`${base}/codex/events`, {
        headers: { Accept: 'text/event-stream' },
        signal: AbortSignal.timeout(500),
      });

      expect(res.ok).toBe(true);
      const ct = res.headers.get('content-type') || '';
      expect(ct).toContain('text/event-stream');
      await res.body?.cancel();
    } finally {
      server.close();
    }
  });
});
