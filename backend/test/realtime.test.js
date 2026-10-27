import { createServer } from 'node:http';
import { io as connect } from 'socket.io-client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { attachRealtime } from '../src/realtime/socket.js';
import { api, app, post, resetDb, signup } from './helpers.js';

let server, ioServer, url;
const sockets = [];

beforeAll(async () => {
  server = createServer(app);
  ioServer = attachRealtime(server);
  await new Promise((r) => server.listen(0, r));
  url = `http://localhost:${server.address().port}`;
});
afterAll(async () => {
  sockets.forEach((s) => s.close());
  await new Promise((r) => ioServer.close(r));
});

function open(token) {
  const s = connect(url, { auth: { token }, transports: ['websocket'], reconnection: false });
  sockets.push(s);
  return new Promise((resolve, reject) => {
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
  });
}
const once = (socket, event) => new Promise((r) => socket.once(event, r));

describe('tempo real (Socket.io)', () => {
  let alice, bob;
  beforeEach(async () => {
    await resetDb();
    alice = await signup('alice');
    bob = await signup('bob');
  });

  it('recusa conexão sem token válido', async () => {
    await expect(open('invalido')).rejects.toThrow('unauthorized');
  });

  it('entrega novos posts a quem segue o autor (timeline:new)', async () => {
    await api().post('/api/users/bob/follow').set(alice.auth);
    const s = await open(alice.token);
    const received = once(s, 'timeline:new');
    await post(bob, 'ao vivo');
    expect((await received).data.text).toBe('ao vivo');
  });

  it('notifica menções', async () => {
    const s = await open(alice.token);
    const received = once(s, 'notification');
    await post(bob, 'olá @alice');
    expect(await received).toMatchObject({ type: 'mention', post: { data: { text: 'olá @alice' } } });
  });

  it('entrega mensagens e reações aos inscritos no canal', async () => {
    await api().post('/api/channels').set(alice.auth).send({ slug: 'sala', title: 'Sala', kind: 'group' });
    await api().post('/api/channels/sala/members').set(bob.auth);
    const s = await open(bob.token);
    const ack = await s.emitWithAck('channel:subscribe', { slug: 'sala' });
    expect(ack).toEqual({ ok: true, pts: 0 });

    const msgP = once(s, 'message:new');
    const sent = await api().post('/api/channels/sala/messages').set(alice.auth).send({ text: 'oi sala' });
    expect(await msgP).toMatchObject({ data: { text: 'oi sala', pts: 1 } });

    const reactP = once(s, 'message:reactions');
    await api().post(`/api/channels/sala/messages/${sent.body.data.id}/reactions`).set(alice.auth).send({ emoji: '❤️' });
    expect(await reactP).toEqual({ message_id: sent.body.data.id, reactions: [{ emoji: '❤️', count: 1 }] });

    const bad = await s.emitWithAck('channel:subscribe', { slug: 'nao_existe' });
    expect(bad.ok).toBe(false);
  });
});
