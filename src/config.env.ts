import dotenv from 'dotenv';

console.log('[CONFIG] Loading environment configuration...');
dotenv.config();

const PORT = Number(process.env.PORT) || 8765;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const REALTIME_MODEL = process.env.REALTIME_MODEL || 'gpt-realtime';

// SSL configuration
const SSL_ENABLED = process.env.SSL_ENABLED !== 'false'; // Enabled by default
const SSL_CERT_PATH = process.env.SSL_CERT_PATH;
const SSL_KEY_PATH = process.env.SSL_KEY_PATH;

console.log('[CONFIG] PORT:', PORT);
console.log('[CONFIG] OPENAI_API_KEY:', OPENAI_API_KEY ? `${OPENAI_API_KEY.slice(0, 10)}...` : '(not set)');
console.log('[CONFIG] REALTIME_MODEL:', REALTIME_MODEL);
console.log('[CONFIG] SSL_ENABLED:', SSL_ENABLED);
console.log('[CONFIG] SSL_CERT_PATH:', SSL_CERT_PATH || '(auto-generate)');
console.log('[CONFIG] SSL_KEY_PATH:', SSL_KEY_PATH || '(auto-generate)');
console.log('[CONFIG] NODE_ENV:', process.env.NODE_ENV || '(not set)');

if (!OPENAI_API_KEY && process.env.NODE_ENV !== 'test') {
  console.error('[CONFIG] FATAL: OPENAI_API_KEY is required but not set');
  throw new Error('OPENAI_API_KEY must be set');
}

console.log('[CONFIG] Configuration validated successfully');

export const env = {
  PORT,
  OPENAI_API_KEY: OPENAI_API_KEY ?? 'test-key',
  REALTIME_MODEL,
  SSL_ENABLED,
  SSL_CERT_PATH,
  SSL_KEY_PATH,
};
