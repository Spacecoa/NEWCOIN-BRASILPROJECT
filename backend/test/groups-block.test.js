import { createServer } from 'node:http';
import { io as connect } from 'socket.io-client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { promoteModerators } from '../src/services/moderation.js';
import { attachRealtime } from '../src/realtime/socket.js';
import { api, app, resetDb, signup } from './helpers.js';

// Bloqueio, silêncio e suspensão também valem dentro de grupos e canais.

let alice, bob, carol;
const say = async (who, text) => (await api().post('/api/channels/sala/messages').set(who.auth).send({ text })).body.data;
const history = async (who) => (await api().get('/api/channels/sala/messages').set(who.auth)).body;
const byText = (body, text) => body.data.find((m) => m.text === text);

beforeEach(async () => {
  await resetDb();
  alice = await signup('alice');
  bob = await signup('bob');
  carol = await signup('carol');
  await api().post('/api/channels').set(alice.auth).send({ slug: 'sala', title: 'Sala', kind: 'group' });
  await api().post('/api/channels/sala/members').set(bob.auth);
  await api().post('/api/channels/sala/members').set(carol.auth);
});

describe('grupos com bloqueio', () => {
  it('a mensagem de quem tem bloqueio vira aviso, sem texto nem autor, e mantém o pts', async () => {
    const mb = await say(bob, 'mensagem do bob');
    const ma = await say(alice, 'mensagem da alice');
    await api().post('/api/users/bob/block').set(alice.auth);

    const asAlice = await history(alice);
    const hidden = asAlice.data.find((m) => m.id === mb.id);
    expect(hidden).toMatchObject({ hidden: 'bloqueio', text: null, author_id: null, reactions: [], pts: mb.pts });
    expect(asAlice.includes.users.map((u) => u.username)).not.toContain('bob');
    // Vale nos dois sentidos.
    expect((await history(bob)).data.find((m) => m.id === ma.id)).toMatchObject({ hidden: 'bloqueio', text: null });
    // Quem não tem nada com isso vê as duas.
    const asCarol = await history(carol);
    expect(byText(asCarol, 'mensagem do bob')).toBeTruthy();
    expect(byText(asCarol, 'mensagem da alice')).toBeTruthy();
    // Recuperar lacuna por pts segue a mesma regra.
    const diff = (await api().get(`/api/channels/sala/difference?pts=0`).set(alice.auth)).body;
    expect(diff.data.find((m) => m.id === mb.id).hidden).toBe('bloqueio');
    expect(diff.data.map((m) => m.pts)).toEqual([1, 2]);
  });

  it('não dá para reagir à mensagem de quem tem bloqueio', async () => {
    const mb = await say(bob, 'do bob');
    const ma = await say(alice, 'da alice');
    await api().post('/api/users/bob/block').set(alice.auth);
    expect((await api().post(`/api/channels/sala/messages/${mb.id}/reactions`).set(alice.auth).send({ emoji: '👍' })).status).toBe(403);
    expect((await api().post(`/api/channels/sala/messages/${ma.id}/reactions`).set(bob.auth).send({ emoji: '👍' })).status).toBe(403);
    expect((await api().post(`/api/channels/sala/messages/${mb.id}/reactions`).set(carol.auth).send({ emoji: '👍' })).status).toBe(200);
  });

  it('silenciado chega marcado (com o texto, para o app recolher); desbloquear devolve tudo', async () => {
    await say(carol, 'da carol');
    await api().post('/api/users/carol/mute').set(alice.auth);
    expect(byText(await history(alice), 'da carol')).toMatchObject({ muted: true });
    expect(byText(await history(bob), 'da carol').muted).toBeUndefined();
    await api().post('/api/users/carol/block').set(alice.auth);
    await api().delete('/api/users/carol/block').set(alice.auth);
    await api().delete('/api/users/carol/mute').set(alice.auth);
    const m = byText(await history(alice), 'da carol');
    expect(m.hidden).toBeUndefined();
    expect(m.muted).toBeUndefined();
  });

  it('conta suspensa: as mensagens dela viram aviso para todo mundo', async () => {
    const mb = await say(bob, 'golpe no grupo');
    await promoteModerators(['alice']);
    const rule = (await api().get('/api/instancia/regras')).body.data.rules[2];
    const rid = (await api().post('/api/denuncias').set(carol.auth).send({ username: 'bob', reason: 'golpe' })).body.data.id;
    await api().post(`/api/moderacao/denuncias/${rid}/resolver`).set(alice.auth).send({ action: 'suspender', rule_id: rule.id });
    for (const who of [alice, carol]) {
      expect((await history(who)).data.find((m) => m.id === mb.id)).toMatchObject({ hidden: 'suspensa', text: null });
    }
  });
});

describe('grupos com bloqueio, em tempo real', () => {
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
  async function join(who) {
    const s = connect(url, { auth: { token: who.token }, transports: ['websocket'], reconnection: false });
    sockets.push(s);
    await new Promise((res, rej) => {
      s.on('connect', res);
      s.on('connect_error', rej);
    });
    await new Promise((res) => s.emit('channel:subscribe', { slug: 'sala' }, res));
    return s;
  }
  const next = (s) => new Promise((r) => s.once('message:new', r));

  it('cada pessoa recebe a versão que pode ver', async () => {
    await api().post('/api/users/bob/block').set(alice.auth);
    await api().post('/api/users/bob/mute').set(carol.auth);
    const [sa, sc] = await Promise.all([join(alice), join(carol)]);
    const [ga, gc] = [next(sa), next(sc)];
    const sent = await say(bob, 'oi grupo');
    const [toAlice, toCarol] = await Promise.all([ga, gc]);
    expect(toAlice.data).toMatchObject({ id: sent.id, pts: sent.pts, hidden: 'bloqueio', text: null, author_id: null });
    expect(toAlice.includes.users).toEqual([]);
    expect(toCarol.data).toMatchObject({ id: sent.id, text: 'oi grupo', muted: true });
  });
});
