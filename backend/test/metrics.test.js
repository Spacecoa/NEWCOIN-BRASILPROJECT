import { afterEach, describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import { resetMetrics } from '../src/lib/metrics.js';
import { api, post, resetDb, signup } from './helpers.js';

describe('métricas (GET /api/metricas)', () => {
  afterEach(() => {
    config.metricsToken = null;
  });

  it('sem METRICS_TOKEN a rota não existe; com ele, exige o token', async () => {
    expect((await api().get('/api/metricas')).status).toBe(404);
    config.metricsToken = 'token-das-metricas-123';
    expect((await api().get('/api/metricas')).status).toBe(401);
    expect((await api().get('/api/metricas').set('Authorization', 'Bearer outro')).status).toBe(401);
    expect((await api().get('/api/metricas').set('Authorization', 'Bearer token-das-metricas-123')).status).toBe(200);
  });

  it('conta pedidos por padrão de rota (sem um ID por série) e mostra fila, banco e memória', async () => {
    await resetDb();
    resetMetrics();
    const ana = await signup('ana');
    const p = await post(ana, 'oi');
    await api().get(`/api/posts/${p.id}`);
    await api().get('/api/posts/123456789');
    config.metricsToken = 'token-das-metricas-123';
    const res = await api().get('/api/metricas').set('Authorization', 'Bearer token-das-metricas-123');
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    const t = res.text;
    expect(t).toContain('agora_http_requests_total{route="GET /api/posts/:id",status="2xx"} 1');
    expect(t).toContain('agora_http_requests_total{route="GET /api/posts/:id",status="4xx"} 1');
    expect(t).toContain('agora_http_requests_total{route="POST /api/posts",status="2xx"} 1');
    expect(t).toMatch(/agora_http_request_duration_seconds_count\{route="GET \/api\/posts\/:id"\} 2/);
    expect(t).not.toContain(p.id);
    for (const g of ['fanout_queue_length', 'db_pool_total', 'ratelimit_memory_keys', 'process_resident_memory_bytes']) expect(t).toMatch(new RegExp(`agora_${g} \\d+`));
  });
});
