import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Tauri needs a fixed dev port and no screen clearing, so its own output stays visible.
// Everything the document engine needs (its font shaper's harfbuzz.wasm included) is
// bundled; nothing comes from a CDN.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { host: 'localhost', port: 5173, strictPort: true },
  build: { target: 'es2023', outDir: 'dist', emptyOutDir: true, sourcemap: false, chunkSizeWarningLimit: 6000 },
  worker: { format: 'es' },
});
