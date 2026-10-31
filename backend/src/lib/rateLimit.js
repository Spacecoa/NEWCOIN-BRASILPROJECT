import { getRedis } from '../cache.js';

// Rate limit de janela fixa, com os mesmos cabeçalhos que a X API devolve:
// x-rate-limit-limit, x-rate-limit-remaining, x-rate-limit-reset (epoch em segundos).
// Usa Redis (INCR + EXPIRE) quando disponível; senão, memória do processo.
//
// Redis configurado e fora do ar: por padrão o contador cai para a memória do processo. Nas rotas
// de senha (failClosed) isso abriria uma brecha (cada processo contaria do zero), então elas
// respondem 503 até o Redis voltar (docs/10, B3).
const memory = new Map();
export const MAX_MEMORY_KEYS = 50_000;

/** Unavailable: o Redis respondeu com erro e a rota pediu para falhar fechado. */
export class LimiterUnavailable extends Error {}

// Teto para a memória: primeiro saem as janelas vencidas; se ainda passar do teto, saem os 10%
// mais antigos (ordem de criação). Assim, muitas chaves novas não estouram a memória e não
// zeram todos os limites de uma vez, como acontecia antes.
function evict(nowSec) {
  if (memory.size <= MAX_MEMORY_KEYS) return;
  for (const [k, v] of memory) if (v.reset <= nowSec) memory.delete(k);
  if (memory.size <= MAX_MEMORY_KEYS) return;
  let drop = Math.ceil(MAX_MEMORY_KEYS * 0.1);
  for (const k of memory.keys()) {
    memory.delete(k);
    if (--drop <= 0) break;
  }
}

async function hit(key, windowSec, { failClosed = false } = {}) {
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
      if (failClosed) throw new LimiterUnavailable();
      /* Redis fora do ar: cai para memória */
    }
  }
  evict(nowSec);
  const entry = memory.get(fullKey) ?? { count: 0, reset };
  entry.count += 1;
  memory.set(fullKey, entry);
  return { count: entry.count, reset };
}

const unavailable = (res) =>
  res.set('retry-after', '5').status(503).json({ error: 'O controle de tentativas está fora do ar. Tente de novo em alguns segundos.', retry_after: 5 });

export function rateLimit({ name, limit, windowSec, key = (req) => req.user?.id ?? req.ip, failClosed = false }) {
  return async (req, res, next) => {
    if (process.env.DISABLE_RATE_LIMIT === '1') return next();
    let count, reset;
    try {
      ({ count, reset } = await hit(`${name}:${key(req)}`, windowSec, { failClosed }));
    } catch (err) {
      if (err instanceof LimiterUnavailable) return unavailable(res);
      throw err;
    }
    res.set('x-rate-limit-limit', String(limit));
    res.set('x-rate-limit-remaining', String(Math.max(0, limit - count)));
    res.set('x-rate-limit-reset', String(reset));
    if (count > limit) {
      return res.status(429).json({ error: 'Too Many Requests', retry_after: reset - Math.floor(Date.now() / 1000) });
    }
    next();
  };
}

/**
 * Contador de FALHAS (ex.: senha errada para uma conta). Diferente de rateLimit, que conta
 * todo pedido: aqui só soma quem errou; quem acerta não gasta tentativa.
 */
export function failureCounter({ name, limit, windowSec, failClosed = false }) {
  const peekKey = (key) => {
    const nowSec = Math.floor(Date.now() / 1000);
    const windowStart = nowSec - (nowSec % windowSec);
    return { fullKey: `rl:${name}:${key}:${windowStart}`, reset: windowStart + windowSec };
  };
  return {
    /** { blocked, retryAfter } sem contar nada. */
    async check(key) {
      if (process.env.DISABLE_RATE_LIMIT === '1') return { blocked: false };
      const { fullKey, reset } = peekKey(key);
      const redis = getRedis();
      let count = 0;
      if (redis) {
        try {
          count = Number((await redis.get(fullKey)) ?? 0);
        } catch {
          if (failClosed) return { blocked: true, unavailable: true, retryAfter: 5 };
          count = memory.get(fullKey)?.count ?? 0;
        }
      } else count = memory.get(fullKey)?.count ?? 0;
      return { blocked: count >= limit, retryAfter: reset - Math.floor(Date.now() / 1000) };
    },
    async fail(key) {
      if (process.env.DISABLE_RATE_LIMIT === '1') return;
      await hit(`${name}:${key}`, windowSec, { failClosed }).catch((err) => {
        if (!(err instanceof LimiterUnavailable)) throw err;
      });
    },
  };
}

export const memorySize = () => memory.size;

export function resetRateLimitMemory() {
  memory.clear();
}
