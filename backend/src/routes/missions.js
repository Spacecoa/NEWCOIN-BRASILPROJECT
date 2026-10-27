import { Router } from 'express';
import { requireAuth } from '../lib/auth.js';
import { rateLimit } from '../lib/rateLimit.js';
import { createInvite, listInvites } from '../services/invites.js';
import { getMissions, skipMission } from '../services/missions.js';

const router = Router();

router.get('/missoes', requireAuth, async (req, res) => {
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
