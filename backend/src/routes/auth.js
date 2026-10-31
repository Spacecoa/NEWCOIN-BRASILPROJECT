import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { authenticate, checkPassword, dummyHash, requireAuth, signToken } from '../lib/auth.js';
import { conflict, parse, unauthorized } from '../lib/errors.js';
import { failureCounter, rateLimit } from '../lib/rateLimit.js';
import { registerWithInvite } from '../services/invites.js';
import { touchActivity } from '../services/evaporation.js';
import { activeSuspension } from '../services/moderation.js';
import { requestReset, resetPassword } from '../services/passwordReset.js';
import { createSession, revokeAllSessions, revokeByRefresh, revokeSession, rotateSession } from '../services/sessions.js';
import { CONSENT_VERSION } from '../lib/consent.js';
import { createUser, findUserForLogin, formatUser, getSelf } from '../services/users.js';

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

export const clearRefreshCookie = (res) =>
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
  await touchActivity(user.id).catch(() => {}); // entrar é usar o app (evaporação do NWC)
  setRefreshCookie(res, refreshToken);
  res.status(status).json({ token: signToken(user, sid), expires_in: config.accessTokenTtlSec, user: await getSelf(user.id) });
}

const registerSchema = z.object({
  username: z.string().regex(/^[A-Za-z0-9_]{3,20}$/, '3–20 caracteres: letras, números ou _'),
  email: z.email(),
  password: z.string().min(8, 'mínimo de 8 caracteres').max(128),
  display_name: z.string().trim().min(1).max(50).optional(),
  invite_code: z.string().trim().toLowerCase().regex(/^[a-z0-9]{8}$/, 'código de convite inválido').optional(),
  // Entrar na instância é aceitar as regras dela (GET /api/instancia/regras).
  accept_rules: z.literal(true, { error: 'é preciso ler e aceitar as regras da instância' }),
  // E aceitar o termo de consentimento do piloto (GET /api/instancia/termo, docs/16).
  accept_consent: z.literal(true, { error: 'é preciso ler e aceitar o termo de consentimento' }),
  // A versão que a tela mostrou; se o termo mudou nesse meio-tempo, o cadastro pede para reler.
  consent_version: z.string().max(40).optional(),
});

// O app entra com e-mail e senha. "login" (e-mail ou usuário) continua aceito para scripts antigos.
const loginSchema = z
  .object({
    email: z.string().trim().toLowerCase().pipe(z.email('e-mail inválido')).optional(),
    login: z.string().trim().min(1).max(254).optional(),
    password: z.string().min(1).max(128),
  })
  .refine((v) => v.email || v.login, { message: 'informe o e-mail', path: ['email'] });

// Limite de tentativas por IP para mitigar força bruta.
// Falha fechada: com o Redis fora do ar, recusa (503) em vez de deixar testar senhas sem limite.
const authLimiter = rateLimit({ name: 'auth', limit: 20, windowSec: 15 * 60, key: (req) => req.ip, failClosed: true });

router.post('/register', authLimiter, async (req, res) => {
  const { invite_code: inviteCode, accept_rules: _rules, accept_consent: _consent, consent_version: seen, ...fields } = parse(registerSchema, req.body);
  if (seen && seen !== CONSENT_VERSION) throw conflict('O termo de consentimento mudou enquanto você lia. Recarregue a página e leia a versão nova.');
  const input = { ...fields, consent_version: CONSENT_VERSION };
  const user = inviteCode ? await registerWithInvite(input, inviteCode) : await createUser(input);
  await startSession(req, res, user, 201);
});

// Além do limite por IP, um limite de SENHAS ERRADAS por conta: quem testa a senha de uma
// pessoa a partir de muitos IPs para em 10 erros a cada 15 min (docs/14, A-4). Só erros
// contam; ainda assim, quem atacar uma conta pode atrasar o login dela nessa janela.
const accountFailures = failureCounter({ name: 'auth:account', limit: 10, windowSec: 15 * 60, failClosed: true });

