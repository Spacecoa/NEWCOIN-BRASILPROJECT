import { query, withTransaction } from '../db.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { nextId } from '../lib/ids.js';
import { extractMentions } from '../lib/text.js';
import { bus } from '../realtime/bus.js';
import { notify, retract } from './notifications.js';
import { assertCanInteract, filterAudience, hiddenAuthors } from './relations.js';
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
     FROM posts p WHERE p.id = ANY($1::bigint[]) AND p.removed_at IS NULL`,
    [ids, viewerId ?? null],
  );
  return rows;
}

/**
 * Converte uma lista ordenada de IDs em { data, includes }.
 * IDs que não existem mais (posts apagados ainda presentes no cache) são ignorados.
 *
 * É aqui que a moderação pessoal vale para todas as listas: somem os posts (e reposts)
 * de quem tem bloqueio com quem está vendo, de contas suspensas e, por padrão, de quem
 * a pessoa silenciou. Com { muted: false } os silenciados aparecem: é o caso de abrir
 * de propósito o perfil, a thread ou um post específico.
 */
export async function hydrate(ids, viewerId, { muted = true } = {}) {
  const [rows, hidden] = await Promise.all([fetchPostRows(ids, viewerId), hiddenAuthors(viewerId, { muted })]);
  const byId = new Map(rows.map((r) => [r.id, formatPost(r)]));
  let data = ids.map((id) => byId.get(id)).filter((p) => p && !hidden.has(p.author_id));

  // Expansão de referências (1 nível, como referenced_tweets.id no X).
  const refIds = [...new Set(data.flatMap((p) => p.referenced_posts.map((r) => r.id)))].filter((id) => !byId.has(id));
  const refRows = await fetchPostRows(refIds, viewerId);
  const allRefs = refRows.map(formatPost);
  const hiddenRef = new Set(allRefs.filter((p) => hidden.has(p.author_id)).map((p) => p.id));
  // Repost de quem está escondido também some; respostas ficam, mas sem o post de origem.
  data = data.filter((p) => !p.referenced_posts.some((r) => r.type === 'reposted' && (hiddenRef.has(r.id) || hidden.has(byId.get(r.id)?.author_id))));
  const includedPosts = allRefs.filter((p) => !hiddenRef.has(p.id));

  const authorIds = [...new Set([...data, ...includedPosts].map((p) => p.author_id))];
  const users = await getUsersByIds(authorIds);
  // Posts referenciados que já estão em `data` também precisam estar acessíveis no cliente.
  const alsoIncluded = data.filter((p) => data.some((d) => d.referenced_posts.some((r) => r.id === p.id)));
  return { data, includes: { users, posts: [...includedPosts, ...alsoIncluded] } };
}

export async function getPost(id, viewerId) {
  const result = await hydrate([id], viewerId, { muted: false });
  if (!result.data.length) throw notFound('Post não encontrado');
  return { data: result.data[0], includes: result.includes };
}

async function resolveMentions(client, text) {
  const usernames = extractMentions(text);
  if (!usernames.length) return [];
  const { rows } = await client.query('SELECT id FROM users WHERE lower(username::text) = ANY($1)', [usernames]);
  return rows.map((r) => r.id);
}

// Cada menção vira notificação: sem teto, um post alcançaria ~50 pessoas (docs/14, P-1).
export const MAX_MENTIONS = 10;

/** POST /api/posts — cria um post (ou reply, se reply_to_id vier preenchido). */
export async function createPost(authorId, { text, reply_to_id: replyToId = null }) {
  if (extractMentions(text).length > MAX_MENTIONS) throw badRequest(`Mencione no máximo ${MAX_MENTIONS} pessoas por post`);
  const id = nextId();
  const { mentionedIds, parentAuthorId } = await withTransaction(async (client) => {
    let conversationId = id; // post raiz: a conversa é ele mesmo
    let parentAuthor = null;
    if (replyToId) {
      // FOR UPDATE serializa o incremento de reply_count no post pai.
      const { rows } = await client.query(
        'SELECT conversation_id, author_id, repost_of_id FROM posts WHERE id = $1 AND removed_at IS NULL FOR UPDATE',
        [replyToId],
      );
      if (!rows[0]) throw notFound('Post respondido não existe');
      if (rows[0].repost_of_id) throw conflict('Responda ao post original, não ao repost');
      await assertCanInteract(authorId, rows[0].author_id, client);
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

  // Quem silenciou ou tem bloqueio com o autor não recebe o aviso em tempo real nem notificação.
  const audience = await filterAudience(authorId, await fanOut(id, authorId));
  const post = await getPost(id, authorId);
  bus.emit('post:created', { post, audience });
  // Quem foi respondido recebe "respondeu"; os demais citados, "mencionou" (um aviso por pessoa).
  if (parentAuthorId) await notify({ kind: 'reply', actorId: authorId, userIds: [parentAuthorId], postId: id, post });
  await notify({ kind: 'mention', actorId: authorId, userIds: mentionedIds.filter((uid) => uid !== parentAuthorId), postId: id, post });
  return post;
}

/**
 * Apaga um post (só o autor). A moderação não apaga: esconde (removed_at), para poder desfazer.
 *
 * Post já removido pela moderação ou com denúncia em aberto não é apagado de vez: sai do ar
 * para todos (removed_at) e fica marcado como apagado pelo autor, para a moderação ainda
 * poder decidir e a prova não sumir (docs/14, M-3). Um recurso aceito não o traz de volta.
 */
export async function deletePost(userId, id) {
  await withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT author_id, reply_to_id, repost_of_id, removed_at, deleted_by_author_at,
              EXISTS (SELECT 1 FROM reports r WHERE r.post_id = posts.id AND r.status = 'aberta') AS under_review
         FROM posts WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (!rows[0] || rows[0].deleted_by_author_at) throw notFound('Post não encontrado');
    if (rows[0].author_id !== userId) throw forbidden('Só o autor pode apagar o post');
    if (rows[0].removed_at || rows[0].under_review) {
      await client.query('UPDATE posts SET removed_at = COALESCE(removed_at, now()), deleted_by_author_at = now() WHERE id = $1', [id]);
      return;
    }
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

/** Confere que o post existe e que quem age pode interagir com o autor do original. */
async function assertPostExists(client, id, actorId) {
  const { rows } = await client.query(
    `SELECT p.id, p.repost_of_id, COALESCE(o.author_id, p.author_id) AS original_author
       FROM posts p LEFT JOIN posts o ON o.id = p.repost_of_id
      WHERE p.id = $1 AND p.removed_at IS NULL AND o.removed_at IS NULL`,
    [id],
  );
  if (!rows[0]) throw notFound('Post não encontrado');
  if (actorId) await assertCanInteract(actorId, rows[0].original_author, client);
  return rows[0];
}

export async function like(userId, postId) {
  const liked = await withTransaction(async (client) => {
    const target = await assertPostExists(client, postId, userId);
    const { rowCount } = await client.query(
      'INSERT INTO likes (user_id, post_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [userId, postId],
    );
    if (rowCount) await client.query('UPDATE posts SET like_count = like_count + 1 WHERE id = $1', [postId]);
    return rowCount > 0 ? target.original_author : null;
  });
  if (liked) await notify({ kind: 'like', actorId: userId, userIds: [liked], postId });
  return getPost(postId, userId);
}

export async function unlike(userId, postId) {
  await withTransaction(async (client) => {
    const { rowCount } = await client.query('DELETE FROM likes WHERE user_id = $1 AND post_id = $2', [userId, postId]);
    if (rowCount) await client.query('UPDATE posts SET like_count = GREATEST(like_count - 1, 0) WHERE id = $1', [postId]);
    return rowCount > 0;
  });
  await retract({ kind: 'like', actorId: userId, postId });
  return getPost(postId, userId);
}

/** Repost = novo post com repost_of_id. Repostar um repost reposta o original (como no X). */
export async function repost(userId, postId) {
  const id = nextId();
  const created = await withTransaction(async (client) => {
    const target = await assertPostExists(client, postId, userId);
    const originalId = target.repost_of_id ?? target.id;
    const { rows } = await client.query('SELECT conversation_id FROM posts WHERE id = $1', [originalId]);
    const { rowCount } = await client.query(
      `INSERT INTO posts (id, author_id, text, repost_of_id, conversation_id)
       VALUES ($1, $2, '', $3, $4) ON CONFLICT DO NOTHING`,
      [id, userId, originalId, rows[0].conversation_id],
    );
    if (rowCount) await client.query('UPDATE posts SET repost_count = repost_count + 1 WHERE id = $1', [originalId]);
    return { inserted: rowCount > 0, originalId, originalAuthor: target.original_author };
  });
  if (created.inserted) {
    const audience = await filterAudience(userId, await fanOut(id, userId));
    const post = await getPost(id, userId);
    bus.emit('post:created', { post, audience });
    await notify({ kind: 'repost', actorId: userId, userIds: [created.originalAuthor], postId: created.originalId });
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
  await retract({ kind: 'repost', actorId: userId, postId: originalId });
  return getPost(originalId, userId);
}

/**
 * Thread completa de um post: todos os posts com o mesmo conversation_id, em ordem
 * cronológica. O cliente monta a árvore com in_reply_to_post_id.
 * (No X, o equivalente é a busca `conversation_id:<id>` na API v2.)
 */
export async function getThread(id, viewerId) {
  const { rows } = await query('SELECT conversation_id FROM posts WHERE id = $1 AND repost_of_id IS NULL AND removed_at IS NULL', [id]);
  if (!rows[0]) throw notFound('Post não encontrado');
  const conversationId = rows[0].conversation_id;
  const { rows: idRows } = await query(
    'SELECT id FROM posts WHERE conversation_id = $1 AND repost_of_id IS NULL ORDER BY id ASC LIMIT 500',
    [conversationId],
  );
  // Quem abre uma thread de propósito vê também os silenciados; bloqueios continuam valendo.
  const result = await hydrate(idRows.map((r) => r.id), viewerId, { muted: false });
  return { ...result, meta: { conversation_id: conversationId, focal_id: id, result_count: result.data.length } };
}
