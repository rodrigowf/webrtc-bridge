import { performance } from 'node:perf_hooks';
import { formatClaudeMessage } from '../utils/log-formatter.js';

type ClaudeAgentModule = typeof import('@anthropic-ai/claude-agent-sdk');
type Query = import('@anthropic-ai/claude-agent-sdk').Query;
type SDKMessage = import('@anthropic-ai/claude-agent-sdk').SDKMessage;

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

export type ClaudePauseResult = {
  status: 'paused' | 'idle';
  sessionId: string | null;
};

export type ClaudeCompactResult = {
  status: 'ok' | 'error';
  sessionId: string | null;
  summary?: string;
  error?: string;
};

export type ClaudeResetResult = {
  status: 'reset';
  sessionId: string | null;
};

type Listener = (event: ClaudeStreamEvent) => void;

let claudeModule: ClaudeAgentModule | null = null;
let currentQuery: Query | null = null;
let currentAbort: AbortController | null = null;
let lastSessionId: string | null = null;
let sessionCounter = 0;
let isProcessingFlag = false;
const listeners = new Set<Listener>();

// Store conversation history for multi-turn support
let conversationHistory: SDKMessage[] = [];

function broadcast(type: string, payload: unknown) {
  const evt: ClaudeStreamEvent = { type, payload, timestamp: performance.now() };
  for (const listener of listeners) {
    try {
      listener(evt);
    } catch (err) {
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
      console.error('[CLAUDE] Failed to load @anthropic-ai/claude-agent-sdk. Did you install it?');
      throw err;
    }
  }
  // Note: OAuth credentials are read automatically by the Claude CLI from ~/.claude/.credentials.json
  // We don't need to set ANTHROPIC_API_KEY for OAuth - that only works for actual API keys
  return claudeModule;
}

function ensureSessionId(): string {
  if (!lastSessionId) {
    sessionCounter++;
    lastSessionId = `claude-session-${sessionCounter}`;
    console.log('[CLAUDE] New session:', lastSessionId);
    broadcast('session_started', { session_id: lastSessionId });
  }
  return lastSessionId;
}

export function getCurrentSessionId() {
  return lastSessionId;
}

export function hasActiveSession(): boolean {
  return lastSessionId !== null;
}

export function isProcessing(): boolean {
  return isProcessingFlag;
}

/**
 * Send a prompt to Claude using the query() API with full autonomous permissions.
 * Uses bypassPermissions mode to allow file editing and code execution without prompts.
 */
export async function promptClaude(prompt: string): Promise<ClaudeRunResult> {
  const mod = await ensureClaudeModule();
  const sessionId = ensureSessionId();

  if (isProcessingFlag && currentAbort) {
    currentAbort.abort();
  }

  const abortController = new AbortController();
  currentAbort = abortController;
  isProcessingFlag = true;

  console.log('[CLAUDE] Prompt:', prompt?.slice(0, 80));
  broadcast('turn_started', { session_id: sessionId, prompt: prompt.slice(0, 100) });

  const messages: unknown[] = [];
  let finalResponse = '';

  try {
    // Use query() API with full autonomous permissions
    // cwd defaults to process.cwd() which is where the server is started
    currentQuery = mod.query({
      prompt,
      options: {
        model: 'claude-sonnet-4-5-20250929',
        // Enable bypass permissions for autonomous execution
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        // Use all Claude Code tools
        tools: { type: 'preset', preset: 'claude_code' },
        // Use system prompt with project context
        systemPrompt: { type: 'preset', preset: 'claude_code' },
        // Load project settings (CLAUDE.md, etc.)
        settingSources: ['project', 'local'],
        // Pass abort controller
        abortController,
        // Include streaming events
        includePartialMessages: true,
      },
    });

    for await (const message of currentQuery) {
      if (abortController.signal.aborted) {
        throw new Error('aborted');
      }

      // Store in conversation history
      conversationHistory.push(message);

      const formatted = formatClaudeMessage(message as Record<string, unknown>);
      if (formatted) console.log(formatted);
      messages.push(message);
      broadcast('message', message);

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

      if (message.type === 'result') {
        const resultText = (message as any).result;
        if (typeof resultText === 'string' && resultText) {
          finalResponse = resultText;
        }
      }
    }
  } catch (err: any) {
    if (abortController.signal.aborted) {
      broadcast('turn_paused', { reason: err?.message ?? 'paused' });
      currentAbort = null;
      currentQuery = null;
      isProcessingFlag = false;
      return {
        status: 'aborted',
        sessionId: lastSessionId,
        messages,
        finalResponse,
      };
    }
    console.error('[CLAUDE] Error:', err?.message);
    broadcast('turn_error', { message: err?.message ?? 'Unknown Claude error' });
    currentAbort = null;
    currentQuery = null;
    isProcessingFlag = false;
    return {
      status: 'error',
      sessionId: lastSessionId,
      error: err?.message ?? 'Unknown Claude error',
      messages,
      finalResponse,
    };
  }

  console.log('[CLAUDE] Done');
  currentAbort = null;
  currentQuery = null;
  isProcessingFlag = false;
  broadcast('turn_completed', { session_id: lastSessionId });
  return {
    status: 'ok',
    sessionId: lastSessionId,
    finalResponse,
    messages,
  };
}

