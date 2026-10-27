import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
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
