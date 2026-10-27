import { Router } from 'express';
import { requireAuth } from '../lib/auth.js';
import { pageMeta, parsePageParams } from '../lib/pagination.js';
import { rateLimit } from '../lib/rateLimit.js';
import { hydrate } from '../services/posts.js';
import { homeTimelineIds, mentionIds } from '../services/timeline.js';

const router = Router();

// Referência: GET /2/users/:id/timelines/reverse_chronological (180 req / 15 min por usuário
// nos limites historicamente documentados pelo X).
const timelineLimiter = rateLimit({ name: 'timeline', limit: 180, windowSec: 15 * 60 });

/** Home "Seguindo": posts e reposts de quem eu sigo + os meus, em ordem cronológica reversa. */
router.get('/timeline', requireAuth, timelineLimiter, async (req, res) => {
  const page = parsePageParams(req.query);
  const ids = await homeTimelineIds(req.user.id, page);
  const result = await hydrate(ids, req.user.id);
  res.json({ ...result, meta: pageMeta(ids.map((id) => ({ id })), page.limit) });
});

/** Referência: GET /2/users/:id/mentions */
router.get('/mentions', requireAuth, async (req, res) => {
  const page = parsePageParams(req.query);
  const ids = await mentionIds(req.user.id, page);
  const result = await hydrate(ids, req.user.id);
  res.json({ ...result, meta: pageMeta(ids.map((id) => ({ id })), page.limit) });
});

export default router;
