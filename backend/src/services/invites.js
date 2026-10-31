import { randomBytes } from 'node:crypto';
import { query, withTransaction } from '../db.js';
import { badRequest, conflict } from '../lib/errors.js';
import { createUser } from './users.js';

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // sem caracteres ambíguos (0/o, 1/l/i)
const MAX_OPEN = 10;

function newCode() {
  const bytes = randomBytes(8);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

export async function createInvite(userId) {
  const { rows } = await query('SELECT count(*)::int AS n FROM invites WHERE inviter_id = $1 AND used_at IS NULL', [userId]);
  if (rows[0].n >= MAX_OPEN) throw conflict(`Você já tem ${MAX_OPEN} convites sem uso. Envie um deles antes de gerar outro.`);
  const code = newCode();
  const { rows: created } = await query('INSERT INTO invites (code, inviter_id) VALUES ($1, $2) RETURNING code, created_at', [code, userId]);
  return { ...created[0], used: false, path: `/cadastro?convite=${code}` };
}

export async function listInvites(userId) {
  const { rows } = await query(
    `SELECT i.code, i.created_at, i.used_at, u.username AS used_by_username FROM invites i
     LEFT JOIN users u ON u.id = i.used_by
     WHERE i.inviter_id = $1 ORDER BY i.created_at DESC LIMIT 50`,
    [userId],
  );
  return rows.map((r) => ({ ...r, used: Boolean(r.used_at), path: `/cadastro?convite=${r.code}` }));
}

/**
 * Cadastro com convite, numa única transação: cria a conta, consome o convite
 * e faz a pessoa nova seguir quem convidou (para o feed dela não começar vazio).
 */
export async function registerWithInvite(input, code) {
  return withTransaction(async (client) => {
    // used_at, e não used_by: quem usou o convite pode excluir a conta (used_by vira NULL),
    // e o convite não pode voltar a valer por isso.
    const { rows } = await client.query('SELECT inviter_id FROM invites WHERE code = $1 AND used_at IS NULL FOR UPDATE', [code]);
    if (!rows[0]) throw badRequest('Convite inválido ou já usado');
    const user = await createUser(input, client);
    await client.query('UPDATE invites SET used_by = $1, used_at = now() WHERE code = $2', [user.id, code]);
    await client.query('INSERT INTO follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [user.id, rows[0].inviter_id]);
    return user;
  });
}
