import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@openai/codex-sdk', () => {
  type RunMode = 'normal' | 'abort' | 'error';
  let runMode: RunMode = 'normal';
  let lastSignal: AbortSignal | null = null;

  class MockThread {
    id = 'thread-1';

    runStreamed(_input: string, opts: { signal?: AbortSignal } = {}) {
      lastSignal = opts.signal ?? null;

      async function* events(): AsyncGenerator<any> {
        if (runMode === 'error') {
          throw new Error('boom');
        }

        if (runMode === 'abort') {
          while (!opts.signal?.aborted) {
            await new Promise((resolve) => setTimeout(resolve, 5));
          }
          throw new Error('aborted');
        }

        yield { type: 'thread.started', thread_id: 'thread-1' };
        yield { type: 'item.completed', item: { type: 'agent_message', text: 'Hi there' } };
        yield {
          type: 'turn.completed',
          usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 },
        };
      }

      return { events: events() };
    }
  }

  class MockCodex {
    startThread() {
      return new MockThread();
    }
  }

  return {
    Codex: MockCodex,
    __setRunMode: (mode: RunMode) => {
      runMode = mode;
    },
    __getLastSignal: () => lastSignal,
  };
});

async function loadService() {
  // Ensure a fresh module state for each test
  const service = await import('../src/codex/codex.service');
  return service;
}

describe('codex.service', () => {
  beforeEach(async () => {
    vi.resetModules();
    const sdkMock: any = await import('@openai/codex-sdk');
    sdkMock.__setRunMode('normal');
  });

  it('runs Codex and streams events with final response', async () => {
    const service = await loadService();
    const captured: any[] = [];
    const unsub = service.subscribeCodexEvents((evt) => captured.push(evt));

    const result = await service.runCodex('do something');
    unsub();

    expect(result.status).toBe('ok');
    expect(result.finalResponse).toBe('Hi there');
    expect(result.threadId).toBe('thread-1');
    expect(captured.some((e) => e.type === 'thread_event')).toBe(true);
  });

  it('aborts an in-flight turn and reports stopped status', async () => {
    const sdkMock: any = await import('@openai/codex-sdk');
    sdkMock.__setRunMode('abort');

    const service = await loadService();
    const captured: any[] = [];
    const unsub = service.subscribeCodexEvents((evt) => captured.push(evt));

    const runPromise = service.runCodex('long task');
    // Give the generator time to start, then trigger stop
    let stopResult: any;
    await new Promise((resolve) =>
      setTimeout(() => {
        stopResult = service.stopCodex();
        resolve(null);
      }, 15),
    );

    const result = await runPromise;
    unsub();

    expect(stopResult.status).toBe('stopped');
    expect(result.status).toBe('aborted');
    expect(captured.some((e) => e.type === 'turn_aborted')).toBe(true);
  });

  it('returns error status when Codex fails', async () => {
    const sdkMock: any = await import('@openai/codex-sdk');
    sdkMock.__setRunMode('error');

    const service = await loadService();
    const result = await service.runCodex('broken task');

    expect(result.status).toBe('error');
    expect(result.error).toContain('boom');
  });

  it('resets the thread and broadcasts reset event', async () => {
    const service = await loadService();
    const captured: any[] = [];
    const unsub = service.subscribeCodexEvents((evt) => captured.push(evt));

    const result = service.resetCodex();
    unsub();

    expect(result.status).toBe('reset');
    expect(captured.some((e) => e.type === 'thread_reset')).toBe(true);
  });

  it('stopCodex reports idle when nothing is running', async () => {
    const service = await loadService();
    const result = service.stopCodex();
    expect(result.status).toBe('idle');
  });
});
