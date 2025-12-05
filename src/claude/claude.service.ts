import { performance } from 'node:perf_hooks';

type ClaudeAgentModule = typeof import('@anthropic-ai/claude-agent-sdk');

export type ClaudeStreamEvent = {
  type: string;
  payload: unknown;
  timestamp: number;
};

export type ClaudeRunResult = {
  status: 'ok' | 'error' | 'aborted';
  sessionId: string | null;
  finalResponse?: string;
  messages?: unknown[];
  error?: string;
};

export type ClaudeStopResult = {
  status: 'stopped' | 'idle';
  sessionId: string | null;
};

export type ClaudeResetResult = {
  status: 'reset';
  sessionId: string | null;
};

type Listener = (event: ClaudeStreamEvent) => void;

let claudeModule: ClaudeAgentModule | null = null;
let currentAbort: AbortController | null = null;
let lastSessionId: string | null = null;
let sessionCounter = 0;
const listeners = new Set<Listener>();

function broadcast(type: string, payload: unknown) {
  const evt: ClaudeStreamEvent = { type, payload, timestamp: performance.now() };
  for (const listener of listeners) {
    try {
      listener(evt);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[CLAUDE] Listener error', err);
    }
  }
}

export function subscribeClaudeEvents(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function ensureClaudeModule(): Promise<ClaudeAgentModule> {
  if (!claudeModule) {
    try {
      claudeModule = await import('@anthropic-ai/claude-agent-sdk');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[CLAUDE] Failed to load @anthropic-ai/claude-agent-sdk. Did you install it?');
      throw err;
    }
  }
  return claudeModule;
}

export function getCurrentSessionId() {
  return lastSessionId;
}

export async function runClaude(prompt: string): Promise<ClaudeRunResult> {
  console.log('[CLAUDE] runClaude called, prompt length:', prompt?.length ?? 0);
  const mod = await ensureClaudeModule();

  if (currentAbort) {
    console.log('[CLAUDE] Aborting previous Claude turn before starting new one');
    currentAbort.abort();
  }

  const abortController = new AbortController();
  currentAbort = abortController;

  sessionCounter++;
  lastSessionId = `claude-session-${sessionCounter}`;

  console.log('[CLAUDE] Starting Claude Code session:', lastSessionId);
  broadcast('session_started', { session_id: lastSessionId });

  const messages: unknown[] = [];
  let finalResponse = '';

  try {
    console.log('[CLAUDE] Starting streamed run...');

    // Use the query function from claude-agent-sdk
    const queryStream = mod.query({
      prompt,
      options: {
        abortController,
        cwd: process.cwd(),
        maxTurns: 10,
      },
    });

    for await (const message of queryStream) {
      // Log events for debugging
      console.log('[CLAUDE] Event:', message.type, JSON.stringify(message).slice(0, 300));
      messages.push(message);
      broadcast('message', message);

      // Extract text from assistant messages
      if (message.type === 'assistant') {
        const content = (message as any).message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'text') {
              finalResponse = block.text;
            }
          }
        }
      }

      // Handle result message
      if (message.type === 'result') {
        const resultText = (message as any).result;
        if (typeof resultText === 'string' && resultText) {
          finalResponse = resultText;
        }
      }
    }
  } catch (err: any) {
    if (abortController.signal.aborted) {
      console.warn('[CLAUDE] Turn aborted:', err?.message);
      broadcast('turn_aborted', { reason: err?.message ?? 'aborted' });
      currentAbort = null;
      return {
        status: 'aborted',
        sessionId: lastSessionId,
        messages,
        finalResponse,
      };
    }
    console.error('[CLAUDE] Error during execution:', err?.message);
    broadcast('turn_error', { message: err?.message ?? 'Unknown Claude error' });
    currentAbort = null;
    return {
      status: 'error',
      sessionId: lastSessionId,
      error: err?.message ?? 'Unknown Claude error',
      messages,
      finalResponse,
    };
  }

  console.log('[CLAUDE] Turn completed successfully, response length:', finalResponse?.length ?? 0);
  currentAbort = null;
  broadcast('session_completed', { session_id: lastSessionId });
  return {
    status: 'ok',
    sessionId: lastSessionId,
    finalResponse,
    messages,
  };
}

export function stopClaude(): ClaudeStopResult {
  if (currentAbort) {
    console.log('[CLAUDE] Stopping current session');
    currentAbort.abort();
    currentAbort = null;
    return { status: 'stopped', sessionId: lastSessionId };
  }
  return { status: 'idle', sessionId: lastSessionId };
}

export function resetClaude(): ClaudeResetResult {
  if (currentAbort) {
    currentAbort.abort();
  }
  currentAbort = null;
  lastSessionId = null;
  sessionCounter = 0;
  broadcast('session_reset', {});
  console.log('[CLAUDE] Session reset');
  return { status: 'reset', sessionId: null };
}
