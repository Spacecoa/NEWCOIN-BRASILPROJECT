import { config } from '../config.js';
import { query } from '../db.js';
import { notFound } from '../lib/errors.js';
import { CATALOG, PRINCIPLES, selectMissions } from '../lib/missions.js';
import { getSettings } from './interests.js';

// Cada missão tem:
//  suggest(): alvos concretos (pessoas, perguntas, grupos). Lista vazia = missão não se aplica hoje.
//  always:    se aplica mesmo sem alvos (ex.: convidar, abrir um grupo).
//  done():    verificação a partir dos dados reais do dia ($1 = usuário, $2 = fuso).
// "Hoje" é sempre calculado no fuso da instância.

const TODAY = (col) => `(${col} AT TIME ZONE $2)::date = (now() AT TIME ZONE $2)::date`;
const NEW_USER = `u.created_at > now() - interval '7 days'`;
const exists = async (sql, params) => (await query(`SELECT EXISTS (${sql}) AS ok`, params)).rows[0].ok;

const DEFS = {
  apresentar: {
    onlyNewUsers: true,
    always: true,
    // Só para quem ainda não tinha postado nada antes de hoje.
    applies: (p) =>
      exists(
        `SELECT 1 FROM posts WHERE author_id = $1 AND repost_of_id IS NULL AND (created_at AT TIME ZONE $2)::date < (now() AT TIME ZONE $2)::date`,
        p,
      ).then((before) => !before),
    suggest: async () => [],
    done: (p) => exists(`SELECT 1 FROM posts WHERE author_id = $1 AND reply_to_id IS NULL AND repost_of_id IS NULL AND ${TODAY('created_at')}`, p),
  },

  boas_vindas: {
    suggest: async ([me]) =>
      (
        await query(
          `SELECT u.username, u.display_name FROM users u
           WHERE ${NEW_USER} AND u.id <> $1
             AND NOT EXISTS (SELECT 1 FROM mentions m JOIN posts p ON p.id = m.post_id WHERE m.user_id = u.id AND p.author_id = $1)
             AND NOT EXISTS (SELECT 1 FROM posts r JOIN posts t ON t.id = r.reply_to_id WHERE r.author_id = $1 AND t.author_id = u.id)
           ORDER BY u.created_at DESC LIMIT 3`,
          [me],
        )
      ).rows.map((r) => ({ type: 'user', ...r })),
    done: (p) =>
      exists(
        `SELECT 1 FROM posts mine
         JOIN users u ON u.id IN (
           SELECT m.user_id FROM mentions m WHERE m.post_id = mine.id
           UNION SELECT t.author_id FROM posts t WHERE t.id = mine.reply_to_id)
         WHERE mine.author_id = $1 AND u.id <> $1 AND u.created_at > now() - interval '8 days' AND ${TODAY('mine.created_at')}`,
        p,
      ),
  },

  responder_pergunta: {
    suggest: async ([me]) =>
      (
        await query(
          `SELECT p.id, p.text, u.username FROM posts p JOIN users u ON u.id = p.author_id
           WHERE p.author_id <> $1 AND p.repost_of_id IS NULL AND p.reply_count = 0
             AND p.text LIKE '%?%' AND p.created_at > now() - interval '3 days'
           ORDER BY p.id DESC LIMIT 3`,
          [me],
        )
      ).rows.map((r) => ({ type: 'post', ...r })),
    // Só conta se a SUA resposta foi a primeira.
    done: (p) =>
      exists(
        `SELECT 1 FROM posts mine JOIN posts q ON q.id = mine.reply_to_id
         WHERE mine.author_id = $1 AND q.author_id <> $1 AND q.text LIKE '%?%' AND ${TODAY('mine.created_at')}
           AND NOT EXISTS (SELECT 1 FROM posts other WHERE other.reply_to_id = q.id AND other.id < mine.id)`,
        p,
      ),
  },

  ponte: {
    suggest: async ([me]) =>
      (
        await query(
          `SELECT u.username, u.display_name FROM users u
           WHERE u.id <> $1
             AND NOT EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.followee_id = u.id)
             AND NOT EXISTS (SELECT 1 FROM follows mine JOIN follows theirs ON theirs.follower_id = mine.followee_id
                             WHERE mine.follower_id = $1 AND theirs.followee_id = u.id)
             AND EXISTS (SELECT 1 FROM posts p WHERE p.author_id = u.id AND p.created_at > now() - interval '14 days')
           ORDER BY (SELECT max(id) FROM posts p WHERE p.author_id = u.id) DESC LIMIT 3`,
          [me],
        )
      ).rows.map((r) => ({ type: 'user', ...r })),
    done: (p) =>
      exists(
        `SELECT 1 FROM follows f WHERE f.follower_id = $1 AND ${TODAY('f.created_at')}
           AND NOT EXISTS (SELECT 1 FROM follows mine JOIN follows theirs ON theirs.follower_id = mine.followee_id
                           WHERE mine.follower_id = $1 AND mine.followee_id <> f.followee_id AND theirs.followee_id = f.followee_id)`,
        p,
      ),
  },

  amplificar: {
    suggest: async ([me]) =>
      (
        await query(
          `SELECT p.id, p.text, u.username FROM posts p JOIN users u ON u.id = p.author_id
           WHERE p.author_id <> $1 AND p.repost_of_id IS NULL AND p.created_at > now() - interval '3 days'
             AND (SELECT count(*) FROM follows f WHERE f.followee_id = p.author_id AND f.follower_id <> $1) < 5
             AND NOT EXISTS (SELECT 1 FROM posts r WHERE r.repost_of_id = p.id AND r.author_id = $1)
           ORDER BY p.id DESC LIMIT 3`,
          [me],
        )
      ).rows.map((r) => ({ type: 'post', ...r })),
    done: (p) =>
      exists(
        `SELECT 1 FROM posts r JOIN posts o ON o.id = r.repost_of_id
         WHERE r.author_id = $1 AND ${TODAY('r.created_at')}
           AND (SELECT count(*) FROM follows f WHERE f.followee_id = o.author_id AND f.follower_id <> $1) < 5`,
        p,
      ),
  },

  conversa_coletiva: {
    suggest: async ([me]) =>
      (
        await query(
          `SELECT c.slug, c.title FROM channels c
           WHERE c.kind = 'group'
           ORDER BY EXISTS (SELECT 1 FROM channel_members m WHERE m.channel_id = c.id AND m.user_id = $1) DESC,
                    (SELECT max(id) FROM messages msg WHERE msg.channel_id = c.id) DESC NULLS LAST
           LIMIT 3`,
          [me],
        )
      ).rows.map((r) => ({ type: 'channel', ...r })),
    done: (p) =>
      exists(`SELECT 1 FROM messages m JOIN channels c ON c.id = m.channel_id WHERE m.author_id = $1 AND c.kind = 'group' AND ${TODAY('m.created_at')}`, p),
  },

  organizar: {
    always: true,
    suggest: async () => [],
    done: (p) => exists(`SELECT 1 FROM channels WHERE owner_id = $1 AND kind = 'group' AND ${TODAY('created_at')}`, p),
  },

  convidar: {
    always: true,
    suggest: async () => [],
    done: (p) => exists(`SELECT 1 FROM invites WHERE inviter_id = $1 AND ${TODAY('used_at')}`, p),
  },
};

