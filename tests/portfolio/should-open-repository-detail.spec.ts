// spec: specs/estate-dashboard.plan.md
// seed: tests/seed.spec.ts
import { expect, test } from '../fixtures.ts';

test.describe('Repository detail', () => {
  test('should open repository detail with scored risk drivers', async ({ page }) => {
    // 1. Click the worst repository in the queue
    const firstRow = page.getByTestId('leaderboard-body').locator('tr').first();
    const name = (await firstRow.locator('.repo-name').innerText()).trim();
    await firstRow.click();

    // 2. Detail resolves from GET /api/repos/:name and names that repository
    const detail = page.getByTestId('detail');
    await expect(detail).toBeVisible();
    await expect(detail.getByRole('heading', { name })).toBeVisible();

    // 3. All four QA sources are represented
    for (const tool of ['SonarQube', 'Checkmarx', 'Sonatype Lifecycle', 'Repository analysis']) {
      await expect(detail).toContainText(tool);
    }

    // 4. The score is explained rather than asserted
    await expect(page.getByTestId('drivers').locator('li').first()).not.toBeEmpty();

    // 5. Charts have a table-view twin, so no value is colour- or hover-only
    await page.getByTestId('toggle-tables').click();
    await expect(page.getByRole('columnheader', { name: 'Coverage band' })).toBeVisible();
  });
});
