import { createServer } from 'node:http';
import { io as connect } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getRedis } from '../src/cache.js';
import { trustProxy } from '../src/config.js';
import { resetRateLimitMemory } from '../src/lib/rateLimit.js';
import { attachRealtime, WS_LIMITS } from '../src/realtime/socket.js';
import { query } from '../src/db.js';
import { promoteModeratorManually, promoteModerators } from '../src/services/moderation.js';
import { assertSeedAllowed, DEFAULT_SEED_PASSWORD, seedPassword } from '../src/seed.js';
import { api, app, post, resetDb, signup } from './helpers.js';

// Correções da análise de brechas (docs/14). Cada bloco cita o achado.

beforeEach(resetDb);

const ruleId = async () => (await api().get('/api/instancia/regras')).body.data.rules[0].id;
async function moderator(name = 'mod') {
  const m = await signup(name);
  await promoteModerators([name]);
  return m;
}

describe('M-1 · MODERATORS não promove nome criado depois', () => {
  it('nome ainda livre fica anotado; quem o cadastra depois não vira moderação', async () => {
    expect(await promoteModerators(['futuro_mod'])).toMatchObject({ promoted: 0, missing: ['futuro_mod'] });
    const intruso = await signup('futuro_mod');
    expect(await promoteModerators(['futuro_mod'])).toMatchObject({ promoted: 0, refused: ['futuro_mod'] });
    expect((await api().get('/api/moderacao/denuncias').set(intruso.auth)).status).toBe(403);
    // A pessoa que administra confirma a conta certa à mão.
    await promoteModeratorManually('futuro_mod');
    expect((await api().get('/api/moderacao/denuncias').set(intruso.auth)).status).toBe(200);
  });

  it('conta que já existia é promovida normalmente', async () => {
    await signup('ana');
    expect(await promoteModerators(['ana'])).toMatchObject({ promoted: 1, missing: [], refused: [] });
  });
});

describe('A-1 e A-2 · configuração de pré-produção', () => {
  it('TRUST_PROXY=true impede iniciar fora de produção; números e listas continuam valendo', () => {
    expect(() => trustProxy('true', 'development')).toThrow(/X-Forwarded-For/);
    expect(trustProxy('1', 'development')).toBe(1);
    expect(trustProxy('10.0.0.1', 'development')).toBe('10.0.0.1');
    expect(trustProxy(undefined, 'development')).toBe(false);
  });

  it('em produção, TRUST_PROXY=true continua aceito (só avisa): nada muda numa instalação no ar', () => {
    expect(trustProxy('true', 'production')).toBe(true);
  });

  it('o seed não roda em produção e só usa a senha conhecida em domínio local', () => {
    expect(() => assertSeedAllowed('production')).toThrow(/apaga todos os dados/);
    expect(() => assertSeedAllowed('development')).not.toThrow();
    expect(seedPassword({ domain: 'localhost:4000', fromEnv: undefined })).toBe(DEFAULT_SEED_PASSWORD);
    const remote = seedPassword({ domain: 'pre.agora.exemplo', fromEnv: undefined });
    expect(remote).not.toBe(DEFAULT_SEED_PASSWORD);
    expect(remote.length).toBeGreaterThanOrEqual(12);
    expect(seedPassword({ domain: 'pre.agora.exemplo', fromEnv: 'uma-senha-longa-123' })).toBe('uma-senha-longa-123');
    expect(() => seedPassword({ domain: 'pre.agora.exemplo', fromEnv: 'curta' })).toThrow(/12 caracteres/);
  });
});

describe('T-1 · conta suspensa não recebe interação pelo ID direto', () => {
  it('recompensar post de suspensa é recusado e o saldo não sai da carteira', async () => {
    const mod = await moderator();
    const alvo = await signup('alvo');
    const fan = await signup('fan_x');
    const p = await post(alvo, 'post antes da suspensão');
    const rep = (await api().post('/api/denuncias').set(fan.auth).send({ username: 'alvo', reason: 'spam' })).body.data;
    await api().post(`/api/moderacao/denuncias/${rep.id}/resolver`).set(mod.auth).send({ action: 'suspender', rule_id: await ruleId() });

    const before = (await api().get('/api/carteira').set(fan.auth)).body.balance;
    expect((await api().post(`/api/posts/${p.id}/recompensa`).set(fan.auth)).status).toBe(404);
    expect((await api().get('/api/carteira').set(fan.auth)).body.balance).toBe(before);
    // Curtir, responder e seguir também param.
    expect((await api().post(`/api/posts/${p.id}/like`).set(fan.auth)).status).toBe(404);
    expect((await api().post('/api/posts').set(fan.auth).send({ text: 'resposta', reply_to_id: p.id })).status).toBe(404);
    expect((await api().post('/api/users/alvo/follow').set(fan.auth)).status).toBe(404);
  });
});

