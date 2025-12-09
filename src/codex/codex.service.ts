import { performance } from 'node:perf_hooks';
import { formatCodexEvent } from '../utils/log-formatter.js';

type CodexModule = typeof import('@openai/codex-sdk');
type Thread = import('@openai/codex-sdk').Thread;
type ThreadEvent = import('@openai/codex-sdk').ThreadEvent;

export type CodexStreamEvent = {
  type: string;
  payload: unknown;
  timestamp: number;
};

export type CodexRunResult = {
  status: 'ok' | 'error' | 'aborted';
  threadId: string | null;
  finalResponse?: string;
  items?: unknown[];
  error?: string;
};

export type CodexPauseResult = {
  status: 'paused' | 'idle';
  threadId: string | null;
};

export type CodexCompactResult = {
  status: 'ok' | 'error';
  threadId: string | null;
  summary?: string;
  error?: string;
};

export type CodexResetResult = {
  status: 'reset';
  threadId: string | null;
};

type Listener = (event: CodexStreamEvent) => void;

let codexModule: CodexModule | null = null;
let currentThread: Thread | null = null;
let currentAbort: AbortController | null = null;
let lastThreadId: string | null = null;
const listeners = new Set<Listener>();

function broadcast(type: string, payload: unknown) {
  const evt: CodexStreamEvent = { type, payload, timestamp: performance.now() };
  for (const listener of listeners) {
    try {
      listener(evt);
    } catch (err) {
      console.error('[CODEX] Listener error', err);
    }
  }
}

