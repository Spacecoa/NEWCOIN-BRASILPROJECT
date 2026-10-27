import { Redis } from 'ioredis';
import { config } from './config.js';

// Redis é opcional: sem ele o sistema continua correto, só mais lento
// (timelines passam a ser montadas 100% via SQL).
let client = null;

export function getRedis() {
  if (!config.redisUrl) return null;
  if (!client) {
    client = new Redis(config.redisUrl, { maxRetriesPerRequest: 1, lazyConnect: false });
    client.on('error', (err) => {
      if (process.env.NODE_ENV !== 'test') console.warn('[redis]', err.message);
    });
  }
  return client;
}

export async function closeRedis() {
  if (client) {
    await client.quit().catch(() => {});
    client = null;
  }
}
