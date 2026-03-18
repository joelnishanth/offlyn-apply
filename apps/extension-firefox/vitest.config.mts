import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.test.ts'],
    // Per-file environment overrides via @vitest-environment docblock are enabled by default.
    // Files that need a DOM (dom.test.ts, popup.test.ts) declare // @vitest-environment jsdom
    // at their top; all others run in the default Node environment.
    environmentMatchGlobs: [
      ['src/popup/**/*.test.ts', 'jsdom'],
      ['src/shared/dom.test.ts', 'jsdom'],
    ],
  },
});
