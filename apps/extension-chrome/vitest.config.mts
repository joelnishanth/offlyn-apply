import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.test.ts'],
    environmentMatchGlobs: [
      ['src/popup/**/*.test.ts', 'jsdom'],
      ['src/shared/dom.test.ts', 'jsdom'],
    ],
  },
});
