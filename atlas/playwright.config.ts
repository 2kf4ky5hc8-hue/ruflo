import './tests/e2e/load-env'; // first: load .env.e2e before the guard reads env
import { defineConfig, devices } from '@playwright/test';
import { resolveBaseURL } from './tests/e2e/guard';

// resolveBaseURL() throws if ATLAS_E2E_BASE_URL is missing or looks like
// production — so the whole suite refuses to start against live data.
const baseURL = resolveBaseURL();

export default defineConfig({
  testDir: './tests/e2e',
  // Serial: tests share one staging database and a login session.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
