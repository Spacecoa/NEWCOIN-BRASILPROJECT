import { query, withTransaction } from '../db.js';
import { conflict, forbidden, notFound } from '../lib/errors.js';
import { nextId } from '../lib/ids.js';
import { bus } from '../realtime/bus.js';
import { getUsersByIds } from './users.js';

// Vertente "mensageria" inspirada no Telegram:
// - kind 'channel': broadcast — só owner/admin publicam, membros leem e reagem.
// - kind 'group'  : todos os membros publicam.
// - Cada canal tem um contador `pts` (como no MTProto): toda mensagem nova incrementa
//   o pts do canal. O cliente guarda o último pts visto e, ao reconectar, chama
//   /difference?pts=N para buscar só o que perdeu (análogo a updates.getChannelDifference).

const DIFFERENCE_LIMIT = 100;

function formatChannel(row) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    kind: row.kind,
    owner_id: row.owner_id,
    pts: Number(row.pts),
    created_at: row.created_at,
    member_count: row.member_count ?? undefined,
    viewer_role: row.viewer_role ?? null,
  };
}

const CHANNEL_SELECT = `
  SELECT c.*,
    (SELECT count(*)::int FROM channel_members m WHERE m.channel_id = c.id) AS member_count,
    (SELECT role FROM channel_members m WHERE m.channel_id = c.id AND m.user_id = $1) AS viewer_role
  FROM channels c`;

export async function listChannels(viewerId) {
  const { rows } = await query(`${CHANNEL_SELECT} ORDER BY c.id DESC LIMIT 100`, [viewerId]);
  return rows.map(formatChannel);
}

export async function getChannel(slug, viewerId) {
  const { rows } = await query(`${CHANNEL_SELECT} WHERE c.slug = $2`, [viewerId, slug]);
  if (!rows[0]) throw notFound('Canal não encontrado');
  return formatChannel(rows[0]);
}

export async function createChannel(ownerId, { slug, title, description = '', kind }) {
  const id = nextId();
  try {
    await withTransaction(async (client) => {
      await client.query(
        'INSERT INTO channels (id, slug, title, description, kind, owner_id) VALUES ($1, $2, $3, $4, $5, $6)',
        [id, slug, title, description, kind, ownerId],
      );
      await client.query("INSERT INTO channel_members (channel_id, user_id, role) VALUES ($1, $2, 'owner')", [id, ownerId]);
    });
  } catch (err) {
    if (err.code === '23505') throw conflict('Já existe um canal com esse identificador');
    throw err;
  }
  return getChannel(slug, ownerId);
}

export async function joinChannel(userId, slug) {
  const channel = await getChannel(slug, userId);
  await query(
    "INSERT INTO channel_members (channel_id, user_id, role) VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING",
    [channel.id, userId],
  );
  return getChannel(slug, userId);
}

export async function leaveChannel(userId, slug) {
  const channel = await getChannel(slug, userId);
  if (channel.viewer_role === 'owner') throw conflict('O dono não pode sair do próprio canal');
  await query('DELETE FROM channel_members WHERE channel_id = $1 AND user_id = $2', [channel.id, userId]);
  return getChannel(slug, userId);
}

export async function setMemberRole(actorId, slug, username, role) {
  const channel = await getChannel(slug, actorId);
  if (channel.viewer_role !== 'owner') throw forbidden('Só o dono pode promover administradores');
  const { rowCount } = await query(
    `UPDATE channel_members SET role = $3
     WHERE channel_id = $1 AND user_id = (SELECT id FROM users WHERE username = $2) AND role <> 'owner'`,
    [channel.id, username, role],
  );
  if (!rowCount) throw notFound('Membro não encontrado');
  return { username, role };
}

function canPost(channel) {
  if (!channel.viewer_role) return false;
  return channel.kind === 'group' || channel.viewer_role !== 'member';
}

async function reactionsFor(messageIds, viewerId) {
  if (!messageIds.length) return new Map();
  const { rows } = await query(
    `SELECT message_id, emoji, count(*)::int AS count, bool_or(user_id = $2) AS reacted
     FROM message_reactions WHERE message_id = ANY($1::bigint[])
     GROUP BY message_id, emoji ORDER BY min(created_at)`,
    [messageIds, viewerId ?? null],
  );
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.message_id)) map.set(r.message_id, []);
    map.get(r.message_id).push({ emoji: r.emoji, count: r.count, reacted: r.reacted });
  }
  return map;
}

