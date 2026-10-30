import { Router } from 'express';
import { z } from 'zod';
import { optionalAuth, requireAuth } from '../lib/auth.js';
import { parse } from '../lib/errors.js';
import { pageMeta, parsePageParams } from '../lib/pagination.js';
import { rateLimit } from '../lib/rateLimit.js';
import * as posts from '../services/posts.js';
import { publicTimelineIds, searchPostIds } from '../services/timeline.js';

const router = Router();
const idParam = z.string().regex(/^\d{1,20}$/, 'ID inválido');

const createSchema = z.object({
  text: z.string().trim().min(1, 'o texto não pode ser vazio').max(280, 'máximo de 280 caracteres'),
  reply_to_id: idParam.nullish(),
  // Citar: o post novo mostra este outro dentro dele.
  quote_of_id: idParam.nullish(),
  // Imagens já enviadas (POST /api/midia). A descrição é obrigatória: é o que leitores de tela
  // leem para quem não enxerga a imagem.
  media: z
    .array(z.object({ id: idParam, alt: z.string().trim().min(1, 'descreva a imagem para quem não enxerga').max(1000, 'descrição de no máximo 1000 caracteres') }).strict())
    .max(4, 'no máximo 4 imagens por post')
    .optional(),
});

// O X documenta 300 posts / 3h por usuário (soma de posts e reposts) para criação via API.
const createLimiter = rateLimit({ name: 'posts:create', limit: 300, windowSec: 3 * 60 * 60 });

// Ler posts é aberto a qualquer pessoa. Interagir (postar, curtir, repostar, responder,
// recompensar, seguir, apagar) exige login: todas as rotas de escrita abaixo usam requireAuth.

/** Timeline da instância (mais recentes primeiro). */
router.get('/', optionalAuth, async (req, res) => {
  const page = parsePageParams(req.query);
  const ids = await publicTimelineIds(page);
  const result = await posts.hydrate(ids, req.user?.id);
  res.json({ ...result, meta: pageMeta(result.data, page.limit) });
});

// Busca aberta a visitantes (ler é livre), com limite próprio: cada busca varre o índice.
const searchLimiter = rateLimit({ name: 'posts:search', limit: 60, windowSec: 5 * 60 });
const searchSchema = z.object({ q: z.string().trim().min(2, 'digite pelo menos 2 letras').max(100, 'no máximo 100 caracteres') });

/** GET /api/posts/busca?q= — posts com as palavras, mais recentes primeiro. */
router.get('/busca', optionalAuth, searchLimiter, async (req, res) => {
  const { q } = parse(searchSchema, { q: req.query.q ?? '' });
  const page = parsePageParams({ ...req.query, q: undefined });
  const ids = await searchPostIds(q, page);
  const result = await posts.hydrate(ids, req.user?.id);
  res.json({ ...result, meta: { ...pageMeta(ids.map((id) => ({ id })), page.limit), query: q } });
});

router.post('/', requireAuth, createLimiter, async (req, res) => {
  const input = parse(createSchema, req.body);
  res.status(201).json(await posts.createPost(req.user.id, input));
});

router.get('/:id', optionalAuth, async (req, res) => {
  res.json(await posts.getPost(parse(idParam, req.params.id), req.user?.id));
});

// Editar o texto (30 minutos, até 5 vezes). Conta no mesmo limite de criar posts.
const editSchema = z.object({ text: createSchema.shape.text }).strict();
router.patch('/:id', requireAuth, createLimiter, async (req, res) => {
  res.json(await posts.editPost(req.user.id, parse(idParam, req.params.id), parse(editSchema, req.body).text));
});

/** Histórico de edições: aberto a quem pode ler o post. */
router.get('/:id/edicoes', optionalAuth, async (req, res) => {
  res.json(await posts.getEdits(parse(idParam, req.params.id), req.user?.id));
});

router.get('/:id/thread', optionalAuth, async (req, res) => {
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
