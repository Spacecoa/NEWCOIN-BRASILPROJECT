import { query } from '../db.js';
import { nextId } from '../lib/ids.js';
import { bus } from '../realtime/bus.js';
import { hydrate } from './posts.js';
import { filterAudience, hiddenAuthorsSql } from './relations.js';
import { getUsersByIds } from './users.js';

// Notificações guardadas (a tela "Notificações"). Regras:
//  - ninguém é notificado da própria ação;
//  - quem silenciou ou tem bloqueio com quem agiu não recebe (mesmo filtro do tempo real);
//  - a mesma ação não notifica duas vezes, e desfazê-la (descurtir, deixar de seguir…) apaga o aviso.
export const KINDS = ['like', 'repost', 'reply', 'mention', 'follow', 'tip', 'quote'];

/**
 * Grava e avisa em tempo real. `post` (opcional) é o post hidratado que vai junto no evento.
 * Uma falha aqui só perde o aviso: a curtida, o follow etc. já foram salvos e seguem valendo.
 */
export async function notify(args) {
  try {
    return await save(args);
  } catch (err) {
    console.warn('[notificações] aviso não gravado:', err.message);
    return [];
  }
}

async function save({ kind, actorId, userIds, postId = null, post = null }) {
  const targets = await filterAudience(actorId, [...new Set(userIds)].filter((id) => id && id !== actorId));
  if (!targets.length) return [];
  const created = [];
  for (const userId of targets) {
    const { rowCount } = await query(
      'INSERT INTO notifications (id, user_id, actor_id, kind, post_id) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING',
      [nextId(), userId, actorId, kind, postId],
    );
    if (rowCount) created.push(userId);
  }
  if (created.length) bus.emit('notification', { userIds: created, type: kind, post: post ?? (postId ? { data: { id: postId } } : null) });
  return created;
}

/** Desfaz o aviso de uma ação desfeita. */
export async function retract({ kind, actorId, userId = null, postId = null }) {
  await query(
    `DELETE FROM notifications WHERE kind = $1 AND actor_id = $2
       AND ($3::bigint IS NULL OR user_id = $3) AND COALESCE(post_id, 0) = COALESCE($4::bigint, 0)`,
    [kind, actorId, userId, postId],
  );
}

/**
 * Lista no formato da API (data + includes + meta). Avisos de quem foi silenciado, bloqueado ou
 * suspenso depois somem, assim como os de posts apagados ou removidos pela moderação.
 */
export async function listNotifications(userId, { untilId, limit }) {
  const { rows } = await query(
    `SELECT n.id, n.kind, n.actor_id, n.post_id, n.created_at, n.read_at IS NOT NULL AS read
       FROM notifications n
      WHERE n.user_id = $1 AND ($2::bigint IS NULL OR n.id < $2)
        AND n.actor_id NOT IN ${hiddenAuthorsSql('$1')}
      ORDER BY n.id DESC LIMIT $3`,
    [userId, untilId, limit],
  );
  const postIds = [...new Set(rows.filter((r) => r.post_id).map((r) => r.post_id))];
  const posts = postIds.length ? await hydrate(postIds, userId, { muted: false }) : { data: [], includes: { users: [], posts: [] } };
  const visible = new Set(posts.data.map((p) => p.id));
  const data = rows
    .filter((r) => !r.post_id || visible.has(r.post_id))
    .map((r) => ({ id: r.id, kind: r.kind, actor_id: r.actor_id, post_id: r.post_id, created_at: r.created_at, read: r.read }));
  const actors = await getUsersByIds([...new Set(data.map((n) => n.actor_id))]);
  const users = [...new Map([...actors, ...posts.includes.users].map((u) => [u.id, u])).values()];
  const meta = { result_count: data.length, unread_count: await unreadCount(userId) };
  if (rows.length) {
    meta.newest_id = rows[0].id;
    meta.oldest_id = rows[rows.length - 1].id;
    if (rows.length === limit) meta.next_token = meta.oldest_id;
  }
  return { data, includes: { users, posts: [...posts.data, ...posts.includes.posts] }, meta };
}

export async function unreadCount(userId) {
  const { rows } = await query(
    `SELECT count(*)::int AS n FROM notifications
      WHERE user_id = $1 AND read_at IS NULL AND actor_id NOT IN ${hiddenAuthorsSql('$1')}`,
    [userId],
  );
  return rows[0].n;
}

/** Marca como lidas até newest_id (o que a pessoa viu na tela); sem ele, todas. */
export async function markRead(userId, newestId = null) {
  await query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL AND ($2::bigint IS NULL OR id <= $2)', [userId, newestId]);
  return { unread_count: await unreadCount(userId) };
}
