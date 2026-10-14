import { test, expect, devices } from '@playwright/test';

test.use({ ...devices['Pixel 7'] });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('orbital-help-seen-v3', '1');
  });
});

test.describe('Mobile object list', () => {
  test('search list viewport can scroll without requiring a selection', async ({ page }) => {
    await page.goto('/');
    await page.locator('#toggle-left-panel').click();
    const viewport = page.locator('#object-list-viewport');
    await expect(viewport).toBeVisible({ timeout: 15_000 });

    const before = await viewport.evaluate((el) => el.scrollTop);
    await viewport.evaluate((el) => {
      el.scrollTop = 240;
    });
    const after = await viewport.evaluate((el) => el.scrollTop);
    expect(after).toBeGreaterThan(before);

    // Scrolling alone must not select an object (right panel stays empty of selection).
    await expect(page.locator('.object-list-item--selected')).toHaveCount(0);
  });

  test('a short tap selects an object from the list', async ({ page }) => {
    await page.goto('/');
    await page.locator('#toggle-left-panel').click();
    const item = page.locator('.object-list-item').first();
    await expect(item).toBeVisible({ timeout: 15_000 });
    await item.click();
    await expect(page.locator('.object-list-item--selected')).toHaveCount(1, { timeout: 5_000 });
  });
});

test.describe('Radio panel on a phone', () => {
  test('fits the screen and picking a satellite opens its details', async ({ page }) => {
    await page.goto('/');
    await page.locator('#radio-panel-btn').click();
    await expect(page.locator('.radio-row').first()).toBeVisible({ timeout: 15_000 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    await page.locator('.radio-row-main').first().click();
    await expect(page.locator('#radio-panel')).toHaveCount(0);
    await expect(page.locator('#right-panel')).toHaveClass(/panel--open/, { timeout: 10_000 });
  });
});
