import { defineConfig } from 'vitest/config';

// Integration suite. Requires DATABASE_URL pointing at a Postgres with the
// schema applied + seed loaded (pnpm db:bootstrap). Run with
// `pnpm test:integration`.
export default defineConfig({
  test: {
    include: ['**/*.integration.test.ts', '**/*.integration.test.tsx'],
    exclude: ['**/node_modules/**', '**/.next/**', '**/dist/**'],
    testTimeout: 30_000,
  },
});
