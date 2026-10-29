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

// Proteção contra iframe (clickjacking, docs/14 W-1). A CSP em <meta> não aceita
// frame-ancestors, então ela precisa vir como cabeçalho. Vale para o servidor de
// desenvolvimento e o de pré-visualização (`vite preview`, usado na pré-produção).
// O servidor da produção oficial precisa mandar os mesmos dois cabeçalhos por conta própria.
const noFraming = { 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "frame-ancestors 'none'" };

export default defineConfig({
  plugins: [react(), tailwindcss(), cspOnBuild],
  // O algoritmo "Para você" é o mesmo arquivo no servidor e no navegador (shared/ranking).
  resolve: { alias: { '@shared': fileURLToPath(new URL('../shared', import.meta.url)) } },
  preview: { headers: noFraming },
  server: {
    port: 5173,
    headers: noFraming,
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
