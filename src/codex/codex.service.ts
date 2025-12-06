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

export type CodexStopResult = {
  status: 'stopped' | 'idle';
  threadId: string | null;
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
      // eslint-disable-next-line no-console
      console.error('[CODEX] Listener error', err);
    }
  }
}

export function subscribeCodexEvents(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function ensureThread(): Promise<Thread> {
  if (!codexModule) {
    // Dynamically import to stay compatible with CommonJS build output.
    try {
      codexModule = await import('@openai/codex-sdk');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[CODEX] Failed to load @openai/codex-sdk. Did you install it?');
      throw err;
    }
  }
  if (!currentThread) {
    const { Codex } = codexModule;
    const codex = new Codex();
    console.log('[CODEX] Starting new thread');
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

export async function runCodex(prompt: string): Promise<CodexRunResult> {
  const thread = await ensureThread();
  if (currentAbort) {
    currentAbort.abort();
  }

  const abortController = new AbortController();
  currentAbort = abortController;

  console.log('[CODEX] Running:', prompt?.slice(0, 80));
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
      console.warn('[CODEX] Turn aborted:', err?.message);
      broadcast('turn_aborted', { reason: err?.message ?? 'aborted' });
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
  return {
    status: 'ok',
    threadId: lastThreadId ?? thread.id,
    finalResponse,
    items,
  };
}

export function stopCodex(): CodexStopResult {
  if (currentAbort) {
    currentAbort.abort();
    return { status: 'stopped', threadId: lastThreadId ?? currentThread?.id ?? null };
  }
  return { status: 'idle', threadId: lastThreadId ?? currentThread?.id ?? null };
}

export function resetCodex(): CodexResetResult {
  if (currentAbort) {
    currentAbort.abort();
  }
  currentAbort = null;
  currentThread = null;
  lastThreadId = null;
  broadcast('thread_reset', {});
  return { status: 'reset', threadId: null };
}