describe('M-2 · recurso de suspensão não confirma senha', () => {
  it('senha errada e conta não suspensa recebem a mesma resposta', async () => {
    await signup('maria');
    const body = (password) => ({ email: 'maria@exemplo.test', password, text: 'quero recorrer da decisão' });
    const wrong = await api().post('/api/recursos/suspensao').send(body('errada-123'));
    const right = await api().post('/api/recursos/suspensao').send(body('senha1234'));
    expect(wrong.status).toBe(401);
    expect(right.status).toBe(401);
    expect(right.body.error).toBe(wrong.body.error);
  });
});

describe('M-3 · apagar post denunciado não destrói a prova', () => {
  it('com denúncia aberta, o post sai do ar mas a moderação ainda decide; recurso aceito não o traz de volta', async () => {
    const mod = await moderator();
    const autor = await signup('autor');
    const outra = await signup('outra');
    const p = await post(autor, 'post problemático');
    const rep = (await api().post('/api/denuncias').set(outra.auth).send({ post_id: p.id, reason: 'spam' })).body.data;

    expect((await api().delete(`/api/posts/${p.id}`).set(autor.auth)).status).toBe(200);
    expect((await api().get(`/api/posts/${p.id}`).set(outra.auth)).status).toBe(404);
    const queue = (await api().get('/api/moderacao/denuncias').set(mod.auth)).body.data;
    expect(queue.find((r) => r.id === rep.id)).toMatchObject({ post_exists: true, post_deleted_by_author: true, post_text: 'post problemático' });

    const decided = await api().post(`/api/moderacao/denuncias/${rep.id}/resolver`).set(mod.auth).send({ action: 'remover_post', rule_id: await ruleId() });
    expect(decided.status).toBe(200);
    const sanction = (await api().get('/api/conta/decisoes').set(autor.auth)).body.data[0];
    await api().post(`/api/conta/decisoes/${sanction.id}/recurso`).set(autor.auth).send({ text: 'eu mesma apaguei, foi engano' });
    await api().post(`/api/moderacao/recursos/${sanction.id}/decidir`).set(mod.auth).send({ decision: 'aceitar' });
    expect((await api().get(`/api/posts/${p.id}`).set(outra.auth)).status).toBe(404);
  });

  it('sem denúncia, apagar continua apagando de vez', async () => {
    const autor = await signup('autor');
    const p = await post(autor, 'post comum');
    await api().delete(`/api/posts/${p.id}`).set(autor.auth);
    expect((await query('SELECT count(*)::int AS n FROM posts WHERE id = $1', [p.id])).rows[0].n).toBe(0);
  });
});

