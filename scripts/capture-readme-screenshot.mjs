/**
 * Captures docs/screenshot-en.png (README, ISS selected so the radio-frequency
 * table is visible), docs/screenshot-radio.png (the Radio panel on 70 cm) and
 * public/og-image.png (social link preview) via
 * Playwright against vite preview.
 * Forces English UI (localStorage + lang select). Requires a prior `npm run build`.
 *
 * No Playwright browsers installed? Use a system one:
 *   PW_CHANNEL=msedge npm run screenshot   (or chrome)
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync, spawn } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'docs/screenshot-en.png');
const radioOut = join(root, 'docs/screenshot-radio.png');
const ogOut = join(root, 'public/og-image.png');
mkdirSync(dirname(out), { recursive: true });

const preview = spawn(
  'npx vite preview --host 127.0.0.1 --port 4179 --strictPort',
  { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], shell: true },
);

// With `shell: true`, preview.kill() only ends the shell wrapper on Windows and
// leaves the vite server holding the port, so stop the whole process tree.
function stopPreview() {
  if (process.platform === 'win32') {
    try {
      execSync(`taskkill /pid ${preview.pid} /T /F`, { stdio: 'ignore' });
    } catch {
      // already gone
    }
  } else {
    preview.kill('SIGTERM');
  }
}

let ready = false;
const onData = (buf) => {
  const text = String(buf);
  process.stdout.write(text);
  if (/Local:|http:\/\/127\.0\.0\.1:4179/.test(text)) ready = true;
};
preview.stdout.on('data', onData);
preview.stderr.on('data', onData);

for (let i = 0; i < 90 && !ready; i++) {
  await new Promise((r) => setTimeout(r, 500));
  try {
    const res = await fetch('http://127.0.0.1:4179/');
    if (res.ok) { ready = true; break; }
  } catch {
    // keep waiting
  }
}

if (!ready) {
  stopPreview();
  throw new Error('Preview server did not start on :4179');
}

try {
  const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const seed = () => {
    localStorage.setItem('orbital-lang', 'en');
    localStorage.setItem('orbital-help-seen-v3', '1');
  };
  const open = async (viewport, path) => {
    const page = await browser.newPage({ viewport });
    await page.addInitScript(seed);
    await page.goto(`http://127.0.0.1:4179/${path}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.locator('canvas').waitFor({ state: 'visible', timeout: 45_000 });
    const select = page.locator('#lang-select');
    if (await select.count()) await select.selectOption('en');
    // Wait for the worker-backed catalog to populate the list meta line.
    await page.locator('#object-list-meta').filter({ hasText: /objects/i }).waitFor({ timeout: 45_000 });
    await page.locator('#kessler-panel-btn').waitFor({ state: 'visible', timeout: 10_000 });
    await page.locator('#help-guide-btn').waitFor({ state: 'visible', timeout: 10_000 });
    return page;
  };

  // README: ISS selected, right panel scrolled to its radio-frequency table.
  const page = await open({ width: 1440, height: 900 }, '?object=25544');
  await page.locator('.radio-frequency-section').waitFor({ state: 'visible', timeout: 15_000 });
  await page.evaluate(() => {
    const panel = document.querySelector('.panel-right');
    const section = document.querySelector('.radio-frequency-section');
    if (panel && section) {
      panel.scrollTop +=
        section.getBoundingClientRect().top - panel.getBoundingClientRect().top - 12;
    }
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: out, type: 'png' });

  // README: the Radio panel, narrowed to the 70 cm band.
  const radio = await open({ width: 1440, height: 900 }, '');
  await radio.locator('#radio-panel-btn').click();
  await radio.locator('.radio-row').first().waitFor({ state: 'visible', timeout: 15_000 });
  await radio.locator('[data-band="ham70cm"]').click();
  await radio.waitForTimeout(800);
  await radio.screenshot({ path: radioOut, type: 'png' });

  // Social preview (Open Graph): the plain globe view at 1200x630.
  const og = await open({ width: 1200, height: 630 }, '');
  // Panels would crowd a 1200x630 card, so let the globe fill the frame.
  await og.addStyleTag({
    content:
      '.panel-left,.panel-right,.app-header,.time-bar{display:none!important}' +
      '.app-grid{grid-template:"scene" 1fr / 1fr!important}',
  });
  await og.setViewportSize({ width: 1200, height: 631 });
  await og.setViewportSize({ width: 1200, height: 630 });
  await og.waitForTimeout(1500);
  await og.screenshot({ path: ogOut, type: 'png' });
  await browser.close();
  console.log('Wrote', out, radioOut, 'and', ogOut);
} finally {
  stopPreview();
}
