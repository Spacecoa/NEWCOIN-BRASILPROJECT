import request from 'supertest';
import { createApp } from '../src/app.js';
import { getRedis } from '../src/cache.js';
import { query } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { ensureDefaultRules } from '../src/services/rules.js';

export const app = createApp();
export const api = () => request(app);

// Posts só são lidos com login: os testes que só querem LER usam esta conta neutra.
let readerAuth = null;
export async function asReader() {
  readerAuth ??= (await signup(`leitor_${Math.random().toString(36).slice(2, 8)}`)).auth;
  return readerAuth;
}

export async function resetDb() {
  readerAuth = null;
  await migrate();
  await query('TRUNCATE official_observations, official_raw, moderator_names_missing, users, sessions, mutes, blocks, reports, sanctions, instance_rules, follows, posts, likes, mentions, channels, channel_members, messages, message_reactions CASCADE');
  await ensureDefaultRules();
  const redis = getRedis();
  if (redis) await redis.flushdb();
}

/** Registra um usuário e devolve { user, token, auth } — auth é o header Authorization. */
export async function signup(username, extra = {}) {
  const res = await api()
    .post('/api/auth/register')
    .send({ username, email: `${username}@exemplo.test`, password: 'senha1234', accept_rules: true, ...extra });
  if (res.status !== 201) throw new Error(`signup falhou: ${res.status} ${JSON.stringify(res.body)}`);
  return { user: res.body.user, token: res.body.token, auth: { Authorization: `Bearer ${res.body.token}` } };
}

export async function post(who, text, replyToId) {
  const res = await api().post('/api/posts').set(who.auth).send({ text, reply_to_id: replyToId });
  if (res.status !== 201) throw new Error(`post falhou: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data;
}
