import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const webRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [react()],
  root: webRoot,
  server: {
    port: Number(process.env.WEB_PORT || 5178),
    strictPort: false,
    proxy: {
      '/api': {
        target: `http://localhost:${Number(process.env.PORT || 4100)}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
