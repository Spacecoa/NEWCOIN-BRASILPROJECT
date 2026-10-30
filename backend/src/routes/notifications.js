import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../lib/auth.js';
import { parse } from '../lib/errors.js';
import { parsePageParams } from '../lib/pagination.js';
import { listNotifications, markRead, unreadCount } from '../services/notifications.js';

const router = Router();

/** Quem curtiu, repostou, respondeu, mencionou, seguiu ou recompensou, do mais novo ao mais antigo. */
router.get('/notificacoes', requireAuth, async (req, res) => {
  const page = parsePageParams({ max_results: 30, ...req.query });
  res.json(await listNotifications(req.user.id, { untilId: page.untilId, limit: Math.min(page.limit, 50) }));
});

/** Só o número, para o contador da navegação. */
router.get('/notificacoes/nao-lidas', requireAuth, async (req, res) => {
  res.json({ unread_count: await unreadCount(req.user.id) });
});

/** Marca como lidas até newest_id (o mais novo que a pessoa viu); sem ele, todas. */
router.post('/notificacoes/lidas', requireAuth, async (req, res) => {
  const { newest_id: newestId } = parse(z.object({ newest_id: z.string().regex(/^\d{1,20}$/).optional() }).strict(), req.body ?? {});
  res.json(await markRead(req.user.id, newestId ?? null));
});

export default router;
