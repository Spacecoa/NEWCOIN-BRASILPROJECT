import { afterAll } from 'vitest';
import { closeRedis } from '../src/cache.js';
import { pool } from '../src/db.js';

afterAll(async () => {
  await closeRedis();
  await pool.end();
});
