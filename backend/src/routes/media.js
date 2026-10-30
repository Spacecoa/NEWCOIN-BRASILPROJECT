import express, { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../lib/auth.js';
import { parse } from '../lib/errors.js';
import { rateLimit } from '../lib/rateLimit.js';
import { getMediaFile, MEDIA, uploadMedia } from '../services/media.js';

const router = Router();
const idParam = z.string().regex(/^\d{1,20}$/, 'ID inválido');

// Envio: os bytes da imagem no corpo. O tipo é conferido pelos bytes, não por este cabeçalho.
const uploadLimiter = rateLimit({ name: 'media:upload', limit: 30, windowSec: 60 * 60 });
const rawImage = express.raw({ type: () => true, limit: MEDIA.maxBytes });

router.post('/midia', requireAuth, uploadLimiter, rawImage, async (req, res) => {
  res.status(201).json({ data: await uploadMedia(req.user.id, Buffer.isBuffer(req.body) ? req.body : null) });
});

// Leitura aberta, como os posts. A imagem nunca muda: o navegador pode guardá-la, mas um
// post apagado ou removido para de servi-la (e o cache é curto o bastante para isso valer).
router.get('/midia/:id', async (req, res) => {
  const file = await getMediaFile(parse(idParam, req.params.id));
  res.set({
    'Content-Type': file.mime,
    'Cache-Control': 'public, max-age=3600',
    'Content-Disposition': 'inline',
    // A política geral da API já é fechada; para uma imagem, nada além dela pode rodar.
    'Content-Security-Policy': "default-src 'none'; sandbox",
  });
  res.send(file.bytes);
});

export default router;
