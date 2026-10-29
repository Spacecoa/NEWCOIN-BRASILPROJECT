import { query, withTransaction } from '../db.js';
import { badRequest, conflict, forbidden, notFound, unauthorized } from '../lib/errors.js';
import { nextId } from '../lib/ids.js';
import { checkPassword, dummyHash } from '../lib/auth.js';
import { bus } from '../realtime/bus.js';
import { getActiveRule } from './rules.js';
import { revokeAllSessions } from './sessions.js';

// Denúncias e a fila da moderação da instância.
//
// Quem denuncia escolhe um motivo e pode explicar. A denúncia vai para a fila de quem
// modera a instância (users.is_moderator), que decide uma de três coisas:
//   arquivar      — não viola as regras; nada acontece com a conta denunciada;
//   remover_post  — o post sai do ar (para todos);
//   suspender     — a conta não entra mais e some para todos; as sessões caem na hora.
// Remover e suspender exigem citar uma regra da instância (services/rules.js) e geram
// uma "sanção" que a pessoa afetada vê e pode contestar uma vez (recurso).
// Toda decisão fica registrada (quem, quando, regra, nota) e quem denunciou vê o resultado.
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
  r.post_id, r.post_text, t.username AS target_username, t.display_name AS target_display_name,
  (SELECT json_build_object('id', ru.id::text, 'position', ru.position, 'title', ru.title) FROM instance_rules ru WHERE ru.id = r.rule_id) AS rule`;

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

/**
 * Quem decide não deveria ser parte: a própria denúncia, ou o recurso contra a própria
 * decisão (docs/14, M-4). Só vale quando há outra pessoa ativa na moderação; numa
 * instância com uma pessoa só, ela continua decidindo (senão nada andaria).
 */
async function assertNotOwnCase(moderatorId, partyId, what) {
  if (String(partyId) !== String(moderatorId)) return;
  const { rows } = await query('SELECT 1 FROM users WHERE is_moderator AND suspended_at IS NULL AND id <> $1 LIMIT 1', [moderatorId]);
  if (rows.length) throw forbidden(`Outra pessoa da moderação precisa decidir ${what}`);
}

/** Fila da moderação. Mostra quantas denúncias abertas a mesma conta acumula. */
export async function listQueue(status = 'aberta') {
  const { rows } = await query(
    `SELECT ${REPORT_COLS}, rep.username AS reporter_username, mod.username AS resolved_by_username,
       (t.suspended_at IS NOT NULL) AS target_suspended,
       (r.post_id IS NOT NULL AND EXISTS (SELECT 1 FROM posts p WHERE p.id = r.post_id AND (p.removed_at IS NULL OR p.deleted_by_author_at IS NOT NULL))) AS post_exists,
       (r.post_id IS NOT NULL AND EXISTS (SELECT 1 FROM posts p WHERE p.id = r.post_id AND p.deleted_by_author_at IS NOT NULL)) AS post_deleted_by_author,
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
export async function resolveReport(moderatorId, reportId, { action, note = '', rule_id: ruleId = null }) {
  await assertModerator(moderatorId);
  // Tirar conteúdo do ar ou suspender alguém precisa dizer qual regra foi quebrada.
  const rule = action === 'arquivar' ? null : ruleId ? await getActiveRule(ruleId) : null;
  if (action !== 'arquivar' && !rule) throw badRequest('Cite a regra da instância que foi quebrada');
  const { rows } = await query(
    `SELECT r.*, t.is_moderator AS target_is_moderator FROM reports r JOIN users t ON t.id = r.target_user_id WHERE r.id = $1`,
    [reportId],
  );
  const report = rows[0];
  if (!report) throw notFound('Denúncia não encontrada');
  if (report.status !== 'aberta') throw conflict('Esta denúncia já foi decidida');
  await assertNotOwnCase(moderatorId, report.reporter_id, 'uma denúncia feita por você');

  const close = (c, where, params, status) =>
    c.query(
      `UPDATE reports SET status = '${status}', resolution = $${params.length + 1}, resolution_note = $${params.length + 2},
         resolved_by = $${params.length + 3}, resolved_at = now(), rule_id = $${params.length + 4}
       WHERE status = 'aberta' AND ${where}`,
      [...params, action, note.trim() || null, moderatorId, rule?.id ?? null],
    );
  const sanction = (c, kind, postId, postText) =>
    c.query(
      `INSERT INTO sanctions (id, user_id, kind, post_id, post_text, rule_id, note, moderator_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [nextId(), report.target_user_id, kind, postId, postText, rule.id, note.trim() || null, moderatorId],
    );

  if (action === 'arquivar') {
    await withTransaction((c) => close(c, 'id = $1', [reportId], 'arquivada'));
  } else if (action === 'remover_post') {
    if (!report.post_id) throw conflict('Esta denúncia não tem post para remover (ou ele já foi apagado)');
    // Remover esconde (removed_at) em vez de apagar: se o recurso for aceito, o post volta.
    await withTransaction(async (c) => {
      // Post apagado pelo autor durante a análise continua decidível: já está fora do ar,
      // e a decisão fica registrada (a pessoa vê a regra e pode recorrer).
      const { rows: p } = await c.query('SELECT removed_at, deleted_by_author_at FROM posts WHERE id = $1 FOR UPDATE', [report.post_id]);
      if (!p[0] || (p[0].removed_at && !p[0].deleted_by_author_at)) throw conflict('Este post já foi apagado ou removido');
      await c.query('UPDATE posts SET removed_at = COALESCE(removed_at, now()) WHERE id = $1', [report.post_id]);
      await close(c, 'post_id = $1', [report.post_id], 'acatada');
      await sanction(c, 'post_removido', report.post_id, report.post_text);
    });
    bus.emit('post:deleted', { id: report.post_id });
  } else if (action === 'suspender') {
    if (report.target_user_id === moderatorId) throw conflict('Não é possível suspender a própria conta');
    if (report.target_is_moderator) throw conflict('Contas da moderação não podem ser suspensas por aqui');
    await withTransaction(async (c) => {
      await c.query('UPDATE users SET suspended_at = now(), suspension_reason = $2 WHERE id = $1', [
        report.target_user_id,
        note.trim() || rule.title,
      ]);
      await close(c, 'target_user_id = $1', [report.target_user_id], 'acatada');
      await sanction(c, 'suspensao', report.post_id, report.post_text);
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
  await withTransaction(async (c) => {
    const { rows } = await c.query(
      'UPDATE users SET suspended_at = NULL, suspension_reason = NULL WHERE username = $1 AND suspended_at IS NOT NULL RETURNING id',
      [username],
    );
    if (!rows[0]) throw notFound('Não há conta suspensa com esse nome');
    await c.query("UPDATE sanctions SET reverted_at = now() WHERE user_id = $1 AND kind = 'suspensao' AND reverted_at IS NULL", [rows[0].id]);
  });
  return { suspended: false };
}

// ---------------------------------------------------------------------------
// Decisões sobre a própria conta e recursos
// ---------------------------------------------------------------------------

const SANCTION_COLS = `s.id, s.kind, s.post_text, s.note, s.created_at, s.reverted_at,
  s.appeal_text, s.appeal_at, s.appeal_status, s.appeal_note, s.appeal_resolved_at,
  json_build_object('id', ru.id::text, 'position', ru.position, 'title', ru.title, 'description', ru.description, 'archived', ru.archived_at IS NOT NULL) AS rule`;

/** Decisões que afetaram a pessoa (posts removidos, suspensões), com a regra citada. */
export async function myDecisions(userId) {
  const { rows } = await query(
    `SELECT ${SANCTION_COLS} FROM sanctions s JOIN instance_rules ru ON ru.id = s.rule_id
     WHERE s.user_id = $1 ORDER BY s.id DESC LIMIT 100`,
    [userId],
  );
  return rows;
}

const APPEAL_MAX = 1000;

async function openAppeal(sanctionId, userId, text) {
  const { rows } = await query(
    `UPDATE sanctions SET appeal_text = $3, appeal_at = now(), appeal_status = 'aberto'
     WHERE id = $1 AND user_id = $2 AND appeal_status IS NULL AND reverted_at IS NULL
     RETURNING id`,
    [sanctionId, userId, text.trim().slice(0, APPEAL_MAX)],
  );
  if (!rows[0]) {
    const { rows: s } = await query('SELECT appeal_status, reverted_at FROM sanctions WHERE id = $1 AND user_id = $2', [sanctionId, userId]);
    if (!s[0]) throw notFound('Decisão não encontrada');
    if (s[0].reverted_at) throw conflict('Esta decisão já foi desfeita');
    throw conflict('Você já recorreu desta decisão. Cada decisão aceita um recurso.');
  }
  return { id: sanctionId, appeal_status: 'aberto' };
}

/** Recurso de quem está logado (ex.: post removido). */
export function appealDecision(userId, sanctionId, text) {
  return openAppeal(sanctionId, userId, text);
}

/** Suspensão ativa (a mais recente) de um usuário, para mostrar no login. */
export async function activeSuspension(userId) {
  const { rows } = await query(
    `SELECT ${SANCTION_COLS} FROM sanctions s JOIN instance_rules ru ON ru.id = s.rule_id
     WHERE s.user_id = $1 AND s.kind = 'suspensao' AND s.reverted_at IS NULL ORDER BY s.id DESC LIMIT 1`,
    [userId],
  );
  return rows[0] ?? null;
}

/**
 * Recurso de quem foi suspenso: não dá para entrar, então a pessoa prova quem é com
 * e-mail e senha (mesma mensagem e mesmo custo do login para não revelar contas).
 */
export async function appealSuspension({ email, password, text }) {
  const { rows } = await query('SELECT id, password_hash, suspended_at FROM users WHERE email = $1', [email]);
  const ok = await checkPassword(password, rows[0]?.password_hash ?? (await dummyHash()));
  // Uma só resposta para senha errada, conta inexistente e conta que não está suspensa:
  // antes, "não está suspensa" confirmava que a senha estava certa (docs/14, M-2).
  const denied = () => unauthorized('Não encontramos uma suspensão com este e-mail e esta senha');
  if (!rows[0] || !ok || !rows[0].suspended_at) throw denied();
  const s = await activeSuspension(rows[0].id);
  if (!s) throw denied();
  return openAppeal(s.id, rows[0].id, text);
}

/** Recursos para a moderação decidir (abertos primeiro, os mais antigos antes). */
export async function listAppeals(status = 'aberto') {
  const { rows } = await query(
    `SELECT ${SANCTION_COLS}, u.username, u.display_name, (u.suspended_at IS NOT NULL) AS suspended,
            m.username AS decided_by_username, rv.username AS appeal_resolved_by_username
     FROM sanctions s
     JOIN instance_rules ru ON ru.id = s.rule_id
     JOIN users u ON u.id = s.user_id
     LEFT JOIN users m ON m.id = s.moderator_id
     LEFT JOIN users rv ON rv.id = s.appeal_resolved_by
     WHERE ${status === 'aberto' ? "s.appeal_status = 'aberto'" : "s.appeal_status IN ('aceito', 'negado')"}
     ORDER BY s.appeal_at ${status === 'aberto' ? 'ASC' : 'DESC'} LIMIT 200`,
  );
  return rows;
}

/** Aceitar desfaz a decisão (o post volta ou a conta é reativada); negar mantém. */
export async function decideAppeal(moderatorId, sanctionId, { decision, note = '' }) {
  await assertModerator(moderatorId);
  const { rows: who } = await query('SELECT moderator_id FROM sanctions WHERE id = $1', [sanctionId]);
  if (who[0]) await assertNotOwnCase(moderatorId, who[0].moderator_id, 'o recurso contra uma decisão sua');
  const result = await withTransaction(async (c) => {
    const { rows } = await c.query("SELECT * FROM sanctions WHERE id = $1 AND appeal_status = 'aberto' FOR UPDATE", [sanctionId]);
    const s = rows[0];
    if (!s) throw notFound('Recurso não encontrado ou já decidido');
    const accepted = decision === 'aceitar';
    await c.query(
      `UPDATE sanctions SET appeal_status = $2, appeal_note = $3, appeal_resolved_by = $4, appeal_resolved_at = now()
         ${accepted ? ', reverted_at = now()' : ''} WHERE id = $1`,
      [sanctionId, accepted ? 'aceito' : 'negado', note.trim() || null, moderatorId],
    );
    // O post volta, a não ser que o próprio autor o tenha apagado.
    if (accepted && s.kind === 'post_removido' && s.post_id) {
      await c.query('UPDATE posts SET removed_at = NULL WHERE id = $1 AND deleted_by_author_at IS NULL', [s.post_id]);
    }
    if (accepted && s.kind === 'suspensao') await c.query('UPDATE users SET suspended_at = NULL, suspension_reason = NULL WHERE id = $1', [s.user_id]);
    return { id: sanctionId, appeal_status: accepted ? 'aceito' : 'negado', reverted: accepted };
  });
  return result;
}

/**
 * Promove as contas listadas em MODERATORS (lista separada por vírgulas) ao iniciar.
 *
 * Um nome da lista que ainda não existe fica anotado (moderator_names_missing). Se depois
 * alguém criar uma conta com esse nome, ela NÃO é promovida sozinha: quem chegasse primeiro
 * ao nome viraria moderação no próximo reinício. Nesse caso a promoção é manual
 * (`npm run moderacao:promover -- <usuario>`). Devolve { promoted, missing, refused }.
 */
export async function promoteModerators(usernames) {
  const report = { promoted: 0, missing: [], refused: [] };
  for (const name of usernames) {
    const { rows } = await query('SELECT id, username, created_at, is_moderator FROM users WHERE username = $1', [name]);
    const user = rows[0];
    if (!user) {
      await query('INSERT INTO moderator_names_missing (username) VALUES ($1) ON CONFLICT DO NOTHING', [name]);
      report.missing.push(name);
      continue;
    }
    if (user.is_moderator) continue;
    const { rows: seen } = await query('SELECT missing_since FROM moderator_names_missing WHERE username = $1', [name]);
    if (seen[0] && user.created_at > seen[0].missing_since) {
      report.refused.push(user.username);
      continue;
    }
    await query('UPDATE users SET is_moderator = true WHERE id = $1', [user.id]);
    report.promoted++;
  }
  return report;
}

/** Promoção explícita (linha de comando): a pessoa que administra confirma a conta certa. */
export async function promoteModeratorManually(username) {
  const { rows } = await query('UPDATE users SET is_moderator = true WHERE username = $1 RETURNING username', [username]);
  if (!rows[0]) throw notFound('Usuário não encontrado');
  await query('DELETE FROM moderator_names_missing WHERE username = $1', [username]);
  return rows[0].username;
}
