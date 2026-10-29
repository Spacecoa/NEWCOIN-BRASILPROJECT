import { query, withTransaction } from '../db.js';
import { conflict, forbidden, notFound } from '../lib/errors.js';
import { invalidateHomeTimeline } from './timeline.js';

// Silenciar e bloquear.
//
//  - Silenciar (mutes): privado e de mão única. Quem silenciou deixa de ver os posts da
//    pessoa nos feeds, nas menções e nas notificações. Ainda pode abrir o perfil dela
//    de propósito. A outra pessoa não é avisada e nada muda para ela.
//  - Bloquear (blocks): vale nos dois sentidos. Nenhum dos dois vê os posts do outro,
//    os follows entre eles são desfeitos e não podem ser refeitos, e ninguém consegue
//    responder, curtir, repostar ou recompensar o outro.
//  - Contas suspensas pela moderação somem para todo mundo.
//
// Os filtros são aplicados num só lugar (hydrate, em posts.js) e nas consultas que
// sugerem pessoas ou posts (feed "Para você", missões, busca).

/**
 * SQL com os ids de autores que `viewer` não deve ver. `param` é o placeholder do id
 * de quem está vendo (ex.: '$1'). Com muted=false, só bloqueios e suspensões.
 */
export function hiddenAuthorsSql(param, { muted = true } = {}) {
  return `(
    ${muted ? `SELECT target_id FROM mutes WHERE user_id = ${param} UNION ALL` : ''}
    SELECT target_id FROM blocks WHERE user_id = ${param}
    UNION ALL SELECT user_id FROM blocks WHERE target_id = ${param}
    UNION ALL SELECT id FROM users WHERE suspended_at IS NOT NULL
  )`;
}

/** Conjunto de autores escondidos para quem está vendo (anônimo: só suspensos). */
export async function hiddenAuthors(viewerId, { muted = true } = {}) {
  if (!viewerId) {
    const { rows } = await query('SELECT id FROM users WHERE suspended_at IS NOT NULL');
    return new Set(rows.map((r) => r.id));
  }
  const { rows } = await query(`SELECT DISTINCT target_id AS id FROM ${hiddenAuthorsSql('$1', { muted })} AS h(target_id)`, [viewerId]);
  return new Set(rows.map((r) => r.id));
}

/** true se um dos dois bloqueou o outro. */
export async function isBlockedEitherWay(a, b, db = { query }) {
  if (!a || !b || a === b) return false;
  const { rows } = await db.query(
    'SELECT 1 FROM blocks WHERE (user_id = $1 AND target_id = $2) OR (user_id = $2 AND target_id = $1) LIMIT 1',
    [a, b],
  );
  return rows.length > 0;
}

/**
 * Recusa interagir (seguir, responder, curtir, repostar, recompensar, reagir) com quem tem
 * bloqueio ou com conta suspensa. A suspensa some para todos: interagir pelo ID direto
 * não pode continuar funcionando (antes, uma recompensa saía da carteira; docs/14, T-1).
 */
export async function assertCanInteract(actorId, otherId, db = { query }) {
  if (otherId && otherId !== actorId) {
    const { rows } = await db.query('SELECT suspended_at IS NOT NULL AS suspended FROM users WHERE id = $1', [otherId]);
    if (rows[0]?.suspended) throw notFound('Esta conta foi suspensa pela moderação da instância');
  }
  if (await isBlockedEitherWay(actorId, otherId, db)) throw forbidden('Não é possível interagir com esta conta');
}

/** De uma lista de destinatários, tira quem silenciou ou tem bloqueio com o autor. */
export async function filterAudience(authorId, userIds) {
  if (!userIds.length) return userIds;
  const { rows } = await query(
    `SELECT unnest($2::bigint[]) AS id
     EXCEPT (SELECT user_id FROM mutes WHERE target_id = $1
             UNION SELECT user_id FROM blocks WHERE target_id = $1
             UNION SELECT target_id FROM blocks WHERE user_id = $1)`,
    [authorId, userIds],
  );
  const keep = new Set(rows.map((r) => r.id));
  return userIds.filter((id) => keep.has(id));
}

