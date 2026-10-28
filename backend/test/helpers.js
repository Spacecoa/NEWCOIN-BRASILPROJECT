import request from 'supertest';
import { createApp } from '../src/app.js';
import { getRedis } from '../src/cache.js';
import { query } from '../src/db.js';
import { migrate } from '../src/migrate.js';

export const app = createApp();
export const api = () => request(app);

export async function resetDb() {
  await migrate();
  await query('TRUNCATE users, sessions, mutes, blocks, reports, follows, posts, likes, mentions, channels, channel_members, messages, message_reactions CASCADE');
  const redis = getRedis();
  if (redis) await redis.flushdb();
}

/** Registra um usuário e devolve { user, token, auth } — auth é o header Authorization. */
export async function signup(username, extra = {}) {
  const res = await api()
    .post('/api/auth/register')
    .send({ username, email: `${username}@exemplo.test`, password: 'senha1234', ...extra });
  if (res.status !== 201) throw new Error(`signup falhou: ${res.status} ${JSON.stringify(res.body)}`);
  return { user: res.body.user, token: res.body.token, auth: { Authorization: `Bearer ${res.body.token}` } };
}

export async function post(who, text, replyToId) {
  const res = await api().post('/api/posts').set(who.auth).send({ text, reply_to_id: replyToId });
  if (res.status !== 201) throw new Error(`post falhou: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data;
}
