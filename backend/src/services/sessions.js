import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { getRedis } from '../cache.js';
import { config } from '../config.js';
import { query } from '../db.js';
import { unauthorized } from '../lib/errors.js';
import { nextId } from '../lib/ids.js';
import { bus } from '../realtime/bus.js';

// Sessões de login. Duas peças:
//   - token de acesso (JWT): curto (15 min), vai em cada pedido, carrega o id da sessão (sid);
//   - refresh token: longo (30 dias), fica num cookie HttpOnly e só serve para pedir um
//     novo token de acesso. Formato "<sid>.<segredo aleatório>"; o banco guarda só o hash.
//
// Encerrar uma sessão marca revoked_at no banco e põe o sid numa lista de "revogados"
// (Redis + memória) que dura o tempo de vida de um token de acesso. Assim, "Sair" vale
// na hora, sem consultar o banco em cada pedido.

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const newSecret = () => randomBytes(32).toString('base64url');
const revokedKey = (sid) => `revoked:sid:${sid}`;

const revokedMemory = new Map(); // sid -> expira em (ms)

/** Marca sessões como encerradas na hora (e derruba as conexões ao vivo delas). */
export async function markRevoked(sids) {
  if (!sids.length) return;
  const until = Date.now() + config.accessTokenTtlSec * 1000;
  if (revokedMemory.size > 10_000) {
    const now = Date.now();
    for (const [k, v] of revokedMemory) if (v <= now) revokedMemory.delete(k);
  }
  for (const sid of sids) revokedMemory.set(String(sid), until);
  const redis = getRedis();
  if (redis) {
    try {
      const m = redis.multi();
      for (const sid of sids) m.set(revokedKey(sid), '1', 'EX', config.accessTokenTtlSec);
      await m.exec();
    } catch {
      /* sem Redis: a memória do processo cobre o caso de um servidor só */
    }
  }
  for (const sid of sids) bus.emit('session:revoked', { sid: String(sid) });
}

/** true se a sessão foi encerrada nos últimos minutos (o token de acesso dela ainda não expirou). */
export async function isRevoked(sid) {
  const until = revokedMemory.get(sid);
  if (until) {
    if (until > Date.now()) return true;
    revokedMemory.delete(sid);
  }
  const redis = getRedis();
  if (!redis) return false;
  try {
    return (await redis.exists(revokedKey(sid))) === 1;
  } catch {
    return false;
  }
}

function splitRefresh(token) {
  const m = /^(\d{1,20})\.([A-Za-z0-9_-]{20,100})$/.exec(token ?? '');
  return m ? { sid: m[1], secret: m[2] } : null;
}

function sameHash(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Cria uma sessão nova (login ou cadastro). Devolve { sid, refreshToken }. */
export async function createSession(userId, userAgent = '') {
  const sid = nextId();
  const secret = newSecret();
  await query(
    `INSERT INTO sessions (id, user_id, refresh_hash, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, now() + make_interval(days => $5))`,
    [sid, userId, sha256(secret), String(userAgent).slice(0, 200), config.sessionTtlDays],
  );
  // Faxina leve: sessões vencidas há mais de uma semana não servem para nada.
  if (Math.random() < 0.05) await query("DELETE FROM sessions WHERE expires_at < now() - interval '7 days'");
  return { sid, refreshToken: `${sid}.${secret}` };
}

// Duas abas (ou um recarregar junto com uma renovação) podem mandar o mesmo cookie ao
// mesmo tempo. Quem chega em segundo traz o refresh que acabou de ser trocado: dentro
// desta janela ele ganha só um token de acesso, sem cookie novo (o navegador já tem o
// mais recente). Fora dela, é reuso de verdade.
const GRACE_SEC = 30;

/**
 * Troca um refresh token por um novo (rotação). Devolve { sid, userId, refreshToken },
 * com refreshToken null quando o cookie atual do navegador deve ser mantido.
 * Se o token tiver o formato certo mas não for o atual (nem o recém-trocado), ele já foi
 * usado antes: sinal de cópia. A sessão é encerrada para os dois lados.
 */
export async function rotateSession(refreshToken) {
  const parts = splitRefresh(refreshToken);
  if (!parts) throw unauthorized('Sessão inválida');
  const hash = sha256(parts.secret);
  const secret = newSecret();
  // Um único UPDATE atômico: só troca se o hash enviado for o atual.
  const { rows } = await query(
    `UPDATE sessions SET prev_hash = refresh_hash, refresh_hash = $3, rotated_at = now(), last_used_at = now()
      WHERE id = $1 AND refresh_hash = $2 AND revoked_at IS NULL AND expires_at > now()
      RETURNING id, user_id`,
    [parts.sid, hash, sha256(secret)],
  );
  if (rows[0]) return { sid: rows[0].id, userId: rows[0].user_id, refreshToken: `${rows[0].id}.${secret}` };

  const { rows: found } = await query(
    `SELECT id, user_id, refresh_hash, prev_hash, revoked_at, expires_at < now() AS expired,
            rotated_at > now() - make_interval(secs => $2) AS recent
       FROM sessions WHERE id = $1`,
    [parts.sid, GRACE_SEC],
  );
  const s = found[0];
  if (!s || s.revoked_at || s.expired) throw unauthorized('Sessão encerrada');
  if (s.prev_hash && sameHash(hash, s.prev_hash) && s.recent) {
    return { sid: s.id, userId: s.user_id, refreshToken: null };
  }
  await revokeSession(s.id);
  throw unauthorized('Sessão encerrada por segurança');
}

export async function revokeSession(sid) {
  const { rows } = await query('UPDATE sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL RETURNING id', [sid]);
  await markRevoked(rows.map((r) => r.id));
}

/** Encerra todas as sessões da pessoa (ex.: perdeu o celular). */
export async function revokeAllSessions(userId) {
  const { rows } = await query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL RETURNING id', [userId]);
  await markRevoked(rows.map((r) => r.id));
  return rows.length;
}

/** Encerra a sessão dona deste refresh token, se ele for o atual. Devolve true se encerrou. */
export async function revokeByRefresh(refreshToken) {
  const parts = splitRefresh(refreshToken);
  if (!parts) return false;
  const { rows } = await query(
    'UPDATE sessions SET revoked_at = now() WHERE id = $1 AND refresh_hash = $2 AND revoked_at IS NULL RETURNING id',
    [parts.sid, sha256(parts.secret)],
  );
  await markRevoked(rows.map((r) => r.id));
  return rows.length > 0;
}

export function resetSessionMemory() {
  revokedMemory.clear();
}
