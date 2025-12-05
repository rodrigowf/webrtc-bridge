import { performance } from 'node:perf_hooks';

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
    console.log('[CODEX] Starting new Codex thread (approvalPolicy=never, workspace-write, network on)');
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
  console.log('[CODEX] runCodex called, prompt length:', prompt?.length ?? 0);
  const thread = await ensureThread();
  if (currentAbort) {
    console.log('[CODEX] Aborting previous Codex turn before starting new one');
    // Cancel any previous in-flight turn before starting a new one.
    currentAbort.abort();
  }

  const abortController = new AbortController();
  currentAbort = abortController;

  console.log('[CODEX] Starting streamed run...');
  const { events } = await thread.runStreamed(prompt, { signal: abortController.signal } as any);
  const items: ThreadEvent[] = [];
  let finalResponse = '';

  try {
    for await (const event of events) {
      // Log ALL events for debugging
      console.log('[CODEX] Event:', event.type, JSON.stringify(event).slice(0, 300));

      if (event.type === 'thread.started') {
        lastThreadId = event.thread_id;
        console.log('[CODEX] Thread started:', lastThreadId);
      }
      if (event.type === 'item.completed' && (event.item as any)?.type === 'agent_message') {
        finalResponse = (event.item as any).text ?? finalResponse;
        console.log('[CODEX] Agent message completed:', finalResponse?.slice(0, 160));
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

  console.log('[CODEX] Turn completed successfully, response length:', finalResponse?.length ?? 0);
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
