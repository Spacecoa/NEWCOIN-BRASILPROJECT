import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { unauthorized } from './errors.js';

const ROUNDS = process.env.NODE_ENV === 'test' ? 4 : 10;

export const hashPassword = (plain) => bcrypt.hash(plain, ROUNDS);
export const checkPassword = (plain, hash) => bcrypt.compare(plain, hash);

export function signToken(user) {
  return jwt.sign({ sub: user.id, username: user.username }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
}

/** Retorna { id, username } ou null se o token for inválido/expirado. */
export function verifyToken(token) {
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    return { id: String(payload.sub), username: payload.username };
  } catch {
    return null;
  }
}

function tokenFrom(req) {
  const header = req.get('authorization') ?? '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

/** Popula req.user se houver token válido; nunca bloqueia. */
export function optionalAuth(req, _res, next) {
  const token = tokenFrom(req);
  req.user = token ? verifyToken(token) : null;
  next();
}

/** Exige token válido. */
export function requireAuth(req, _res, next) {
  const token = tokenFrom(req);
  req.user = token ? verifyToken(token) : null;
  if (!req.user) return next(unauthorized());
  next();
}
