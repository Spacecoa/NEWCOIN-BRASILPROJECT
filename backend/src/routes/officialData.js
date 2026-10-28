import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../lib/auth.js';
import { parse } from '../lib/errors.js';
import { rateLimit } from '../lib/rateLimit.js';
import { INDICATOR_IDS } from '../official/catalog.js';
import { allIndicators, indicator, refreshAll } from '../official/service.js';
import { assertModerator } from '../services/moderation.js';

const router = Router();

/** Aba "Brasil em dados": públicos, como as próprias fontes. */
router.get('/dados', async (_req, res) => {
  res.json({ data: await allIndicators() });
});

router.get('/dados/:id', async (req, res) => {
  res.json({ data: await indicator(parse(z.enum(INDICATOR_IDS), req.params.id)) });
});

// Forçar atualização (a coleta normal é periódica). Só a moderação, e com limite.
const refreshLimiter = rateLimit({ name: 'dados:refresh', limit: 6, windowSec: 60 * 60 });
router.post('/moderacao/dados/atualizar', requireAuth, refreshLimiter, async (req, res) => {
  await assertModerator(req.user.id);
  res.json({ data: await refreshAll() });
});

export default router;
