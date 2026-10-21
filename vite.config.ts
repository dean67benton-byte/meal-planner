import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// `npm run dev` proxies /api to `npm run worker` (wrangler dev on :8787).
export default defineConfig({
  plugins: [preact()],
  server: { proxy: { '/api': 'http://localhost:8787' } },
});