describe('C-1, C-2 e C-3 · grupos', () => {
  async function group() {
    const dona = await signup('dona');
    await api().post('/api/channels').set(dona.auth).send({ slug: 'sala', title: 'Sala', kind: 'group' });
    await api().post('/api/channels/sala/messages').set(dona.auth).send({ text: 'conversa interna' });
    return dona;
  }

  it('C-1: só membro lê o grupo (histórico e lacuna); canal de transmissão segue com prévia', async () => {
    const dona = await group();
    const fora = await signup('fora');
    expect((await api().get('/api/channels/sala/messages').set(fora.auth)).status).toBe(403);
    expect((await api().get('/api/channels/sala/difference?pts=0').set(fora.auth)).status).toBe(403);
    await api().post('/api/channels/sala/members').set(fora.auth);
    expect((await api().get('/api/channels/sala/messages').set(fora.auth)).status).toBe(200);

    await api().post('/api/channels').set(dona.auth).send({ slug: 'avisos', title: 'Avisos', kind: 'channel' });
    expect((await api().get('/api/channels/avisos/messages').set(fora.auth)).status).toBe(200);
  });

  it('C-2: dono remove; a pessoa não lê nem entra de novo até a remoção ser desfeita', async () => {
    const dona = await group();
    const chato = await signup('chato');
    await api().post('/api/channels/sala/members').set(chato.auth);
    expect((await api().delete('/api/channels/sala/members/chato').set(chato.auth)).status).toBe(403);
    expect((await api().delete('/api/channels/sala/members/chato').set(dona.auth)).body.data).toMatchObject({ removed: true, banned: true });
    expect((await api().get('/api/channels/sala/messages').set(chato.auth)).status).toBe(403);
    expect((await api().post('/api/channels/sala/members').set(chato.auth)).status).toBe(403);
    await api().delete('/api/channels/sala/bans/chato').set(dona.auth);
    expect((await api().post('/api/channels/sala/members').set(chato.auth)).status).toBe(200);
  });

  it('C-2: admin remove membro, mas não outro admin nem o dono', async () => {
    const dona = await group();
    const adm = await signup('adm');
    const adm2 = await signup('adm2');
    for (const p of [adm, adm2]) await api().post('/api/channels/sala/members').set(p.auth);
    for (const u of ['adm', 'adm2']) await api().put(`/api/channels/sala/members/${u}/role`).set(dona.auth).send({ role: 'admin' });
    expect((await api().delete('/api/channels/sala/members/adm2').set(adm.auth)).status).toBe(403);
    expect((await api().delete('/api/channels/sala/members/dona').set(adm.auth)).status).toBe(403);
  });

  it('C-3: só emojis da lista, e no máximo 3 por pessoa na mesma mensagem', async () => {
    const dona = await group();
    const mid = (await api().get('/api/channels/sala/messages').set(dona.auth)).body.data[0].id;
    const react = (emoji) => api().post(`/api/channels/sala/messages/${mid}/reactions`).set(dona.auth).send({ emoji });
    expect((await react('texto livre')).status).toBe(400);
    for (const e of ['👍', '❤️', '🔥']) expect((await react(e)).status).toBe(200);
    expect((await react('😂')).status).toBe(409);
    expect((await react('👍')).status).toBe(200); // repetir a mesma não conta como nova
  });
});

describe('P-1 · menções por post', () => {
  it('até 10 menções passam; 11 são recusadas', async () => {
    const a = await signup('autora');
    const names = Array.from({ length: 11 }, (_, i) => `@pessoa_${i}`);
    expect((await api().post('/api/posts').set(a.auth).send({ text: names.slice(0, 10).join(' ') })).status).toBe(201);
    const r = await api().post('/api/posts').set(a.auth).send({ text: names.join(' ') });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/no máximo 10/);
  });
});

describe('U-1 · listas de seguidores', () => {
  it('conta suspensa não mostra listas; quem tem bloqueio recebe lista vazia', async () => {
    const mod = await moderator();
    const a = await signup('aaa');
    const b = await signup('bbb');
    await api().post('/api/users/aaa/follow').set(b.auth);
    await api().post('/api/users/bbb/block').set(a.auth);
    expect((await api().get('/api/users/aaa/followers').set(b.auth)).body.data).toEqual([]);
    const rep = (await api().post('/api/denuncias').set(b.auth).send({ username: 'aaa', reason: 'spam' })).body.data;
    await api().post(`/api/moderacao/denuncias/${rep.id}/resolver`).set(mod.auth).send({ action: 'suspender', rule_id: await ruleId() });
    expect((await api().get('/api/users/aaa/following')).status).toBe(404);
  });
});

describe('M-4 · ninguém decide o próprio caso quando há outra pessoa na moderação', () => {
  it('quem denunciou não decide a própria denúncia', async () => {
    const m1 = await moderator('mod1');
    await moderator('mod2');
    await signup('alvo');
    const rep = (await api().post('/api/denuncias').set(m1.auth).send({ username: 'alvo', reason: 'spam' })).body.data;
    expect((await api().post(`/api/moderacao/denuncias/${rep.id}/resolver`).set(m1.auth).send({ action: 'arquivar' })).status).toBe(403);
  });

  it('com uma pessoa só na moderação, ela continua decidindo', async () => {
    const m1 = await moderator('mod1');
    await signup('alvo');
    const rep = (await api().post('/api/denuncias').set(m1.auth).send({ username: 'alvo', reason: 'spam' })).body.data;
    expect((await api().post(`/api/moderacao/denuncias/${rep.id}/resolver`).set(m1.auth).send({ action: 'arquivar' })).status).toBe(200);
  });
});

describe('Posts só com login (decisão do projeto)', () => {
  it('sem login, nenhuma rota entrega post: timeline, post, thread, perfil e federação', async () => {
    const a = await signup('autora');
    const p = await post(a, 'só para quem entrou');
    for (const path of ['/api/posts', `/api/posts/${p.id}`, `/api/posts/${p.id}/thread`, '/api/users/autora/posts']) {
      expect((await api().get(path)).status, path).toBe(401);
    }
    expect(JSON.stringify((await api().get('/federation/users/autora/outbox')).body)).not.toContain('só para quem entrou');
    // Com login, tudo continua igual.
    expect((await api().get(`/api/posts/${p.id}`).set(a.auth)).status).toBe(200);
  });
});

