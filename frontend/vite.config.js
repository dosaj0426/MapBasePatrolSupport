import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '127.0.0.1', port: 5173, strictPort: true,
    allowedHosts: ['safety-map.mcrolcharge.com'],
    headers: { 'Cache-Control': 'no-store, max-age=0' },
    proxy: { '/api': 'http://127.0.0.1:8000' },
  },
});
