#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Save the user's working directory before changing to package root.
// This is where Codex/Claude agents should operate.
const userWorkingDir = process.cwd();
(globalThis as any).__USER_WORKING_DIR__ = userWorkingDir;

// Ensure runtime path resolution matches repo root for env/public assets.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, '..');
(globalThis as any).__PACKAGE_ROOT__ = packageRoot;
process.chdir(packageRoot);

console.log('[CLI] User working directory:', userWorkingDir);
console.log('[CLI] Package root:', packageRoot);

// Start the built server (keeps process alive).
// Use dynamic import to ensure globals are set BEFORE server module loads.
import('./server.js');
