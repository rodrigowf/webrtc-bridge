import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@anthropic-ai/claude-agent-sdk', () => {
  type RunMode = 'normal' | 'abort' | 'error';
  let runMode: RunMode = 'normal';

  // Mock query() API that returns an AsyncGenerator with control methods
  function query({ prompt, options }: { prompt: string; options?: any }) {
    const abortController = options?.abortController;

    async function* generator() {
      if (runMode === 'error') {
        throw new Error('claude boom');
      }

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

  return {
    query,
    __setRunMode: (mode: RunMode) => {
      runMode = mode;
    },
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

  describe('promptClaude (query API)', () => {
    it('runs Claude and streams events with final response', async () => {
      const service = await loadService();
      const captured: any[] = [];
      const unsub = service.subscribeClaudeEvents((evt) => captured.push(evt));

      const result = await service.promptClaude('do something');
      unsub();

      expect(result.status).toBe('ok');
      expect(result.finalResponse).toBe('Query completed');
      expect(result.sessionId).toMatch(/^claude-session-\d+$/);
      expect(captured.some((e) => e.type === 'session_started')).toBe(true);
      expect(captured.some((e) => e.type === 'message')).toBe(true);
      expect(captured.some((e) => e.type === 'turn_completed')).toBe(true);
    });

    it('returns error status when Claude fails', async () => {
      const sdkMock: any = await import('@anthropic-ai/claude-agent-sdk');
      sdkMock.__setRunMode('error');

      const service = await loadService();
      const result = await service.promptClaude('broken task');

      expect(result.status).toBe('error');
      expect(result.error).toContain('claude boom');
    });
  });

  describe('pauseClaude', () => {
    it('pauseClaude reports paused when nothing is running', async () => {
      const service = await loadService();
      const result = await service.pauseClaude();
      // Even when idle, pauseClaude now always returns 'paused' status
      expect(result.status).toBe('paused');
    });
  });

  describe('session management', () => {
    it('hasActiveSession returns false initially', async () => {
      const service = await loadService();
      expect(service.hasActiveSession()).toBe(false);
    });

    it('hasActiveSession returns true after promptClaude', async () => {
      const service = await loadService();
      await service.promptClaude('test');
      expect(service.hasActiveSession()).toBe(true);
    });

    it('hasActiveSession returns false after reset', async () => {
      const service = await loadService();
      await service.promptClaude('init');
      expect(service.hasActiveSession()).toBe(true);

      await service.resetClaude();
      expect(service.hasActiveSession()).toBe(false);
    });

    it('isProcessing returns correct status', async () => {
      const service = await loadService();
      expect(service.isProcessing()).toBe(false);

      await service.promptClaude('test');
      expect(service.isProcessing()).toBe(false);
    });
  });

  describe('common operations', () => {
    it('resets the session and broadcasts reset event', async () => {
      const service = await loadService();
      const captured: any[] = [];
      const unsub = service.subscribeClaudeEvents((evt) => captured.push(evt));

      const result = await service.resetClaude();
      unsub();

      expect(result.status).toBe('reset');
      expect(result.sessionId).toBeNull();
      expect(captured.some((e) => e.type === 'reset')).toBe(true);
    });

    it('getCurrentSessionId returns null initially', async () => {
      const service = await loadService();
      expect(service.getCurrentSessionId()).toBeNull();
    });

    it('getCurrentSessionId returns session id after promptClaude', async () => {
      const service = await loadService();
      await service.promptClaude('test');
      expect(service.getCurrentSessionId()).toMatch(/^claude-session-\d+$/);
    });
  });
});
