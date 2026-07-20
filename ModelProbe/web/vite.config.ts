import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const webRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [react()],
  root: webRoot,
  css: {
    postcss: path.join(webRoot, 'postcss.config.cjs'),
  },
  server: {
    port: Number(process.env.WEB_PORT || 5179),
    strictPort: false,
    proxy: {
      '/api': {
        target: `http://localhost:${Number(process.env.PORT || 4200)}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
