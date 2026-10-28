import { config } from '../config.js';
import { query } from '../db.js';
import { conflict, notFound } from '../lib/errors.js';
import { hashPassword } from '../lib/auth.js';
import { nextId } from '../lib/ids.js';
import { assertCanInteract, hiddenAuthorsSql } from './relations.js';
import { invalidateHomeTimeline } from './timeline.js';

export function formatUser(row) {
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    bio: row.bio,
    created_at: row.created_at,
    // Handle federado no estilo WebFinger/ActivityPub: usuario@instancia
    handle: `${row.username}@${config.instanceDomain}`,
    // Selo público, como "staff" no Mastodon: quem modera a instância é conhecido.
    is_moderator: row.is_moderator ?? false,
  };
}

const USER_COLS = 'id, username, display_name, bio, created_at, is_moderator';

export async function createUser({ username, email, password, display_name }, db = { query }) {
  const id = nextId();
  const passwordHash = await hashPassword(password);
  try {
    const { rows } = await db.query(
      `INSERT INTO users (id, username, email, password_hash, display_name)
       VALUES ($1, $2, $3, $4, $5) RETURNING ${USER_COLS}`,
      [id, username, email, passwordHash, display_name ?? username],
    );
    return formatUser(rows[0]);
  } catch (err) {
    if (err.code === '23505') throw conflict('Usuário ou e-mail já cadastrado');
    throw err;
  }
}

export async function findUserForLogin(login) {
  const { rows } = await query(
    `SELECT ${USER_COLS}, password_hash, suspended_at FROM users WHERE email = $1 OR username = $1`,
    [login],
  );
  return rows[0] ?? null;
}

export async function getUserById(id) {
  const { rows } = await query(`SELECT ${USER_COLS} FROM users WHERE id = $1`, [id]);
  if (!rows[0]) throw notFound('Usuário não encontrado');
  return formatUser(rows[0]);
}

export async function getUsersByIds(ids) {
  if (!ids.length) return [];
  const { rows } = await query(`SELECT ${USER_COLS} FROM users WHERE id = ANY($1::bigint[])`, [ids]);
  return rows.map(formatUser);
}

export async function getUserIdByUsername(username) {
  const { rows } = await query('SELECT id FROM users WHERE username = $1', [username]);
  if (!rows[0]) throw notFound('Usuário não encontrado');
  return rows[0].id;
}

export async function getProfile(username, viewerId) {
  const { rows } = await query(
    `SELECT u.${USER_COLS.split(', ').join(', u.')},
       (SELECT count(*)::int FROM follows WHERE followee_id = u.id) AS followers_count,
       (SELECT count(*)::int FROM follows WHERE follower_id = u.id) AS following_count,
       (SELECT count(*)::int FROM posts   WHERE author_id  = u.id) AS post_count,
       EXISTS (SELECT 1 FROM follows WHERE follower_id = $2 AND followee_id = u.id) AS following,
       EXISTS (SELECT 1 FROM follows WHERE follower_id = u.id AND followee_id = $2) AS followed_by,
       EXISTS (SELECT 1 FROM blocks WHERE user_id = $2 AND target_id = u.id) AS blocking,
       EXISTS (SELECT 1 FROM blocks WHERE user_id = u.id AND target_id = $2) AS blocked_by,
       EXISTS (SELECT 1 FROM mutes  WHERE user_id = $2 AND target_id = u.id) AS muting,
       u.suspended_at
     FROM users u WHERE u.username = $1`,
    [username, viewerId ?? null],
  );
  const row = rows[0];
  if (!row) throw notFound('Usuário não encontrado');
  if (row.suspended_at) throw notFound('Esta conta foi suspensa pela moderação da instância');
  return {
    ...formatUser(row),
    public_metrics: {
      followers_count: row.followers_count,
      following_count: row.following_count,
      post_count: row.post_count,
    },
    relationship: viewerId
      ? { following: row.following, followed_by: row.followed_by, blocking: row.blocking, blocked_by: row.blocked_by, muting: row.muting }
      : null,
  };
}

export async function follow(followerId, username) {
  const followeeId = await getUserIdByUsername(username);
  if (followeeId === followerId) throw conflict('Não é possível seguir a si mesmo');
  await assertCanInteract(followerId, followeeId);
  await query(
    'INSERT INTO follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [followerId, followeeId],
  );
  // A timeline materializada passa a estar incompleta: descartamos e ela é
  // reconstruída sob demanda na próxima leitura.
  await invalidateHomeTimeline(followerId);
  return { following: true };
}

export async function unfollow(followerId, username) {
  const followeeId = await getUserIdByUsername(username);
  await query('DELETE FROM follows WHERE follower_id = $1 AND followee_id = $2', [followerId, followeeId]);
  await invalidateHomeTimeline(followerId);
  return { following: false };
}

export async function listFollows(username, direction, { untilId, limit }) {
  const userId = await getUserIdByUsername(username);
  // followers: quem segue `username`; following: quem `username` segue.
  const [matchCol, otherCol] = direction === 'followers' ? ['followee_id', 'follower_id'] : ['follower_id', 'followee_id'];
  const { rows } = await query(
    `SELECT u.${USER_COLS.split(', ').join(', u.')} FROM follows f
     JOIN users u ON u.id = f.${otherCol}
     WHERE f.${matchCol} = $1 AND ($2::bigint IS NULL OR u.id < $2)
     ORDER BY u.id DESC LIMIT $3`,
    [userId, untilId, limit],
  );
  return rows.map(formatUser);
}

export async function searchUsers(q, limit = 10, viewerId = null) {
  // Busca não mostra contas suspensas nem quem tem bloqueio com quem busca.
  const { rows } = await query(
    `SELECT ${USER_COLS} FROM users
     WHERE (username ILIKE $1 OR display_name ILIKE $1)
       AND id NOT IN ${hiddenAuthorsSql('$3', { muted: false })}
     ORDER BY username LIMIT $2`,
    [`%${q.replace(/[%_\\]/g, '\\$&')}%`, limit, viewerId ?? 0],
  );
  return rows.map(formatUser);
}
