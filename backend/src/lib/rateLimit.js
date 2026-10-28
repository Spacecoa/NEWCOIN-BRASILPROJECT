import { getRedis } from '../cache.js';

// Rate limit de janela fixa, com os mesmos cabeçalhos que a X API devolve:
// x-rate-limit-limit, x-rate-limit-remaining, x-rate-limit-reset (epoch em segundos).
// Usa Redis (INCR + EXPIRE) quando disponível; senão, memória do processo.
const memory = new Map();

async function hit(key, windowSec) {
  const nowSec = Math.floor(Date.now() / 1000);
  const windowStart = nowSec - (nowSec % windowSec);
  const reset = windowStart + windowSec;
  const fullKey = `rl:${key}:${windowStart}`;
  const redis = getRedis();
  if (redis) {
    try {
      const [[, count]] = await redis.multi().incr(fullKey).expire(fullKey, windowSec).exec();
      return { count, reset };
    } catch {
      /* Redis fora do ar: cai para memória */
    }
  }
  // Sem Redis: contadores na memória. Ao crescer demais, descarta só as janelas vencidas
  // (antes zerava tudo, o que devolvia o limite inteiro a quem estava abusando).
  if (memory.size > 50_000) {
    for (const [k, v] of memory) if (v.reset <= nowSec) memory.delete(k);
  }
  const entry = memory.get(fullKey) ?? { count: 0, reset };
  entry.count += 1;
  memory.set(fullKey, entry);
  return { count: entry.count, reset };
}

export function rateLimit({ name, limit, windowSec, key = (req) => req.user?.id ?? req.ip }) {
  return async (req, res, next) => {
    if (process.env.DISABLE_RATE_LIMIT === '1') return next();
    const { count, reset } = await hit(`${name}:${key(req)}`, windowSec);
    res.set('x-rate-limit-limit', String(limit));
    res.set('x-rate-limit-remaining', String(Math.max(0, limit - count)));
    res.set('x-rate-limit-reset', String(reset));
    if (count > limit) {
      return res.status(429).json({ error: 'Too Many Requests', retry_after: reset - Math.floor(Date.now() / 1000) });
    }
    next();
  };
}

export function resetRateLimitMemory() {
  memory.clear();
}
