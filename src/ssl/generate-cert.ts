import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const CERT_DIR = path.join(os.homedir(), '.vcode', 'ssl');
const CERT_PATH = path.join(CERT_DIR, 'cert.pem');
const KEY_PATH = path.join(CERT_DIR, 'key.pem');

export interface SSLCerts {
  cert: string;
  key: string;
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function certsExist(): boolean {
  return fs.existsSync(CERT_PATH) && fs.existsSync(KEY_PATH);
}

function generateSelfSignedCerts(): void {
  console.log('[SSL] Generating self-signed certificate...');
  ensureDir(CERT_DIR);

  // Generate a self-signed cert valid for localhost and local network IPs
  const opensslCmd = `openssl req -x509 -newkey rsa:2048 -keyout "${KEY_PATH}" -out "${CERT_PATH}" -days 365 -nodes -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:0.0.0.0"`;

  try {
    execSync(opensslCmd, { stdio: 'pipe' });
    console.log('[SSL] Self-signed certificate generated at:', CERT_DIR);
    console.log('[SSL] WARNING: Browsers will show a security warning for self-signed certs.');
    console.log('[SSL] TIP: For trusted local certs, install mkcert: https://github.com/FiloSottile/mkcert');
  } catch (error) {
    console.error('[SSL] Failed to generate certificate. Is openssl installed?');
    throw error;
  }
}

export function getSSLCerts(customCertPath?: string, customKeyPath?: string): SSLCerts {
  // Use custom certs if both provided
  if (customCertPath && customKeyPath) {
    console.log('[SSL] Using custom SSL certificates');
    if (!fs.existsSync(customCertPath)) {
      throw new Error(`SSL cert not found: ${customCertPath}`);
    }
    if (!fs.existsSync(customKeyPath)) {
      throw new Error(`SSL key not found: ${customKeyPath}`);
    }
    return {
      cert: fs.readFileSync(customCertPath, 'utf-8'),
      key: fs.readFileSync(customKeyPath, 'utf-8'),
    };
  }

  // Generate or use existing self-signed certs
  if (!certsExist()) {
    generateSelfSignedCerts();
  } else {
    console.log('[SSL] Using existing self-signed certificate from:', CERT_DIR);
  }

  return {
    cert: fs.readFileSync(CERT_PATH, 'utf-8'),
    key: fs.readFileSync(KEY_PATH, 'utf-8'),
  };
}

export { CERT_DIR, CERT_PATH, KEY_PATH };
