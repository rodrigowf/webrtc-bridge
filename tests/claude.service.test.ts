import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@anthropic-ai/claude-agent-sdk', () => {
  type RunMode = 'normal' | 'abort' | 'error';
  let runMode: RunMode = 'normal';
  let lastAbortController: AbortController | null = null;

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

  return {
    query,
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

  it('runs Claude and streams events with final response', async () => {
    const service = await loadService();
    const captured: any[] = [];
    const unsub = service.subscribeClaudeEvents((evt) => captured.push(evt));

    const result = await service.runClaude('do something');
    unsub();

    expect(result.status).toBe('ok');
    expect(result.finalResponse).toBe('Claude completed successfully');
    expect(result.sessionId).toMatch(/^claude-session-\d+$/);
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

  it('getCurrentSessionId returns session id after run', async () => {
    const service = await loadService();
    await service.runClaude('test');
    expect(service.getCurrentSessionId()).toMatch(/^claude-session-\d+$/);
  });
});
