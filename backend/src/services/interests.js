import { query } from '../db.js';
import { decayed, mergeSettings } from '../lib/ranking.js';
import { TOPICS } from '../lib/topics.js';
import { hiddenAuthorsSql } from './relations.js';
import { hydrate } from './posts.js';

export const CANDIDATE_DAYS = 7;
export const CANDIDATE_LIMIT = 500;
// Preferências que NÃO são do algoritmo: sobrevivem à troca de modo.
const NON_ALGORITHM_KEYS = ['missions_enabled', 'count_time'];

export async function getSettings(userId) {
  const { rows } = await query('SELECT settings FROM feed_settings WHERE user_id = $1', [userId]);
  return mergeSettings(rows[0]?.settings);
}

/**
 * Salva só as preferências que NÃO são do algoritmo (missões e contagem de tempo).
 * O algoritmo de cada pessoa fica exclusivamente no aparelho dela.
 */
export async function saveSettings(userId, patch) {
  const current = await getSettings(userId);
  const next = mergeSettings({ ...current, ...Object.fromEntries(NON_ALGORITHM_KEYS.filter((k) => k in patch).map((k) => [k, patch[k]])) });
  await query(
    `INSERT INTO feed_settings (user_id, settings, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (user_id) DO UPDATE SET settings = EXCLUDED.settings, updated_at = now()`,
    [userId, JSON.stringify(next)],
  );
  return next;
}

/** Aprendizado que contas antigas ainda têm no servidor (só para o app importar uma vez). */
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

/**
 * Posts candidatos do feed de interesses. O conjunto NÃO depende das preferências
 * (só exclui os próprios posts e os escondidos no servidor), então entregá-lo ao
 * navegador não revela à instância do que a pessoa gosta.
 */
function candidateRows(userId) {
  return query(
    `SELECT p.id, p.author_id, p.text, p.created_at, p.like_count, p.repost_count FROM posts p
     WHERE p.repost_of_id IS NULL AND p.removed_at IS NULL AND p.author_id <> $1
       AND p.created_at > now() - make_interval(days => $2)
       AND NOT EXISTS (SELECT 1 FROM hidden_posts h WHERE h.user_id = $1 AND h.post_id = p.id)
       AND p.author_id NOT IN ${hiddenAuthorsSql('$1')}
     ORDER BY p.id DESC LIMIT $3`,
    [userId, CANDIDATE_DAYS, CANDIDATE_LIMIT],
  );
}

const followingIds = async (userId) =>
  (await query('SELECT followee_id FROM follows WHERE follower_id = $1', [userId])).rows.map((r) => r.followee_id);

/** Modo "neste aparelho": candidatos hidratados + quem a pessoa segue. O ranking acontece no navegador. */
export async function candidatesForDevice(userId) {
  const [rows, following] = await Promise.all([candidateRows(userId), followingIds(userId)]);
  const result = await hydrate(rows.rows.map((r) => r.id), userId);
  return {
    ...result,
    meta: {
      result_count: result.data.length,
      following,
      window_days: CANDIDATE_DAYS,
      limit: CANDIDATE_LIMIT,
      generated_at: new Date().toISOString(),
      algorithm: 'interesses-v1',
    },
  };
}

/**
 * Leva a conta para o aparelho: o servidor APAGA as preferências do algoritmo, o aprendizado
 * e os posts escondidos que ainda tinha (o app copia tudo antes). Só existe esse sentido:
 * o algoritmo de cada pessoa fica exclusivamente no aparelho dela.
 */
export async function moveAlgorithmToDevice(userId) {
  const current = await getSettings(userId);
  await resetLearning(userId);
  const next = mergeSettings({ ...Object.fromEntries(NON_ALGORITHM_KEYS.map((k) => [k, current[k]])), ranking_mode: 'device' });
  await query(
    `INSERT INTO feed_settings (user_id, settings, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (user_id) DO UPDATE SET settings = EXCLUDED.settings, updated_at = now()`,
    [userId, JSON.stringify(next)],
  );
  return next;
}

export async function hiddenPostIds(userId) {
  const { rows } = await query('SELECT post_id FROM hidden_posts WHERE user_id = $1 ORDER BY post_id', [userId]);
  return rows.map((r) => r.post_id);
}

const round = (x) => Math.round(x * 1000) / 1000;
