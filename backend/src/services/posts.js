import { query, withTransaction } from '../db.js';
import { conflict, forbidden, notFound } from '../lib/errors.js';
import { nextId } from '../lib/ids.js';
import { extractMentions } from '../lib/text.js';
import { bus } from '../realtime/bus.js';
import { recordSignalSafely } from './interests.js';
import { fanOut } from './timeline.js';
import { getUsersByIds } from './users.js';

// ---------------------------------------------------------------------------
// Formato de saída inspirado no objeto Post da X API v2:
// { id, text, author_id, created_at, conversation_id, in_reply_to_post_id,
//   referenced_posts: [{ type: 'replied_to' | 'reposted', id }],
//   public_metrics: { like_count, reply_count, repost_count },
//   viewer: { liked, reposted } }
// Usuários e posts referenciados vão em `includes` (como as "expansions" do X),
// evitando duplicar o mesmo autor em cada item da lista.
// ---------------------------------------------------------------------------

function formatPost(row) {
  const referenced = [];
  if (row.reply_to_id) referenced.push({ type: 'replied_to', id: row.reply_to_id });
  if (row.repost_of_id) referenced.push({ type: 'reposted', id: row.repost_of_id });
  return {
    id: row.id,
    text: row.text,
    author_id: row.author_id,
    created_at: row.created_at,
    conversation_id: row.conversation_id,
    in_reply_to_post_id: row.reply_to_id,
    referenced_posts: referenced,
    public_metrics: {
      like_count: row.like_count,
      reply_count: row.reply_count,
      repost_count: row.repost_count,
      tip_count: row.tip_count ?? 0,
    },
    viewer: { liked: row.liked ?? false, reposted: row.reposted ?? false, tipped: row.tipped ?? false },
  };
}

async function fetchPostRows(ids, viewerId) {
  if (!ids.length) return [];
  const { rows } = await query(
    `SELECT p.*,
       EXISTS (SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.user_id = $2) AS liked,
       EXISTS (SELECT 1 FROM posts r WHERE r.repost_of_id = p.id AND r.author_id = $2) AS reposted,
       EXISTS (SELECT 1 FROM tips t WHERE t.post_id = p.id AND t.user_id = $2) AS tipped
     FROM posts p WHERE p.id = ANY($1::bigint[])`,
    [ids, viewerId ?? null],
  );
  return rows;
}

/**
 * Converte uma lista ordenada de IDs em { data, includes }.
 * IDs que não existem mais (posts apagados ainda presentes no cache) são ignorados.
 */
export async function hydrate(ids, viewerId) {
  const rows = await fetchPostRows(ids, viewerId);
  const byId = new Map(rows.map((r) => [r.id, formatPost(r)]));
  const data = ids.map((id) => byId.get(id)).filter(Boolean);

  // Expansão de referências (1 nível, como referenced_tweets.id no X).
  const refIds = [...new Set(data.flatMap((p) => p.referenced_posts.map((r) => r.id)))].filter((id) => !byId.has(id));
  const refRows = await fetchPostRows(refIds, viewerId);
  const includedPosts = refRows.map(formatPost);

  const authorIds = [...new Set([...data, ...includedPosts].map((p) => p.author_id))];
  const users = await getUsersByIds(authorIds);
  // Posts referenciados que já estão em `data` também precisam estar acessíveis no cliente.
  const alsoIncluded = data.filter((p) => data.some((d) => d.referenced_posts.some((r) => r.id === p.id)));
  return { data, includes: { users, posts: [...includedPosts, ...alsoIncluded] } };
}

export async function getPost(id, viewerId) {
  const result = await hydrate([id], viewerId);
  if (!result.data.length) throw notFound('Post não encontrado');
  return { data: result.data[0], includes: result.includes };
}

async function resolveMentions(client, text) {
  const usernames = extractMentions(text);
  if (!usernames.length) return [];
  const { rows } = await client.query('SELECT id FROM users WHERE lower(username::text) = ANY($1)', [usernames]);
  return rows.map((r) => r.id);
}

/** POST /api/posts — cria um post (ou reply, se reply_to_id vier preenchido). */
export async function createPost(authorId, { text, reply_to_id: replyToId = null }) {
  const id = nextId();
  const { mentionedIds, parentAuthorId } = await withTransaction(async (client) => {
    let conversationId = id; // post raiz: a conversa é ele mesmo
    let parentAuthor = null;
    if (replyToId) {
      // FOR UPDATE serializa o incremento de reply_count no post pai.
      const { rows } = await client.query(
        'SELECT conversation_id, author_id, repost_of_id FROM posts WHERE id = $1 FOR UPDATE',
        [replyToId],
      );
      if (!rows[0]) throw notFound('Post respondido não existe');
      if (rows[0].repost_of_id) throw conflict('Responda ao post original, não ao repost');
      conversationId = rows[0].conversation_id;
      parentAuthor = rows[0].author_id;
      await client.query('UPDATE posts SET reply_count = reply_count + 1 WHERE id = $1', [replyToId]);
    }
    await client.query(
      `INSERT INTO posts (id, author_id, text, reply_to_id, conversation_id) VALUES ($1, $2, $3, $4, $5)`,
      [id, authorId, text, replyToId, conversationId],
    );
    const mentioned = (await resolveMentions(client, text)).filter((uid) => uid !== authorId);
    if (mentioned.length) {
      await client.query(
        'INSERT INTO mentions (post_id, user_id) SELECT $1, unnest($2::bigint[]) ON CONFLICT DO NOTHING',
        [id, mentioned],
      );
    }
    return { mentionedIds: mentioned, parentAuthorId: parentAuthor };
  });

  const audience = await fanOut(id, authorId);
  if (replyToId) await recordSignalSafely(authorId, replyToId, 'reply');
  const post = await getPost(id, authorId);
  bus.emit('post:created', { post, audience });
  const notify = new Set(mentionedIds);
  if (parentAuthorId && parentAuthorId !== authorId) notify.add(parentAuthorId);
  if (notify.size) bus.emit('notification', { userIds: [...notify], type: replyToId ? 'reply' : 'mention', post });
  return post;
}

