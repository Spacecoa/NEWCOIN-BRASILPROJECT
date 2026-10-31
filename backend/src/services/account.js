import { config } from '../config.js';
import { query, withTransaction } from '../db.js';
import { checkPassword } from '../lib/auth.js';
import { conflict, forbidden, notFound } from '../lib/errors.js';
import { bus } from '../realtime/bus.js';
import { markRevoked } from './sessions.js';
import { invalidateHomeTimeline } from './timeline.js';
import { usernameHash } from './users.js';

// Os dados da própria pessoa (docs/16): baixar tudo o que a instância guarda sobre ela
// e excluir a conta de vez. São os direitos de acesso, portabilidade e eliminação da LGPD
// (art. 18), feitos pelo próprio app, sem precisar pedir a ninguém.

export const EXPORT_FORMAT = 'agora-dados/1';

const rows = async (sql, params) => (await query(sql, params)).rows;

/**
 * Tudo o que a instância guarda sobre a pessoa, num JSON só. Ficam de fora apenas os
 * segredos (hash da senha, dos refresh tokens e dos links de senha) e o que é de outras
 * pessoas (quem denunciou você, quem moderou).
 */
export async function exportAccount(userId) {
  const p = [userId];
  const [user] = await rows(
    `SELECT id, username, email, display_name, bio, created_at, rules_accepted_at, last_active_at, is_moderator, suspended_at
       FROM users WHERE id = $1`,
    p,
  );
  if (!user) throw notFound('Usuário não encontrado');

  const [posts, edits, media] = await Promise.all([
    rows(
      `SELECT id, text, created_at, reply_to_id, repost_of_id, quote_of_id, conversation_id, edited_at, edit_count,
              like_count, reply_count, repost_count, quote_count, tip_count, removed_at, deleted_by_author_at
         FROM posts WHERE author_id = $1 ORDER BY id`,
      p,
    ),
    rows('SELECT e.post_id, e.text, e.edited_at FROM post_edits e JOIN posts p ON p.id = e.post_id WHERE p.author_id = $1 ORDER BY e.id', p),
    rows('SELECT id, post_id, position, mime, width, height, alt, created_at, bytes FROM media WHERE owner_id = $1 ORDER BY id', p),
  ]);

  const [likes, following, followers, mutes, blocks, hidden] = await Promise.all([
    rows('SELECT post_id, created_at FROM likes WHERE user_id = $1 ORDER BY created_at', p),
    rows('SELECT u.username, f.created_at FROM follows f JOIN users u ON u.id = f.followee_id WHERE f.follower_id = $1 ORDER BY f.created_at', p),
    rows('SELECT u.username, f.created_at FROM follows f JOIN users u ON u.id = f.follower_id WHERE f.followee_id = $1 ORDER BY f.created_at', p),
    rows('SELECT u.username, m.created_at FROM mutes m JOIN users u ON u.id = m.target_id WHERE m.user_id = $1', p),
    rows('SELECT u.username, b.created_at FROM blocks b JOIN users u ON u.id = b.target_id WHERE b.user_id = $1', p),
    rows('SELECT post_id, created_at FROM hidden_posts WHERE user_id = $1', p),
  ]);

  const [channels, messages, reactions] = await Promise.all([
    rows(
      `SELECT c.slug, c.title, c.kind, m.role, m.joined_at FROM channel_members m JOIN channels c ON c.id = m.channel_id
        WHERE m.user_id = $1 ORDER BY m.joined_at`,
      p,
    ),
    rows(
      `SELECT c.slug AS canal, m.id, m.pts, m.text, m.created_at FROM messages m JOIN channels c ON c.id = m.channel_id
        WHERE m.author_id = $1 ORDER BY m.id`,
      p,
    ),
    rows('SELECT message_id, emoji, created_at FROM message_reactions WHERE user_id = $1', p),
  ]);

  const [balance, ledger, tips, rewards, activity] = await Promise.all([
    rows('SELECT balance, evaporated_days FROM token_balances WHERE user_id = $1', p),
    rows('SELECT amount, kind, ref, created_at FROM token_ledger WHERE user_id = $1 ORDER BY id', p),
    rows('SELECT post_id, amount, created_at FROM tips WHERE user_id = $1 ORDER BY created_at', p),
    rows('SELECT day::text, mission, amount, created_at FROM mission_rewards WHERE user_id = $1 ORDER BY created_at', p),
    rows('SELECT day::text, minutes FROM activity_days WHERE user_id = $1 ORDER BY day', p),
  ]);

  const [settings, topics, authors] = await Promise.all([
    rows('SELECT settings, updated_at FROM feed_settings WHERE user_id = $1', p),
    rows('SELECT topic, value, updated_at FROM learned_topics WHERE user_id = $1 ORDER BY topic', p),
    rows(
      `SELECT u.username, a.value, a.updated_at FROM learned_authors a JOIN users u ON u.id = a.author_id
        WHERE a.user_id = $1 ORDER BY u.username`,
      p,
    ),
  ]);

  const [reports, decisions, invites, notifications, sessions, resets] = await Promise.all([
    rows(
      `SELECT r.id, u.username AS alvo, r.post_id, r.post_text, r.reason, r.details, r.status, r.resolution, r.created_at, r.resolved_at
         FROM reports r JOIN users u ON u.id = r.target_user_id WHERE r.reporter_id = $1 ORDER BY r.id`,
      p,
    ),
    rows(
      `SELECT s.id, s.kind, s.post_id, s.post_text, ru.title AS regra, s.note, s.created_at, s.reverted_at,
              s.appeal_text, s.appeal_at, s.appeal_status, s.appeal_note
         FROM sanctions s LEFT JOIN instance_rules ru ON ru.id = s.rule_id WHERE s.user_id = $1 ORDER BY s.id`,
      p,
    ),
    rows(
      `SELECT i.code, i.created_at, i.used_at, u.username AS usado_por FROM invites i LEFT JOIN users u ON u.id = i.used_by
        WHERE i.inviter_id = $1 ORDER BY i.created_at`,
      p,
    ),
    rows(
      `SELECT n.kind, u.username AS quem, n.post_id, n.created_at, n.read_at FROM notifications n JOIN users u ON u.id = n.actor_id
        WHERE n.user_id = $1 ORDER BY n.id`,
      p,
    ),
    rows('SELECT user_agent, created_at, last_used_at, expires_at, revoked_at FROM sessions WHERE user_id = $1 ORDER BY created_at', p),
    rows('SELECT created_at, expires_at, used_at FROM password_resets WHERE user_id = $1 ORDER BY created_at', p),
  ]);

  return {
    formato: EXPORT_FORMAT,
    gerado_em: new Date().toISOString(),
    instancia: config.instanceDomain,
    leia_me:
      'Tudo o que esta instância do Ágora guarda sobre você. Ficam de fora só os segredos (hash da senha e das sessões) ' +
      'e o que é de outras pessoas (quem denunciou você, quem moderou). As imagens vão em base64, já sem metadados.',
    conta: { ...user, handle: `${user.username}@${config.instanceDomain}` },
    posts: posts.map((post) => ({ ...post, edicoes: edits.filter((e) => e.post_id === post.id).map(({ post_id: _, ...e }) => e) })),
    imagens: media.map(({ bytes, ...m }) => ({ ...m, base64: Buffer.from(bytes).toString('base64') })),
    curtidas: likes,
    seguindo: following,
    seguidores: followers,
    silenciados: mutes,
    bloqueados: blocks,
    posts_ocultados: hidden,
    canais: channels,
    mensagens: messages,
    reacoes: reactions,
    newcoin: { saldo: balance[0]?.balance ?? 0, dias_evaporados: balance[0]?.evaporated_days ?? 0, extrato: ledger, recompensas_dadas: tips, missoes: rewards },
    atividade_por_dia: activity,
    interesses: { preferencias: settings[0]?.settings ?? null, atualizado_em: settings[0]?.updated_at ?? null, temas_aprendidos: topics, autores_aprendidos: authors },
    denuncias_feitas: reports,
    decisoes_sobre_voce: decisions,
    convites: invites,
    notificacoes: notifications,
    sessoes: sessions,
    pedidos_de_nova_senha: resets,
  };
}

