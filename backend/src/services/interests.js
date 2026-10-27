import { query } from '../db.js';
import { notFound } from '../lib/errors.js';
import { decayed, learn, mergeSettings, rank } from '../lib/ranking.js';
import { extractTopics, TOPICS } from '../lib/topics.js';
import { hydrate } from './posts.js';

const CANDIDATE_DAYS = 7;
const CANDIDATE_LIMIT = 500;

export async function getSettings(userId) {
  const { rows } = await query('SELECT settings FROM feed_settings WHERE user_id = $1', [userId]);
  return mergeSettings(rows[0]?.settings);
}

/** Mescla `patch` nas preferências salvas (o patch já vem validado pela rota). */
export async function saveSettings(userId, patch) {
  const current = await getSettings(userId);
  const next = mergeSettings({
    ...current,
    ...patch,
    weights: { ...current.weights, ...(patch.weights ?? {}) },
    topics: patch.topics ? { ...current.topics, ...patch.topics } : current.topics,
  });
  await query(
    `INSERT INTO feed_settings (user_id, settings, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (user_id) DO UPDATE SET settings = EXCLUDED.settings, updated_at = now()`,
    [userId, JSON.stringify(next)],
  );
  return next;
}

/** Aprendizado atual, já com decaimento aplicado. */
export async function getLearned(userId) {
  const [topics, authors] = await Promise.all([
    query('SELECT topic, value, updated_at FROM learned_topics WHERE user_id = $1', [userId]),
    query(
      `SELECT la.author_id, la.value, la.updated_at, u.username FROM learned_authors la
       JOIN users u ON u.id = la.author_id WHERE la.user_id = $1`,
      [userId],
    ),
  ]);
  const now = Date.now();
  const t = topics.rows.map((r) => ({ topic: r.topic, label: TOPICS[r.topic]?.label ?? r.topic, value: round(decayed(r.value, r.updated_at, now)) }));
  const a = authors.rows.map((r) => ({ author_id: r.author_id, username: r.username, value: round(decayed(r.value, r.updated_at, now)) }));
  return {
    topics: t.filter((x) => Math.abs(x.value) >= 0.01).sort((x, y) => y.value - x.value),
    authors: a.filter((x) => Math.abs(x.value) >= 0.01).sort((x, y) => y.value - x.value),
  };
}

export async function resetLearning(userId) {
  await query('DELETE FROM learned_topics WHERE user_id = $1', [userId]);
  await query('DELETE FROM learned_authors WHERE user_id = $1', [userId]);
  await query('DELETE FROM hidden_posts WHERE user_id = $1', [userId]);
}

async function upsertLearned(table, keyCol, userId, key, signal) {
  const { rows } = await query(`SELECT value, updated_at FROM ${table} WHERE user_id = $1 AND ${keyCol} = $2`, [userId, key]);
  const value = learn(rows[0]?.value ?? 0, rows[0]?.updated_at ?? new Date(), signal);
  await query(
    `INSERT INTO ${table} (user_id, ${keyCol}, value, updated_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (user_id, ${keyCol}) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [userId, key, value],
  );
}

/**
 * Registra um sinal EXPLÍCITO (like, unlike, repost, reply, more, less).
 * Atualiza a afinidade com os tópicos do post e com o autor.
 */
export async function recordSignal(userId, postId, signal) {
  const { rows } = await query('SELECT author_id, text, repost_of_id FROM posts WHERE id = $1', [postId]);
  if (!rows[0]) throw notFound('Post não encontrado');
  let post = rows[0];
  if (post.repost_of_id) {
    const orig = await query('SELECT author_id, text FROM posts WHERE id = $1', [post.repost_of_id]);
    if (orig.rows[0]) post = orig.rows[0];
  }
  if (post.author_id === userId) return; // interagir com o próprio post não ensina nada
  for (const topic of extractTopics(post.text)) await upsertLearned('learned_topics', 'topic', userId, topic, signal);
  await upsertLearned('learned_authors', 'author_id', userId, post.author_id, signal);
  if (signal === 'less') {
    await query('INSERT INTO hidden_posts (user_id, post_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [userId, postId]);
  }
}

/** Versão best-effort para os ganchos de like/repost/reply: nunca derruba a ação principal. */
export async function recordSignalSafely(userId, postId, signal) {
  try {
    await recordSignal(userId, postId, signal);
  } catch (err) {
    if (process.env.NODE_ENV !== 'test') console.warn('[interesses] falha ao aprender:', err.message);
  }
}

/** Feed "Interesses": candidatos recentes → rank() → página. Cursor = posição no ranking. */
export async function interestFeed(userId, { offset = 0, limit = 20 } = {}) {
  const [settings, learnedRaw, followRows, candidates] = await Promise.all([
    getSettings(userId),
    getLearned(userId),
    query('SELECT followee_id FROM follows WHERE follower_id = $1', [userId]),
    query(
      `SELECT p.id, p.author_id, p.text, p.created_at, p.like_count, p.repost_count FROM posts p
       WHERE p.repost_of_id IS NULL AND p.author_id <> $1
         AND p.created_at > now() - make_interval(days => $2)
         AND NOT EXISTS (SELECT 1 FROM hidden_posts h WHERE h.user_id = $1 AND h.post_id = p.id)
       ORDER BY p.id DESC LIMIT $3`,
      [userId, CANDIDATE_DAYS, CANDIDATE_LIMIT],
    ),
  ]);
  const ranked = rank(candidates.rows, {
    settings,
    following: new Set(followRows.rows.map((r) => r.followee_id)),
    learnedTopics: Object.fromEntries(learnedRaw.topics.map((t) => [t.topic, t.value])),
    learnedAuthors: Object.fromEntries(learnedRaw.authors.map((a) => [a.author_id, a.value])),
  });
  const page = ranked.slice(offset, offset + limit);
  const result = await hydrate(page.map((r) => r.post.id), userId);
  const byId = new Map(page.map((r, i) => [r.post.id, { r, position: offset + i + 1 }]));
  result.data = result.data.map((p) => {
    const { r, position } = byId.get(p.id);
    return {
      ...p,
      ranking: {
        position,
        score: r.score,
        topics: r.topics.map((t) => ({ id: t, label: TOPICS[t].label })),
        keywords: r.keywords,
        reasons: r.reasons,
      },
    };
  });
  const end = offset + page.length;
  const caughtUp = end >= ranked.length;
  return {
    ...result,
    meta: {
      result_count: page.length,
      next_token: caughtUp ? undefined : String(end),
      caught_up: caughtUp,
      session: { limit: settings.session_limit, delivered: end, available: ranked.length },
      hide_metrics: settings.hide_metrics,
      // false = nenhum tópico, palavra-chave ou aprendizado ainda: o ranking é quase cronológico
      personalized:
        Object.values(settings.topics).some((v) => v > 0) || settings.keywords.length > 0 || learnedRaw.topics.some((t) => t.value > 0),
      algorithm: 'interesses-v1',
    },
  };
}

const round = (x) => Math.round(x * 1000) / 1000;
