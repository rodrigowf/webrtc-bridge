import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@anthropic-ai/claude-agent-sdk', () => {
  type RunMode = 'normal' | 'abort' | 'error';
  let runMode: RunMode = 'normal';
  let lastAbortController: AbortController | null = null;

  // V1 API - query function (fresh session each time)
  function query(opts: { prompt: string; options?: { abortController?: AbortController; [key: string]: any } }) {
    // abortController is inside options per the actual SDK API
    lastAbortController = opts.options?.abortController ?? null;

    async function* generator(): AsyncGenerator<any> {
      if (runMode === 'error') {
        throw new Error('claude boom');
      }

      if (runMode === 'abort') {
        while (!opts.options?.abortController?.signal.aborted) {
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        throw new Error('aborted');
      }

      yield { type: 'user', message: { content: [{ type: 'text', text: 'test prompt' }] } };
      yield {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Claude response here' }] },
      };
      yield { type: 'result', result: 'Claude completed successfully' };
    }

    return generator();
  }

  // V2 API - persistent session mock
  class MockSession {
    private messageQueue: string[] = [];
    private closed = false;

    async send(message: string) {
      if (this.closed) throw new Error('Session is closed');
      this.messageQueue.push(message);
    }

    async *receive(): AsyncGenerator<any> {
      if (this.closed) throw new Error('Session is closed');

      if (runMode === 'error') {
        throw new Error('claude boom');
      }

      const prompt = this.messageQueue.shift() || '';

      yield { type: 'user', message: { content: [{ type: 'text', text: prompt }] } };
      yield {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Persistent session response' }] },
      };
      yield { type: 'result', result: 'Session query completed', session_id: 'sdk-session-123' };
    }

    close() {
      this.closed = true;
    }
  }

  function unstable_v2_createSession(_opts: { model: string }) {
    return new MockSession();
  }

  return {
    query,
    unstable_v2_createSession,
    __setRunMode: (mode: RunMode) => {
      runMode = mode;
    },
    __getLastAbortController: () => lastAbortController,
  };
});

async function loadService() {
  // Ensure a fresh module state for each test
  const service = await import('../src/claude/claude.service.js');
  return service;
}

