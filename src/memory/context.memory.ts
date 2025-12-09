import fs from 'node:fs/promises';
import path from 'node:path';

// Memory file is in the user's working directory (process.cwd())
function getMemoryPath(): string {
  return path.join(process.cwd(), 'CONTEXT_MEMORY.md');
}

const DEFAULT_MEMORY = `# Context Memory

Persistent notes the assistant should read on startup so context survives across runs.

## Purpose
- Keep debugging notes, user preferences, agreements, and project facts available to the assistant.
- Update this file instead of relying on transient conversation memory.

## User Preferences
- (add preferences here)

## Debugging Notes
- (record fixes, workarounds, test commands)

## Important Agreements
- (log decisions or agreements to honor later)

## Project Details
- (project-specific details will be added here)

## Run Log
- Initialized context memory; entries will be appended automatically on each assistant startup.
`;

export async function ensureMemoryFile() {
  const memoryPath = getMemoryPath();
  console.log('[MEMORY] Memory file path:', memoryPath);
  try {
    await fs.access(memoryPath);
  } catch {
    await fs.writeFile(memoryPath, DEFAULT_MEMORY, 'utf8');
  }
}

export async function loadContextMemory(): Promise<string> {
  const memoryPath = getMemoryPath();
  // Don't auto-create - only load if file exists in user's directory
  try {
    await fs.access(memoryPath);
    console.log('[MEMORY] Loading context memory from:', memoryPath);
    return await fs.readFile(memoryPath, 'utf8');
  } catch {
    console.log('[MEMORY] No CONTEXT_MEMORY.md found in:', process.cwd());
    return ''; // Return empty string if no memory file exists
  }
}

export async function recordMemoryRun(note: string) {
  const memoryPath = getMemoryPath();
  const safeNote = note.replace(/\s+/g, ' ').trim();
  const timestamp = new Date().toISOString();
  const entry = `- ${timestamp} UTC - ${safeNote}`;

  // Only record if memory file already exists
  try {
    await fs.access(memoryPath);
    const current = await fs.readFile(memoryPath, 'utf8');
    const hasRunLog = current.includes('## Run Log');
    const base = hasRunLog ? current.trimEnd() : `${current.trimEnd()}\n\n## Run Log`;
    const updated = `${base}\n${entry}\n`;
    await fs.writeFile(memoryPath, updated, 'utf8');
  } catch {
    // No memory file in user directory - skip recording
  }
}

/**
 * Replace the entire CONTEXT_MEMORY.md file with new content.
 * The assistant has full control over the memory file structure.
 */
export async function saveMemory(content: string): Promise<{ success: boolean; error?: string }> {
  const memoryPath = getMemoryPath();

  try {
    await fs.writeFile(memoryPath, content.trim() + '\n', 'utf8');
    console.log('[MEMORY] Replaced memory file, length:', content.length);
    return { success: true };
  } catch (err: any) {
    console.error('[MEMORY] Failed to save memory:', err);
    return { success: false, error: err?.message || 'Failed to save memory' };
  }
}