async function present(rows, viewerId) {
  const reactions = await reactionsFor(rows.map((r) => r.id), viewerId);
  const data = rows.map((r) => ({
    id: r.id,
    channel_id: r.channel_id,
    author_id: r.author_id,
    text: r.text,
    pts: Number(r.pts),
    created_at: r.created_at,
    reactions: reactions.get(r.id) ?? [],
  }));
  const users = await getUsersByIds([...new Set(data.map((m) => m.author_id))]);
  return { data, includes: { users } };
}

/** Histórico paginado (mais recentes primeiro) — análogo a messages.getHistory(offset_id, limit). */
export async function listMessages(slug, viewerId, { sinceId, untilId, limit }) {
  const channel = await getChannel(slug, viewerId);
  const { rows } = await query(
    `SELECT * FROM messages WHERE channel_id = $1
       AND ($2::bigint IS NULL OR id > $2) AND ($3::bigint IS NULL OR id < $3)
     ORDER BY id DESC LIMIT $4`,
    [channel.id, sinceId, untilId, limit],
  );
  const result = await present(rows, viewerId);
  return { ...result, meta: { result_count: rows.length, pts: channel.pts, next_token: rows.length === limit ? rows.at(-1).id : undefined } };
}

/** Mensagens com pts > N, em ordem crescente — análogo a updates.getChannelDifference. */
export async function getDifference(slug, viewerId, fromPts) {
  const channel = await getChannel(slug, viewerId);
  const { rows } = await query(
    'SELECT * FROM messages WHERE channel_id = $1 AND pts > $2 ORDER BY pts ASC LIMIT $3',
    [channel.id, fromPts, DIFFERENCE_LIMIT],
  );
  const result = await present(rows, viewerId);
  // too_long: a lacuna é grande demais; o cliente deve recarregar o histórico do zero
  // (o Telegram responde updates.channelDifferenceTooLong no mesmo caso).
  const tooLong = channel.pts - fromPts > DIFFERENCE_LIMIT;
  return { ...result, meta: { pts: channel.pts, too_long: tooLong } };
}

export async function postMessage(userId, slug, text) {
  const channel = await getChannel(slug, userId);
  if (!channel.viewer_role) throw forbidden('Entre no canal para participar');
  if (!canPost(channel)) throw forbidden('Neste canal só administradores publicam');
  const id = nextId();
  const row = await withTransaction(async (client) => {
    // O UPDATE trava a linha do canal, garantindo pts sequencial e sem buracos.
    const { rows } = await client.query('UPDATE channels SET pts = pts + 1 WHERE id = $1 RETURNING pts', [channel.id]);
    const { rows: msg } = await client.query(
      'INSERT INTO messages (id, channel_id, author_id, text, pts) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [id, channel.id, userId, text, rows[0].pts],
    );
    return msg[0];
  });
  const result = await present([row], userId);
  const message = { data: result.data[0], includes: result.includes };
  bus.emit('message:created', { channelId: channel.id, message });
  return message;
}

async function messageInChannel(slug, messageId, userId) {
  const channel = await getChannel(slug, userId);
  const { rows } = await query('SELECT id FROM messages WHERE id = $1 AND channel_id = $2', [messageId, channel.id]);
  if (!rows[0]) throw notFound('Mensagem não encontrada');
  if (!channel.viewer_role) throw forbidden('Entre no canal para reagir');
  return channel;
}

async function emitReactions(channelId, messageId, userId) {
  const reactions = (await reactionsFor([messageId], userId)).get(messageId) ?? [];
  // O payload em tempo real não carrega "reacted" (é por usuário); clientes mantêm o próprio estado.
  bus.emit('message:reactions', {
    channelId,
    messageId,
    reactions: reactions.map(({ emoji, count }) => ({ emoji, count })),
  });
  return { message_id: messageId, reactions };
}

export async function addReaction(userId, slug, messageId, emoji) {
  const channel = await messageInChannel(slug, messageId, userId);
  await query(
    'INSERT INTO message_reactions (message_id, user_id, emoji) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
    [messageId, userId, emoji],
  );
  return emitReactions(channel.id, messageId, userId);
}

export async function removeReaction(userId, slug, messageId, emoji) {
  const channel = await messageInChannel(slug, messageId, userId);
  await query('DELETE FROM message_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3', [messageId, userId, emoji]);
  return emitReactions(channel.id, messageId, userId);
}
