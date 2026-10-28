import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../lib/auth.js';
import { parse } from '../lib/errors.js';
import { rateLimit } from '../lib/rateLimit.js';
import * as moderation from '../services/moderation.js';
import { listRelations } from '../services/relations.js';

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
  const body = parse(z.object({ action: z.enum(moderation.ACTIONS), note: z.string().trim().max(500).optional().default('') }).strict(), req.body);
  res.json({ data: await moderation.resolveReport(req.user.id, parse(idParam, req.params.id), body) });
});

router.post('/moderacao/usuarios/:username/reativar', requireAuth, async (req, res) => {
  res.json({ data: await moderation.unsuspend(req.user.id, req.params.username) });
});

export default router;
