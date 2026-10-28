import { createServer } from 'node:http';
import jwt from 'jsonwebtoken';
import { io as connect } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getRedis } from '../src/cache.js';
import { config, resolveJwtSecret } from '../src/config.js';
import { pool, withTransaction } from '../src/db.js';
import { resetRateLimitMemory } from '../src/lib/rateLimit.js';
import { attachRealtime } from '../src/realtime/socket.js';
import { resetSessionMemory } from '../src/services/sessions.js';
import { api, app, resetDb, signup } from './helpers.js';

// Etapa 1 de segurança: segredo forte, sessões revogáveis, limite geral,
// cabeçalhos de proteção, tempo-limite no banco e erros sem detalhes internos.

const refreshCookie = (res) => (res.headers['set-cookie'] ?? []).find((c) => c.startsWith('agora_refresh='));
const cookieValue = (setCookie) => setCookie.split(';')[0]; // "agora_refresh=..."
const bearer = (token) => ({ Authorization: `Bearer ${token}` });

async function login(username) {
  const res = await api().post('/api/auth/login').send({ login: username, password: 'senha1234' });
  expect(res.status).toBe(200);
  return { token: res.body.token, cookie: cookieValue(refreshCookie(res)) };
}

beforeEach(async () => {
  await resetDb();
  resetSessionMemory();
});

describe('segredo dos tokens (A1)', () => {
  it('recusa segredos conhecidos ou curtos, em qualquer ambiente', () => {
    for (const env of ['development', 'production', 'test']) {
      expect(() => resolveJwtSecret('troque-este-segredo-em-qualquer-ambiente-compartilhado', env)).toThrow(/fraco ou conhecido/);
      expect(() => resolveJwtSecret('dev-only-secret', env)).toThrow();
      expect(() => resolveJwtSecret('curto-demais', env)).toThrow();
    }
  });

  it('em produção, sem segredo, não inicia; em desenvolvimento gera um aleatório', () => {
    expect(() => resolveJwtSecret('', 'production')).toThrow(/obrigatório/);
    const a = resolveJwtSecret(undefined, 'test');
    const b = resolveJwtSecret(undefined, 'test');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
    const forte = 'x'.repeat(16) + 'y'.repeat(16);
    expect(resolveJwtSecret(forte, 'production')).toBe(forte);
  });

  it('token assinado com outro segredo ou sem sessão não entra', async () => {
    const { user } = await signup('alice');
    const forjado = jwt.sign({ sub: user.id, username: 'alice', sid: '1' }, 'troque-este-segredo-em-qualquer-ambiente-compartilhado');
    expect((await api().get('/api/auth/me').set(bearer(forjado))).status).toBe(401);
    const semSessao = jwt.sign({ sub: user.id, username: 'alice' }, config.jwtSecret);
    expect((await api().get('/api/auth/me').set(bearer(semSessao))).status).toBe(401);
  });
});

