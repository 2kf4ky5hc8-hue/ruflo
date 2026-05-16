import { defineConfig } from 'vitest/config';

// Default unit-test run excludes anything named `*.integration.test.*`.
// Run integration tests with `pnpm test:integration` (or vitest --mode integration).
export default defineConfig({
  test: {
    exclude: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/*.integration.test.ts',
      '**/*.integration.test.tsx',
    ],
  },
});
