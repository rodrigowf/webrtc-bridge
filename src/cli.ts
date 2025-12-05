#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Ensure runtime path resolution matches repo root for env/public assets.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
process.chdir(path.resolve(__dirname, '..'));

// Start the built server (keeps process alive).
import './server.js';
