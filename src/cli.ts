#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Calculate package root for assets (public/, .env)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, '..');

// Store package root globally - used by config.env.ts for .env file path
(globalThis as any).__PACKAGE_ROOT__ = packageRoot;

// DO NOT chdir - keep process.cwd() as user's working directory
// so that Claude/Codex agents operate in the user's project
console.log('[CLI] Working directory:', process.cwd());
console.log('[CLI] Package root:', packageRoot);

// Start the built server (keeps process alive).
import('./server.js');
