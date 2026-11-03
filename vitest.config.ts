import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts', 'research/**/*.test.ts'],
    // UI smoke tests use jsdom (via per-file @vitest-environment annotation)
    environmentOptions: {
      jsdom: {
        url: 'http://localhost/',
      },
    },
  },
});
