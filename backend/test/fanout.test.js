import { createServer } from 'node:http';
import { io as connect } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getRedis } from '../src/cache.js';
import { config } from '../src/config.js';
import { attachRealtime } from '../src/realtime/socket.js';
import { drainFanoutQueue, queueKey, queueLength, startFanoutWorker } from '../src/services/fanout.js';
import { api, app, post, resetDb, signup } from './helpers.js';

// Com a fila ligada: o pedido de postar não espera a cópia para os seguidores.
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
const open = (token) =>
  new Promise((resolve, reject) => {
    const s = connect(url, { auth: { token }, transports: ['websocket'], reconnection: false });
    sockets.push(s);
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
  });
const timeline = async (who) => (await api().get('/api/timeline').set(who.auth)).body.data.map((p) => p.text);

describe('distribuição por fila (fan-out)', () => {
  let ana, bruno;
  beforeEach(async () => {
    await resetDb();
    config.fanoutQueue = true;
    [ana, bruno] = await Promise.all([signup('ana'), signup('bruno')]);
    await api().post('/api/users/ana/follow').set(bruno.auth);
    await timeline(bruno); // aquece o cache do Bruno (a lista no Redis passa a existir)
  });
  afterEach(() => {
    config.fanoutQueue = false;
  });

  it('o post entra na fila; a autora vê na hora e quem segue vê depois que o trabalhador passa', async () => {
    await post(ana, 'saiu da fila');
    expect(await queueLength()).toBe(1);
    expect(await timeline(ana)).toEqual(['saiu da fila']);
    expect(await timeline(bruno)).toEqual([]); // cache do Bruno ainda sem o post
    await drainFanoutQueue();
    expect(await queueLength()).toBe(0);
    expect(await timeline(bruno)).toEqual(['saiu da fila']);
  });

  it('o aviso em tempo real sai quando o trabalho termina, e o trabalhador processa sozinho', async () => {
    const s = await open(bruno.token);
    const got = new Promise((r) => s.once('timeline:new', r));
    const stop = await startFanoutWorker();
    try {
      await post(ana, 'ao vivo pela fila');
      expect((await got).data.text).toBe('ao vivo pela fila');
      expect(await timeline(bruno)).toEqual(['ao vivo pela fila']);
    } finally {
      stop();
    }
  });

  it('trabalho que estava em andamento quando o processo caiu volta para a fila', async () => {
    const redis = getRedis();
    const job = JSON.stringify({ postId: (await post(ana, 'quase perdido')).id, authorId: ana.user.id });
    await redis.del(queueKey());
    await redis.lpush(`fanout:processing:${config.workerId}`, job); // "caiu" no meio
    const stop = await startFanoutWorker();
    try {
      for (let i = 0; i < 50 && !(await timeline(bruno)).length; i++) await new Promise((r) => setTimeout(r, 50));
      expect(await timeline(bruno)).toEqual(['quase perdido']);
      expect(await redis.llen(`fanout:processing:${config.workerId}`)).toBe(0);
    } finally {
      stop();
    }
  });

  it('cada instância tem a sua fila: o trabalho roda onde o post foi criado', async () => {
    await post(ana, 'só desta instância');
    const before = config.workerId;
    config.workerId = before + 1; // "outra instância"
    try {
      expect(await queueLength()).toBe(0);
      await drainFanoutQueue();
      expect(await timeline(bruno)).toEqual([]);
    } finally {
      config.workerId = before;
    }
    await drainFanoutQueue();
    expect(await timeline(bruno)).toEqual(['só desta instância']);
  });

  it('post apagado antes de o trabalho rodar não é distribuído', async () => {
    const p = await post(ana, 'apagado logo');
    await api().delete(`/api/posts/${p.id}`).set(ana.auth);
    await drainFanoutQueue();
    expect(await timeline(bruno)).toEqual([]);
  });
});
