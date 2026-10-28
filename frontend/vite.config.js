import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';

// Política de conteúdo da página (só na versão final; o modo dev do Vite injeta scripts
// inline). Scripts só do próprio site: um texto malicioso num post não vira código.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "img-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ');

const cspOnBuild = {
  name: 'agora-csp',
  apply: 'build',
  transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' }],
};

export default defineConfig({
  plugins: [react(), tailwindcss(), cspOnBuild],
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
