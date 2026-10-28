import cors from 'cors';
import express from 'express';
import { config } from './config.js';
import { requesterKey } from './lib/auth.js';
import { HttpError } from './lib/errors.js';
import { rateLimit } from './lib/rateLimit.js';
import { securityHeaders } from './lib/securityHeaders.js';
import authRoutes from './routes/auth.js';
import channelRoutes from './routes/channels.js';
import federationRoutes from './routes/federation.js';
import feedRoutes from './routes/feed.js';
import missionRoutes from './routes/missions.js';
import tokenRoutes from './routes/tokens.js';
import postRoutes from './routes/posts.js';
import timelineRoutes from './routes/timeline.js';
import userRoutes from './routes/users.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // Atrás de um proxy reverso, req.ip só é o IP real se dissermos em quem confiar.
  app.set('trust proxy', config.trustProxy);
  app.use(securityHeaders);
  app.use(cors({ origin: config.corsOrigin, credentials: true }));

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  // Limite geral, antes de ler o corpo: um excesso é recusado gastando o mínimo.
  // Rotas sensíveis têm limites próprios, mais apertados, além deste.
  app.use('/api', rateLimit({ name: 'api', limit: config.apiRateLimit, windowSec: config.apiRateWindowSec, key: requesterKey }));
  const federationLimiter = rateLimit({ name: 'federation', limit: 300, windowSec: 5 * 60, key: (req) => req.ip });
  app.use(['/.well-known', '/federation'], federationLimiter);

  app.use(express.json({ limit: '32kb' }));
  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/posts', postRoutes);
  app.use('/api', timelineRoutes);
  app.use('/api/channels', channelRoutes);
  app.use('/api/feed', feedRoutes);
  app.use('/api', missionRoutes);
  app.use('/api', tokenRoutes);
  app.use(federationRoutes);

  app.use((_req, res) => res.status(404).json({ error: 'Rota não encontrada' }));

  // Express 5 encaminha rejeições de handlers async para cá automaticamente.
  // Nunca devolve detalhes internos; só registra no log o que é falha nossa (5xx).
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message, details: err.details });
    }
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Conteúdo grande demais (máximo de 32 KB)' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido' });
    if (err.status >= 400 && err.status < 500) return res.status(err.status).json({ error: 'Pedido inválido' });
    // Consulta cancelada pelo tempo-limite (57014) ou pool sem conexão livre: servidor ocupado.
    if (err.code === '57014' || /timeout exceeded when trying to connect/i.test(err.message ?? '')) {
      console.warn('[db]', err.message);
      res.set('retry-after', '5');
      return res.status(503).json({ error: 'Servidor ocupado. Tente de novo em instantes.' });
    }
    console.error(err);
    res.status(500).json({ error: 'Erro interno' });
  });

  return app;
}
