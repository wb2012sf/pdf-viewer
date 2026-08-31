import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Node is the default because the PDF logic (pdf-lib) is environment-agnostic.
    // Tests that need a DOM opt in with a `// @vitest-environment jsdom` docblock.
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // Playwright owns tests/e2e; vitest must not try to run those.
    exclude: ['node_modules/**', 'dist/**', 'tests/e2e/**'],
  },
});
