import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: { sourcemap: false, rollupOptions: { output: { manualChunks: { terminal: ['@xterm/xterm', '@xterm/addon-fit', '@xterm/addon-search'], react: ['react', 'react-dom'] } } } },
});