export function subscribeCodexEvents(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function ensureModule(): Promise<CodexModule> {
  if (!codexModule) {
    try {
      codexModule = await import('@openai/codex-sdk');
    } catch (err) {
      console.error('[CODEX] Failed to load @openai/codex-sdk. Did you install it?');
      throw err;
    }
  }
  return codexModule;
}

async function ensureThread(): Promise<Thread> {
  const mod = await ensureModule();
  if (!currentThread) {
    const { Codex } = mod;
    const codex = new Codex();
    console.log('[CODEX] Starting new thread in:', process.cwd());
    currentThread = codex.startThread({
      workingDirectory: process.cwd(),
      skipGitRepoCheck: true,
      sandboxMode: 'workspace-write',
      approvalPolicy: 'never',
      networkAccessEnabled: true,
    } as any);
  }
  return currentThread;
}

export function getCurrentThreadId() {
  return lastThreadId;
}

export function hasActiveThread(): boolean {
  return currentThread !== null;
}

export function isProcessing(): boolean {
  return currentAbort !== null;
}

/**
 * Send a prompt to Codex, maintaining the current thread context.
 * Creates a new thread if none exists.
 */
export async function promptCodex(prompt: string): Promise<CodexRunResult> {
  const thread = await ensureThread();

  if (currentAbort) {
    currentAbort.abort();
  }

  const abortController = new AbortController();
  currentAbort = abortController;

  console.log('[CODEX] Prompt:', prompt?.slice(0, 80));
  broadcast('turn_started', { prompt: prompt.slice(0, 100) });

  const { events } = await thread.runStreamed(prompt, { signal: abortController.signal } as any);
  const items: ThreadEvent[] = [];
  let finalResponse = '';

  try {
    for await (const event of events) {
      const formatted = formatCodexEvent(event as Record<string, unknown>);
      if (formatted) console.log(formatted);
      if (event.type === 'thread.started') {
        lastThreadId = event.thread_id;
      }
      if (event.type === 'item.completed' && (event.item as any)?.type === 'agent_message') {
        finalResponse = (event.item as any).text ?? finalResponse;
      }
      items.push(event);
      broadcast('thread_event', event);
    }
  } catch (err: any) {
    if (abortController.signal.aborted) {
      console.warn('[CODEX] Turn paused/aborted:', err?.message);
      broadcast('turn_paused', { reason: err?.message ?? 'paused' });
      currentAbort = null;
      return {
        status: 'aborted',
        threadId: lastThreadId ?? thread.id,
        items,
        finalResponse,
      };
    }
    broadcast('turn_error', { message: err?.message ?? 'Unknown Codex error' });
    currentAbort = null;
    return {
      status: 'error',
      threadId: lastThreadId ?? thread.id,
      error: err?.message ?? 'Unknown Codex error',
      items,
      finalResponse,
    };
  }

  console.log('[CODEX] Done');
  currentAbort = null;
  broadcast('turn_completed', { threadId: lastThreadId });
  return {
    status: 'ok',
    threadId: lastThreadId ?? thread.id,
    finalResponse,
    items,
  };
}

/**
 * Pause (interrupt) the current Codex execution without losing context.
 * The thread remains active and can receive new prompts.
 */
export function pauseCodex(): CodexPauseResult {
  if (currentAbort) {
    currentAbort.abort();
    currentAbort = null;
    console.log('[CODEX] Paused');
    broadcast('paused', { threadId: lastThreadId });
    return { status: 'paused', threadId: lastThreadId };
  }
  return { status: 'idle', threadId: lastThreadId };
}

/**
 * Compact the thread context by asking Codex to summarize the conversation,
 * then starting a fresh thread with only the summary.
 */
export async function compactCodex(): Promise<CodexCompactResult> {
  if (!currentThread) {
    return {
      status: 'error',
      threadId: null,
      error: 'No active thread to compact',
    };
  }

  // Pause any ongoing execution first
  if (currentAbort) {
    currentAbort.abort();
    currentAbort = null;
  }

  console.log('[CODEX] Compacting context...');
  broadcast('compact_started', { threadId: lastThreadId });

  try {
    // Ask the current thread to generate a summary
    const summaryPrompt = `Please provide a concise summary of our entire conversation so far. Include:
1. Key tasks we discussed or completed
2. Important files or code we worked with
3. Any pending items or context that should be preserved
4. Current state of the project/task

Format this as a context summary that can be used to continue our work in a new session.`;

    const abortController = new AbortController();
    currentAbort = abortController;

    const { events } = await currentThread.runStreamed(summaryPrompt, { signal: abortController.signal } as any);
    let summary = '';

    for await (const event of events) {
      if (event.type === 'item.completed' && (event.item as any)?.type === 'agent_message') {
        summary = (event.item as any).text ?? summary;
      }
    }

    currentAbort = null;

    if (!summary) {
      return {
        status: 'error',
        threadId: lastThreadId,
        error: 'Failed to generate summary',
      };
    }

    // Clear the current thread and start fresh with the summary
    const oldThreadId = lastThreadId;
    currentThread = null;
    lastThreadId = null;

    // Start a new thread with the summary as context
    const newThread = await ensureThread();
    const contextPrompt = `Here is the context from our previous conversation:\n\n${summary}\n\nPlease acknowledge this context briefly and let me know you're ready to continue.`;

    const contextAbort = new AbortController();
    currentAbort = contextAbort;

    const { events: contextEvents } = await newThread.runStreamed(contextPrompt, { signal: contextAbort.signal } as any);

    for await (const event of contextEvents) {
      if (event.type === 'thread.started') {
        lastThreadId = event.thread_id;
      }
    }

    currentAbort = null;
    console.log('[CODEX] Compacted: old thread', oldThreadId, '-> new thread', lastThreadId);
    broadcast('compact_completed', { oldThreadId, newThreadId: lastThreadId, summary: summary.slice(0, 200) });

    return {
      status: 'ok',
      threadId: lastThreadId,
      summary,
    };
  } catch (err: any) {
    currentAbort = null;
    console.error('[CODEX] Compact error:', err?.message);
    broadcast('compact_error', { error: err?.message });
    return {
      status: 'error',
      threadId: lastThreadId,
      error: err?.message ?? 'Failed to compact context',
    };
  }
}

/**
 * Completely reset Codex, clearing all context and starting fresh.
 */
export function resetCodex(): CodexResetResult {
  if (currentAbort) {
    currentAbort.abort();
  }
  currentAbort = null;
  currentThread = null;
  const oldThreadId = lastThreadId;
  lastThreadId = null;
  console.log('[CODEX] Reset');
  broadcast('reset', { oldThreadId });
  return { status: 'reset', threadId: null };
}

// Legacy alias for backwards compatibility
export const runCodex = promptCodex;
export const stopCodex = pauseCodex;