async function targetId(actorId, username) {
  const { rows } = await query('SELECT id FROM users WHERE username = $1', [username]);
  if (!rows[0]) throw notFound('Usuário não encontrado');
  if (rows[0].id === actorId) throw conflict('Não é possível fazer isso com a própria conta');
  return rows[0].id;
}

export async function mute(userId, username) {
  const id = await targetId(userId, username);
  await query('INSERT INTO mutes (user_id, target_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [userId, id]);
  return { muting: true };
}

export async function unmute(userId, username) {
  const id = await targetId(userId, username);
  await query('DELETE FROM mutes WHERE user_id = $1 AND target_id = $2', [userId, id]);
  return { muting: false };
}

export async function block(userId, username) {
  const id = await targetId(userId, username);
  await withTransaction(async (c) => {
    await c.query('INSERT INTO blocks (user_id, target_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [userId, id]);
    // Bloquear desfaz os follows nos dois sentidos (como no X).
    await c.query(
      'DELETE FROM follows WHERE (follower_id = $1 AND followee_id = $2) OR (follower_id = $2 AND followee_id = $1)',
      [userId, id],
    );
  });
  // As timelines materializadas dos dois podem ter posts um do outro.
  await Promise.all([invalidateHomeTimeline(userId), invalidateHomeTimeline(id)]);
  return { blocking: true };
}

export async function unblock(userId, username) {
  const id = await targetId(userId, username);
  await query('DELETE FROM blocks WHERE user_id = $1 AND target_id = $2', [userId, id]);
  return { blocking: false };
}

/** Listas para a tela "Bloqueados e silenciados". */
export async function listRelations(userId, kind) {
  const table = kind === 'blocks' ? 'blocks' : 'mutes';
  const { rows } = await query(
    `SELECT u.id, u.username, u.display_name, r.created_at AS since FROM ${table} r
     JOIN users u ON u.id = r.target_id WHERE r.user_id = $1 ORDER BY r.created_at DESC LIMIT 500`,
    [userId],
  );
  return rows;
}

/** Relação de quem está vendo com cada autor: bloqueio (qualquer lado), silêncio e suspensão. */
export async function viewerRelations(viewerId, authorIds) {
  const ids = [...new Set(authorIds)].filter(Boolean);
  const out = { blocked: new Set(), muted: new Set(), suspended: new Set() };
  if (!ids.length) return out;
  const { rows } = await query(
    `SELECT u.id, u.suspended_at IS NOT NULL AS suspended,
       EXISTS (SELECT 1 FROM blocks b WHERE (b.user_id = $2 AND b.target_id = u.id) OR (b.user_id = u.id AND b.target_id = $2)) AS blocked,
       EXISTS (SELECT 1 FROM mutes m WHERE m.user_id = $2 AND m.target_id = u.id) AS muted
     FROM users u WHERE u.id = ANY($1::bigint[])`,
    [ids, viewerId ?? 0],
  );
  for (const r of rows) {
    if (r.suspended) out.suspended.add(r.id);
    if (r.blocked) out.blocked.add(r.id);
    if (r.muted) out.muted.add(r.id);
  }
  return out;
}

/** Para o tempo real: quem tem bloqueio com o autor (qualquer lado) e quem o silenciou. */
export async function authorRelations(authorId) {
  const { rows } = await query(
    `SELECT target_id AS id, 'blocked' AS kind FROM blocks WHERE user_id = $1
     UNION SELECT user_id, 'blocked' FROM blocks WHERE target_id = $1
     UNION SELECT user_id, 'muted' FROM mutes WHERE target_id = $1`,
    [authorId],
  );
  const blocked = new Set(rows.filter((r) => r.kind === 'blocked').map((r) => r.id));
  const muted = new Set(rows.filter((r) => r.kind === 'muted' && !blocked.has(r.id)).map((r) => r.id));
  return { blocked, muted };
}