router.post('/login', authLimiter, async (req, res) => {
  const { email, login, password } = parse(loginSchema, req.body);
  const accountKey = String(email ?? login).toLowerCase();
  const gate = await accountFailures.check(accountKey);
  if (gate.unavailable) {
    res.set('retry-after', '5');
    return res.status(503).json({ error: 'O controle de tentativas está fora do ar. Tente de novo em alguns segundos.', retry_after: 5 });
  }
  if (gate.blocked) {
    res.set('retry-after', String(gate.retryAfter));
    return res.status(429).json({ error: 'Muitas tentativas com senha errada para esta conta. Tente de novo em alguns minutos.', retry_after: gate.retryAfter });
  }
  const row = await findUserForLogin(email ?? login);
  // Mesma mensagem E o mesmo tempo para conta inexistente e senha errada: o bcrypt roda
  // sempre (contra um hash falso quando a conta não existe), então ninguém descobre
  // quais e-mails estão cadastrados medindo a demora da resposta.
  const ok = await checkPassword(password, row?.password_hash ?? (await dummyHash()));
  if (!row || !ok) {
    await accountFailures.fail(accountKey);
    throw unauthorized('E-mail ou senha incorretos');
  }
  if (row.suspended_at) {
    // Senha certa: a pessoa tem direito de saber por quê, qual regra, e como recorrer.
    const s = await activeSuspension(row.id);
    return res.status(403).json({
      error: 'Esta conta foi suspensa pela moderação da instância.',
      suspension: {
        since: s?.created_at ?? row.suspended_at,
        rule: s?.rule ?? null,
        note: s?.note ?? null,
        appeal_status: s?.appeal_status ?? null,
        appeal_note: s?.appeal_note ?? null,
        can_appeal: Boolean(s && !s.appeal_status),
      },
    });
  }
  await startSession(req, res, formatUser(row));
});

// Renovação: troca o refresh do cookie por um novo e devolve um token de acesso novo.
// Tem limite próprio por IP, já que não exige token de acesso.
const refreshLimiter = rateLimit({ name: 'auth:refresh', limit: 60, windowSec: 15 * 60, key: (req) => req.ip });
router.post('/refresh', refreshLimiter, async (req, res) => {
  try {
    const { sid, userId, refreshToken } = await rotateSession(readCookie(req, REFRESH_COOKIE));
    const user = await getSelf(userId);
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

// Esqueci a senha. Mesma resposta para qualquer e-mail (não revela quem tem conta); o limite
// por IP segura quem tenta mandar e-mails em massa, e o serviço só manda 3 por hora por conta.
const resetLimiter = rateLimit({ name: 'auth:reset', limit: 10, windowSec: 15 * 60, key: (req) => req.ip, failClosed: true });
const RESET_SENT = 'Se houver uma conta com este e-mail, enviamos um link para criar uma senha nova. Ele vale por 30 minutos.';

router.post('/senha/esqueci', resetLimiter, async (req, res) => {
  const { email } = parse(z.object({ email: z.string().trim().toLowerCase().pipe(z.email('e-mail inválido')) }).strict(), req.body);
  await requestReset(email);
  res.json({ ok: true, message: RESET_SENT });
});

// Troca a senha pelo link. Divide o limite com o login: não vira outro lugar de testar senhas.
router.post('/senha/redefinir', authLimiter, async (req, res) => {
  const { token, password } = parse(
    z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'link inválido'), password: registerSchema.shape.password }).strict(),
    req.body,
  );
  await resetPassword(token, password);
  clearRefreshCookie(res);
  res.json({ ok: true, message: 'Senha nova salva. Entre com ela; os outros aparelhos saíram da conta.' });
});

router.get('/me', requireAuth, async (req, res) => {
  res.json({ user: await getSelf(req.user.id) });
});

export default router;