/** Quem herda um canal quando o dono sai: o administrador mais antigo, senão o membro mais antigo. */
async function passChannels(client, userId) {
  const { rows: owned } = await client.query('SELECT id FROM channels WHERE owner_id = $1', [userId]);
  let passed = 0;
  for (const { id } of owned) {
    const { rows: heir } = await client.query(
      `SELECT user_id FROM channel_members WHERE channel_id = $1 AND user_id <> $2
        ORDER BY (role = 'admin') DESC, joined_at, user_id LIMIT 1`,
      [id, userId],
    );
    if (!heir[0]) continue; // canal sem mais ninguém: some junto com a conta
    await client.query('UPDATE channels SET owner_id = $2 WHERE id = $1', [id, heir[0].user_id]);
    await client.query(`UPDATE channel_members SET role = 'owner' WHERE channel_id = $1 AND user_id = $2`, [id, heir[0].user_id]);
    passed++;
  }
  return { passed, removed: owned.length - passed };
}

/**
 * Exclui a conta de vez. Some tudo o que é da pessoa (posts, imagens, mensagens, curtidas,
 * seguidas, carteira, sessões...). Fica só o hash do nome de usuário, para ninguém tomar o @.
 * Os contadores dos posts de OUTRAS pessoas (curtidas, respostas, reposts, citações e
 * recompensas) são recalculados, e os canais com mais gente passam para outra pessoa.
 */
