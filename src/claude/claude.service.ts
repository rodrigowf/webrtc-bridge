import { performance } from 'node:perf_hooks';

type ClaudeAgentModule = typeof import('@anthropic-ai/claude-agent-sdk');
type SDKSession = import('@anthropic-ai/claude-agent-sdk').SDKSession;

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

export type ClaudeInitResult = {
  status: 'initialized' | 'already_initialized';
  sessionId: string | null;
};

type Listener = (event: ClaudeStreamEvent) => void;

let claudeModule: ClaudeAgentModule | null = null;
let currentSession: SDKSession | null = null;
let currentAbort: AbortController | null = null;
let lastSessionId: string | null = null;
let sessionCounter = 0;
let isProcessing = false;
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

export function hasActiveSession(): boolean {
  return currentSession !== null;
}

/**
 * Initialize a new persistent Claude session.
 * This creates a long-lived session that maintains conversation history.
 */
export async function initClaudeSession(): Promise<ClaudeInitResult> {
  const mod = await ensureClaudeModule();

  if (currentSession) {
    console.log('[CLAUDE] Session already exists, returning existing session');
    return { status: 'already_initialized', sessionId: lastSessionId };
  }

  sessionCounter++;
  lastSessionId = `claude-session-${sessionCounter}`;

  console.log('[CLAUDE] Creating new persistent session:', lastSessionId);

  // Use the V2 unstable API for persistent sessions
  currentSession = (mod as any).unstable_v2_createSession({
    model: 'claude-sonnet-4-5-20250929',
  });

  broadcast('session_started', { session_id: lastSessionId });
  console.log('[CLAUDE] Persistent session initialized:', lastSessionId);

  return { status: 'initialized', sessionId: lastSessionId };
}

/**
 * Send a message to the existing Claude session (maintains conversation history).
 * If no session exists, one will be created automatically.
 */
export async function queryClaudeSession(prompt: string): Promise<ClaudeRunResult> {
  console.log('[CLAUDE] queryClaudeSession called, prompt length:', prompt?.length ?? 0);

  // Auto-initialize session if needed
  if (!currentSession) {
    console.log('[CLAUDE] No active session, initializing new one');
    await initClaudeSession();
  }

  if (!currentSession) {
    return {
      status: 'error',
      sessionId: lastSessionId,
      error: 'Failed to initialize Claude session',
    };
  }

  if (isProcessing) {
    console.log('[CLAUDE] Already processing a message, aborting previous');
    if (currentAbort) {
      currentAbort.abort();
    }
  }

  const abortController = new AbortController();
  currentAbort = abortController;
  isProcessing = true;

  console.log('[CLAUDE] Sending message to persistent session:', lastSessionId);
  broadcast('turn_started', { session_id: lastSessionId, prompt: prompt.slice(0, 100) });

  const messages: unknown[] = [];
  let finalResponse = '';

  try {
    // Send the message to the persistent session
    await currentSession.send(prompt);

    // Receive the response (maintains full conversation history)
    for await (const message of currentSession.receive()) {
      // Check for abort
      if (abortController.signal.aborted) {
        throw new Error('aborted');
      }

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
        // Update session ID from the SDK if provided
        const sdkSessionId = (message as any).session_id;
        if (sdkSessionId) {
          console.log('[CLAUDE] SDK session ID:', sdkSessionId);
        }
      }
    }
  } catch (err: any) {
    if (abortController.signal.aborted) {
      console.warn('[CLAUDE] Turn aborted:', err?.message);
      broadcast('turn_aborted', { reason: err?.message ?? 'aborted' });
      currentAbort = null;
      isProcessing = false;
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
    isProcessing = false;
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
  isProcessing = false;
  broadcast('turn_completed', { session_id: lastSessionId });
  return {
    status: 'ok',
    sessionId: lastSessionId,
    finalResponse,
    messages,
  };
}

/**
 * Run Claude with a fresh session (legacy behavior - starts new conversation).
 * Use queryClaudeSession() instead for persistent conversations.
 */
export async function runClaude(prompt: string): Promise<ClaudeRunResult> {
  console.log('[CLAUDE] runClaude called (fresh session), prompt length:', prompt?.length ?? 0);
  const mod = await ensureClaudeModule();

  if (currentAbort) {
    console.log('[CLAUDE] Aborting previous Claude turn before starting new one');
    currentAbort.abort();
  }

  const abortController = new AbortController();
  currentAbort = abortController;

  sessionCounter++;
  const freshSessionId = `claude-fresh-${sessionCounter}`;

  console.log('[CLAUDE] Starting fresh Claude session:', freshSessionId);
  broadcast('session_started', { session_id: freshSessionId });

  const messages: unknown[] = [];
  let finalResponse = '';

  try {
    console.log('[CLAUDE] Starting streamed run...');

    // Use the query function from claude-agent-sdk (fresh session each time)
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
        sessionId: freshSessionId,
        messages,
        finalResponse,
      };
    }
    console.error('[CLAUDE] Error during execution:', err?.message);
    broadcast('turn_error', { message: err?.message ?? 'Unknown Claude error' });
    currentAbort = null;
    return {
      status: 'error',
      sessionId: freshSessionId,
      error: err?.message ?? 'Unknown Claude error',
      messages,
      finalResponse,
    };
  }

  console.log('[CLAUDE] Turn completed successfully, response length:', finalResponse?.length ?? 0);
  currentAbort = null;
  broadcast('session_completed', { session_id: freshSessionId });
  return {
    status: 'ok',
    sessionId: freshSessionId,
    finalResponse,
    messages,
  };
}

export function stopClaude(): ClaudeStopResult {
  if (currentAbort) {
    console.log('[CLAUDE] Stopping current turn');
    currentAbort.abort();
    currentAbort = null;
    isProcessing = false;
    return { status: 'stopped', sessionId: lastSessionId };
  }
  return { status: 'idle', sessionId: lastSessionId };
}

export function resetClaude(): ClaudeResetResult {
  if (currentAbort) {
    currentAbort.abort();
  }
  if (currentSession) {
    console.log('[CLAUDE] Closing persistent session');
    currentSession.close();
    currentSession = null;
  }
  currentAbort = null;
  lastSessionId = null;
  sessionCounter = 0;
  isProcessing = false;
  broadcast('session_reset', {});
  console.log('[CLAUDE] Session reset');
  return { status: 'reset', sessionId: null };
}