/**
 * Pause (interrupt) the current Claude execution without losing context.
 * The session remains active and can receive new prompts.
 */
export async function pauseClaude(): Promise<ClaudePauseResult> {
  if (currentQuery) {
    try {
      await currentQuery.interrupt();
    } catch {
      // Ignore interrupt errors
    }
  }
  if (currentAbort) {
    currentAbort.abort();
    currentAbort = null;
  }
  currentQuery = null;
  isProcessingFlag = false;
  console.log('[CLAUDE] Paused');
  broadcast('paused', { sessionId: lastSessionId });
  return { status: 'paused', sessionId: lastSessionId };
}

/**
 * Compact the session context by asking Claude to summarize the conversation,
 * then starting a fresh session with only the summary.
 */
export async function compactClaude(): Promise<ClaudeCompactResult> {
  if (!lastSessionId || conversationHistory.length === 0) {
    return {
      status: 'error',
      sessionId: null,
      error: 'No active session to compact',
    };
  }

  // Pause any ongoing execution first
  await pauseClaude();

  console.log('[CLAUDE] Compacting context...');
  broadcast('compact_started', { sessionId: lastSessionId });

  try {
    const mod = await ensureClaudeModule();
    const summaryPrompt = `Please provide a concise summary of our entire conversation so far. Include:
1. Key tasks we discussed or completed
2. Important files or code we worked with
3. Any pending items or context that should be preserved
4. Current state of the project/task

Format this as a context summary that can be used to continue our work in a new session.`;

    const abortController = new AbortController();
    currentAbort = abortController;
    isProcessingFlag = true;

    const summaryQuery = mod.query({
      prompt: summaryPrompt,
      options: {
        model: 'claude-sonnet-4-5-20250929',
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        abortController,
      },
    });

    let summary = '';
    for await (const message of summaryQuery) {
      if (abortController.signal.aborted) {
        throw new Error('aborted');
      }

      if (message.type === 'assistant') {
        const content = (message as any).message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'text') {
              summary = block.text;
            }
          }
        }
      }

      if (message.type === 'result') {
        const resultText = (message as any).result;
        if (typeof resultText === 'string' && resultText) {
          summary = resultText;
        }
      }
    }

    currentAbort = null;
    isProcessingFlag = false;

    if (!summary) {
      return {
        status: 'error',
        sessionId: lastSessionId,
        error: 'Failed to generate summary',
      };
    }

    // Clear history and start fresh with the summary
    const oldSessionId = lastSessionId;
    conversationHistory = [];
    lastSessionId = null;

    // Start a new session with the summary as context
    const newSessionId = ensureSessionId();
    const contextPrompt = `Here is the context from our previous conversation:\n\n${summary}\n\nPlease acknowledge this context briefly and let me know you're ready to continue.`;

    const contextAbort = new AbortController();
    currentAbort = contextAbort;
    isProcessingFlag = true;

    const contextQuery = mod.query({
      prompt: contextPrompt,
      options: {
        model: 'claude-sonnet-4-5-20250929',
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        abortController: contextAbort,
      },
    });

    for await (const message of contextQuery) {
      if (contextAbort.signal.aborted) break;
      conversationHistory.push(message);
    }

    currentAbort = null;
    isProcessingFlag = false;

    console.log('[CLAUDE] Compacted: old session', oldSessionId, '-> new session', newSessionId);
    broadcast('compact_completed', { oldSessionId, newSessionId, summary: summary.slice(0, 200) });

    return {
      status: 'ok',
      sessionId: lastSessionId,
      summary,
    };
  } catch (err: any) {
    currentAbort = null;
    currentQuery = null;
    isProcessingFlag = false;
    console.error('[CLAUDE] Compact error:', err?.message);
    broadcast('compact_error', { error: err?.message });
    return {
      status: 'error',
      sessionId: lastSessionId,
      error: err?.message ?? 'Failed to compact context',
    };
  }
}

/**
 * Completely reset Claude, closing the session and clearing all context.
 */
export async function resetClaude(): Promise<ClaudeResetResult> {
  if (currentQuery) {
    try {
      await currentQuery.interrupt();
    } catch {
      // Ignore interrupt errors
    }
  }
  if (currentAbort) {
    currentAbort.abort();
  }
  currentQuery = null;
  currentAbort = null;
  conversationHistory = [];
  const oldSessionId = lastSessionId;
  lastSessionId = null;
  sessionCounter = 0;
  isProcessingFlag = false;
  console.log('[CLAUDE] Reset');
  broadcast('reset', { oldSessionId });
  return { status: 'reset', sessionId: null };
}

// Legacy aliases for backwards compatibility
export const runClaude = promptClaude;
export const queryClaudeSession = promptClaude;
export const stopClaude = pauseClaude;
