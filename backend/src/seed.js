// Popula o banco com dados FICTÍCIOS para testes locais.
// Uso: npm run seed            (apaga contas, conteúdo, regras e moderação e recria;
//                               as regras voltam às 7 padrão. Só os dados oficiais da aba Brasil ficam)
//      SEED_USERS=50 npm run seed
//
// Os IDs são gerados com um relógio simulado que avança ao longo dos últimos dias,
// para que o feed tenha timestamps variados e a paginação por cursor seja exercitada.

import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getRedis, closeRedis } from './cache.js';
import { pool, withTransaction } from './db.js';
import { hashPassword } from './lib/auth.js';
import { createSnowflake, snowflakeToDate } from './lib/snowflake.js';
import { extractMentions } from './lib/text.js';
import { migrate } from './migrate.js';
import { ensureDefaultRules } from './services/rules.js';

// Senha das contas de teste. Só é a senha conhecida ("senha1234", citada no README) quando a
// instância é local. Em qualquer outro domínio (pré-produção acessível pela rede), vem de
// SEED_PASSWORD ou é sorteada e mostrada uma vez: senão qualquer pessoa entraria como
// ana_dev, que modera a instância (docs/14, A-2).
const LOCAL_DOMAIN = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
export const DEFAULT_SEED_PASSWORD = 'senha1234';

export function seedPassword({ domain = process.env.INSTANCE_DOMAIN ?? 'localhost:4000', fromEnv = process.env.SEED_PASSWORD } = {}) {
  if (fromEnv) {
    if (fromEnv.length < 12) throw new Error('SEED_PASSWORD precisa de pelo menos 12 caracteres.');
    return fromEnv;
  }
  if (LOCAL_DOMAIN.test(domain)) return DEFAULT_SEED_PASSWORD;
  return randomBytes(12).toString('base64url');
}

/** O seed APAGA o banco: nunca roda em produção. */
export function assertSeedAllowed(nodeEnv = process.env.NODE_ENV) {
  if (nodeEnv === 'production') throw new Error('O seed apaga todos os dados e não roda com NODE_ENV=production.');
}

export const SEED_PASSWORD = seedPassword();

const PEOPLE = [
  ['ana_dev', 'Ana Souza', 'Engenheira de backend. Café e Postgres.'],
  ['bruno_pesquisa', 'Bruno Lima', 'Pesquisador de sistemas distribuídos.'],
  ['carla_ux', 'Carla Mendes', 'Designer de interfaces acessíveis.'],
  ['diego_ops', 'Diego Rocha', 'SRE. Se não tem métrica, não existe.'],
  ['elisa_dados', 'Elisa Martins', 'Cientista de dados e ciclista.'],
  ['fabio_sec', 'Fábio Nunes', 'Segurança da informação, criptografia aplicada.'],
  ['gabi_front', 'Gabriela Alves', 'React, CSS e acessibilidade.'],
  ['heitor_net', 'Heitor Costa', 'Protocolos de rede e P2P.'],
  ['iris_prof', 'Íris Carvalho', 'Professora de computação.'],
  ['joao_mobile', 'João Pereira', 'Desenvolvedor mobile.'],
  ['karen_ml', 'Karen Ribeiro', 'Aprendizado de máquina responsável.'],
  ['leo_infra', 'Leonardo Dias', 'Kubernetes de dia, violão à noite.'],
];

const TOPICS = [
  'Testando paginação por cursor com since_id e until_id. Muito mais estável que offset!',
  'Fan-out on write é ótimo até alguém com 10 milhões de seguidores postar. Aí vira fan-out on read.',
  'Snowflake IDs: tempo + máquina + sequência. Ordenáveis e sem coordenação central.',
  'Alguém já mediu a latência do LRANGE numa lista de 800 itens? Spoiler: microssegundos.',
  'Federação é um problema de identidade antes de ser um problema de transporte.',
  'O pts do MTProto é uma ideia simples e genial para detectar lacunas de atualização.',
  'Reescrevi o componente de feed com IntersectionObserver. Rolagem infinita sem biblioteca.',
  'Lembrete: rate limit não é só proteção, é contrato com o cliente.',
  'Thread sobre modelagem de dados de redes sociais 🧵',
  'Canal de broadcast ≠ grupo. Permissões diferentes, mesmo armazenamento.',
  'Hoje aprendi que o X v2 usa until_id e não max_id. Detalhes importam.',
  'WebSocket para push, REST para escrita. Um caminho de escrita só = menos bugs.',
  'Postgres + Redis continua sendo a dupla mais subestimada da engenharia.',
  'Quem aí já implementou WebFinger na mão?',
  'Bom dia, rede! Café pronto e testes verdes ☕',
];