async function today(tz) {
  const { rows } = await query('SELECT ((now() AT TIME ZONE $1)::date)::text AS day', [tz]);
  return rows[0].day;
}

/** Painel coletivo: só números da rede inteira, nunca de pessoas individuais. */
async function collective(tz) {
  const { rows } = await query(
    `SELECT
       (SELECT count(*)::int FROM users u WHERE ${NEW_USER}) AS novos_membros_semana,
       (SELECT count(*)::int FROM users u WHERE ${NEW_USER} AND (
          EXISTS (SELECT 1 FROM mentions m JOIN posts p ON p.id = m.post_id WHERE m.user_id = u.id AND p.author_id <> u.id)
          OR EXISTS (SELECT 1 FROM posts r JOIN posts t ON t.id = r.reply_to_id WHERE t.author_id = u.id AND r.author_id <> u.id))) AS recebidos_semana,
       (SELECT count(*)::int FROM posts q WHERE q.text LIKE '%?%' AND EXISTS (
          SELECT 1 FROM posts r WHERE r.reply_to_id = q.id AND r.author_id <> q.author_id
            AND (r.created_at AT TIME ZONE $1)::date = (now() AT TIME ZONE $1)::date
            AND NOT EXISTS (SELECT 1 FROM posts o WHERE o.reply_to_id = q.id AND o.id < r.id))) AS perguntas_respondidas_hoje,
       (SELECT count(DISTINCT m.channel_id)::int FROM messages m JOIN channels c ON c.id = m.channel_id
          WHERE c.kind = 'group' AND (m.created_at AT TIME ZONE $1)::date = (now() AT TIME ZONE $1)::date) AS grupos_ativos_hoje,
       (SELECT count(*)::int FROM invites WHERE used_at > now() - interval '7 days') AS convites_aceitos_semana`,
    [tz],
  );
  return rows[0];
}

export async function getMissions(userId) {
  const tz = config.missionTimezone;
  const [settings, day, userRow] = await Promise.all([
    getSettings(userId),
    today(tz),
    query(`SELECT u.created_at > now() - interval '7 days' AS is_new FROM users u WHERE u.id = $1`, [userId]),
  ]);
  const coll = await collective(tz);
  if (!settings.missions_enabled) return { enabled: false, day, missions: [], collective: coll, principles: PRINCIPLES };

  const isNewUser = userRow.rows[0]?.is_new ?? false;
  const suggestions = {};
  const applicable = [];
  for (const [id, def] of Object.entries(DEFS)) {
    if (def.onlyNewUsers && !isNewUser) continue;
    if (def.applies && !(await def.applies([userId, tz]))) continue;
    suggestions[id] = await def.suggest([userId]);
    if (def.always || suggestions[id].length) applicable.push(id);
  }
  const chosen = selectMissions(userId, day, applicable, { isNewUser });
  const { rows: skipRows } = await query('SELECT mission FROM mission_skips WHERE user_id = $1 AND day = $2', [userId, day]);
  const skipped = new Set(skipRows.map((r) => r.mission));

  const missions = [];
  for (const id of chosen) {
    const done = await DEFS[id].done([userId, tz]);
    missions.push({
      id,
      ...CATALOG[id],
      status: done ? 'done' : skipped.has(id) ? 'skipped' : 'todo',
      suggestions: done ? [] : suggestions[id],
    });
  }
  return {
    enabled: true,
    day,
    timezone: tz,
    summary: { done: missions.filter((m) => m.status === 'done').length, total: missions.length },
    missions,
    collective: coll,
    principles: PRINCIPLES,
  };
}

export async function skipMission(userId, missionId) {
  if (!CATALOG[missionId]) throw notFound('Missão não encontrada');
  const day = await today(config.missionTimezone);
  await query('INSERT INTO mission_skips (user_id, day, mission) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [userId, day, missionId]);
  return { skipped: missionId, day };
}

// Exposto só para testes: verifica a regra de conclusão de uma missão específica.
export const __test = {
  done: (id, who) => DEFS[id].done([who.user.id, config.missionTimezone]),
  suggest: (id, who) => DEFS[id].suggest([who.user.id]),
};
