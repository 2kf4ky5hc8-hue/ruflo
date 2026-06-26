import { test, expect } from '@playwright/test';
import { login, gotoClients, unique, hasCreds } from './helpers';

test.describe('admin: client → property → job hierarchy', () => {
  test.skip(!hasCreds('admin'), 'no admin credentials set');

  test('admin can create a client and a property under it', async ({ page }) => {
    await login(page, 'admin');
    await gotoClients(page);

    const clientName = unique('QA Client');
    await page.getByTestId('new-client-btn').click();
    await page.getByTestId('client-name-input').fill(clientName);
    await page.getByTestId('client-save-btn').click();
    await expect(
      page.getByTestId('client-row').filter({ hasText: clientName }),
    ).toBeVisible();

    // open the client and add a property
    await page.getByTestId('client-row').filter({ hasText: clientName }).click();
    const propLabel = unique('QA Property');
    await page.getByTestId('add-property-btn').click();
    await page.getByTestId('property-label-input').fill(propLabel);
    await page.getByTestId('property-save-btn').click();
    await expect(page.getByText(propLabel)).toBeVisible();
  });

  test('a job with no client/property still works (existing jobs unaffected)', async ({
    page,
  }) => {
    await login(page, 'admin');
    await page.getByTestId('nav-board').click();
    await page.getByTestId('new-job-btn').click();

    const jobName = unique('QA Job no-client');
    await page.getByTestId('job-name-input').fill(jobName);
    // intentionally leave the client/property pickers as "— none —"
    await page.getByTestId('create-job-btn').click();
    await expect(page.getByText(jobName)).toBeVisible();
  });
});
