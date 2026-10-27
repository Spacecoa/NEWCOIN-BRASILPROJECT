import { Router } from 'express';
import { z } from 'zod';
import { optionalAuth, requireAuth } from '../lib/auth.js';
import { parse } from '../lib/errors.js';
import { pageMeta, parsePageParams } from '../lib/pagination.js';
import { hydrate } from '../services/posts.js';
import { userTimelineIds } from '../services/timeline.js';
import * as users from '../services/users.js';

const router = Router();

router.get('/', async (req, res) => {
  const q = parse(z.string().trim().min(1).max(50), req.query.q ?? '');
  res.json({ data: await users.searchUsers(q) });
});

router.get('/:username', optionalAuth, async (req, res) => {
  res.json({ data: await users.getProfile(req.params.username, req.user?.id) });
});

/** Referência: GET /2/users/:id/tweets?exclude=replies,retweets */
router.get('/:username/posts', optionalAuth, async (req, res) => {
  const page = parsePageParams(req.query);
  const exclude = String(req.query.exclude ?? '').split(',');
  const userId = await users.getUserIdByUsername(req.params.username);
  const ids = await userTimelineIds(userId, page, {
    excludeReplies: exclude.includes('replies'),
    excludeReposts: exclude.includes('reposts'),
  });
  const result = await hydrate(ids, req.user?.id);
  res.json({ ...result, meta: pageMeta(ids.map((id) => ({ id })), page.limit) });
});

for (const direction of ['followers', 'following']) {
  router.get(`/:username/${direction}`, async (req, res) => {
    const page = parsePageParams(req.query);
    const data = await users.listFollows(req.params.username, direction, page);
    res.json({ data, meta: pageMeta(data, page.limit) });
  });
}

router.post('/:username/follow', requireAuth, async (req, res) => {
  res.json({ data: await users.follow(req.user.id, req.params.username) });
});

router.delete('/:username/follow', requireAuth, async (req, res) => {
  res.json({ data: await users.unfollow(req.user.id, req.params.username) });
});

export default router;
