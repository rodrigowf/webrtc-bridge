import { performance } from 'node:perf_hooks';

type ClaudeAgentModule = typeof import('@anthropic-ai/claude-agent-sdk');

export type ClaudeAuthStatus = {
  isAuthenticated: boolean;
  method?: 'api_key' | 'config';
  needsLogin?: boolean;
  loginUrl?: string;
  error?: string;
};

let claudeModule: ClaudeAgentModule | null = null;

async function ensureClaudeModule(): Promise<ClaudeAgentModule> {
  if (!claudeModule) {
    try {
      claudeModule = await import('@anthropic-ai/claude-agent-sdk');
    } catch (err) {
      console.error('[CLAUDE-AUTH] Failed to load @anthropic-ai/claude-agent-sdk. Did you install it?');
      throw err;
    }
  }
  return claudeModule;
}

/**
 * Check if Claude Code is authenticated and ready to use.
 * This function checks for ANTHROPIC_API_KEY in the environment.
 */
export async function checkClaudeAuth(): Promise<ClaudeAuthStatus> {
  try {
    // Ensure the module can be loaded
    await ensureClaudeModule();

    // Check environment variable for API key
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey && apiKey.trim()) {
      console.log('[CLAUDE-AUTH] ANTHROPIC_API_KEY found in environment');
      return {
        isAuthenticated: true,
        method: 'api_key',
        needsLogin: false,
      };
    }

    // No API key found - user needs to authenticate
    console.log('[CLAUDE-AUTH] No ANTHROPIC_API_KEY found, authentication required');
    return {
      isAuthenticated: false,
      needsLogin: true,
      loginUrl: 'https://console.anthropic.com/settings/keys',
      error: 'ANTHROPIC_API_KEY not set',
    };
  } catch (err: any) {
    console.error('[CLAUDE-AUTH] Error checking authentication:', err?.message);
    return {
      isAuthenticated: false,
      needsLogin: true,
      loginUrl: 'https://console.anthropic.com/settings/keys',
      error: err?.message || 'Failed to check authentication',
    };
  }
}

/**
 * Set the API key for Claude authentication.
 * This stores it in the process environment for the current session.
 */
export function setClaudeApiKey(apiKey: string): void {
  process.env.ANTHROPIC_API_KEY = apiKey;
  console.log('[CLAUDE-AUTH] API key set in environment');
}
