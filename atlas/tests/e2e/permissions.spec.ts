import { test, expect } from '@playwright/test';
import { login, gotoClients, unique, hasCreds } from './helpers';

// The make-or-break RLS check: a staff user must not see an unrelated client
// that an admin created and never linked to them.
test('staff cannot see an unrelated admin-only client', async ({ page, browser }) => {
  test.skip(!hasCreds('admin') || !hasCreds('staff'), 'need admin + staff creds');

  await login(page, 'admin');
  await gotoClients(page);
  const secret = unique('QA Admin-Only');
  await page.getByTestId('new-client-btn').click();
  await page.getByTestId('client-name-input').fill(secret);
  await page.getByTestId('client-save-btn').click();
  await expect(page.getByText(secret)).toBeVisible();

  const staffCtx = await browser.newContext();
  const staffPage = await staffCtx.newPage();
  await login(staffPage, 'staff');
  await gotoClients(staffPage);
  await expect(staffPage.getByText(secret)).toHaveCount(0);
  await staffCtx.close();
});

// A viewer is read-only: no create actions anywhere.
test('viewer has no create actions', async ({ page }) => {
  test.skip(!hasCreds('viewer'), 'no viewer credentials set');

  await login(page, 'viewer');
  await page.getByTestId('nav-board').click();
  await expect(page.getByTestId('new-job-btn')).toHaveCount(0);

  await gotoClients(page);
  await expect(page.getByTestId('new-client-btn')).toHaveCount(0);
});
