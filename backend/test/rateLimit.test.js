import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getRedis } from '../src/cache.js';
import { rateLimit } from '../src/lib/rateLimit.js';

describe('rate limit (cabeçalhos no estilo X API)', () => {
  beforeEach(async () => {
    delete process.env.DISABLE_RATE_LIMIT;
    await getRedis()?.flushdb();
  });
  afterEach(() => {
    process.env.DISABLE_RATE_LIMIT = '1';
  });

  it('expõe x-rate-limit-* e responde 429 ao exceder', async () => {
    const app = express();
    app.get('/x', rateLimit({ name: 't', limit: 2, windowSec: 60, key: () => 'k' }), (_req, res) => res.json({ ok: true }));
    const a = await request(app).get('/x');
    expect(a.headers['x-rate-limit-limit']).toBe('2');
    expect(a.headers['x-rate-limit-remaining']).toBe('1');
    expect(Number(a.headers['x-rate-limit-reset'])).toBeGreaterThan(Date.now() / 1000);
    await request(app).get('/x');
    const c = await request(app).get('/x');
    expect(c.status).toBe(429);
    expect(c.headers['x-rate-limit-remaining']).toBe('0');
    expect(c.body.retry_after).toBeGreaterThan(0);
  });
});
