import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Execute a terminal command (bash or Python) and return the result
 * @param command The command to execute
 * @param timeoutMs Maximum execution time in milliseconds (default: 30 seconds)
 * @returns Command result with stdout, stderr, and exit code
 */
export async function executeCommand(
  command: string,
  timeoutMs: number = 30000
): Promise<CommandResult> {
  console.log('[TERMINAL] Executing command:', command);

  try {
    const { stdout, stderr } = await execAsync(command, {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024 * 10, // 10MB buffer
      shell: '/bin/bash',
    });

    console.log('[TERMINAL] Command completed successfully');
    console.log('[TERMINAL] Stdout length:', stdout.length);
    console.log('[TERMINAL] Stderr length:', stderr.length);

    return {
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      exitCode: 0,
    };
  } catch (error: any) {
    // exec throws an error if the command returns a non-zero exit code
    const exitCode = error.code ?? 1;
    const stdout = error.stdout ? error.stdout.toString().trim() : '';
    const stderr = error.stderr ? error.stderr.toString().trim() : '';

    console.error('[TERMINAL] Command failed with exit code:', exitCode);
    console.log('[TERMINAL] Stdout:', stdout);
    console.log('[TERMINAL] Stderr:', stderr);

    // If the error is due to a timeout, throw it
    if (error.killed && error.signal === 'SIGTERM') {
      throw new Error(`Command timed out after ${timeoutMs}ms`);
    }

    // Return the result even if the command failed (non-zero exit code)
    // The AI can interpret the error and explain it to the user
    return {
      stdout,
      stderr: stderr || error.message || 'Command failed',
      exitCode,
    };
  }
}

/**
 * Check if a command is potentially dangerous and requires confirmation
 * This is a basic heuristic - the AI should also implement its own safety checks
 */
export function isCommandDangerous(command: string): boolean {
  const dangerousPatterns = [
    /\brm\s+(-rf?|--recursive|--force)/i, // rm -rf
    /\bsudo\b/i, // sudo commands
    /\bsu\b/i, // su commands
    /\bapt\s+(remove|purge|install)/i, // apt operations
    /\byum\s+(remove|install)/i, // yum operations
    /\bbrew\s+(uninstall|install)/i, // brew operations
    /\bsystemctl\s+(stop|disable|restart)/i, // systemctl operations
    /\bchmod\b/i, // chmod
    /\bchown\b/i, // chown
    /\bgit\s+(reset\s+--hard|push\s+--force|rebase)/i, // dangerous git ops
    /\b(DROP|DELETE|TRUNCATE)\s+(DATABASE|TABLE)/i, // SQL operations
    />\/dev\//i, // Writing to devices
    /\bkill(all)?\b/i, // kill processes
  ];

  return dangerousPatterns.some((pattern) => pattern.test(command));
}
