import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/server.js';

describe('Health endpoint', () => {
  it('should return status ok', async () => {
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'ok');
  });
});
