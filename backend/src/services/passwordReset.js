import { createHash, randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { query, withTransaction } from '../db.js';
import { badRequest } from '../lib/errors.js';
import { hashPassword } from '../lib/auth.js';
import { nextId } from '../lib/ids.js';
import { sendMail } from '../lib/mailer.js';
import { revokeAllSessions } from './sessions.js';

export const RESET = { ttlMin: 30, maxPerHour: 3 };

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

/**
 * Pedido de "esqueci a senha". A resposta é sempre a mesma, exista ou não a conta: quem
 * pede não descobre quais e-mails estão cadastrados. Se a conta existe, sai um e-mail com
 * um link de uso único (no máximo 3 por hora por conta, para não virar spam na caixa dela).
 */
export async function requestReset(email) {
  const { rows } = await query('SELECT id, username, display_name, email FROM users WHERE email = $1', [email]);
  const user = rows[0];
  if (!user) return;
  const { rows: recent } = await query(
    "SELECT count(*)::int AS n FROM password_resets WHERE user_id = $1 AND created_at > now() - interval '1 hour'",
    [user.id],
  );
  if (recent[0].n >= RESET.maxPerHour) return;
  const token = randomBytes(32).toString('base64url');
  await query(
    "INSERT INTO password_resets (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, now() + make_interval(mins => $4))",
    [nextId(), user.id, sha256(token), RESET.ttlMin],
  );
  const link = `${config.webUrl}/redefinir-senha?token=${token}`;
  await sendMail({
    to: user.email,
    subject: 'Ágora: redefinir sua senha',
    text: [
      `Olá, ${user.display_name}.`,
      '',
      `Alguém pediu para redefinir a senha da conta @${user.username}. Para escolher uma senha nova, abra:`,
      link,
      '',
      `O link vale por ${RESET.ttlMin} minutos e uma vez só. Ao trocar a senha, você sai da conta em todos os aparelhos.`,
      'Se não foi você, ignore este e-mail: sua senha continua a mesma.',
    ].join('\n'),
  });
}

/** Troca a senha pelo link. Invalida os outros links da conta e encerra todas as sessões. */
export async function resetPassword(token, password) {
  const passwordHash = await hashPassword(password);
  const userId = await withTransaction(async (c) => {
    const { rows } = await c.query(
      'SELECT id, user_id FROM password_resets WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() FOR UPDATE',
      [sha256(token)],
    );
    if (!rows[0]) throw badRequest('Este link não vale mais: ele venceu ou já foi usado. Peça um novo.');
    await c.query('UPDATE users SET password_hash = $2 WHERE id = $1', [rows[0].user_id, passwordHash]);
    await c.query('UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [rows[0].user_id]);
    return rows[0].user_id;
  });
  await revokeAllSessions(userId);
}
