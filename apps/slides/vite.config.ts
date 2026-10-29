import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Tauri needs a fixed dev port and no screen clearing, so its own output stays visible.
// Everything the slide engine needs (the renderer, its chart library, the .ppt converter's
// WebAssembly) is bundled; nothing comes from a CDN.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { host: 'localhost', port: 5174, strictPort: true },
  build: { target: 'es2023', outDir: 'dist', emptyOutDir: true, sourcemap: false },
  worker: { format: 'es' },
});
