import { config } from '../config.js';
import { getRedis } from '../cache.js';
import { query } from '../db.js';
import { applyCursor } from '../lib/pagination.js';

// Estratégia "fan-out on write" (como a home timeline do Twitter, descrita publicamente
// em palestras de engenharia): ao publicar, o ID do post é empurrado para uma lista Redis
// de cada seguidor. A leitura vira um LRANGE + hidratação por IDs.
//
// Detalhes deste protótipo:
// - A lista só recebe push se já existir (LPUSHX). Listas inexistentes são
//   reconstruídas a partir do SQL na primeira leitura ("lazy rebuild").
// - Um sentinela "0" no fim da lista indica que ela contém TODO o histórico
//   (nada foi cortado pelo LTRIM). Sem ele, páginas além do cache vão ao SQL.
// - Sem Redis, tudo é "fan-out on read" via SQL — mesmo resultado, mais custo.

const SENTINEL = '0';
const TTL_SEC = 60 * 60;
const key = (userId) => `tl:home:${userId}`;

async function homeIdsFromSql(userId, { sinceId, untilId, limit }) {
  const { rows } = await query(
    `SELECT id FROM posts
     WHERE (author_id = $1 OR author_id IN (SELECT followee_id FROM follows WHERE follower_id = $1))
       AND ($2::bigint IS NULL OR id > $2) AND ($3::bigint IS NULL OR id < $3)
     ORDER BY id DESC LIMIT $4`,
    [userId, sinceId, untilId, limit],
  );
  return rows.map((r) => r.id);
}

async function rebuild(redis, userId) {
  const size = config.timelineCacheSize;
  const ids = await homeIdsFromSql(userId, { sinceId: null, untilId: null, limit: size + 1 });
  const complete = ids.length <= size;
  const items = complete ? [...ids, SENTINEL] : ids.slice(0, size);
  await redis.multi().del(key(userId)).rpush(key(userId), ...items).expire(key(userId), TTL_SEC).exec();
  return items;
}

export async function homeTimelineIds(userId, page) {
  const redis = getRedis();
  if (!redis) return homeIdsFromSql(userId, page);
  try {
    let items = await redis.lrange(key(userId), 0, -1);
    if (!items.length) items = await rebuild(redis, userId);
    const complete = items[items.length - 1] === SENTINEL;
    const cached = items.filter((id) => id !== SENTINEL);
    const ids = applyCursor(cached, page).slice(0, page.limit);
    if (ids.length === page.limit || complete) return ids;
    // Cache esgotado: completa a página com o SQL a partir do ID mais antigo em cache.
    // Tudo entre o topo e o item mais antigo do cache já foi considerado acima.
    const oldest = cached.at(-1);
    const untilId = page.untilId && BigInt(page.untilId) < BigInt(oldest) ? page.untilId : oldest;
    const rest = await homeIdsFromSql(userId, { ...page, untilId, limit: page.limit - ids.length });
    return [...ids, ...rest];
  } catch (err) {
    if (process.env.NODE_ENV !== 'test') console.warn('[timeline] Redis falhou, usando SQL:', err.message);
    return homeIdsFromSql(userId, page);
  }
}

/** Empurra o post para as timelines do autor e de seus seguidores. Retorna os IDs alcançados. */
export async function fanOut(postId, authorId) {
  const { rows } = await query('SELECT follower_id FROM follows WHERE followee_id = $1', [authorId]);
  const audience = [authorId, ...rows.map((r) => r.follower_id)];
  const redis = getRedis();
  if (redis) {
    try {
      const pipe = redis.pipeline();
      for (const uid of audience) {
        pipe.lpushx(key(uid), postId);
        pipe.ltrim(key(uid), 0, config.timelineCacheSize - 1);
      }
      await pipe.exec();
    } catch {
      /* cache é best-effort; o SQL continua sendo a fonte da verdade */
    }
  }
  return audience;
}

export async function invalidateHomeTimeline(userId) {
  const redis = getRedis();
  if (redis) await redis.del(key(userId)).catch(() => {});
}

export async function userTimelineIds(userId, { sinceId, untilId, limit }, { excludeReplies = false, excludeReposts = false } = {}) {
  const { rows } = await query(
    `SELECT id FROM posts WHERE author_id = $1
       AND ($2::bigint IS NULL OR id > $2) AND ($3::bigint IS NULL OR id < $3)
       AND (NOT $5 OR reply_to_id IS NULL) AND (NOT $6 OR repost_of_id IS NULL)
     ORDER BY id DESC LIMIT $4`,
    [userId, sinceId, untilId, limit, excludeReplies, excludeReposts],
  );
  return rows.map((r) => r.id);
}

/** Timeline pública da instância (equivalente à "local timeline" do Mastodon). */
export async function publicTimelineIds({ sinceId, untilId, limit }) {
  const { rows } = await query(
    `SELECT id FROM posts WHERE repost_of_id IS NULL
       AND ($1::bigint IS NULL OR id > $1) AND ($2::bigint IS NULL OR id < $2)
     ORDER BY id DESC LIMIT $3`,
    [sinceId, untilId, limit],
  );
  return rows.map((r) => r.id);
}

/**
 * Busca de posts por palavras, do mais recente ao mais antigo (sem ordenar por curtidas:
 * a busca não premia popularidade, como o resto do app). Aceita "frase entre aspas", -palavra
 * para excluir e OR. Reposts ficam de fora (o original aparece); hydrate() tira bloqueados,
 * suspensos e silenciados.
 */
export async function searchPostIds(q, { untilId, limit }) {
  // MATERIALIZED obriga o Postgres a usar o índice de busca primeiro. Sem isso, para uma palavra
  // rara ele percorria a tabela pela chave atrás de 20 resultados: 418 ms com 100 mil posts,
  // contra 0,06 ms assim (e 17 ms para uma palavra que aparece em 1 de cada 5 posts).
  const { rows } = await query(
    `WITH found AS MATERIALIZED (
       SELECT id, removed_at FROM posts
        WHERE repost_of_id IS NULL AND to_tsvector('agora_pt', text) @@ websearch_to_tsquery('agora_pt', $1)
          AND ($2::bigint IS NULL OR id < $2)
     )
     SELECT id FROM found WHERE removed_at IS NULL ORDER BY id DESC LIMIT $3`,
    [q, untilId, limit],
  );
  return rows.map((r) => r.id);
}

export async function mentionIds(userId, { sinceId, untilId, limit }) {
  const { rows } = await query(
    `SELECT post_id AS id FROM mentions WHERE user_id = $1
       AND ($2::bigint IS NULL OR post_id > $2) AND ($3::bigint IS NULL OR post_id < $3)
     ORDER BY post_id DESC LIMIT $4`,
    [userId, sinceId, untilId, limit],
  );
  return rows.map((r) => r.id);
}
