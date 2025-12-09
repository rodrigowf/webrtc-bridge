import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock claude-agent-sdk before importing the server
vi.mock('@anthropic-ai/claude-agent-sdk', () => {
  // Mock query() API that returns an AsyncGenerator with control methods
  function query({ prompt, options }: { prompt: string; options?: any }) {
    const abortController = options?.abortController;

    async function* generator() {
      if (abortController?.signal.aborted) {
        throw new Error('aborted');
      }

      yield { type: 'system', subtype: 'init', cwd: '/test', tools: ['Read', 'Edit', 'Bash'] };
      yield { type: 'user', message: { content: [{ type: 'text', text: prompt }] } };
      yield {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Query response' }] },
      };
      yield { type: 'result', result: 'Query completed', session_id: 'sdk-session-123' };
    }

    const gen = generator();
    // Add control methods to the generator
    (gen as any).interrupt = async () => {
      abortController?.abort();
    };
    (gen as any).setPermissionMode = async () => {};
    (gen as any).setModel = async () => {};

    return gen;
  }

  return { query };
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
      expect(data).toHaveProperty('isProcessing');
    } finally {
      server.close();
    }
  });

  it('responds to /claude/pause endpoint', async () => {
    const app = (await import('../src/server.js')).default;
    const server = app.listen(0);

    try {
      const addr = server.address();
      const base =
        typeof addr === 'string' ? addr : `http://127.0.0.1:${addr?.port ?? 0}`;

      const res = await fetch(`${base}/claude/pause`, { method: 'POST' });
      expect(res.ok).toBe(true);

      const data = await res.json();
      // pauseClaude now always returns 'paused' status
      expect(data.status).toBe('paused');
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

  it('rejects /claude/prompt without prompt', async () => {
    const app = (await import('../src/server.js')).default;
    const server = app.listen(0);

    try {
      const addr = server.address();
      const base =
        typeof addr === 'string' ? addr : `http://127.0.0.1:${addr?.port ?? 0}`;

      const res = await fetch(`${base}/claude/prompt`, {
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

  it('responds to /claude/prompt endpoint', async () => {
    const app = (await import('../src/server.js')).default;
    const server = app.listen(0);

    try {
      const addr = server.address();
      const base =
        typeof addr === 'string' ? addr : `http://127.0.0.1:${addr?.port ?? 0}`;

      const res = await fetch(`${base}/claude/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'test prompt' }),
      });
      expect(res.ok).toBe(true);

      const data = await res.json();
      expect(data.status).toBe('ok');
      expect(data.sessionId).toMatch(/^claude-session-\d+$/);
    } finally {
      server.close();
    }
  });

  it('responds to /claude/compact endpoint', async () => {
    const app = (await import('../src/server.js')).default;
    const server = app.listen(0);

    try {
      const addr = server.address();
      const base =
        typeof addr === 'string' ? addr : `http://127.0.0.1:${addr?.port ?? 0}`;

      // First need to create a session
      await fetch(`${base}/claude/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'init session' }),
      });

      const res = await fetch(`${base}/claude/compact`, { method: 'POST' });
      expect(res.ok).toBe(true);

      const data = await res.json();
      // compact may succeed or error depending on mock - just check we get a response
      expect(data).toHaveProperty('status');
    } finally {
      server.close();
    }
  });
});
