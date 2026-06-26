import { test, expect } from '@playwright/test';
import { login, hasCreds, type Role } from './helpers';

// Login works for each role and lands on the board with the right role badge.
for (const role of ['admin', 'staff', 'viewer'] as Role[]) {
  test(`${role} can log in`, async ({ page }) => {
    test.skip(!hasCreds(role), `no ${role} credentials set`);
    await login(page, role);
    await expect(page.getByTestId('user-role')).toContainText(role);
  });
}
