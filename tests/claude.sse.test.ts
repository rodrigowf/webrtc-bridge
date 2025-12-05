import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock claude-agent-sdk before importing the server
vi.mock('@anthropic-ai/claude-agent-sdk', () => {
  function query() {
    async function* generator(): AsyncGenerator<any> {
      yield { type: 'result', result: 'test' };
    }
    return generator();
  }

  // V2 API mock for persistent sessions
  class MockSession {
    private messageQueue: string[] = [];

    async send(message: string) {
      this.messageQueue.push(message);
    }

    async *receive(): AsyncGenerator<any> {
      const prompt = this.messageQueue.shift() || '';
      yield { type: 'user', message: { content: [{ type: 'text', text: prompt }] } };
      yield { type: 'result', result: 'session test result', session_id: 'sdk-session-123' };
    }

    close() {}
  }

  function unstable_v2_createSession() {
    return new MockSession();
  }

  return { query, unstable_v2_createSession };
});

// Mock codex-sdk to prevent import errors
vi.mock('@openai/codex-sdk', () => {
  class MockThread {
    id = 'thread-1';
    runStreamed() {
      async function* events(): AsyncGenerator<any> {
        yield { type: 'thread.started', thread_id: 'thread-1' };
      }
      return { events: events() };
    }
  }
  class MockCodex {
    startThread() {
      return new MockThread();
    }
  }
  return { Codex: MockCodex };
});

describe('Claude events via SSE endpoint', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('streams Claude events through the SSE endpoint', async () => {
    const app = (await import('../src/server.js')).default;
    const server = app.listen(0);

    try {
      const addr = server.address();
      const base =
        typeof addr === 'string' ? addr : `http://127.0.0.1:${addr?.port ?? 0}`;

      // Connect to SSE
      const sseRes = await fetch(`${base}/codex/events`, {
        headers: { Accept: 'text/event-stream' },
        signal: AbortSignal.timeout(500),
      });

      expect(sseRes.ok).toBe(true);
      const ct = sseRes.headers.get('content-type') || '';
      expect(ct).toContain('text/event-stream');
      await sseRes.body?.cancel();
    } finally {
      server.close();
    }
  });

  it('responds to /claude/status endpoint with hasActiveSession', async () => {
    const app = (await import('../src/server.js')).default;
    const server = app.listen(0);

    try {
      const addr = server.address();
      const base =
        typeof addr === 'string' ? addr : `http://127.0.0.1:${addr?.port ?? 0}`;

      const res = await fetch(`${base}/claude/status`);
      expect(res.ok).toBe(true);

      const data = await res.json();
      expect(data).toHaveProperty('sessionId');
      expect(data).toHaveProperty('hasActiveSession');
    } finally {
      server.close();
    }
  });

  it('responds to /claude/stop endpoint', async () => {
    const app = (await import('../src/server.js')).default;
    const server = app.listen(0);

    try {
      const addr = server.address();
      const base =
        typeof addr === 'string' ? addr : `http://127.0.0.1:${addr?.port ?? 0}`;

      const res = await fetch(`${base}/claude/stop`, { method: 'POST' });
      expect(res.ok).toBe(true);

      const data = await res.json();
      expect(data.status).toBe('idle');
    } finally {
      server.close();
    }
  });

  it('responds to /claude/reset endpoint', async () => {
    const app = (await import('../src/server.js')).default;
    const server = app.listen(0);

    try {
      const addr = server.address();
      const base =
        typeof addr === 'string' ? addr : `http://127.0.0.1:${addr?.port ?? 0}`;

      const res = await fetch(`${base}/claude/reset`, { method: 'POST' });
      expect(res.ok).toBe(true);

      const data = await res.json();
      expect(data.status).toBe('reset');
    } finally {
      server.close();
    }
  });

  it('rejects /claude/run without prompt', async () => {
    const app = (await import('../src/server.js')).default;
    const server = app.listen(0);

    try {
      const addr = server.address();
      const base =
        typeof addr === 'string' ? addr : `http://127.0.0.1:${addr?.port ?? 0}`;

      const res = await fetch(`${base}/claude/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toBe('Missing prompt');
    } finally {
      server.close();
    }
  });

  it('responds to /claude/init endpoint', async () => {
    const app = (await import('../src/server.js')).default;
    const server = app.listen(0);

    try {
      const addr = server.address();
      const base =
        typeof addr === 'string' ? addr : `http://127.0.0.1:${addr?.port ?? 0}`;

      const res = await fetch(`${base}/claude/init`, { method: 'POST' });
      expect(res.ok).toBe(true);

      const data = await res.json();
      expect(data.status).toBe('initialized');
      expect(data.sessionId).toMatch(/^claude-session-\d+$/);
    } finally {
      server.close();
    }
  });

  it('responds to /claude/query endpoint', async () => {
    const app = (await import('../src/server.js')).default;
    const server = app.listen(0);

    try {
      const addr = server.address();
      const base =
        typeof addr === 'string' ? addr : `http://127.0.0.1:${addr?.port ?? 0}`;

      const res = await fetch(`${base}/claude/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'test query' }),
      });
      expect(res.ok).toBe(true);

      const data = await res.json();
      expect(data.status).toBe('ok');
      expect(data.sessionId).toMatch(/^claude-session-\d+$/);
    } finally {
      server.close();
    }
  });

  it('rejects /claude/query without prompt', async () => {
    const app = (await import('../src/server.js')).default;
    const server = app.listen(0);

    try {
      const addr = server.address();
      const base =
        typeof addr === 'string' ? addr : `http://127.0.0.1:${addr?.port ?? 0}`;

      const res = await fetch(`${base}/claude/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toBe('Missing prompt');
    } finally {
      server.close();
    }
  });
});
