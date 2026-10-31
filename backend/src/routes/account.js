import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../lib/auth.js';
import { parse } from '../lib/errors.js';
import { rateLimit } from '../lib/rateLimit.js';
import { consentTerm } from '../lib/consent.js';
import { deleteAccount, exportAccount } from '../services/account.js';
import { acceptConsent } from '../services/users.js';
import { clearRefreshCookie } from './auth.js';

const router = Router();

// Baixar os dados é pesado (vai tudo, imagens incluídas): poucas vezes por hora bastam.
const exportLimiter = rateLimit({ name: 'conta:dados', limit: 5, windowSec: 60 * 60 });
// Excluir pede a senha: o limite impede usar esta rota para testar senhas.
const deleteLimiter = rateLimit({ name: 'conta:excluir', limit: 5, windowSec: 15 * 60, failClosed: true });

/** Todos os meus dados, num arquivo JSON (LGPD, art. 18: acesso e portabilidade). */
router.get('/conta/dados', requireAuth, exportLimiter, async (req, res) => {
  const data = await exportAccount(req.user.id);
  const day = data.gerado_em.slice(0, 10);
  res.set('content-disposition', `attachment; filename="agora-dados-${data.conta.username}-${day}.json"`);
  res.json(data);
});

/** Excluir a conta de vez (LGPD, art. 18: eliminação). Pede a senha de novo. */
router.delete('/conta', requireAuth, deleteLimiter, async (req, res) => {
  const { password } = parse(z.object({ password: z.string().min(1, 'digite sua senha').max(128) }).strict(), req.body);
  const result = await deleteAccount(req.user.id, password);
  clearRefreshCookie(res);
  res.json({ ok: true, ...result, message: 'Conta excluída. Seus posts, mensagens, imagens e dados saíram da instância.' });
});

/** Pública: o termo de consentimento do piloto, para ler antes de criar a conta (docs/16). */
router.get('/instancia/termo', (_req, res) => {
  res.json({ data: consentTerm() });
});

/** Aceitar a versão atual do termo (conta antiga, ou o termo mudou). Devolve a conta atualizada. */
router.post('/conta/termo', requireAuth, async (req, res) => {
  const { version } = parse(z.object({ version: z.string().min(1).max(40) }).strict(), req.body);
  res.json({ user: await acceptConsent(req.user.id, version) });
});

export default router;
