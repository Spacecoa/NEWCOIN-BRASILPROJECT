import { query, withTransaction } from '../db.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { nextId } from '../lib/ids.js';
import { deletePost } from './posts.js';
import { revokeAllSessions } from './sessions.js';

// Denúncias e a fila da moderação da instância.
//
// Quem denuncia escolhe um motivo e pode explicar. A denúncia vai para a fila de quem
// modera a instância (users.is_moderator), que decide uma de três coisas:
//   arquivar      — não viola as regras; nada acontece com a conta denunciada;
//   remover_post  — o post sai do ar (para todos);
//   suspender     — a conta não entra mais e some para todos; as sessões caem na hora.
// Toda decisão fica registrada (quem, quando, nota) e quem denunciou vê o resultado.
// A pessoa denunciada nunca vê quem a denunciou.

export const REASONS = {
  spam: 'Spam ou propaganda repetitiva',
  assedio: 'Assédio ou ataque a uma pessoa',
  odio: 'Discurso de ódio ou discriminação',
  violencia: 'Ameaça ou incentivo à violência',
  golpe: 'Golpe, fraude ou se passar por outra pessoa',
  outro: 'Outro motivo (explique)',
};

export const ACTIONS = ['arquivar', 'remover_post', 'suspender'];

/** Cria uma denúncia de um post (post_id) ou de uma conta (username). */
export async function createReport(reporterId, { post_id: postId, username, reason, details = '' }) {
  if (reason === 'outro' && !details.trim()) throw badRequest('Explique o motivo da denúncia');
  let targetUserId;
  let postText = null;
  if (postId) {
    const { rows } = await query(
      `SELECT p.id, COALESCE(o.id, p.id) AS original_id, COALESCE(o.author_id, p.author_id) AS author_id,
              COALESCE(o.text, p.text) AS text
         FROM posts p LEFT JOIN posts o ON o.id = p.repost_of_id WHERE p.id = $1`,
      [postId],
    );
    if (!rows[0]) throw notFound('Post não encontrado');
    // Denunciar um repost é denunciar o original.
    postId = rows[0].original_id;
    targetUserId = rows[0].author_id;
    postText = rows[0].text;
  } else {
    const { rows } = await query('SELECT id FROM users WHERE username = $1', [username]);
    if (!rows[0]) throw notFound('Usuário não encontrado');
    targetUserId = rows[0].id;
  }
  if (targetUserId === reporterId) throw conflict('Não é possível denunciar a própria conta ou post');
  const id = nextId();
  try {
    await query(
      `INSERT INTO reports (id, reporter_id, target_user_id, post_id, post_text, reason, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, reporterId, targetUserId, postId ?? null, postText, reason, details.trim()],
    );
  } catch (err) {
    if (err.code === '23505') throw conflict('Você já denunciou isto. A moderação vai analisar.');
    throw err;
  }
  return { id, status: 'aberta' };
}

const REPORT_COLS = `r.id, r.reason, r.details, r.status, r.resolution, r.resolution_note, r.created_at, r.resolved_at,
  r.post_id, r.post_text, t.username AS target_username, t.display_name AS target_display_name`;

/** Denúncias feitas pela pessoa, com o andamento (sem dizer quem da moderação decidiu). */
export async function myReports(reporterId) {
  const { rows } = await query(
    `SELECT ${REPORT_COLS} FROM reports r JOIN users t ON t.id = r.target_user_id
     WHERE r.reporter_id = $1 ORDER BY r.id DESC LIMIT 100`,
    [reporterId],
  );
  return rows;
}

/** Só confia no banco (não no token): tirar o papel de alguém vale no próximo pedido. */
export async function assertModerator(userId) {
  const { rows } = await query('SELECT is_moderator FROM users WHERE id = $1', [userId]);
  if (!rows[0]?.is_moderator) throw forbidden('Apenas a moderação da instância');
}

/** Fila da moderação. Mostra quantas denúncias abertas a mesma conta acumula. */
export async function listQueue(status = 'aberta') {
  const { rows } = await query(
    `SELECT ${REPORT_COLS}, rep.username AS reporter_username, mod.username AS resolved_by_username,
       (t.suspended_at IS NOT NULL) AS target_suspended,
       (r.post_id IS NOT NULL AND EXISTS (SELECT 1 FROM posts p WHERE p.id = r.post_id)) AS post_exists,
       (SELECT count(*)::int FROM reports o WHERE o.target_user_id = r.target_user_id AND o.status = 'aberta') AS open_against_target
     FROM reports r
     JOIN users t ON t.id = r.target_user_id
     JOIN users rep ON rep.id = r.reporter_id
     LEFT JOIN users mod ON mod.id = r.resolved_by
     WHERE r.status = $1 ORDER BY r.id ${status === 'aberta' ? 'ASC' : 'DESC'} LIMIT 200`,
    [status],
  );
  return rows;
}

/** Decide uma denúncia. Remover ou suspender também resolve as outras denúncias abertas do mesmo alvo. */
export async function resolveReport(moderatorId, reportId, { action, note = '' }) {
  await assertModerator(moderatorId);
  const { rows } = await query(
    `SELECT r.*, t.is_moderator AS target_is_moderator FROM reports r JOIN users t ON t.id = r.target_user_id WHERE r.id = $1`,
    [reportId],
  );
  const report = rows[0];
  if (!report) throw notFound('Denúncia não encontrada');
  if (report.status !== 'aberta') throw conflict('Esta denúncia já foi decidida');

  const close = (c, where, params, status) =>
    c.query(
      `UPDATE reports SET status = '${status}', resolution = $${params.length + 1}, resolution_note = $${params.length + 2},
         resolved_by = $${params.length + 3}, resolved_at = now()
       WHERE status = 'aberta' AND ${where}`,
      [...params, action, note.trim() || null, moderatorId],
    );

  if (action === 'arquivar') {
    await withTransaction((c) => close(c, 'id = $1', [reportId], 'arquivada'));
  } else if (action === 'remover_post') {
    if (!report.post_id) throw conflict('Esta denúncia não tem post para remover (ou ele já foi apagado)');
    // Guarda antes quais denúncias são deste post: ao apagá-lo, post_id vira NULL (ON DELETE SET NULL).
    const { rows: same } = await query("SELECT id FROM reports WHERE post_id = $1 AND status = 'aberta'", [report.post_id]);
    await deletePost(moderatorId, report.post_id, { byModerator: true });
    await withTransaction((c) => close(c, 'id = ANY($1::bigint[])', [same.map((r) => r.id)], 'acatada'));
  } else if (action === 'suspender') {
    if (report.target_user_id === moderatorId) throw conflict('Não é possível suspender a própria conta');
    if (report.target_is_moderator) throw conflict('Contas da moderação não podem ser suspensas por aqui');
    await withTransaction(async (c) => {
      await c.query('UPDATE users SET suspended_at = now(), suspension_reason = $2 WHERE id = $1', [
        report.target_user_id,
        note.trim() || REASONS[report.reason],
      ]);
      await close(c, 'target_user_id = $1', [report.target_user_id], 'acatada');
    });
    await revokeAllSessions(report.target_user_id);
  } else {
    throw badRequest('Ação desconhecida');
  }
  const { rows: out } = await query(`SELECT ${REPORT_COLS} FROM reports r JOIN users t ON t.id = r.target_user_id WHERE r.id = $1`, [reportId]);
  return out[0];
}

/** Desfaz uma suspensão (a decisão também pode ser revista). */
export async function unsuspend(moderatorId, username) {
  await assertModerator(moderatorId);
  const { rowCount } = await query(
    'UPDATE users SET suspended_at = NULL, suspension_reason = NULL WHERE username = $1 AND suspended_at IS NOT NULL',
    [username],
  );
  if (!rowCount) throw notFound('Não há conta suspensa com esse nome');
  return { suspended: false };
}

/** Promove as contas listadas em MODERATORS (lista separada por vírgulas) ao iniciar. */
export async function promoteModerators(usernames) {
  if (!usernames.length) return 0;
  const { rowCount } = await query('UPDATE users SET is_moderator = true WHERE username = ANY($1) AND NOT is_moderator', [usernames]);
  return rowCount;
}
