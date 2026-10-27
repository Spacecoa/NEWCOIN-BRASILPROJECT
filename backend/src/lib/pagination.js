import { z } from 'zod';
import { parse } from './errors.js';

const snowflake = z.string().regex(/^\d{1,20}$/, 'deve ser um ID numérico');

// Mesmos nomes de parâmetro da X API v2 (since_id / until_id / max_results).
// `max_id` (nome da API v1.1) é aceito como alias de until_id para fins didáticos.
const schema = z.object({
  since_id: snowflake.optional(),
  until_id: snowflake.optional(),
  max_id: snowflake.optional(),
  max_results: z.coerce.number().int().min(1).max(100).default(20),
});

export function parsePageParams(q) {
  const p = parse(schema, q);
  return { sinceId: p.since_id ?? null, untilId: p.until_id ?? p.max_id ?? null, limit: p.max_results };
}

/** Monta o bloco `meta` no formato da X API v2. */
export function pageMeta(items, limit) {
  const meta = { result_count: items.length };
  if (items.length) {
    meta.newest_id = items[0].id;
    meta.oldest_id = items[items.length - 1].id;
    // Página cheia => provavelmente há mais. O cliente envia until_id=next_token.
    if (items.length === limit) meta.next_token = meta.oldest_id;
  }
  return meta;
}

/** Filtra uma lista de IDs (strings, ordem decrescente) pelos cursores. */
export function applyCursor(ids, { sinceId, untilId }) {
  const since = sinceId ? BigInt(sinceId) : null;
  const until = untilId ? BigInt(untilId) : null;
  return ids.filter((id) => {
    const n = BigInt(id);
    return (since === null || n > since) && (until === null || n < until);
  });
}
