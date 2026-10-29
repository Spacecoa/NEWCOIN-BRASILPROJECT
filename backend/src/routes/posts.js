import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../lib/auth.js';
import { parse } from '../lib/errors.js';
import { pageMeta, parsePageParams } from '../lib/pagination.js';
import { rateLimit } from '../lib/rateLimit.js';
import * as posts from '../services/posts.js';
import { publicTimelineIds } from '../services/timeline.js';

const router = Router();
const idParam = z.string().regex(/^\d{1,20}$/, 'ID inválido');

const createSchema = z.object({
  text: z.string().trim().min(1, 'o texto não pode ser vazio').max(280, 'máximo de 280 caracteres'),
  reply_to_id: idParam.nullish(),
});

// O X documenta 300 posts / 3h por usuário (soma de posts e reposts) para criação via API.
const createLimiter = rateLimit({ name: 'posts:create', limit: 300, windowSec: 3 * 60 * 60 });

// Posts só são lidos por quem tem conta e entrou: nada de leitura anônima.

/** Timeline da instância (mais recentes primeiro), para quem está logado. */
router.get('/', requireAuth, async (req, res) => {
  const page = parsePageParams(req.query);
  const ids = await publicTimelineIds(page);
  const result = await posts.hydrate(ids, req.user?.id);
  res.json({ ...result, meta: pageMeta(result.data, page.limit) });
});

router.post('/', requireAuth, createLimiter, async (req, res) => {
  const input = parse(createSchema, req.body);
  res.status(201).json(await posts.createPost(req.user.id, input));
});

router.get('/:id', requireAuth, async (req, res) => {
  res.json(await posts.getPost(parse(idParam, req.params.id), req.user?.id));
});

router.get('/:id/thread', requireAuth, async (req, res) => {
  res.json(await posts.getThread(parse(idParam, req.params.id), req.user?.id));
});

router.delete('/:id', requireAuth, async (req, res) => {
  await posts.deletePost(req.user.id, parse(idParam, req.params.id));
  res.json({ deleted: true });
});

router.post('/:id/like', requireAuth, async (req, res) => {
  res.json(await posts.like(req.user.id, parse(idParam, req.params.id)));
});
router.delete('/:id/like', requireAuth, async (req, res) => {
  res.json(await posts.unlike(req.user.id, parse(idParam, req.params.id)));
});

/**
 * "Mais disto" / "Menos disto": o aprendizado acontece no aparelho de cada pessoa. A rota
 * continua aceitando o sinal (apps antigos), mas o servidor não guarda nada.
 */
router.post('/:id/feedback', requireAuth, async (req, res) => {
  const { kind } = parse(z.object({ kind: z.enum(['more', 'less']) }), req.body);
  parse(idParam, req.params.id);
  res.json({ ok: true, kind, stored: false });
});

router.post('/:id/repost', requireAuth, createLimiter, async (req, res) => {
  res.json(await posts.repost(req.user.id, parse(idParam, req.params.id)));
});
router.delete('/:id/repost', requireAuth, async (req, res) => {
  res.json(await posts.unrepost(req.user.id, parse(idParam, req.params.id)));
});

export default router;
