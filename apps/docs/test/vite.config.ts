import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Builds test/harness.html (the app on the shell's in-memory backend) for test/ui.mjs.
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  logLevel: 'warn',
  build: { target: 'es2023', outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 8000, rollupOptions: { input: 'harness.html' } },
  worker: { format: 'es' },
});
