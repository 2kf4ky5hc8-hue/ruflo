import { test, expect } from '@playwright/test';
import { login, unique, hasCreds } from './helpers';

test.describe('contributions are a simple who-did-what log', () => {
  test.skip(!hasCreds('admin'), 'no admin credentials set');

  test('no points/weight field, and a contribution can be added without a team member', async ({
    page,
  }) => {
    await login(page, 'admin');
    await page.getByTestId('nav-board').click();

    // make a job to attach the contribution to
    await page.getByTestId('new-job-btn').click();
    const jobName = unique('QA Contrib Job');
    await page.getByTestId('job-name-input').fill(jobName);
    await page.getByTestId('create-job-btn').click();
    await expect(page.getByText(jobName)).toBeVisible();

    // open the job and the contribution form
    await page.getByText(jobName).click();
    await page.getByTestId('log-contribution-btn').click();
    const form = page.getByTestId('contrib-form');
    await expect(form).toBeVisible();

    // "points" / "weight" must not appear anywhere in the contribution form
    const formText = (await form.innerText()).toLowerCase();
    expect(formText).not.toContain('point');
    expect(formText).not.toContain('weight');

    // add a contribution WITHOUT first adding anyone as a team member
    // (person defaults to the current user)
    await page.getByTestId('contrib-add-btn').click();
    await expect(form).toHaveCount(0);
  });
});
