import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { touchActivity } from '../services/evaporation.js';
import { isRevoked } from '../services/sessions.js';
import { unauthorized } from './errors.js';

const ROUNDS = process.env.NODE_ENV === 'test' ? 4 : 10;

export const hashPassword = (plain) => bcrypt.hash(plain, ROUNDS);
export const checkPassword = (plain, hash) => bcrypt.compare(plain, hash);

// Hash de uma senha aleatória, com o mesmo custo dos reais: usado quando a conta não existe.
let dummy = null;
export const dummyHash = () => (dummy ??= hashPassword(Math.random().toString(36)));

/** Token de acesso curto, ligado a uma sessão (sid). */
export function signToken(user, sid) {
  return jwt.sign({ sub: String(user.id), username: user.username, sid: String(sid) }, config.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: config.accessTokenTtlSec,
  });
}

/** Só confere assinatura e validade: { id, username, sid } ou null. Não consulta nada. */
export function verifyToken(token) {
  try {
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    if (!payload.sid) return null; // tokens antigos, sem sessão, não valem mais
    return { id: String(payload.sub), username: payload.username, sid: String(payload.sid) };
  } catch {
    return null;
  }
}

/** Assinatura válida E sessão não encerrada. */
export async function authenticate(token) {
  const user = token ? verifyToken(token) : null;
  if (!user || (await isRevoked(user.sid))) return null;
  return user;
}

function tokenFrom(req) {
  const header = req.get('authorization') ?? '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

/** Todo pedido logado conta como uso do app (para a evaporação do NWC). Nunca derruba o pedido. */
async function markActive(user) {
  if (!user) return;
  try {
    await touchActivity(user.id);
  } catch (err) {
    if (process.env.NODE_ENV !== 'test') console.warn('[atividade] falha ao marcar uso:', err.message);
  }
}

/** Popula req.user se houver token válido; nunca bloqueia. */
export async function optionalAuth(req, _res, next) {
  req.user = await authenticate(tokenFrom(req));
  await markActive(req.user);
  next();
}

/** Exige token válido. */
export async function requireAuth(req, _res, next) {
  req.user = await authenticate(tokenFrom(req));
  if (!req.user) return next(unauthorized());
  await markActive(req.user);
  next();
}

/** Quem está pedindo, só para contar no limite de requisições: id da pessoa ou IP. */
export function requesterKey(req) {
  if (req.user?.id) return `u:${req.user.id}`;
  const user = verifyToken(tokenFrom(req) ?? '');
  return user ? `u:${user.id}` : `ip:${req.ip}`;
}