describe('sessões revogáveis (A2)', () => {
  it('login entrega token curto e cookie HttpOnly, SameSite=Strict, só para /api/auth', async () => {
    await signup('alice');
    const res = await api().post('/api/auth/login').send({ login: 'alice', password: 'senha1234' });
    const payload = jwt.decode(res.body.token);
    expect(payload.exp - payload.iat).toBe(15 * 60);
    expect(payload.sid).toMatch(/^\d+$/);
    expect(res.body.expires_in).toBe(15 * 60);
    const c = refreshCookie(res);
    expect(c).toMatch(/HttpOnly/i);
    expect(c).toMatch(/SameSite=Strict/i);
    expect(c).toMatch(/Path=\/api\/auth/);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('renovar troca o cookie e devolve um token novo; o cookie antigo deixa de valer', async () => {
    await signup('alice');
    const s = await login('alice');
    const r1 = await api().post('/api/auth/refresh').set('Cookie', s.cookie);
    expect(r1.status).toBe(200);
    expect(r1.body.user.username).toBe('alice');
    const novo = cookieValue(refreshCookie(r1));
    expect(novo).not.toBe(s.cookie);
    expect((await api().get('/api/auth/me').set(bearer(r1.body.token))).status).toBe(200);
    const r2 = await api().post('/api/auth/refresh').set('Cookie', novo);
    expect(r2.status).toBe(200);
  });

  it('cookie copiado e reusado encerra a sessão inteira (dos dois lados)', async () => {
    await signup('alice');
    const s = await login('alice');
    const legit = await api().post('/api/auth/refresh').set('Cookie', s.cookie); // a pessoa renova
    await pool.query("UPDATE sessions SET rotated_at = now() - interval '1 minute'"); // a cópia volta depois
    const ladrao = await api().post('/api/auth/refresh').set('Cookie', s.cookie); // a cópia reaparece
    expect(ladrao.status).toBe(401);
    expect(ladrao.body.error).toMatch(/segurança/);
    // Nem o cookie novo da pessoa nem o token de acesso dela valem mais.
    expect((await api().post('/api/auth/refresh').set('Cookie', cookieValue(refreshCookie(legit)))).status).toBe(401);
    expect((await api().get('/api/auth/me').set(bearer(legit.body.token))).status).toBe(401);
  });

  it('duas abas renovando ao mesmo tempo não derrubam a sessão', async () => {
    await signup('alice');
    const s = await login('alice');
    const [a, b] = await Promise.all([
      api().post('/api/auth/refresh').set('Cookie', s.cookie),
      api().post('/api/auth/refresh').set('Cookie', s.cookie),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    // Só uma resposta troca o cookie; a outra mantém o que o navegador já recebeu.
    const novos = [a, b].map(refreshCookie).filter(Boolean);
    expect(novos).toHaveLength(1);
    expect((await api().post('/api/auth/refresh').set('Cookie', cookieValue(novos[0]))).status).toBe(200);
    expect((await api().get('/api/auth/me').set(bearer(b.body.token))).status).toBe(200);
  });

  it('o cookie recém-trocado só é tolerado por 30 s; depois disso é reuso', async () => {
    await signup('alice');
    const s = await login('alice');
    const r1 = await api().post('/api/auth/refresh').set('Cookie', s.cookie);
    await pool.query("UPDATE sessions SET rotated_at = now() - interval '31 seconds'");
    expect((await api().post('/api/auth/refresh').set('Cookie', s.cookie)).status).toBe(401);
    expect((await api().post('/api/auth/refresh').set('Cookie', cookieValue(refreshCookie(r1)))).status).toBe(401);
  });

  it('sair invalida o token de acesso na hora, não em 7 dias', async () => {
    await signup('alice');
    const s = await login('alice');
    expect((await api().get('/api/auth/me').set(bearer(s.token))).status).toBe(200);
    const out = await api().post('/api/auth/logout').set(bearer(s.token)).set('Cookie', s.cookie);
    expect(out.status).toBe(204);
    expect(refreshCookie(out)).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect((await api().get('/api/auth/me').set(bearer(s.token))).status).toBe(401);
    expect((await api().post('/api/auth/refresh').set('Cookie', s.cookie)).status).toBe(401);
  });

  it('a revogação vale mesmo sem a memória do processo (outro servidor, via Redis)', async () => {
    await signup('alice');
    const s = await login('alice');
    await api().post('/api/auth/logout').set(bearer(s.token));
    resetSessionMemory();
    const expected = getRedis() ? 401 : 200;
    expect((await api().get('/api/auth/me').set(bearer(s.token))).status).toBe(expected);
  });

  it('sair só pelo cookie exige o segredo do cookie (não dá para derrubar a sessão alheia pelo número)', async () => {
    await signup('alice');
    const s = await login('alice');
    const sid = jwt.decode(s.token).sid;
    const res = await api().post('/api/auth/logout').set('Cookie', `agora_refresh=${sid}.${'A'.repeat(43)}`);
    expect(res.status).toBe(204);
    expect((await api().get('/api/auth/me').set(bearer(s.token))).status).toBe(200);
  });

  it('sair de todos os aparelhos encerra todas as sessões da pessoa e só dela', async () => {
    await signup('alice');
    await signup('bob');
    const celular = await login('alice');
    const notebook = await login('alice');
    const bob = await login('bob');
    const res = await api().post('/api/auth/logout-all').set(bearer(notebook.token));
    expect(res.body.ended).toBe(3); // cadastro + 2 logins
    expect((await api().get('/api/auth/me').set(bearer(celular.token))).status).toBe(401);
    expect((await api().post('/api/auth/refresh').set('Cookie', celular.cookie)).status).toBe(401);
    expect((await api().get('/api/auth/me').set(bearer(bob.token))).status).toBe(200);
  });

  it('refresh sem cookie, malformado ou inventado é recusado', async () => {
    expect((await api().post('/api/auth/refresh')).status).toBe(401);
    expect((await api().post('/api/auth/refresh').set('Cookie', 'agora_refresh=lixo')).status).toBe(401);
    expect((await api().post('/api/auth/refresh').set('Cookie', `agora_refresh=123.${'B'.repeat(43)}`)).status).toBe(401);
  });
});

describe('tempo real respeita a saída (A2)', () => {
  let server, ioServer, url;
  beforeAll(async () => {
    server = createServer(app);
    ioServer = attachRealtime(server);
    await new Promise((r) => server.listen(0, r));
    url = `http://localhost:${server.address().port}`;
  });
  afterAll(() => new Promise((r) => ioServer.close(r)));

  it('a conexão do aparelho cai quando a pessoa sai, e o token velho não reconecta', async () => {
    await signup('alice');
    const s = await login('alice');
    const sock = connect(url, { auth: { token: s.token }, transports: ['websocket'], reconnection: false });
    await new Promise((res, rej) => {
      sock.on('connect', res);
      sock.on('connect_error', rej);
    });
    const caiu = new Promise((r) => sock.on('disconnect', r));
    await api().post('/api/auth/logout').set(bearer(s.token));
    expect(await caiu).toBe('io server disconnect');
    const again = connect(url, { auth: { token: s.token }, transports: ['websocket'], reconnection: false });
    await expect(
      new Promise((res, rej) => {
        again.on('connect', res);
        again.on('connect_error', rej);
      }),
    ).rejects.toThrow('unauthorized');
    again.close();
    sock.close();
  });
});

describe('limite geral da API (A3)', () => {
  beforeEach(async () => {
    delete process.env.DISABLE_RATE_LIMIT;
    resetRateLimitMemory();
    await getRedis()?.flushdb();
  });
  afterEach(() => {
    process.env.DISABLE_RATE_LIMIT = '1';
  });

  it('toda rota de /api conta, por pessoa logada; sem login, por IP', async () => {
    const alice = await signup('alice');
    const a1 = await api().get('/api/users/alice').set(alice.auth);
    const a2 = await api().get('/api/users/alice').set(alice.auth);
    expect(a1.headers['x-rate-limit-limit']).toBe(String(config.apiRateLimit));
    expect(Number(a1.headers['x-rate-limit-remaining']) - Number(a2.headers['x-rate-limit-remaining'])).toBe(1);
    expect(Number(a2.headers['x-rate-limit-remaining'])).toBe(config.apiRateLimit - 2);
    // Anônimo tem o próprio contador, por IP: o cadastro + este pedido (não soma os 2 da Alice).
    const anon = await api().get('/api/users/alice');
    expect(Number(anon.headers['x-rate-limit-remaining'])).toBe(config.apiRateLimit - 2);
    // A federação (fora de /api) também tem limite.
    const wf = await api().get('/.well-known/nodeinfo');
    expect(wf.headers['x-rate-limit-limit']).toBe('300');
  });

  it('health fica de fora, para o monitoramento nunca ser bloqueado', async () => {
    const res = await api().get('/api/health');
    expect(res.headers['x-rate-limit-limit']).toBeUndefined();
  });
});

describe('cabeçalhos de proteção (M7)', () => {
  it('toda resposta sai com política fechada e sem identificar o servidor', async () => {
    const res = await api().get('/api/health');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('banco com tempo-limite (M8)', () => {
  it('cada consulta tem teto de tempo e é cancelada ao passar dele', async () => {
    const { rows } = await pool.query('SHOW statement_timeout');
    expect(rows[0].statement_timeout).toBe('5s');
    const err = await withTransaction(async (c) => {
      await c.query("SET LOCAL statement_timeout = '50ms'");
      await c.query('SELECT pg_sleep(1)');
    }).catch((e) => e);
    expect(err.code).toBe('57014');
  });
});

describe('erros sem detalhes internos (B1)', () => {
  it('corpo grande demais recebe 413, sem stack', async () => {
    const alice = await signup('alice');
    const res = await api()
      .post('/api/posts')
      .set(alice.auth)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ text: 'x'.repeat(40_000) }));
    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/32 KB/);
    expect(JSON.stringify(res.body)).not.toMatch(/at |stack|node_modules/);
  });

  it('JSON quebrado recebe 400', async () => {
    const res = await api().post('/api/auth/login').set('Content-Type', 'application/json').send('{"login":');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('JSON inválido');
  });
});
