import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../lib/auth.js';
import { parse } from '../lib/errors.js';
import { rateLimit } from '../lib/rateLimit.js';
import * as moderation from '../services/moderation.js';
import { listRelations } from '../services/relations.js';
import { listRules, replaceRules } from '../services/rules.js';

const router = Router();
const idParam = z.string().regex(/^\d{1,20}$/, 'ID inválido');

const reportSchema = z
  .object({
    post_id: idParam.optional(),
    username: z.string().trim().min(1).max(20).optional(),
    reason: z.enum(Object.keys(moderation.REASONS)),
    details: z.string().trim().max(500, 'máximo de 500 caracteres').optional().default(''),
  })
  .strict()
  .refine((v) => Boolean(v.post_id) !== Boolean(v.username), { message: 'denuncie um post ou uma conta', path: ['post_id'] });

// Denúncias têm limite próprio: servem para avisar a moderação, não para inundá-la.
const reportLimiter = rateLimit({ name: 'reports', limit: 20, windowSec: 24 * 60 * 60 });

/** Motivos aceitos (o app mostra esta lista no formulário). */
router.get('/denuncias/motivos', (_req, res) => {
  res.json({ data: Object.entries(moderation.REASONS).map(([id, label]) => ({ id, label })) });
});

router.post('/denuncias', requireAuth, reportLimiter, async (req, res) => {
  res.status(201).json({ data: await moderation.createReport(req.user.id, parse(reportSchema, req.body)) });
});

/** Minhas denúncias e o que a moderação decidiu. */
router.get('/denuncias', requireAuth, async (req, res) => {
  res.json({ data: await moderation.myReports(req.user.id) });
});

router.get('/conta/bloqueados', requireAuth, async (req, res) => {
  res.json({ data: await listRelations(req.user.id, 'blocks') });
});

router.get('/conta/silenciados', requireAuth, async (req, res) => {
  res.json({ data: await listRelations(req.user.id, 'mutes') });
});

// ----- Fila da moderação (só quem modera a instância) -----

router.get('/moderacao/denuncias', requireAuth, async (req, res) => {
  await moderation.assertModerator(req.user.id);
  const status = parse(z.enum(['aberta', 'arquivada', 'acatada']).default('aberta'), req.query.status);
  res.json({ data: await moderation.listQueue(status) });
});

router.post('/moderacao/denuncias/:id/resolver', requireAuth, async (req, res) => {
  const body = parse(
    z.object({ action: z.enum(moderation.ACTIONS), note: z.string().trim().max(500).optional().default(''), rule_id: idParam.optional() }).strict(),
    req.body,
  );
  res.json({ data: await moderation.resolveReport(req.user.id, parse(idParam, req.params.id), body) });
});

router.post('/moderacao/usuarios/:username/reativar', requireAuth, async (req, res) => {
  res.json({ data: await moderation.unsuspend(req.user.id, req.params.username) });
});

// ----- Regras da instância -----

/** Públicas: qualquer pessoa (mesmo sem conta) pode ler antes de entrar. */
router.get('/instancia/regras', async (_req, res) => {
  res.json({ data: await listRules() });
});

const ruleSchema = z
  .object({
    id: idParam.optional(),
    title: z.string().trim().min(3, 'título com pelo menos 3 caracteres').max(80),
    description: z.string().trim().max(500).optional().default(''),
  })
  .strict();

router.put('/moderacao/regras', requireAuth, async (req, res) => {
  await moderation.assertModerator(req.user.id);
  const { rules } = parse(z.object({ rules: z.array(ruleSchema).min(1, 'a instância precisa de pelo menos uma regra').max(15) }).strict(), req.body);
  res.json({ data: await replaceRules(rules) });
});

// ----- Decisões sobre a própria conta e recursos -----

const appealText = z.string().trim().min(10, 'explique em pelo menos 10 caracteres').max(1000, 'máximo de 1000 caracteres');

router.get('/conta/decisoes', requireAuth, async (req, res) => {
  res.json({ data: await moderation.myDecisions(req.user.id) });
});

router.post('/conta/decisoes/:id/recurso', requireAuth, async (req, res) => {
  const { text } = parse(z.object({ text: appealText }).strict(), req.body);
  res.status(201).json({ data: await moderation.appealDecision(req.user.id, parse(idParam, req.params.id), text) });
});

// Conta suspensa não entra: o recurso confere e-mail e senha. Conta no MESMO limite do login
// (nome 'auth'), para não virar um segundo lugar de testar senhas (docs/14, M-2).
const appealLimiter = rateLimit({ name: 'auth', limit: 10, windowSec: 15 * 60, key: (req) => req.ip, failClosed: true });
router.post('/recursos/suspensao', appealLimiter, async (req, res) => {
  const body = parse(
    z.object({ email: z.string().trim().toLowerCase().pipe(z.email('e-mail inválido')), password: z.string().min(1).max(128), text: appealText }).strict(),
    req.body,
  );
  res.status(201).json({ data: await moderation.appealSuspension(body) });
});

router.get('/moderacao/recursos', requireAuth, async (req, res) => {
  await moderation.assertModerator(req.user.id);
  const status = parse(z.enum(['aberto', 'decidido']).default('aberto'), req.query.status);
  res.json({ data: await moderation.listAppeals(status) });
});

router.post('/moderacao/recursos/:id/decidir', requireAuth, async (req, res) => {
  const body = parse(z.object({ decision: z.enum(['aceitar', 'negar']), note: z.string().trim().max(500).optional().default('') }).strict(), req.body);
  res.json({ data: await moderation.decideAppeal(req.user.id, parse(idParam, req.params.id), body) });
});

export default router;
