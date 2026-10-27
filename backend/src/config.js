import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const env = process.env;

export const config = {
  port: Number(env.PORT ?? 4000),
  databaseUrl: env.DATABASE_URL ?? 'postgres://social:social@localhost:5432/social',
  redisUrl: env.REDIS_URL || null,
  jwtSecret: env.JWT_SECRET ?? 'dev-only-secret',
  jwtExpiresIn: env.JWT_EXPIRES_IN ?? '7d',
  instanceDomain: env.INSTANCE_DOMAIN ?? 'localhost:4000',
  workerId: Number(env.WORKER_ID ?? 1),
  corsOrigin: env.CORS_ORIGIN ?? 'http://localhost:5173',
  // Tamanho máximo da timeline materializada no Redis. O X documenta que a home
  // timeline retorna no máximo ~800 posts; usamos o mesmo teto.
  timelineCacheSize: Number(env.TIMELINE_CACHE_SIZE ?? 800),
};
