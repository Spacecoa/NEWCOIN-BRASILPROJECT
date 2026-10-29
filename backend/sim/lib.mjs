// Apoio das simulações de uso (docs/15). Tudo roda contra instâncias LOCAIS do Ágora.
// Cada simulação cria as próprias contas (nomes únicos) e não depende de nenhuma outra.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
export const { io } = require('socket.io-client');

export const PASSWORD = 'senha-forte-123';
export const cfg = {
  base: process.env.SIM_BASE ?? 'http://localhost:4020', // instância sem limite de pedidos
  limited: process.env.SIM_LIMITED ?? 'http://localhost:4000', // instância com os limites normais
};
export const state = { base: cfg.base, fiveXX: [], sim: '000', counter: 0 };

const envFile = readFileSync(fileURLToPath(new URL('../.env', import.meta.url)), 'utf8');
const DB = /^DATABASE_URL=(.*)$/m.exec(envFile)?.[1];
export const sql = (q) => execFileSync('psql', [DB, '-Atc', q], { encoding: 'utf8' }).trim();

export class SimError extends Error {}
export const check = (cond, msg) => {
  if (!cond) throw new SimError(msg);
};
export const eq = (a, b, msg) => check(JSON.stringify(a) === JSON.stringify(b), `${msg}: esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);
export const status = (r, s, msg) => check(r.s === s, `${msg}: esperado HTTP ${s}, veio ${r.s} ${JSON.stringify(r.j)?.slice(0, 160)}`);

/** Chamada HTTP. Devolve { s, j, h, cookie }. Qualquer 5xx fica registrado e reprova a simulação. */
export async function call(tok, method, path, body, { headers = {}, rawBody, base } = {}) {
  const url = (base ?? state.base) + path;
  const res = await fetch(url, {
    method,
    headers: { ...(rawBody === undefined ? { 'content-type': 'application/json' } : { 'content-type': 'application/json' }), ...(tok ? { authorization: 'Bearer ' + tok } : {}), ...headers },
    body: rawBody !== undefined ? rawBody : body === undefined ? undefined : JSON.stringify(body),
  });
  let j = null;
  const text = await res.text();
  try {
    j = JSON.parse(text);
  } catch {
    j = text;
  }
  if (res.status >= 500) state.fiveXX.push(`${method} ${path} → ${res.status}`);
  return { s: res.status, j, h: res.headers, cookie: res.headers.get('set-cookie') ?? '' };
}

const rnd = () => Math.random().toString(36).slice(2, 6);
/** Cria uma conta nova (aceitando as regras) e devolve { u, id, tok, email, cookie }. */
export async function reg(tag = 'u', { base, extra = {} } = {}) {
  const u = `${tag}${state.sim}_${rnd()}`.slice(0, 20).replace(/[^A-Za-z0-9_]/g, '_');
  const email = `${u}@sim.test`;
  const r = await call(null, 'POST', '/api/auth/register', { username: u, email, password: PASSWORD, accept_rules: true, ...extra }, { base });
  check(r.s === 201, `cadastro de ${u} falhou: ${r.s} ${JSON.stringify(r.j)?.slice(0, 160)}`);
  return { u, id: r.j.user.id, tok: r.j.token, email, cookie: r.cookie.split(';')[0], base: base ?? state.base };
}
export const login = (email, password = PASSWORD, opts) => call(null, 'POST', '/api/auth/login', { email, password }, opts);
export async function mod() {
  const r = await login('ana_dev@exemplo.test', 'senha1234');
  check(r.s === 200, 'login da moderadora do seed falhou');
  return { u: 'ana_dev', id: r.j.user.id, tok: r.j.token };
}

export const post = async (who, text, replyTo) => {
  const r = await call(who.tok, 'POST', '/api/posts', { text, reply_to_id: replyTo });
  check(r.s === 201, `post falhou: ${r.s} ${JSON.stringify(r.j)?.slice(0, 160)}`);
  return r.j.data;
};
export const getPost = (who, id) => call(who?.tok, 'GET', `/api/posts/${id}`);
export const follow = (who, name) => call(who.tok, 'POST', `/api/users/${name}/follow`);
export const wallet = async (who) => (await call(who.tok, 'GET', '/api/carteira')).j;
export const rules = async () => (await call(null, 'GET', '/api/instancia/regras')).j.data.rules;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Conecta um socket autenticado e guarda os eventos recebidos. */
export function socket(who, base = state.base) {
  return new Promise((resolve, reject) => {
    const s = io(base, { auth: { token: who.tok }, transports: ['websocket'], reconnection: false });
    s.events = [];
    for (const ev of ['message:new', 'timeline:new', 'notification', 'message:reactions', 'post:deleted', 'channel:removed']) s.on(ev, (p) => s.events.push({ ev, p }));
    s.on('connect', () => resolve(s));
    s.on('connect_error', (e) => reject(e));
  });
}
export async function waitFor(fn, ms = 2500, step = 50) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = await fn();
    if (v) return v;
    await sleep(step);
  }
  return null;
}

/** Cria contas novas até que a missão `id` apareça entre as 4 do dia. */
export async function userWithMission(id, tries = 60) {
  for (let i = 0; i < tries; i++) {
    const w = await reg('m');
    const m = await call(w.tok, 'GET', '/api/missoes');
    if (m.j.missions.some((x) => x.id === id)) return w;
  }
  throw new SimError(`a missão "${id}" não apareceu para nenhuma de ${tries} contas novas`);
}

export const registry = [];
/** sim(id, área, título, documento, fn, opções) */
export function sim(area, title, doc, fn, opts = {}) {
  registry.push({ area, title, doc, fn, ...opts });
}
