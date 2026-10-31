import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Redis "configurado mas fora do ar": todo comando falha.
const broken = vi.hoisted(() => ({ on: true }));
vi.mock('../../src/cache.js', () => ({
  getRedis: () =>
    broken.on
      ? { multi: () => ({ incr: () => ({ expire: () => ({ exec: () => Promise.reject(new Error('ECONNREFUSED')) }) }) }), get: () => Promise.reject(new Error('ECONNREFUSED')) }
      : null,
}));
const { failureCounter, MAX_MEMORY_KEYS, memorySize, rateLimit, resetRateLimitMemory } = await import('../../src/lib/rateLimit.js');

const appWith = (opts) => {
  const app = express();
  app.get('/x', rateLimit({ name: 't', limit: 2, windowSec: 60, key: () => 'k', ...opts }), (_req, res) => res.json({ ok: true }));
  return app;
};

describe('limitador com o Redis fora do ar', () => {
  beforeEach(() => {
    delete process.env.DISABLE_RATE_LIMIT;
    resetRateLimitMemory();
    broken.on = true;
  });
  afterEach(() => {
    process.env.DISABLE_RATE_LIMIT = '1';
  });

  it('rotas comuns continuam funcionando, contando na memória do processo', async () => {
    const app = appWith({});
    expect((await request(app).get('/x')).status).toBe(200);
    await request(app).get('/x');
    expect((await request(app).get('/x')).status).toBe(429);
  });

  it('rotas de senha (failClosed) recusam com 503 e Retry-After, em vez de liberar sem limite', async () => {
    const res = await request(appWith({ failClosed: true })).get('/x');
    expect(res.status).toBe(503);
    expect(res.headers['retry-after']).toBe('5');
    expect(res.body.error).toMatch(/fora do ar/);
  });

  it('o contador de senhas erradas por conta também falha fechado', async () => {
    const strict = failureCounter({ name: 'f', limit: 3, windowSec: 60, failClosed: true });
    expect(await strict.check('ana@x')).toMatchObject({ blocked: true, unavailable: true });
    await expect(strict.fail('ana@x')).resolves.toBeUndefined();
    const lax = failureCounter({ name: 'f', limit: 3, windowSec: 60 });
    expect((await lax.check('ana@x')).blocked).toBe(false);
  });

  it('a memória tem teto: chaves demais não estouram nem zeram todos os limites', async () => {
    broken.on = false; // sem Redis: só memória
    const res = { set() { return this; } };
    const limiter = rateLimit({ name: 'cheio', limit: 5, windowSec: 600, key: (req) => req.k });
    for (let i = 0; i < MAX_MEMORY_KEYS + 100; i++) await limiter({ k: `p${i}` }, res, () => {});
    // Passou do teto: saíram só os 10% mais antigos, não todos (antes, zerava tudo).
    expect(memorySize()).toBeLessThanOrEqual(MAX_MEMORY_KEYS + 1);
    expect(memorySize()).toBeGreaterThan(MAX_MEMORY_KEYS * 0.85);
  });
});
