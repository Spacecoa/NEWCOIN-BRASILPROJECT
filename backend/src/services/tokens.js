import { config } from '../config.js';
import { query, withTransaction } from '../db.js';
import { conflict, notFound } from '../lib/errors.js';
import { nextId } from '../lib/ids.js';
import { EVAPORATION } from './evaporation.js';
import { notify } from './notifications.js';
import { assertCanInteract } from './relations.js';

// Token interno. Regras (ver docs/09-token-interno.md):
//  - Utilidade nula por enquanto: serve só para recompensar outras pessoas.
//  - Sem valor monetário, sem compra, venda, saque ou conversão.
//  - EMISSÃO só por missões concluídas (+ um saldo inicial pequeno para começar a recompensar).
//  - Recompensa entre pessoas TRANSFERE saldo: não cria token novo, então
//    duas contas se recompensando em círculo não ganham nada.

export const TOKEN = Object.freeze({
  name: config.tokenName,
  symbol: config.tokenSymbol,
  welcome_grant: 3,
  tip_amount: 1,
  max_tips_per_day: 20,
  // Sem usar o app, o saldo evapora aos poucos e zera em 7 dias (services/evaporation.js).
  evaporation_days: EVAPORATION.days,
});

async function credit(client, userId, amount, kind, ref) {
  const { rows } = await client.query(
    `UPDATE token_balances SET balance = balance + $2, updated_at = now() WHERE user_id = $1 RETURNING balance`,
    [userId, amount],
  );
  if (!rows[0]) throw new Error('carteira inexistente');
  await client.query('INSERT INTO token_ledger (id, user_id, amount, kind, ref) VALUES ($1, $2, $3, $4, $5)', [nextId(), userId, amount, kind, ref]);
  return rows[0].balance;
}

/** Cria a carteira na primeira vez (com o saldo inicial). Idempotente. */
export async function ensureWallet(userId, client = null) {
  const run = async (c) => {
    const { rowCount } = await c.query('INSERT INTO token_balances (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [userId]);
    if (rowCount) await credit(c, userId, TOKEN.welcome_grant, 'grant', 'boas-vindas');
  };
  return client ? run(client) : withTransaction(run);
}

export async function getBalance(userId) {
  await ensureWallet(userId);
  const { rows } = await query('SELECT balance FROM token_balances WHERE user_id = $1', [userId]);
  return rows[0].balance;
}

export async function getWallet(userId) {
  const balance = await getBalance(userId);
  const { rows } = await query(
    `SELECT l.id, l.amount, l.kind, l.created_at,
       CASE l.kind WHEN 'tip_sent' THEN l.ref WHEN 'tip_received' THEN split_part(l.ref, ':', 1) END AS post_id,
       CASE l.kind WHEN 'mission' THEN split_part(l.ref, ':', 2) END AS mission,
       COALESCE(author.username, tipper.username) AS counterpart
     FROM token_ledger l
     LEFT JOIN posts tp ON l.kind = 'tip_sent' AND tp.id::text = l.ref
     LEFT JOIN users author ON author.id = tp.author_id
     LEFT JOIN users tipper ON l.kind = 'tip_received' AND tipper.id::text = split_part(l.ref, ':', 2)
     WHERE l.user_id = $1 ORDER BY l.id DESC LIMIT 50`,
    [userId],
  );
  const totals = await query(
    `SELECT
       COALESCE(sum(amount) FILTER (WHERE kind = 'mission'), 0)::int AS from_missions,
       COALESCE(sum(amount) FILTER (WHERE kind = 'tip_received'), 0)::int AS received,
       COALESCE(-sum(amount) FILTER (WHERE kind = 'tip_sent'), 0)::int AS given,
       COALESCE(-sum(amount) FILTER (WHERE kind = 'evaporated'), 0)::int AS evaporated
     FROM token_ledger WHERE user_id = $1`,
    [userId],
  );
  return { token: TOKEN, balance, totals: totals.rows[0], ledger: rows };
}

/** Credita a recompensa de uma missão uma única vez por dia. Retorna true se creditou agora. */
export async function rewardMission(userId, day, mission, amount) {
  return withTransaction(async (client) => {
    await ensureWallet(userId, client);
    const { rowCount } = await client.query(
      'INSERT INTO mission_rewards (user_id, day, mission, amount) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
      [userId, day, mission, amount],
    );
    if (!rowCount) return false;
    await credit(client, userId, amount, 'mission', `${day}:${mission}`);
    return true;
  });
}

/** Recompensa o autor de um post com 1 token (transferência). Uma vez por post, como o like. */
export async function tipPost(userId, postId) {
  const result = await withTransaction(async (client) => {
    const { rows } = await client.query('SELECT id, author_id, repost_of_id FROM posts WHERE id = $1 AND removed_at IS NULL', [postId]);
    if (!rows[0]) throw notFound('Post não encontrado');
    const target = rows[0].repost_of_id ?? rows[0].id; // recompensa vai para o original
    // O original de um repost também precisa estar no ar.
    const { rows: orig } = await client.query('SELECT author_id FROM posts WHERE id = $1 AND removed_at IS NULL', [target]);
    if (!orig[0]) throw notFound('Post não encontrado');
    const authorId = orig[0].author_id;
    if (authorId === userId) throw conflict('Você não pode recompensar o próprio post');
    await assertCanInteract(userId, authorId, client);

    await ensureWallet(userId, client);
    await ensureWallet(authorId, client);
    const { rows: me } = await client.query('SELECT balance FROM token_balances WHERE user_id = $1 FOR UPDATE', [userId]);
    const { rows: today } = await client.query(
      `SELECT count(*)::int AS n FROM tips WHERE user_id = $1 AND (created_at AT TIME ZONE $2)::date = (now() AT TIME ZONE $2)::date`,
      [userId, config.missionTimezone],
    );
    const { rowCount } = await client.query('INSERT INTO tips (user_id, post_id, amount) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [
      userId,
      target,
      TOKEN.tip_amount,
    ]);
    if (!rowCount) return { target, created: false };
    if (today[0].n >= TOKEN.max_tips_per_day) throw conflict(`Limite de ${TOKEN.max_tips_per_day} recompensas por dia`);
    if (me[0].balance < TOKEN.tip_amount) throw conflict(`Saldo insuficiente de ${TOKEN.symbol}. Conclua missões para ganhar mais.`);

    await credit(client, userId, -TOKEN.tip_amount, 'tip_sent', String(target));
    await credit(client, authorId, TOKEN.tip_amount, 'tip_received', `${target}:${userId}`);
    await client.query('UPDATE posts SET tip_count = tip_count + 1 WHERE id = $1', [target]);
    return { target, created: true, authorId };
  });
  if (result.created) await notify({ kind: 'tip', actorId: userId, userIds: [result.authorId], postId: result.target });
  return result.target;
}

export function tokenInfo() {
  return {
    ...TOKEN,
    utilidade: 'Nenhuma por enquanto: serve apenas para recompensar posts de outras pessoas.',
    emissao: 'Só por missões concluídas (e um saldo inicial de boas-vindas).',
    circulacao: 'Recompensar um post transfere 1 token seu para o autor. Não cria token novo.',
    evaporacao: `Sem usar o app, o saldo evapora aos poucos: cada dia parado leva uma parte, e em ${EVAPORATION.days} dias zera. Usar o app para a evaporação; o que evaporou sai de circulação.`,
    nao_e: ['dinheiro', 'criptomoeda', 'investimento', 'conversível', 'transferível para fora do app'],
  };
}