describe('claude.service', () => {
  beforeEach(async () => {
    vi.resetModules();
    const sdkMock: any = await import('@anthropic-ai/claude-agent-sdk');
    sdkMock.__setRunMode('normal');
  });

  describe('runClaude (fresh session)', () => {
    it('runs Claude and streams events with final response', async () => {
      const service = await loadService();
      const captured: any[] = [];
      const unsub = service.subscribeClaudeEvents((evt) => captured.push(evt));

      const result = await service.runClaude('do something');
      unsub();

      expect(result.status).toBe('ok');
      expect(result.finalResponse).toBe('Claude completed successfully');
      expect(result.sessionId).toMatch(/^claude-fresh-\d+$/);
      expect(captured.some((e) => e.type === 'session_started')).toBe(true);
      expect(captured.some((e) => e.type === 'message')).toBe(true);
      expect(captured.some((e) => e.type === 'session_completed')).toBe(true);
    });

    it('aborts an in-flight turn and reports stopped status', async () => {
      const sdkMock: any = await import('@anthropic-ai/claude-agent-sdk');
      sdkMock.__setRunMode('abort');

      const service = await loadService();
      const captured: any[] = [];
      const unsub = service.subscribeClaudeEvents((evt) => captured.push(evt));

      const runPromise = service.runClaude('long task');
      // Give the generator time to start, then trigger stop
      let stopResult: any;
      await new Promise((resolve) =>
        setTimeout(() => {
          stopResult = service.stopClaude();
          resolve(null);
        }, 15),
      );

      const result = await runPromise;
      unsub();

      expect(stopResult.status).toBe('stopped');
      expect(result.status).toBe('aborted');
      expect(captured.some((e) => e.type === 'turn_aborted')).toBe(true);
    });

    it('returns error status when Claude fails', async () => {
      const sdkMock: any = await import('@anthropic-ai/claude-agent-sdk');
      sdkMock.__setRunMode('error');

      const service = await loadService();
      const result = await service.runClaude('broken task');

      expect(result.status).toBe('error');
      expect(result.error).toContain('claude boom');
    });
  });

  describe('persistent session (V2 API)', () => {
    it('initClaudeSession creates a new session', async () => {
      const service = await loadService();
      const captured: any[] = [];
      const unsub = service.subscribeClaudeEvents((evt) => captured.push(evt));

      const result = await service.initClaudeSession();
      unsub();

      expect(result.status).toBe('initialized');
      expect(result.sessionId).toMatch(/^claude-session-\d+$/);
      expect(service.hasActiveSession()).toBe(true);
      expect(captured.some((e) => e.type === 'session_started')).toBe(true);
    });

    it('initClaudeSession returns already_initialized if session exists', async () => {
      const service = await loadService();

      const result1 = await service.initClaudeSession();
      const result2 = await service.initClaudeSession();

      expect(result1.status).toBe('initialized');
      expect(result2.status).toBe('already_initialized');
      expect(result2.sessionId).toBe(result1.sessionId);
    });

    it('queryClaudeSession sends message and receives response', async () => {
      const service = await loadService();
      const captured: any[] = [];
      const unsub = service.subscribeClaudeEvents((evt) => captured.push(evt));

      const result = await service.queryClaudeSession('test query');
      unsub();

      expect(result.status).toBe('ok');
      expect(result.finalResponse).toBe('Session query completed');
      expect(result.sessionId).toMatch(/^claude-session-\d+$/);
      expect(captured.some((e) => e.type === 'turn_started')).toBe(true);
      expect(captured.some((e) => e.type === 'message')).toBe(true);
      expect(captured.some((e) => e.type === 'turn_completed')).toBe(true);
    });

    it('queryClaudeSession auto-initializes session if not exists', async () => {
      const service = await loadService();

      expect(service.hasActiveSession()).toBe(false);

      const result = await service.queryClaudeSession('auto init test');

      expect(result.status).toBe('ok');
      expect(service.hasActiveSession()).toBe(true);
    });

    it('hasActiveSession returns false initially', async () => {
      const service = await loadService();
      expect(service.hasActiveSession()).toBe(false);
    });

    it('hasActiveSession returns true after init', async () => {
      const service = await loadService();
      await service.initClaudeSession();
      expect(service.hasActiveSession()).toBe(true);
    });

    it('hasActiveSession returns false after reset', async () => {
      const service = await loadService();
      await service.initClaudeSession();
      expect(service.hasActiveSession()).toBe(true);

      service.resetClaude();
      expect(service.hasActiveSession()).toBe(false);
    });
  });

  describe('common operations', () => {
    it('resets the session and broadcasts reset event', async () => {
      const service = await loadService();
      const captured: any[] = [];
      const unsub = service.subscribeClaudeEvents((evt) => captured.push(evt));

      const result = service.resetClaude();
      unsub();

      expect(result.status).toBe('reset');
      expect(result.sessionId).toBeNull();
      expect(captured.some((e) => e.type === 'session_reset')).toBe(true);
    });

    it('stopClaude reports idle when nothing is running', async () => {
      const service = await loadService();
      const result = service.stopClaude();
      expect(result.status).toBe('idle');
    });

    it('getCurrentSessionId returns null initially', async () => {
      const service = await loadService();
      expect(service.getCurrentSessionId()).toBeNull();
    });

    it('getCurrentSessionId returns session id after queryClaudeSession', async () => {
      const service = await loadService();
      await service.queryClaudeSession('test');
      expect(service.getCurrentSessionId()).toMatch(/^claude-session-\d+$/);
    });
  });
});
