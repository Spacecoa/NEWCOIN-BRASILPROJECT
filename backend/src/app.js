import cors from 'cors';
import express from 'express';
import { config } from './config.js';
import { HttpError } from './lib/errors.js';
import authRoutes from './routes/auth.js';
import channelRoutes from './routes/channels.js';
import federationRoutes from './routes/federation.js';
import postRoutes from './routes/posts.js';
import timelineRoutes from './routes/timeline.js';
import userRoutes from './routes/users.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json({ limit: '32kb' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/posts', postRoutes);
  app.use('/api', timelineRoutes);
  app.use('/api/channels', channelRoutes);
  app.use(federationRoutes);

  app.use((_req, res) => res.status(404).json({ error: 'Rota não encontrada' }));

  // Express 5 encaminha rejeições de handlers async para cá automaticamente.
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message, details: err.details });
    }
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido' });
    console.error(err);
    res.status(500).json({ error: 'Erro interno' });
  });

  return app;
}
