import { query } from '../db.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { cleanImage, ImageError } from '../lib/images.js';
import { nextId } from '../lib/ids.js';

export const MEDIA = {
  maxBytes: 2 * 1024 * 1024, // o app reduz para no máximo 1600 px antes de enviar: sobra folga
  maxSide: 4096,
  maxPixels: 16_000_000, // nada de imagem gigante que trave o celular de quem abre
  perPost: 4,
  pendingPerUser: 8, // enviadas e ainda sem post
  pendingHours: 24,
  altMax: 1000,
};

const urlFor = (id) => `/api/midia/${id}`;

/**
 * Recebe os bytes de uma imagem, confere e guarda já limpa. Ela fica "pendente" (sem post)
 * até ser anexada; pendentes velhas são apagadas aqui mesmo, a cada envio.
 */
export async function uploadMedia(ownerId, buf) {
  if (!buf?.length) throw badRequest('Envie a imagem no corpo do pedido');
  if (buf.length > MEDIA.maxBytes) throw badRequest(`A imagem passa de ${MEDIA.maxBytes / 1024 / 1024} MB`);
  let img;
  try {
    img = cleanImage(buf);
  } catch (err) {
    if (err instanceof ImageError) throw badRequest(err.message);
    throw err;
  }
  if (img.width > MEDIA.maxSide || img.height > MEDIA.maxSide || img.width * img.height > MEDIA.maxPixels) {
    throw badRequest(`A imagem pode ter no máximo ${MEDIA.maxSide} px de lado`);
  }
  await query(`DELETE FROM media WHERE owner_id = $1 AND post_id IS NULL AND created_at < now() - make_interval(hours => $2)`, [ownerId, MEDIA.pendingHours]);
  const { rows } = await query('SELECT count(*)::int AS n FROM media WHERE owner_id = $1 AND post_id IS NULL', [ownerId]);
  if (rows[0].n >= MEDIA.pendingPerUser) throw conflict(`Você já tem ${MEDIA.pendingPerUser} imagens enviadas esperando um post. Publique ou espere um dia.`);
  const id = nextId();
  await query('INSERT INTO media (id, owner_id, mime, bytes, size, width, height) VALUES ($1, $2, $3, $4, $5, $6, $7)', [
    id, ownerId, img.type, img.bytes, img.bytes.length, img.width, img.height,
  ]);
  return { id, url: urlFor(id), type: img.type, width: img.width, height: img.height, size: img.bytes.length };
}

/** Dentro da transação do post: anexa imagens da própria pessoa, ainda sem post, com a descrição. */
export async function attachMedia(client, ownerId, postId, items) {
  if (!items?.length) return;
  if (items.length > MEDIA.perPost) throw badRequest(`No máximo ${MEDIA.perPost} imagens por post`);
  if (new Set(items.map((m) => m.id)).size !== items.length) throw badRequest('A mesma imagem aparece duas vezes');
  for (const [position, m] of items.entries()) {
    const { rowCount } = await client.query(
      'UPDATE media SET post_id = $1, position = $2, alt = $3 WHERE id = $4 AND owner_id = $5 AND post_id IS NULL',
      [postId, position, m.alt, m.id, ownerId],
    );
    if (!rowCount) throw badRequest('Imagem não encontrada: envie de novo');
  }
}

/** Mapa postId → imagens (na ordem), para a hidratação dos posts. */
export async function mediaForPosts(postIds) {
  const map = new Map();
  if (!postIds.length) return map;
  const { rows } = await query(
    'SELECT id, post_id, mime, width, height, alt FROM media WHERE post_id = ANY($1::bigint[]) ORDER BY post_id, position',
    [postIds],
  );
  for (const r of rows) {
    if (!map.has(r.post_id)) map.set(r.post_id, []);
    map.get(r.post_id).push({ id: r.id, type: 'photo', url: urlFor(r.id), mime: r.mime, width: r.width, height: r.height, alt: r.alt });
  }
  return map;
}

/**
 * Bytes para o <img>. Só imagens de posts no ar e de contas não suspensas: post removido
 * pela moderação ou apagado leva a imagem junto. Pendente não é servida (o app mostra a
 * prévia do próprio aparelho).
 */
export async function getMediaFile(id) {
  const { rows } = await query(
    `SELECT m.mime, m.bytes FROM media m
       JOIN posts p ON p.id = m.post_id AND p.removed_at IS NULL
       JOIN users u ON u.id = p.author_id AND u.suspended_at IS NULL
      WHERE m.id = $1`,
    [id],
  );
  if (!rows[0]) throw notFound('Imagem não encontrada');
  return rows[0];
}
