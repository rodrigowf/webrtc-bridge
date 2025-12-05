import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MEMORY_PATH = path.resolve(__dirname, '..', '..', 'CONTEXT_MEMORY.md');

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
- App: WebRTC <-> OpenAI Realtime voice bridge (Node.js + TypeScript backend, minimal frontend UI).
- Default port: 8080 (configurable via .env PORT).
- CLI: \`vcode\` -> \`dist/cli.js\` starts the built server.
- Build/dev: \`npm run dev\`, \`npm run build\`, \`npm start\`.
- Tests: \`npm test\` (healthz + Codex endpoints), Playwright E2E available.

## Run Log
- Initialized context memory; entries will be appended automatically on each assistant startup.
`;

export async function ensureMemoryFile() {
  try {
    await fs.access(MEMORY_PATH);
  } catch {
    await fs.writeFile(MEMORY_PATH, DEFAULT_MEMORY, 'utf8');
  }
}

export async function loadContextMemory(): Promise<string> {
  await ensureMemoryFile();
  try {
    return await fs.readFile(MEMORY_PATH, 'utf8');
  } catch (err) {
    console.error('[MEMORY] Failed to read context memory file:', err);
    return DEFAULT_MEMORY;
  }
}

export async function recordMemoryRun(note: string) {
  const safeNote = note.replace(/\s+/g, ' ').trim();
  const timestamp = new Date().toISOString();
  const entry = `- ${timestamp} UTC - ${safeNote}`;

  await ensureMemoryFile();
  try {
    const current = await fs.readFile(MEMORY_PATH, 'utf8');
    const hasRunLog = current.includes('## Run Log');
    const base = hasRunLog ? current.trimEnd() : `${current.trimEnd()}\n\n## Run Log`;
    const updated = `${base}\n${entry}\n`;
    await fs.writeFile(MEMORY_PATH, updated, 'utf8');
  } catch (err) {
    console.error('[MEMORY] Failed to append run entry to context memory:', err);
  }
}
