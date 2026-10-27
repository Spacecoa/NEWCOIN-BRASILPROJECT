import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../lib/auth.js';
import { parse } from '../lib/errors.js';
import { parsePageParams } from '../lib/pagination.js';
import { rateLimit } from '../lib/rateLimit.js';
import * as channels from '../services/channels.js';

const router = Router();
router.use(requireAuth);

const createSchema = z.object({
  slug: z.string().regex(/^[A-Za-z0-9_]{3,32}$/, '3–32 caracteres: letras, números ou _'),
  title: z.string().trim().min(1).max(64),
  description: z.string().trim().max(255).optional(),
  kind: z.enum(['channel', 'group']),
});
const messageSchema = z.object({ text: z.string().trim().min(1).max(4096) });
const reactionSchema = z.object({ emoji: z.string().min(1).max(16) });
const idParam = z.string().regex(/^\d{1,20}$/);

// Equivalente ao FLOOD_WAIT do Telegram: limite de mensagens por usuário.
const messageLimiter = rateLimit({ name: 'messages', limit: 30, windowSec: 60 });

router.get('/', async (req, res) => {
  res.json({ data: await channels.listChannels(req.user.id) });
});

router.post('/', async (req, res) => {
  res.status(201).json({ data: await channels.createChannel(req.user.id, parse(createSchema, req.body)) });
});

router.get('/:slug', async (req, res) => {
  res.json({ data: await channels.getChannel(req.params.slug, req.user.id) });
});

router.post('/:slug/members', async (req, res) => {
  res.json({ data: await channels.joinChannel(req.user.id, req.params.slug) });
});

router.delete('/:slug/members/me', async (req, res) => {
  res.json({ data: await channels.leaveChannel(req.user.id, req.params.slug) });
});

router.put('/:slug/members/:username/role', async (req, res) => {
  const { role } = parse(z.object({ role: z.enum(['admin', 'member']) }), req.body);
  res.json({ data: await channels.setMemberRole(req.user.id, req.params.slug, req.params.username, role) });
});

router.get('/:slug/messages', async (req, res) => {
  res.json(await channels.listMessages(req.params.slug, req.user.id, parsePageParams(req.query)));
});

router.get('/:slug/difference', async (req, res) => {
  const pts = parse(z.coerce.number().int().min(0), req.query.pts ?? 0);
  res.json(await channels.getDifference(req.params.slug, req.user.id, pts));
});

router.post('/:slug/messages', messageLimiter, async (req, res) => {
  const { text } = parse(messageSchema, req.body);
  res.status(201).json(await channels.postMessage(req.user.id, req.params.slug, text));
});

router.post('/:slug/messages/:id/reactions', async (req, res) => {
  const { emoji } = parse(reactionSchema, req.body);
  res.json({ data: await channels.addReaction(req.user.id, req.params.slug, parse(idParam, req.params.id), emoji) });
});

router.delete('/:slug/messages/:id/reactions/:emoji', async (req, res) => {
  const emoji = parse(reactionSchema.shape.emoji, req.params.emoji);
  res.json({ data: await channels.removeReaction(req.user.id, req.params.slug, parse(idParam, req.params.id), emoji) });
});

export default router;
