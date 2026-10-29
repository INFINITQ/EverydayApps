import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/*/src/**/*.test.{ts,tsx}',
      'apps/*/src/**/*.test.{ts,tsx}',
      'config/**/*.test.ts',
      'tools/**/*.test.ts',
    ],
    environment: 'jsdom',
    restoreMocks: true,
  },
});
