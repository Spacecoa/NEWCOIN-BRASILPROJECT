import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // O algoritmo "Para você" é o mesmo arquivo no servidor e no navegador (shared/ranking).
  resolve: { alias: { '@shared': fileURLToPath(new URL('../shared', import.meta.url)) } },
  server: {
    port: 5173,
    fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] },
    // Em desenvolvimento o frontend fala com o backend pela mesma origem (sem CORS).
    proxy: {
      '/api': backend,
      '/socket.io': { target: backend, ws: true },
      '/.well-known': backend,
      '/federation': backend,
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test/setup.js'],
  },
});
