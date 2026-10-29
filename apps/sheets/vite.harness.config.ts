import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Dev-only build of harness/index.html (the app on a fake backend, for browser tests here).
export default defineConfig({
  plugins: [react()],
  build: { target: 'es2023', outDir: 'dist-harness', emptyOutDir: true, sourcemap: false, chunkSizeWarningLimit: 9000, rollupOptions: { input: 'harness/index.html' } },
  preview: { host: '127.0.0.1', port: 5182, strictPort: true },
});
