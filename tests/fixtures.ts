import { test as baseTest } from '@playwright/test';

export { expect } from '@playwright/test';

/**
 * Navigates to the app and resets portfolio state first, so every scenario starts
 * from the committed seed rather than inheriting a previous test's mutations.
 */
export const test = baseTest.extend({
  page: async ({ page }, use) => {
    await page.request.post('/api/reset');
    await page.goto('/');
    await page.getByTestId('kpis').waitFor();
    await use(page);
  },
});
