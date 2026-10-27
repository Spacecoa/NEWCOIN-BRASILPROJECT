import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../lib/auth.js';
import { parse } from '../lib/errors.js';
import { recordBeat } from '../services/activity.js';
import { getSettings } from '../services/interests.js';
import { getPost } from '../services/posts.js';
import { getWallet, tipPost, tokenInfo } from '../services/tokens.js';

const router = Router();
const idParam = z.string().regex(/^\d{1,20}$/, 'ID inválido');

/** Regras do token: públicas. */
router.get('/token', (_req, res) => res.json(tokenInfo()));

router.get('/carteira', requireAuth, async (req, res) => {
  res.json(await getWallet(req.user.id));
});

/** Recompensar um post: transfere 1 token seu para o autor. Como o like, uma vez por post. */
router.post('/posts/:id/recompensa', requireAuth, async (req, res) => {
  const target = await tipPost(req.user.id, parse(idParam, req.params.id));
  res.json(await getPost(target, req.user.id));
});

/** Sinal de atividade (1 por minuto com a aba visível). Ignorado se a pessoa desligou a contagem. */
router.post('/atividade', requireAuth, async (req, res) => {
  const settings = await getSettings(req.user.id);
  if (!settings.count_time) return res.json({ counted: false, minutes: 0 });
  res.json({ counted: true, ...(await recordBeat(req.user.id)) });
});

export default router;
