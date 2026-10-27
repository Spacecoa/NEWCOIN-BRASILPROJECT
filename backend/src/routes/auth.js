import { Router } from 'express';
import { z } from 'zod';
import { checkPassword, requireAuth, signToken } from '../lib/auth.js';
import { parse, unauthorized } from '../lib/errors.js';
import { rateLimit } from '../lib/rateLimit.js';
import { registerWithInvite } from '../services/invites.js';
import { createUser, findUserForLogin, formatUser, getUserById } from '../services/users.js';

const router = Router();

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
  res.status(201).json({ token: signToken(user), user });
});

router.post('/login', authLimiter, async (req, res) => {
  const { login, password } = parse(loginSchema, req.body);
  const row = await findUserForLogin(login);
  // Mesma mensagem para usuário inexistente e senha errada (evita enumeração de contas).
  if (!row || !(await checkPassword(password, row.password_hash))) throw unauthorized('Credenciais inválidas');
  const user = formatUser(row);
  res.json({ token: signToken(user), user });
});

router.get('/me', requireAuth, async (req, res) => {
  res.json({ user: await getUserById(req.user.id) });
});

export default router;