export async function deleteAccount(userId, password) {
  const { rows: found } = await query('SELECT password_hash FROM users WHERE id = $1', [userId]);
  if (!found[0]) throw notFound('Usuário não encontrado');
  // 403, e não 401: o app trata 401 como "sessão vencida" e tentaria renovar.
  if (!(await checkPassword(password, found[0].password_hash))) throw forbidden('Senha incorreta');
  return eraseAccount(userId);
}

/**
 * A exclusão em si, sem pedir senha. Só o app (depois de conferir a senha) e quem administra
 * o servidor (`npm run conta:excluir`, ex.: pedido de conta suspensa) chegam aqui.
 */
export async function eraseAccount(userId) {
  const { rows: found } = await query('SELECT id, username, is_moderator FROM users WHERE id = $1', [userId]);
  const user = found[0];
  if (!user) throw notFound('Usuário não encontrado');

  if (user.is_moderator) {
    const { rows: others } = await query('SELECT count(*)::int AS n FROM users WHERE is_moderator AND suspended_at IS NULL AND id <> $1', [userId]);
    if (!others[0].n) throw conflict('Você é a única pessoa que modera esta instância. Passe a moderação para outra pessoa antes de excluir a conta.');
  }

  const result = await withTransaction(async (client) => {
    // Trava a linha: dois pedidos de exclusão ao mesmo tempo não brigam.
    const { rows: locked } = await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
    if (!locked[0]) throw notFound('Usuário não encontrado');

    const { rows: affected } = await client.query(
      `SELECT post_id AS id FROM likes WHERE user_id = $1
       UNION SELECT post_id FROM tips WHERE user_id = $1
       UNION SELECT reply_to_id FROM posts WHERE author_id = $1 AND reply_to_id IS NOT NULL
       UNION SELECT repost_of_id FROM posts WHERE author_id = $1 AND repost_of_id IS NOT NULL
       UNION SELECT quote_of_id FROM posts WHERE author_id = $1 AND quote_of_id IS NOT NULL`,
      [userId],
    );
    const { rows: own } = await client.query('SELECT id FROM posts WHERE author_id = $1 ORDER BY id DESC LIMIT 500', [userId]);
    const { rows: audience } = await client.query('SELECT follower_id AS id FROM follows WHERE followee_id = $1', [userId]);
    const { rows: sessions } = await client.query('SELECT id FROM sessions WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
    const channels = await passChannels(client, userId);

    // Se o nome estiver na lista MODERATORS, quem se cadastrar depois com ele não vira moderador.
    if (user.is_moderator || config.moderators.some((m) => m.toLowerCase() === user.username.toLowerCase())) {
      await client.query('INSERT INTO moderator_names_missing (username) VALUES ($1) ON CONFLICT DO NOTHING', [user.username]);
    }
    await client.query('INSERT INTO deleted_usernames (username_hash) VALUES ($1) ON CONFLICT DO NOTHING', [usernameHash(user.username)]);
    // O resto vai em cascata (ON DELETE CASCADE no schema).
    await client.query('DELETE FROM users WHERE id = $1', [userId]);

    // Recontagem, e não "menos um": o post da outra pessoa fica com o número certo
    // mesmo que esta conta tenha curtido, respondido e recompensado o mesmo post.
    await client.query(
      `UPDATE posts p SET
          like_count   = (SELECT count(*) FROM likes l WHERE l.post_id = p.id),
          reply_count  = (SELECT count(*) FROM posts r WHERE r.reply_to_id = p.id),
          repost_count = (SELECT count(*) FROM posts r WHERE r.repost_of_id = p.id),
          quote_count  = (SELECT count(*) FROM posts r WHERE r.quote_of_id = p.id),
          tip_count    = (SELECT count(*) FROM tips t WHERE t.post_id = p.id)
        WHERE p.id = ANY($1::bigint[])`,
      [affected.map((r) => r.id)],
    );
    return {
      username: user.username,
      posts: own.map((r) => r.id),
      audience: [userId, ...audience.map((r) => r.id)],
      sessions: sessions.map((r) => r.id),
      channels,
    };
  });

  // Depois do commit: derruba as sessões abertas e tira os posts das telas de quem seguia.
  await markRevoked(result.sessions);
  await invalidateHomeTimeline(userId);
  for (const id of result.posts) bus.emit('post:deleted', { id, audience: result.audience });
  return { username: result.username, channels_passed: result.channels.passed, channels_removed: result.channels.removed };
}
