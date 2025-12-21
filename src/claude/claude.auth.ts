import {
  checkOAuthCredentials,
  applyOAuthCredentials,
  startOAuthFlow,
  sendOAuthInput,
  cancelOAuthFlow,
  getOAuthStatus,
  subscribeOAuthEvents,
  type OAuthCredentials,
  type OAuthFlowStatus,
} from './claude.oauth.js';

type ClaudeAgentModule = typeof import('@anthropic-ai/claude-agent-sdk');

export type ClaudeAuthStatus = {
  isAuthenticated: boolean;
  method?: 'api_key' | 'oauth';
  needsLogin?: boolean;
  loginUrl?: string;
  error?: string;
  subscriptionType?: string;
  expiresAt?: number;
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
 * Checks in order: environment API key, then OAuth credentials.
 */
export async function checkClaudeAuth(): Promise<ClaudeAuthStatus> {
  try {
    // Ensure the module can be loaded
    await ensureClaudeModule();

    // 1. Check environment variable for API key
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey && apiKey.trim()) {
      console.log('[CLAUDE-AUTH] ANTHROPIC_API_KEY found in environment');
      return {
        isAuthenticated: true,
        method: 'api_key',
        needsLogin: false,
      };
    }

    // 2. Check for OAuth credentials in ~/.claude/.credentials.json
    // Note: We just check if they exist - the Claude CLI reads them automatically
    const oauthCreds = await checkOAuthCredentials();
    if (oauthCreds) {
      console.log('[CLAUDE-AUTH] OAuth credentials found (Claude CLI will use them automatically)');
      return {
        isAuthenticated: true,
        method: 'oauth',
        needsLogin: false,
        subscriptionType: oauthCreds.subscriptionType,
        expiresAt: oauthCreds.expiresAt,
      };
    }

    // No authentication found
    console.log('[CLAUDE-AUTH] No authentication found, login required');
    return {
      isAuthenticated: false,
      needsLogin: true,
      loginUrl: 'https://console.anthropic.com/settings/keys',
      error: 'No API key or OAuth credentials found',
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

// Re-export OAuth functions for use by server
export {
  startOAuthFlow,
  sendOAuthInput,
  cancelOAuthFlow,
  getOAuthStatus,
  subscribeOAuthEvents,
  checkOAuthCredentials,
  applyOAuthCredentials,
  type OAuthFlowStatus,
  type OAuthCredentials,
};
