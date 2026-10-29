import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../lib/auth.js';
import { parse } from '../lib/errors.js';
import { describeAlgorithm, FACTORS } from '../lib/ranking.js';
import { TOPIC_IDS, TOPICS } from '../lib/topics.js';
import { rateLimit } from '../lib/rateLimit.js';
import * as interests from '../services/interests.js';

const router = Router();

// O servidor só guarda o que NÃO é do algoritmo: o algoritmo de cada pessoa (pesos, tópicos,
// palavras, aprendizado) fica exclusivamente no aparelho dela.
const settingsSchema = z
  .object({
    missions_enabled: z.boolean().optional(),
    count_time: z.boolean().optional(),
  })
  .strict();

/** O algoritmo é público: qualquer pessoa (logada ou não) pode ler como ele funciona. */
router.get('/algoritmo', (_req, res) => {
  res.json(describeAlgorithm());
});

/** O ranking acontece no aparelho de cada pessoa: a instância não calcula mais o feed. */
router.get('/interesses', requireAuth, (_req, res) => {
  res.status(410).json({ error: 'O feed Para você é calculado no seu aparelho. Use /api/feed/candidatos.' });
});

router.get('/preferencias', requireAuth, async (req, res) => {
  const [settings, learned, hidden] = await Promise.all([
    interests.getSettings(req.user.id),
    interests.getLearned(req.user.id),
    interests.hiddenPostIds(req.user.id),
  ]);
  res.json({
    settings,
    learned,
    hidden_post_ids: hidden,
    topics: TOPIC_IDS.map((id) => ({ id, label: TOPICS[id].label })),
    factors: Object.entries(FACTORS).map(([id, descricao]) => ({ id, descricao })),
  });
});

router.put('/preferencias', requireAuth, async (req, res) => {
  const patch = parse(settingsSchema, req.body);
  res.json({ settings: await interests.saveSettings(req.user.id, patch) });
});

// Candidatos para o ranking no navegador. Resposta pesada (até 500 posts): limite próprio.
const candidatesLimiter = rateLimit({ name: 'feed:candidates', limit: 60, windowSec: 15 * 60 });
router.get('/candidatos', requireAuth, candidatesLimiter, async (req, res) => {
  res.json(await interests.candidatesForDevice(req.user.id));
});

/**
 * Leva o algoritmo para o aparelho (contas antigas): o app copia as preferências e o
 * aprendizado que o servidor ainda tinha, e o servidor apaga a cópia dele.
 */
router.put('/modo', requireAuth, async (req, res) => {
  const { mode } = parse(z.object({ mode: z.literal('device', { error: 'o algoritmo fica só no aparelho' }) }).strict(), req.body);
  res.json({ mode, settings: await interests.moveAlgorithmToDevice(req.user.id) });
});

router.delete('/aprendizado', requireAuth, async (req, res) => {
  await interests.resetLearning(req.user.id);
  res.json({ reset: true });
});

export default router;
