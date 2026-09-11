// spec: specs/estate-dashboard.plan.md
// seed: tests/seed.spec.ts
import { expect, test } from '../fixtures.ts';

test.describe('Portfolio overview', () => {
  test('should render portfolio totals from the API', async ({ page }) => {
    // 1. Read the totals straight from the API to assert against the real payload
    const totals = await page.request.get('/api/portfolio').then((r) => r.json());

    // 2. The KPI row reflects those same numbers
    const kpis = page.getByTestId('kpis');
    await expect(kpis).toContainText(String(totals.totals.repos));
    await expect(kpis).toContainText(`${totals.totals.gatePassRate}%`);
    await expect(kpis).toContainText(`${totals.totals.medianCoverage}%`);
    await expect(kpis).toContainText(String(totals.totals.eolRepos));

    // 3. Every repository is listed, and the queue is ranked worst-first
    const rows = page.getByTestId('leaderboard-body').locator('tr');
    await expect(rows).toHaveCount(totals.totals.repos);

    const scores = await page.getByTestId('leaderboard-body')
      .locator('tr .meter__value').allInnerTexts();
    const numeric = scores.map(Number);
    expect(numeric).toEqual([...numeric].sort((a, b) => b - a));
  });
});
