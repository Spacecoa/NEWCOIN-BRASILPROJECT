import { timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { config } from '../config.js';
import { pool } from '../db.js';
import { renderMetrics } from '../lib/metrics.js';
import { memorySize } from '../lib/rateLimit.js';
import { queueLength } from '../services/fanout.js';

const router = Router();

const sameToken = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * GET /api/metricas — só com METRICS_TOKEN configurado e o mesmo token no cabeçalho
 * Authorization: Bearer. Sem configurar, a rota não existe (404): números internos não
 * ficam abertos na internet.
 */
router.get('/metricas', async (req, res) => {
  if (!config.metricsToken) return res.status(404).json({ error: 'Rota não encontrada' });
  const given = (req.get('authorization') ?? '').replace(/^Bearer /, '');
  if (!sameToken(given, config.metricsToken)) return res.status(401).json({ error: 'Token de métricas inválido' });
  const mem = process.memoryUsage();
  res.type('text/plain; version=0.0.4').send(
    renderMetrics({
      fanout_queue_length: { help: 'Trabalhos de distribuição de posts esperando na fila.', value: await queueLength() },
      db_pool_total: { help: 'Conexões abertas com o Postgres.', value: pool.totalCount },
      db_pool_idle: { help: 'Conexões livres com o Postgres.', value: pool.idleCount },
      db_pool_waiting: { help: 'Pedidos esperando uma conexão livre.', value: pool.waitingCount },
      ratelimit_memory_keys: { help: 'Contadores de limite guardados na memória (Redis fora do ar ou ausente).', value: memorySize() },
      process_resident_memory_bytes: { help: 'Memória do processo.', value: mem.rss },
      process_uptime_seconds: { help: 'Tempo desde que o processo subiu.', value: Math.round(process.uptime()) },
    }),
  );
});

export default router;
