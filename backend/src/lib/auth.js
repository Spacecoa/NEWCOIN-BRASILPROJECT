import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { isRevoked } from '../services/sessions.js';
import { unauthorized } from './errors.js';

const ROUNDS = process.env.NODE_ENV === 'test' ? 4 : 10;

export const hashPassword = (plain) => bcrypt.hash(plain, ROUNDS);
export const checkPassword = (plain, hash) => bcrypt.compare(plain, hash);

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

/** Popula req.user se houver token válido; nunca bloqueia. */
export async function optionalAuth(req, _res, next) {
  req.user = await authenticate(tokenFrom(req));
  next();
}

/** Exige token válido. */
export async function requireAuth(req, _res, next) {
  req.user = await authenticate(tokenFrom(req));
  if (!req.user) return next(unauthorized());
  next();
}

/** Quem está pedindo, só para contar no limite de requisições: id da pessoa ou IP. */
export function requesterKey(req) {
  if (req.user?.id) return `u:${req.user.id}`;
  const user = verifyToken(tokenFrom(req) ?? '');
  return user ? `u:${user.id}` : `ip:${req.ip}`;
}
