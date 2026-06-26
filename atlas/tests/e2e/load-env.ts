// Side-effect import: load .env.e2e so `npm run test:e2e` works after a simple
// `cp .env.e2e.example .env.e2e`. Imported FIRST in playwright.config.ts so the
// vars are present before the production guard reads them. Real environment
// variables already set take precedence (dotenv does not override them).
import dotenv from 'dotenv';

dotenv.config({ path: '.env.e2e' });
