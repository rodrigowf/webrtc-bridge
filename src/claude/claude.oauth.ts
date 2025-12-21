import { spawn, ChildProcess } from 'node:child_process';
import { readFile, access, constants } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CREDENTIALS_PATH = join(homedir(), '.claude', '.credentials.json');

export type OAuthCredentials = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
  subscriptionType?: string;
  rateLimitTier?: string;
};

export type OAuthFlowStatus = {
  status: 'idle' | 'waiting_for_url' | 'url_ready' | 'waiting_for_code' | 'authenticating' | 'success' | 'error';
  authUrl?: string;
  message?: string;
  error?: string;
  credentials?: OAuthCredentials;
};

type OAuthFlowListener = (status: OAuthFlowStatus) => void;

let currentProcess: ChildProcess | null = null;
let currentStatus: OAuthFlowStatus = { status: 'idle' };
const listeners = new Set<OAuthFlowListener>();

function broadcast(status: OAuthFlowStatus) {
  currentStatus = status;
  for (const listener of listeners) {
    try {
      listener(status);
    } catch (err) {
      console.error('[CLAUDE-OAUTH] Listener error:', err);
    }
  }
}

export function subscribeOAuthEvents(listener: OAuthFlowListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getOAuthStatus(): OAuthFlowStatus {
  return currentStatus;
}

/**
 * Check if OAuth credentials exist and are valid
 */
export async function checkOAuthCredentials(): Promise<OAuthCredentials | null> {
  try {
    await access(CREDENTIALS_PATH, constants.R_OK);
    const content = await readFile(CREDENTIALS_PATH, 'utf-8');
    const data = JSON.parse(content);

    if (data.claudeAiOauth) {
      const oauth = data.claudeAiOauth;
      // Check if token is expired (with 5 minute buffer)
      const now = Date.now();
      const expiresAt = oauth.expiresAt || 0;

      if (expiresAt > now + 300000) {
        return {
          accessToken: oauth.accessToken,
          refreshToken: oauth.refreshToken,
          expiresAt: oauth.expiresAt,
          scopes: oauth.scopes || [],
          subscriptionType: oauth.subscriptionType,
          rateLimitTier: oauth.rateLimitTier,
        };
      } else {
        console.log('[CLAUDE-OAUTH] Token expired or expiring soon');
        return null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Start the OAuth flow by running `claude setup-token` with PTY
 * This will output a URL for the user to visit and authenticate
 */
export async function startOAuthFlow(): Promise<void> {
  if (currentProcess) {
    console.log('[CLAUDE-OAUTH] OAuth flow already in progress');
    return;
  }

  broadcast({ status: 'waiting_for_url', message: 'Starting OAuth flow...' });

  // Use script command to provide a PTY for the claude command
  // This works on Linux/macOS to fake a terminal
  const isLinux = process.platform === 'linux';
  const isMac = process.platform === 'darwin';

  let cmd: string;
  let args: string[];

  if (isLinux) {
    // Use script with /dev/null to provide PTY on Linux
    cmd = 'script';
    args = ['-q', '-c', 'claude setup-token', '/dev/null'];
  } else if (isMac) {
    // Use script on macOS (different syntax)
    cmd = 'script';
    args = ['-q', '/dev/null', 'claude', 'setup-token'];
  } else {
    // Fallback - try directly (may fail without TTY)
    cmd = 'claude';
    args = ['setup-token'];
  }

  console.log('[CLAUDE-OAUTH] Starting:', cmd, args.join(' '));

  currentProcess = spawn(cmd, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, TERM: 'xterm-256color', FORCE_COLOR: '0' },
  });

  let output = '';
  let authUrl: string | null = null;

  const stripAnsi = (text: string): string => {
    // Remove ANSI escape codes
    return text.replace(/[\x1b\x9b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
  };

  const extractUrl = (text: string): string | null => {
    // First strip all ANSI codes
    const cleanText = stripAnsi(text);

    // Look for the auth URL in the output
    // The URL typically looks like: https://claude.ai/oauth/authorize?...
    const urlPatterns = [
      /https:\/\/claude\.ai\/oauth\/authorize[^\s\n]*/,
      /https:\/\/claude\.ai\/oauth[^\s\n]*/,
      /https:\/\/console\.anthropic\.com[^\s\n]*/,
    ];

    for (const pattern of urlPatterns) {
      const match = cleanText.match(pattern);
      if (match) {
        return match[0].trim();
      }
    }
    return null;
  };

  currentProcess.stdout?.on('data', (data: Buffer) => {
    const text = data.toString();
    output += text;
    const cleanText = stripAnsi(text).trim();
    if (cleanText) {
      console.log('[CLAUDE-OAUTH] stdout:', cleanText);
    }

    if (!authUrl) {
      authUrl = extractUrl(output);
      if (authUrl) {
        console.log('[CLAUDE-OAUTH] Found auth URL:', authUrl);
        broadcast({
          status: 'url_ready',
          authUrl,
          message: 'Please visit the URL to authenticate'
        });
      }
    }

    // Check for prompt asking for code
    const cleanOutput = stripAnsi(output);
    if (cleanOutput.includes('Paste code here') || cleanOutput.includes('paste code') || cleanOutput.includes('code here')) {
      if (authUrl && currentStatus.status !== 'url_ready') {
        broadcast({
          status: 'url_ready',
          authUrl,
          message: 'Paste the authorization code'
        });
      }
    }

    // Check for success indicators
    if (cleanOutput.includes('Successfully') || cleanOutput.includes('authenticated') || cleanOutput.includes('Token saved')) {
      handleSuccess();
    }
  });

  currentProcess.stderr?.on('data', (data: Buffer) => {
    const text = data.toString();
    console.log('[CLAUDE-OAUTH] stderr:', text);

    // Sometimes the URL comes through stderr
    if (!authUrl) {
      authUrl = extractUrl(text);
      if (authUrl) {
        console.log('[CLAUDE-OAUTH] Found auth URL in stderr:', authUrl);
        broadcast({
          status: 'url_ready',
          authUrl,
          message: 'Please visit the URL to authenticate'
        });
      }
    }
  });

  currentProcess.on('close', async (code) => {
    console.log('[CLAUDE-OAUTH] Process closed with code:', code);
    currentProcess = null;

    if (code === 0) {
      await handleSuccess();
    } else if (currentStatus.status !== 'success') {
      broadcast({
        status: 'error',
        error: `OAuth process exited with code ${code}`,
        message: output
      });
    }
  });

  currentProcess.on('error', (err) => {
    console.error('[CLAUDE-OAUTH] Process error:', err);
    currentProcess = null;
    broadcast({
      status: 'error',
      error: err.message
    });
  });

  async function handleSuccess() {
    const credentials = await checkOAuthCredentials();
    if (credentials) {
      broadcast({
        status: 'success',
        credentials,
        message: 'Authentication successful!'
      });
    } else {
      broadcast({
        status: 'error',
        error: 'Authentication completed but credentials not found'
      });
    }
  }
}

/**
 * Send input to the OAuth process (for entering the code)
 */
export function sendOAuthInput(input: string): void {
  if (currentProcess?.stdin?.writable) {
    console.log('[CLAUDE-OAUTH] Sending input');
    currentProcess.stdin.write(input + '\n');
    broadcast({ status: 'authenticating', message: 'Verifying code...' });
  } else {
    console.error('[CLAUDE-OAUTH] No active process to send input to');
  }
}

/**
 * Cancel the OAuth flow
 */
export function cancelOAuthFlow(): void {
  if (currentProcess) {
    currentProcess.kill();
    currentProcess = null;
  }
  broadcast({ status: 'idle' });
}

/**
 * Check if OAuth credentials are available and valid.
 *
 * NOTE: We do NOT set ANTHROPIC_API_KEY with OAuth tokens because:
 * 1. OAuth tokens (sk-ant-oat01-*) are NOT valid API keys (sk-ant-api01-*)
 * 2. The Claude CLI automatically reads OAuth credentials from ~/.claude/.credentials.json
 * 3. Setting ANTHROPIC_API_KEY with an OAuth token causes "Invalid API key" errors
 *
 * This function just validates that OAuth credentials exist and are not expired.
 */
export async function applyOAuthCredentials(): Promise<boolean> {
  const credentials = await checkOAuthCredentials();
  if (credentials) {
    // Don't set ANTHROPIC_API_KEY - let the Claude CLI read OAuth from ~/.claude/.credentials.json
    console.log('[CLAUDE-OAUTH] OAuth credentials available (will be used by Claude CLI automatically)');
    return true;
  }
  return false;
}
