import { expect, type Page } from '@playwright/test';

export type Role = 'admin' | 'staff' | 'viewer';

export function hasCreds(role: Role): boolean {
  const u = process.env[`ATLAS_E2E_${role.toUpperCase()}_EMAIL`];
  const p = process.env[`ATLAS_E2E_${role.toUpperCase()}_PASSWORD`];
  return Boolean(u && p);
}

export function creds(role: Role): { email: string; password: string } {
  const email = process.env[`ATLAS_E2E_${role.toUpperCase()}_EMAIL`];
  const password = process.env[`ATLAS_E2E_${role.toUpperCase()}_PASSWORD`];
  if (!email || !password) {
    throw new Error(
      `Missing ATLAS_E2E_${role.toUpperCase()}_EMAIL / ATLAS_E2E_${role.toUpperCase()}_PASSWORD`,
    );
  }
  return { email, password };
}

/** A name unique to this run, so re-runs don't collide on staging data. */
export function unique(prefix: string): string {
  return `${prefix} ${Date.now().toString().slice(-7)}`;
}

/** Log in via the UI and wait until the board shell is visible. */
export async function login(page: Page, role: Role): Promise<void> {
  const { email, password } = creds(role);
  await page.goto('/');
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('nav-board')).toBeVisible({ timeout: 20_000 });
}

export async function gotoClients(page: Page): Promise<void> {
  await page.getByTestId('nav-clients').click();
  await expect(page.getByRole('heading', { name: 'Clients' })).toBeVisible();
}
