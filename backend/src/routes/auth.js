import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { authenticate, checkPassword, requireAuth, signToken } from '../lib/auth.js';
import { parse, unauthorized } from '../lib/errors.js';
import { rateLimit } from '../lib/rateLimit.js';
import { registerWithInvite } from '../services/invites.js';
import { createSession, revokeAllSessions, revokeByRefresh, revokeSession, rotateSession } from '../services/sessions.js';
import { createUser, findUserForLogin, formatUser, getUserById } from '../services/users.js';

const router = Router();

// O refresh token mora num cookie que o JavaScript da página não consegue ler (HttpOnly),
// só é enviado para /api/auth e nunca a partir de outro site (SameSite=Strict).
const REFRESH_COOKIE = 'agora_refresh';
const COOKIE_PATH = '/api/auth';

function setRefreshCookie(res, token) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'strict',
    path: COOKIE_PATH,
    maxAge: config.sessionTtlDays * 24 * 60 * 60 * 1000,
  });
}

const clearRefreshCookie = (res) =>
  res.clearCookie(REFRESH_COOKIE, { httpOnly: true, secure: config.cookieSecure, sameSite: 'strict', path: COOKIE_PATH });

function readCookie(req, name) {
  for (const part of (req.get('cookie') ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Abre uma sessão e responde com o token de acesso (corpo) e o refresh (cookie). */
async function startSession(req, res, user, status = 200) {
  const { sid, refreshToken } = await createSession(user.id, req.get('user-agent'));
  setRefreshCookie(res, refreshToken);
  res.status(status).json({ token: signToken(user, sid), expires_in: config.accessTokenTtlSec, user });
}

const registerSchema = z.object({
  username: z.string().regex(/^[A-Za-z0-9_]{3,20}$/, '3–20 caracteres: letras, números ou _'),
  email: z.email(),
  password: z.string().min(8, 'mínimo de 8 caracteres').max(128),
  display_name: z.string().trim().min(1).max(50).optional(),
  invite_code: z.string().trim().toLowerCase().regex(/^[a-z0-9]{8}$/, 'código de convite inválido').optional(),
});

const loginSchema = z.object({
  login: z.string().min(1), // e-mail ou username
  password: z.string().min(1),
});

// Limite de tentativas por IP para mitigar força bruta.
const authLimiter = rateLimit({ name: 'auth', limit: 20, windowSec: 15 * 60, key: (req) => req.ip });

router.post('/register', authLimiter, async (req, res) => {
  const { invite_code: inviteCode, ...input } = parse(registerSchema, req.body);
  const user = inviteCode ? await registerWithInvite(input, inviteCode) : await createUser(input);
  await startSession(req, res, user, 201);
});

router.post('/login', authLimiter, async (req, res) => {
  const { login, password } = parse(loginSchema, req.body);
  const row = await findUserForLogin(login);
  // Mesma mensagem para usuário inexistente e senha errada (evita enumeração de contas).
  if (!row || !(await checkPassword(password, row.password_hash))) throw unauthorized('Credenciais inválidas');
  await startSession(req, res, formatUser(row));
});

// Renovação: troca o refresh do cookie por um novo e devolve um token de acesso novo.
// Tem limite próprio por IP, já que não exige token de acesso.
const refreshLimiter = rateLimit({ name: 'auth:refresh', limit: 60, windowSec: 15 * 60, key: (req) => req.ip });
router.post('/refresh', refreshLimiter, async (req, res) => {
  try {
    const { sid, userId, refreshToken } = await rotateSession(readCookie(req, REFRESH_COOKIE));
    const user = await getUserById(userId);
    if (refreshToken) setRefreshCookie(res, refreshToken);
    res.json({ token: signToken(user, sid), expires_in: config.accessTokenTtlSec, user });
  } catch (err) {
    clearRefreshCookie(res);
    throw err;
  }
});

// Sair deste aparelho. Aceita o token de acesso ou o cookie (o que vier válido).
router.post('/logout', refreshLimiter, async (req, res) => {
  const header = req.get('authorization') ?? '';
  const user = header.startsWith('Bearer ') ? await authenticate(header.slice(7)) : null;
  if (user) await revokeSession(user.sid);
  await revokeByRefresh(readCookie(req, REFRESH_COOKIE));
  clearRefreshCookie(res);
  res.status(204).end();
});

// Sair de todos os aparelhos (ex.: celular perdido).
router.post('/logout-all', requireAuth, async (req, res) => {
  const ended = await revokeAllSessions(req.user.id);
  clearRefreshCookie(res);
  res.json({ ended });
});

router.get('/me', requireAuth, async (req, res) => {
  res.json({ user: await getUserById(req.user.id) });
});

export default router;