describe('A-4 · limite de senhas erradas por conta', () => {
  beforeEach(async () => {
    delete process.env.DISABLE_RATE_LIMIT;
    resetRateLimitMemory();
    await getRedis()?.flushdb();
  });
  afterEach(() => {
    process.env.DISABLE_RATE_LIMIT = '1';
  });

  it('10 senhas erradas para a mesma conta bloqueiam a 11ª tentativa, mesmo vindo de outro IP; outras contas seguem livres', async () => {
    await signup('vitima');
    await signup('outra');
    const login = (email, password, ip) => api().post('/api/auth/login').set('X-Forwarded-For', ip).send({ email, password });
    // Sem TRUST_PROXY, o IP é o da conexão: aqui o limite por IP (20) não é atingido.
    for (let i = 0; i < 10; i++) expect((await login('vitima@exemplo.test', `errada-${i}`, `10.0.0.${i}`)).status).toBe(401);
    const blocked = await login('vitima@exemplo.test', 'senha1234', '10.0.1.1');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/esta conta/);
    expect((await login('outra@exemplo.test', 'senha1234', '10.0.1.2')).status).toBe(200);
  });

  it('acertar a senha não gasta tentativa', async () => {
    await signup('acerta');
    for (let i = 0; i < 12; i++) expect((await api().post('/api/auth/login').send({ email: 'acerta@exemplo.test', password: 'senha1234' })).status).toBe(200);
  });
});

describe('C-1 e C-4 · tempo real', () => {
  let server;
  let ioServer;
  let url;
  const sockets = [];
  beforeEach(async () => {
    server = createServer(app);
    ioServer = attachRealtime(server);
    await new Promise((r) => server.listen(0, r));
    url = `http://localhost:${server.address().port}`;
  });
  afterEach(async () => {
    sockets.splice(0).forEach((s) => s.close());
    await new Promise((r) => ioServer.close(r));
  });
  const open = (who) =>
    new Promise((resolve, reject) => {
      const s = connect(url, { auth: { token: who.token }, transports: ['websocket'], reconnection: false });
      sockets.push(s);
      s.on('connect', () => resolve(s));
      s.on('connect_error', reject);
    });

  it('grupo: quem não entrou não assina; quem sai ou é removido para de receber', async () => {
    const dona = await signup('dona');
    const fora = await signup('fora');
    await api().post('/api/channels').set(dona.auth).send({ slug: 'sala', title: 'Sala', kind: 'group' });
    const s = await open(fora);
    expect(await s.emitWithAck('channel:subscribe', { slug: 'sala' })).toMatchObject({ ok: false, error: expect.stringMatching(/Entre no grupo/) });

    await api().post('/api/channels/sala/members').set(fora.auth);
    expect(await s.emitWithAck('channel:subscribe', { slug: 'sala' })).toMatchObject({ ok: true });
    const removed = new Promise((r) => s.once('channel:removed', r));
    await api().delete('/api/channels/sala/members/fora').set(dona.auth);
    await removed;
    const got = [];
    s.on('message:new', (m) => got.push(m));
    await api().post('/api/channels/sala/messages').set(dona.auth).send({ text: 'depois da remoção' });
    await new Promise((r) => setTimeout(r, 150));
    expect(got).toEqual([]);
  });

  it(`no máximo ${WS_LIMITS.connectionsPerUser} conexões por conta`, async () => {
    const a = await signup('muitas');
    for (let i = 0; i < WS_LIMITS.connectionsPerUser; i++) await open(a);
    await expect(open(a)).rejects.toThrow('too_many_connections');
  });

  it(`assinar tem ritmo máximo (${WS_LIMITS.subscribesPerMinute} por minuto por conexão)`, async () => {
    const a = await signup('assina');
    await api().post('/api/channels').set(a.auth).send({ slug: 'avisos', title: 'Avisos', kind: 'channel' });
    const s = await open(a);
    let last;
    for (let i = 0; i <= WS_LIMITS.subscribesPerMinute; i++) last = await s.emitWithAck('channel:subscribe', { slug: 'avisos' });
    expect(last).toMatchObject({ ok: false, error: expect.stringMatching(/Muitos pedidos/) });
  });
});