const REPLIES = [
  'Concordo totalmente.',
  'Interessante! Tem alguma referência sobre isso?',
  'Já passei por isso em produção, dói.',
  'E como fica a consistência nesse caso?',
  'Boa! Vou testar aqui também.',
  'Discordo um pouco: depende muito da carga.',
];

const NEWCOMERS = [
  ['nina_nova', 'Nina Barros', 'Estudo redes comunitárias e rádios livres.', 'Oi! Cheguei agora pelo convite da @ana_dev. Alguém recomenda grupos para quem estuda redes comunitárias?'],
  ['otavio_recife', 'Otávio Lins', 'Dados abertos e mapeamento de bairro em Recife.', 'Primeiro post: trabalho com dados abertos em Recife e quero conectar quem mapeia o próprio bairro.'],
];

const CHANNELS = [
  { slug: 'avisos', title: 'Avisos da instância', description: 'Comunicados oficiais (somente admins publicam).', kind: 'channel' },
  { slug: 'sistemas_distribuidos', title: 'Sistemas Distribuídos', description: 'Grupo de estudo aberto.', kind: 'group' },
  { slug: 'cafe', title: 'Café ☕', description: 'Conversa livre.', kind: 'group' },
];

// Gerador pseudoaleatório determinístico (mulberry32) — seeds reprodutíveis.
function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function seed({ users: userCount = PEOPLE.length, postsPerUser = 8, log = console.log } = {}) {
  const rand = rng(42);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];

  // Relógio simulado: começa ~36h atrás e avança alguns minutos a cada ID.
  let clock = Date.now() - 36 * 3600 * 1000;
  const tick = () => (clock += Math.floor(rand() * 20 * 60 * 1000) + 1000);
  const nextId = createSnowflake(1, () => clock);
  const id = () => {
    tick();
    return nextId();
  };

  assertSeedAllowed();
  await migrate();
  const passwordHash = await hashPassword(SEED_PASSWORD);

  await withTransaction(async (db) => {
    // instance_rules e moderator_names_missing não dependem de users: sem citá-las, regras feitas à mão sobreviviam ao seed.
    await db.query('TRUNCATE instance_rules, moderator_names_missing, users, follows, posts, likes, mentions, channels, channel_members, messages, message_reactions CASCADE');

    // Usuários (os 12 nomeados + extras numerados, se pedido)
    const users = [];
    for (let i = 0; i < userCount; i++) {
      const [username, name, bio] = PEOPLE[i] ?? [`pessoa_${i}`, `Pessoa ${i}`, 'Usuária fictícia de teste.'];
      const uid = id();
      await db.query(
        'INSERT INTO users (id, username, email, password_hash, display_name, bio, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        // Contas "veteranas" (≈2 meses), para que só as recém-chegadas contem como novas nas missões.
        [uid, username, `${username}@exemplo.test`, passwordHash, name, bio, new Date(Date.now() - (60 - i) * 86_400_000)],
      );
      users.push({ id: uid, username });
    }
    const userByName = new Map(users.map((u) => [u.username.toLowerCase(), u.id]));

    // Grafo de follows: cada usuário segue ~40% dos outros
    let follows = 0;
    for (const a of users) {
      for (const b of users) {
        if (a.id !== b.id && rand() < 0.4) {
          await db.query("INSERT INTO follows (follower_id, followee_id, created_at) VALUES ($1,$2, now() - interval '30 days')", [a.id, b.id]);
          follows++;
        }
      }
    }

    // Posts, replies (threads), reposts e likes, intercalados no tempo
    const posts = [];
    const insertPost = async ({ author, text, replyTo = null, repostOf = null }) => {
      const pid = id();
      const parent = replyTo ? posts.find((p) => p.id === replyTo) : null;
      const original = repostOf ? posts.find((p) => p.id === repostOf) : null;
      const conversation = parent?.conversation ?? original?.conversation ?? pid;
      await db.query(
        `INSERT INTO posts (id, author_id, text, reply_to_id, repost_of_id, conversation_id, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [pid, author.id, text, replyTo, repostOf, conversation, snowflakeToDate(pid)],
      );
      for (const name of extractMentions(text)) {
        const mid = userByName.get(name);
        if (mid && mid !== author.id) await db.query('INSERT INTO mentions VALUES ($1,$2) ON CONFLICT DO NOTHING', [pid, mid]);
      }
      const post = { id: pid, author: author.id, conversation, repostOf };
      posts.push(post);
      return post;
    };

    const totalRounds = userCount * postsPerUser;
    for (let i = 0; i < totalRounds; i++) {
      const author = pick(users);
      const originals = posts.filter((p) => !p.repostOf);
      const roll = rand();
      if (roll < 0.55 || originals.length < 3) {
        let text = pick(TOPICS);
        if (rand() < 0.25) text = `@${pick(users).username} ${text}`.slice(0, 280);
        await insertPost({ author, text });
      } else if (roll < 0.85) {
        const target = pick(originals);
        const targetAuthor = users.find((u) => u.id === target.author);
        await insertPost({ author, text: `@${targetAuthor.username} ${pick(REPLIES)}`, replyTo: target.id });
      } else {
        const target = pick(originals);
        if (target.author !== author.id && !posts.some((p) => p.author === author.id && p.repostOf === target.id)) {
          await insertPost({ author, text: '', repostOf: target.id });
        }
      }
    }

    // Recém-chegadas (entraram ontem): alvos reais para as missões "Dê boas-vindas",
    // "Responda quem perguntou" e "Amplifique uma voz pequena".
    const ana = users.find((u) => u.username === 'ana_dev');
    for (const [username, name, bio, text] of NEWCOMERS) {
      const uid = id();
      await db.query(
        'INSERT INTO users (id, username, email, password_hash, display_name, bio, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [uid, username, `${username}@exemplo.test`, passwordHash, name, bio, new Date(Date.now() - 20 * 3_600_000)],
      );
      userByName.set(username, uid);
      if (ana) {
        await db.query("INSERT INTO follows (follower_id, followee_id, created_at) VALUES ($1,$2, now() - interval '20 hours')", [uid, ana.id]);
        if (username === NEWCOMERS[0][0]) {
          await db.query("INSERT INTO invites (code, inviter_id, used_by, used_at) VALUES ('bemvinda', $1, $2, now() - interval '20 hours')", [ana.id, uid]);
        }
      }
      await insertPost({ author: { id: uid }, text });
    }
    const newcomerPostIds = new Set(posts.slice(-NEWCOMERS.length).map((p) => p.id));

    let likes = 0;
    for (const p of posts.filter((x) => !x.repostOf && !newcomerPostIds.has(x.id))) {
      for (const u of users) {
        if (rand() < 0.2) {
          await db.query('INSERT INTO likes (user_id, post_id) VALUES ($1,$2)', [u.id, p.id]);
          likes++;
        }
      }
    }

    // Métricas desnormalizadas (public_metrics) recalculadas em lote
    await db.query(`
      UPDATE posts p SET
        like_count   = (SELECT count(*) FROM likes l WHERE l.post_id = p.id),
        reply_count  = (SELECT count(*) FROM posts r WHERE r.reply_to_id = p.id),
        repost_count = (SELECT count(*) FROM posts r WHERE r.repost_of_id = p.id)`);

    // Canais e grupos (vertente Telegram)
    let messages = 0;
    for (const [i, ch] of CHANNELS.entries()) {
      const owner = users[i % users.length];
      const cid = id();
      await db.query("INSERT INTO channels (id, slug, title, description, kind, owner_id, created_at) VALUES ($1,$2,$3,$4,$5,$6, now() - interval '30 days')", [
        cid, ch.slug, ch.title, ch.description, ch.kind, owner.id,
      ]);
      const members = users.filter((u) => u.id === owner.id || rand() < 0.6);
      for (const m of members) {
        await db.query('INSERT INTO channel_members (channel_id, user_id, role) VALUES ($1,$2,$3)', [
          cid, m.id, m.id === owner.id ? 'owner' : 'member',
        ]);
      }
      const speakers = ch.kind === 'channel' ? [owner] : members;
      let pts = 0;
      for (let k = 0; k < 15; k++) {
        const mid = id();
        pts++;
        const text = ch.kind === 'channel' ? `Aviso #${pts}: ${pick(TOPICS)}` : pick([...TOPICS, ...REPLIES]);
        await db.query('INSERT INTO messages (id, channel_id, author_id, text, pts, created_at) VALUES ($1,$2,$3,$4,$5,$6)', [
          mid, cid, pick(speakers).id, text, pts, snowflakeToDate(mid),
        ]);
        for (const m of members) {
          if (rand() < 0.15) {
            await db.query('INSERT INTO message_reactions (message_id, user_id, emoji) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [
              mid, m.id, pick(['👍', '❤️', '🔥', '😂', '🤔']),
            ]);
          }
        }
        messages++;
      }
      await db.query('UPDATE channels SET pts = $2 WHERE id = $1', [cid, pts]);
    }

    // Moderação: a Ana modera a instância de teste, e uma conta de spam fictícia já tem
    // duas denúncias abertas, para a fila da moderação não começar vazia.
    let reports = 0;
    if (ana) {
      await db.query('UPDATE users SET is_moderator = true WHERE id = $1', [ana.id]);
      const spamId = id();
      await db.query(
        'INSERT INTO users (id, username, email, password_hash, display_name, bio, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [spamId, 'promo_rapida', 'promo_rapida@exemplo.test', passwordHash, 'Promo Rápida', 'Ganhe NWC fácil!!! Link na bio.', new Date(Date.now() - 12 * 86_400_000)],
      );
      userByName.set('promo_rapida', spamId);
      await insertPost({ author: { id: spamId }, text: 'GANHE 500 NWC POR DIA!!! Mande sua senha no privado e eu deposito na hora. Vagas limitadas!!!' });
      const spamPost = posts.at(-1).id;
      await insertPost({ author: { id: spamId }, text: 'Últimas vagas para o esquema de NWC em dobro. Chama no privado!!!' });
      for (const [who, reason, details] of [
        ['bruno_pesquisa', 'golpe', 'Pede senha das pessoas em troca de token. O NWC nem tem valor.'],
        ['karen_ml', 'spam', ''],
      ]) {
        const reporter = userByName.get(who);
        if (!reporter) continue;
        await db.query(
          `INSERT INTO reports (id, reporter_id, target_user_id, post_id, post_text, reason, details, created_at)
           VALUES ($1,$2,$3,$4,(SELECT text FROM posts WHERE id = $4),$5,$6, now() - interval '3 hours')`,
          [id(), reporter, spamId, spamPost, reason, details],
        );
        reports++;
      }
    }

    log(`Seed concluído: ${users.length + NEWCOMERS.length + (ana ? 1 : 0)} usuários (${NEWCOMERS.length} recém-chegadas), ${reports} denúncias abertas, ${follows} follows, ${posts.length} posts, ${likes} likes, ${CHANNELS.length} canais, ${messages} mensagens.`);
  });
  await ensureDefaultRules();

  // Timelines materializadas ficaram obsoletas: o Redis as reconstrói sob demanda.
  const redis = getRedis();
  if (redis) {
    const keys = await redis.keys('tl:home:*').catch(() => []);
    if (keys.length) await redis.del(...keys);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seed({ users: Number(process.env.SEED_USERS ?? PEOPLE.length) })
    .then(() => {
      console.log(`Login de teste: e-mail <usuário>@exemplo.test (ex.: ana_dev@exemplo.test, que modera a instância) com a senha "${SEED_PASSWORD}".`);
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeRedis();
      await pool.end();
    });
}
