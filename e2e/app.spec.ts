import { test, expect } from '@playwright/test';

/**
 * E2E smoke tests for Orbital Congestion Simulator.
 *
 * These tests run against the production-built preview server (port 4173).
 * They verify basic app functionality without relying on implementation details.
 */

// Suppress the first-visit walkthrough so it does not cover the UI under test.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('orbital-help-seen-v3', '1');
  });
});

test.describe('App bootstrap', () => {
  test('page loads and renders a <canvas> element', async ({ page }) => {
    await page.goto('/');
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible({ timeout: 15_000 });
  });

  test('page title contains "Orbital"', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/orbital/i, { timeout: 10_000 });
  });

  test('"Historical Events" heading is visible in the left panel', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Historical Events')).toBeVisible({ timeout: 10_000 });
  });

  test('renders at least 7 event cards', async ({ page }) => {
    await page.goto('/');
    const cards = page.locator('.event-card');
    await expect(cards).toHaveCount(7, { timeout: 10_000 });
  });
});

test.describe('Event cards', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for the event accordion to be populated
    await page.locator('.event-card').first().waitFor({ timeout: 10_000 });
  });

  test('clicking a card marks it active', async ({ page }) => {
    const firstCard = page.locator('.event-card').first();
    await firstCard.click();
    await expect(firstCard).toHaveClass(/event-card--active/);
  });

  test('clicking a second card deactivates the first', async ({ page }) => {
    const cards = page.locator('.event-card');
    await cards.nth(0).click();
    await cards.nth(1).click();
    await expect(cards.nth(0)).not.toHaveClass(/event-card--active/);
    await expect(cards.nth(1)).toHaveClass(/event-card--active/);
  });

  test('each card has an event-type badge', async ({ page }) => {
    const badges = page.locator('.event-type-badge');
    const count = await badges.count();
    expect(count).toBeGreaterThanOrEqual(7);
  });
});

test.describe('Language switcher', () => {
  test('the language choice is in the header More menu', async ({ page }) => {
    await page.goto('/');
    await page.locator('#header-more-btn').click();
    await expect(page.locator('#lang-select')).toBeVisible({ timeout: 10_000 });
  });

  test('switching to Turkish translates orbit-layers heading', async ({ page }) => {
    await page.goto('/');
    await page.locator('#header-more-btn').click();
    await page.locator('#lang-select').selectOption('tr');
    // "ui.orbit_layers" in Turkish is "Yörünge Katmanları"
    await expect(page.getByText('Yörünge Katmanları')).toBeVisible({ timeout: 5_000 });
  });

  test('switching back to English restores English text', async ({ page }) => {
    await page.goto('/');
    await page.locator('#header-more-btn').click();
    await page.locator('#lang-select').selectOption('tr');
    await page.locator('#header-more-btn').click();
    await page.locator('#lang-select').selectOption('en');
    await expect(page.getByText('Orbit Layers')).toBeVisible({ timeout: 5_000 });
  });
});

test.describe('How-to guide', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.locator('#help-guide-btn').waitFor({ state: 'attached', timeout: 10_000 });
    // The tour is in the header's More menu.
    await page.locator('#header-more-btn').click();
  });

  test('opens the UI tour spotlight from the help button', async ({ page }) => {
    await page.locator('#help-guide-btn').click();
    await expect(page.locator('.tour-progress')).toHaveText('1 / 10');
    await expect(page.locator('#tour-highlight')).toBeVisible();
    await expect(page.locator('#tour-skip')).toBeVisible();
    await expect(page.locator('#thesis-collision')).toHaveCount(0);
  });

  test('Skip dismisses the tour', async ({ page }) => {
    await page.locator('#help-guide-btn').click();
    await expect(page.locator('#tour-skip')).toBeVisible();
    await page.locator('#tour-skip').click();
    await expect(page.locator('#help-tour-root')).toHaveCount(0);
  });
});

test.describe('Future Projection panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.locator('#kessler-panel-btn').waitFor({ timeout: 10_000 });
  });

  test('opens from the header button and shows the scenario sliders', async ({ page }) => {
    await page.locator('#kessler-panel-btn').click();
    await expect(page.locator('#kessler-panel')).toBeVisible();
    await expect(page.locator('#kp-launch')).toBeVisible();
    await expect(page.locator('#kp-mitigation')).toBeVisible();
    await expect(page.locator('#kp-risk')).toBeVisible();
    await expect(page.locator('#kp-target-year')).toBeVisible();
  });

  test('opening the panel reveals results and a narrative without a run button', async ({ page }) => {
    await page.locator('#kessler-panel-btn').click();
    await expect(page.locator('#kp-run')).toHaveCount(0);
    await expect(page.locator('#kp-results-section')).toBeVisible();
    const narrative = page.locator('#kp-narrative');
    await expect(narrative).toBeVisible();
    await expect(narrative).not.toHaveText('');
  });

  test('closes on Escape', async ({ page }) => {
    await page.locator('#kessler-panel-btn').click();
    await expect(page.locator('#kessler-panel')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#kessler-panel')).toHaveCount(0);
  });
});

