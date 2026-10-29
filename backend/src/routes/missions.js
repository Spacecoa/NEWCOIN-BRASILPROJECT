import { Router } from 'express';
import { requireAuth } from '../lib/auth.js';
import { rateLimit } from '../lib/rateLimit.js';
import { createInvite, listInvites } from '../services/invites.js';
import { getMissions, skipMission } from '../services/missions.js';

const router = Router();

// Cada pedido grava o dia e roda as consultas coletivas: limite próprio (docs/14, T-5).
const missionsLimiter = rateLimit({ name: 'missions', limit: 60, windowSec: 5 * 60 });
router.get('/missoes', requireAuth, missionsLimiter, async (req, res) => {
  res.json(await getMissions(req.user.id));
});

router.post('/missoes/:id/pular', requireAuth, async (req, res) => {
  res.json(await skipMission(req.user.id, req.params.id));
});

router.get('/convites', requireAuth, async (req, res) => {
  res.json({ data: await listInvites(req.user.id) });
});

const inviteLimiter = rateLimit({ name: 'invites', limit: 20, windowSec: 24 * 60 * 60 });
router.post('/convites', requireAuth, inviteLimiter, async (req, res) => {
  res.status(201).json({ data: await createInvite(req.user.id) });
});

export default router;
