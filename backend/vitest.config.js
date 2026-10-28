import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Os testes de integração compartilham um banco real: rodam em série.
    fileParallelism: false,
    setupFiles: ['test/setup.js'],
    testTimeout: 15000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://social:social@localhost:5432/social_test',
      // Banco 1 do Redis, isolado do banco 0 usado em desenvolvimento.
      REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/1',
      JWT_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres-0123456789',
      INSTANCE_DOMAIN: 'agora.test',
      DISABLE_RATE_LIMIT: '1',
      CORS_ORIGIN: 'http://localhost:5173',
    },
  },
});
