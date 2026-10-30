import { Router } from 'express';
import { z } from 'zod';
import { optionalAuth, requireAuth } from '../lib/auth.js';
import { parse } from '../lib/errors.js';
import { pageMeta, parsePageParams } from '../lib/pagination.js';
import { rateLimit } from '../lib/rateLimit.js';
import { hydrate } from '../services/posts.js';
import { userTimelineIds } from '../services/timeline.js';
import * as relations from '../services/relations.js';
import * as users from '../services/users.js';

const router = Router();

// Busca de pessoas: limite próprio, além do geral (docs/10, B2).
const searchLimiter = rateLimit({ name: 'users:search', limit: 120, windowSec: 5 * 60 });
router.get('/', optionalAuth, searchLimiter, async (req, res) => {
  const q = parse(z.string().trim().min(1).max(50), req.query.q ?? '');
  res.json({ data: await users.searchUsers(q, 10, req.user?.id) });
});

router.get('/:username', optionalAuth, async (req, res) => {
  res.json({ data: await users.getProfile(req.params.username, req.user?.id) });
});

/** Referência: GET /2/users/:id/tweets?exclude=replies,retweets. Leitura aberta; sem login, ninguém é "bloqueado". */
router.get('/:username/posts', optionalAuth, async (req, res) => {
  const page = parsePageParams(req.query);
  const exclude = String(req.query.exclude ?? '').split(',');
  const userId = await users.getUserIdByUsername(req.params.username);
  // Com bloqueio, o perfil não mostra posts (e não oferece "carregar mais").
  if (await relations.isBlockedEitherWay(req.user?.id, userId)) {
    return res.json({ data: [], includes: { users: [], posts: [] }, meta: { result_count: 0, blocked: true } });
  }
  const ids = await userTimelineIds(userId, page, {
    excludeReplies: exclude.includes('replies'),
    excludeReposts: exclude.includes('reposts'),
  });
  // Abrir o perfil é escolha da pessoa: os posts aparecem mesmo se ela silenciou a conta.
  const result = await hydrate(ids, req.user?.id, { muted: false });
  res.json({ ...result, meta: pageMeta(ids.map((id) => ({ id })), page.limit) });
});

for (const direction of ['followers', 'following']) {
  router.get(`/:username/${direction}`, optionalAuth, async (req, res) => {
    const page = parsePageParams(req.query);
    const data = await users.listFollows(req.params.username, direction, page, req.user?.id);
    res.json({ data, meta: pageMeta(data, page.limit) });
  });
}

router.post('/:username/follow', requireAuth, async (req, res) => {
  res.json({ data: await users.follow(req.user.id, req.params.username) });
});

router.delete('/:username/follow', requireAuth, async (req, res) => {
  res.json({ data: await users.unfollow(req.user.id, req.params.username) });
});

router.post('/:username/mute', requireAuth, async (req, res) => {
  res.json({ data: await relations.mute(req.user.id, req.params.username) });
});
router.delete('/:username/mute', requireAuth, async (req, res) => {
  res.json({ data: await relations.unmute(req.user.id, req.params.username) });
});
router.post('/:username/block', requireAuth, async (req, res) => {
  res.json({ data: await relations.block(req.user.id, req.params.username) });
});
router.delete('/:username/block', requireAuth, async (req, res) => {
  res.json({ data: await relations.unblock(req.user.id, req.params.username) });
});

export default router;