export async function deletePost(userId, id) {
  await withTransaction(async (client) => {
    const { rows } = await client.query('SELECT author_id, reply_to_id, repost_of_id FROM posts WHERE id = $1 FOR UPDATE', [id]);
    if (!rows[0]) throw notFound('Post não encontrado');
    if (rows[0].author_id !== userId) throw forbidden('Só o autor pode apagar o post');
    if (rows[0].reply_to_id) {
      await client.query('UPDATE posts SET reply_count = GREATEST(reply_count - 1, 0) WHERE id = $1', [rows[0].reply_to_id]);
    }
    if (rows[0].repost_of_id) {
      await client.query('UPDATE posts SET repost_count = GREATEST(repost_count - 1, 0) WHERE id = $1', [rows[0].repost_of_id]);
    }
    await client.query('DELETE FROM posts WHERE id = $1', [id]);
  });
  // O ID pode continuar em timelines no Redis; a hidratação descarta IDs inexistentes.
  bus.emit('post:deleted', { id });
}

async function assertPostExists(client, id) {
  const { rows } = await client.query('SELECT id, repost_of_id FROM posts WHERE id = $1', [id]);
  if (!rows[0]) throw notFound('Post não encontrado');
  return rows[0];
}

export async function like(userId, postId) {
  await withTransaction(async (client) => {
    await assertPostExists(client, postId);
    const { rowCount } = await client.query(
      'INSERT INTO likes (user_id, post_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [userId, postId],
    );
    if (rowCount) await client.query('UPDATE posts SET like_count = like_count + 1 WHERE id = $1', [postId]);
    return rowCount > 0;
  }).then((added) => added && recordSignalSafely(userId, postId, 'like'));
  return getPost(postId, userId);
}

export async function unlike(userId, postId) {
  await withTransaction(async (client) => {
    const { rowCount } = await client.query('DELETE FROM likes WHERE user_id = $1 AND post_id = $2', [userId, postId]);
    if (rowCount) await client.query('UPDATE posts SET like_count = GREATEST(like_count - 1, 0) WHERE id = $1', [postId]);
    return rowCount > 0;
  }).then((removed) => removed && recordSignalSafely(userId, postId, 'unlike'));
  return getPost(postId, userId);
}

/** Repost = novo post com repost_of_id. Repostar um repost reposta o original (como no X). */
export async function repost(userId, postId) {
  const id = nextId();
  const created = await withTransaction(async (client) => {
    const target = await assertPostExists(client, postId);
    const originalId = target.repost_of_id ?? target.id;
    const { rows } = await client.query('SELECT conversation_id FROM posts WHERE id = $1', [originalId]);
    const { rowCount } = await client.query(
      `INSERT INTO posts (id, author_id, text, repost_of_id, conversation_id)
       VALUES ($1, $2, '', $3, $4) ON CONFLICT DO NOTHING`,
      [id, userId, originalId, rows[0].conversation_id],
    );
    if (rowCount) await client.query('UPDATE posts SET repost_count = repost_count + 1 WHERE id = $1', [originalId]);
    return { inserted: rowCount > 0, originalId };
  });
  if (created.inserted) {
    await recordSignalSafely(userId, created.originalId, 'repost');
    const audience = await fanOut(id, userId);
    const post = await getPost(id, userId);
    bus.emit('post:created', { post, audience });
  }
  return getPost(created.originalId, userId);
}

export async function unrepost(userId, postId) {
  const originalId = await withTransaction(async (client) => {
    const target = await assertPostExists(client, postId);
    const original = target.repost_of_id ?? target.id;
    const { rowCount } = await client.query('DELETE FROM posts WHERE author_id = $1 AND repost_of_id = $2', [userId, original]);
    if (rowCount) await client.query('UPDATE posts SET repost_count = GREATEST(repost_count - 1, 0) WHERE id = $1', [original]);
    return original;
  });
  return getPost(originalId, userId);
}

/**
 * Thread completa de um post: todos os posts com o mesmo conversation_id, em ordem
 * cronológica. O cliente monta a árvore com in_reply_to_post_id.
 * (No X, o equivalente é a busca `conversation_id:<id>` na API v2.)
 */
export async function getThread(id, viewerId) {
  const { rows } = await query('SELECT conversation_id FROM posts WHERE id = $1 AND repost_of_id IS NULL', [id]);
  if (!rows[0]) throw notFound('Post não encontrado');
  const conversationId = rows[0].conversation_id;
  const { rows: idRows } = await query(
    'SELECT id FROM posts WHERE conversation_id = $1 AND repost_of_id IS NULL ORDER BY id ASC LIMIT 500',
    [conversationId],
  );
  const result = await hydrate(idRows.map((r) => r.id), viewerId);
  return { ...result, meta: { conversation_id: conversationId, focal_id: id, result_count: result.data.length } };
}
