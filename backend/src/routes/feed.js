import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../lib/auth.js';
import { parse } from '../lib/errors.js';
import { describeAlgorithm, FACTORS } from '../lib/ranking.js';
import { TOPIC_IDS, TOPICS } from '../lib/topics.js';
import { rateLimit } from '../lib/rateLimit.js';
import * as interests from '../services/interests.js';

const router = Router();

const unit = z.number().min(0).max(1);
const factorWeights = z.object(Object.fromEntries(Object.keys(FACTORS).map((k) => [k, unit.optional()]))).strict();
const topicId = z.enum(TOPIC_IDS);

const settingsSchema = z
  .object({
    weights: factorWeights.optional(),
    topics: z.partialRecord(topicId, unit).optional(),
    muted_topics: z.array(topicId).max(TOPIC_IDS.length).optional(),
    keywords: z.array(z.string().trim().min(2).max(40)).max(20).optional(),
    half_life_hours: z.number().min(1).max(24 * 7).optional(),
    diversity: unit.optional(),
    session_limit: z.number().int().min(5).max(200).optional(),
    hide_metrics: z.boolean().optional(),
    missions_enabled: z.boolean().optional(),
    count_time: z.boolean().optional(),
  })
  .strict();

/** O algoritmo é público: qualquer pessoa (logada ou não) pode ler como ele funciona. */
router.get('/algoritmo', (_req, res) => {
  res.json(describeAlgorithm());
});

// Cada página recalcula o ranking (CPU). Uma sessão normal usa 2–3 pedidos; o limite protege o
// servidor de uma única conta pedindo sem parar (ver docs/10-seguranca-e-dos.md, achado C1).
const interestsLimiter = rateLimit({ name: 'feed:interests', limit: 120, windowSec: 15 * 60 });
router.get('/interesses', requireAuth, interestsLimiter, async (req, res) => {
  const { next_token: token, max_results: limit } = parse(
    z.object({ next_token: z.coerce.number().int().min(0).optional(), max_results: z.coerce.number().int().min(1).max(50).default(20) }),
    req.query,
  );
  res.json(await interests.interestFeed(req.user.id, { offset: token ?? 0, limit }));
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

/** Onde o feed é calculado: 'server' (instância) ou 'device' (navegador). */
router.put('/modo', requireAuth, async (req, res) => {
  const { mode } = parse(z.object({ mode: z.enum(['server', 'device']) }).strict(), req.body);
  res.json({ mode, settings: await interests.setRankingMode(req.user.id, mode) });
});

router.delete('/aprendizado', requireAuth, async (req, res) => {
  await interests.resetLearning(req.user.id);
  res.json({ reset: true });
});

export default router;