test.describe('Left panel filters', () => {
  test('four orbit-layer chips are present and active by default', async ({ page }) => {
    await page.goto('/');
    const chips = page.locator('button[data-layer]');
    await expect(chips).toHaveCount(4, { timeout: 10_000 });
    for (let i = 0; i < 4; i++) {
      await expect(chips.nth(i)).toHaveAttribute('aria-pressed', 'true');
    }
  });

  test('search input is present and accepts text', async ({ page }) => {
    await page.goto('/');
    const input = page.locator('#object-search');
    await expect(input).toBeVisible({ timeout: 10_000 });
    await input.fill('ISS');
    await expect(input).toHaveValue('ISS');
  });
});

test.describe('Collapsible side panels', () => {
  test('collapsing the left panel gives the space to the globe, and the choice is remembered', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#left-panel')).toBeVisible();
    const before = (await page.locator('#scene-container').boundingBox())!.width;

    await page.locator('#toggle-left-panel').click();
    await expect(page.locator('#left-panel')).toBeHidden();
    await expect.poll(async () => (await page.locator('canvas').boundingBox())!.width).toBeGreaterThan(before + 150);

    await page.reload();
    await expect(page.locator('canvas')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#left-panel')).toBeHidden();

    await page.locator('#toggle-left-panel').click();
    await expect(page.locator('#left-panel')).toBeVisible();
  });

  test('selecting a satellite re-opens a collapsed details panel', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas')).toBeVisible({ timeout: 15_000 });
    await page.locator('#toggle-right-panel').click();
    await expect(page.locator('#right-panel')).toBeHidden();

    await page.locator('#radio-panel-btn').click();
    await page.locator('.radio-row-main').first().click();
    await expect(page.locator('#right-panel')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.object-name').first()).toBeVisible();
  });
});

test.describe('Radio panel', () => {
  test('opens from the header with the easy VHF/UHF filter and a list of satellites', async ({ page }) => {
    await page.goto('/');
    await page.locator('#radio-panel-btn').click();
    const dialog = page.getByRole('dialog', { name: 'Satellite radio' });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.radio-row').first()).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByRole('button', { name: /Easy/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(dialog.locator('#radio-summary')).toContainText(/\d+ satellites/);
  });

  test('narrows the list with a band and a mode chip, and closes with Escape', async ({ page }) => {
    await page.goto('/');
    await page.locator('#radio-panel-btn').click();
    const summary = page.locator('#radio-summary');
    await expect(summary).toContainText(/satellites/, { timeout: 15_000 });
    const easy = Number((await summary.innerText()).match(/(\d+) satellites/)![1]);

    await page.locator('[data-band="ham70cm"]').click();
    const ham = Number((await summary.innerText()).match(/(\d+) satellites/)![1]);
    expect(ham).toBeGreaterThan(0);
    expect(ham).toBeLessThan(easy);

    await page.locator('[data-mode="cw"]').click();
    const cw = Number((await summary.innerText()).match(/(\d+) satellites/)![1]);
    expect(cw).toBeLessThanOrEqual(ham);

    await page.keyboard.press('Escape');
    await expect(page.locator('#radio-panel')).toHaveCount(0);
  });

  test('a shared link opens the panel with its filters', async ({ page }) => {
    await page.goto('/?radio=ham70cm&mode=fm&amateur=1');
    const dialog = page.getByRole('dialog', { name: 'Satellite radio' });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByRole('button', { name: '70 cm' })).toHaveAttribute('aria-pressed', 'true');
    await expect(dialog.getByRole('button', { name: 'FM', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#radio-amateur')).toBeChecked();
  });

  test('picking a satellite closes the panel and selects it', async ({ page }) => {
    await page.goto('/');
    await page.locator('#radio-panel-btn').click();
    await page.locator('.radio-row-main').first().click();
    await expect(page.locator('#radio-panel')).toHaveCount(0);
    await expect(page).toHaveURL(/object=\d+/, { timeout: 10_000 });
  });
});

test.describe('Deep links', () => {
  test('?event=iridium-cosmos selects the featured historical event card', async ({ page }) => {
    await page.goto('/?event=iridium-cosmos');
    const card = page.locator('.event-card[data-event-id="iridium-cosmos"]');
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card).toHaveClass(/event-card--active/);
    await expect(page.getByText('Historical Event')).toBeVisible({ timeout: 10_000 });
  });

  test('?object=25544 selects ISS in the right panel', async ({ page }) => {
    await page.goto('/?object=25544');
    await expect(page.locator('canvas')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/ISS/i).first()).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/object=25544/);
  });
});
