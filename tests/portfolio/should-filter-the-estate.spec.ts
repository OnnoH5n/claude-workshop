// spec: specs/estate-dashboard.plan.md
// seed: tests/seed.spec.ts
import { expect, test } from '../fixtures.ts';

test.describe('Portfolio overview', () => {
  test('should filter the estate down to end-of-life repositories', async ({ page }) => {
    const allRows = await page.getByTestId('leaderboard-body').locator('tr').count();

    // 1. Narrow to repositories on an end-of-life Spring Boot release
    await page.getByTestId('filter-support').selectOption('eol');

    // 2. The count, the table and the charts all re-render against the same slice
    const rows = page.getByTestId('leaderboard-body').locator('tr');
    const shown = await rows.count();
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(allRows);
    await expect(page.getByTestId('shown-count')).toHaveText(`${shown} of ${allRows} repositories`);

    // 3. Every surviving row is labelled end-of-life, by text and not by colour alone.
    //    Scoped to the Spring Boot cell — the quality-gate chip shares the critical role.
    const chips = await rows.locator('td:nth-child(5) .chip').allInnerTexts();
    expect(chips).toHaveLength(shown);
    for (const chip of chips) expect(chip).toContain('End of life');

    // 4. A filter with no matches states so rather than rendering an empty table
    await page.getByTestId('filter-gate').selectOption('passed');
    await page.getByTestId('filter-tier').selectOption('tier-3');
    await page.getByTestId('filter-query').fill('zzz-no-such-repo');
    await expect(page.getByTestId('empty')).toBeVisible();
  });
});
