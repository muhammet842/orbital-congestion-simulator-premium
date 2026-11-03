/**
 * Browser measurement: frame time, main-thread load and close-approach scan
 * time for N objects, with the Web Workers on and off (?worker=off), at normal
 * speed and with Chrome's CPU slowdown. Method: research/perf/README.md.
 *
 * Usage (after `npm run pull-data && npm run build`):
 *   npm run research:perf-browser [-- --repeats 10] [--sizes 1000,5000,10000,28000]
 *     [--throttle 1,4] [--scan-repeats 3] [--scan-cap-min 15] [--phase frames|scan|all] [--headless]
 *
 * It starts `vite preview` itself and opens a visible (headed) Edge window.
 * Leave the computer alone while it runs: a covered or minimised window, or
 * other programs, change the results.
 */
import { execFileSync, spawn } from 'node:child_process';
import { cpus, platform, release, totalmem } from 'node:os';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { summarize } from '../tle-age/lib.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(HERE, '..', '..');
// Not 4190: browsers and fetch refuse a few "bad ports", and 4190 is one of them.
const PORT = 4188;
// 127.0.0.1, not localhost: Node may resolve localhost to IPv6 while the server listens on IPv4.
const BASE = `http://127.0.0.1:${PORT}/`;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const list = (s) => s.split(',').map(Number);

const REPEATS = Number(arg('repeats', '10'));
const SIZES = list(arg('sizes', '1000,5000,10000,28000'));
const THROTTLES = list(arg('throttle', '1,4'));
const SCAN_REPEATS = Number(arg('scan-repeats', '3'));
const SCAN_CAP_MS = Number(arg('scan-cap-min', '15')) * 60_000;
const HEADED = !process.argv.includes('--headless');
/** "frames" (frame time, ~2 h), "scan" (scan time, can take hours with workers off) or "all". */
const PHASE = arg('phase', 'all');
/** Measuring starts this long after the catalogue is ready (loading settles first)... */
const WARMUP_MS = 10_000;
/** ...and lasts this long. */
const WINDOW_MS = 15_000;
const LONG_FRAME_MS = 50;

const BROWSER_ARGS = [
  '--use-angle=d3d11',
  '--enable-gpu',
  // Keep drawing at full speed even if the window loses focus or is covered.
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-background-timer-throttling',
];

/** Runs before the app's own code: records long main-thread tasks (over 50 ms). */
function installObservers() {
  window.__longTasks = [];
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__longTasks.push({ start: e.startTime, duration: e.duration });
    }).observe({ type: 'longtask', buffered: true });
  } catch {
    // Not supported: long tasks are then reported as empty.
  }
  localStorage.setItem('orbital-help-seen-v3', '1');
  localStorage.setItem('orbital-lang', 'en');
}

/** Frame intervals (ms) from requestAnimationFrame for `ms` milliseconds. */
function collectFrames(ms) {
  return new Promise((resolve) => {
    const deltas = [];
    let last = performance.now();
    const end = last + ms;
    const step = (now) => {
      deltas.push(now - last);
      last = now;
      if (now < end) requestAnimationFrame(step);
      else resolve(deltas);
    };
    requestAnimationFrame(step);
  });
}

async function mainThreadSeconds(cdp) {
  const { metrics } = await cdp.send('Performance.getMetrics');
  return metrics.find((m) => m.name === 'TaskDuration')?.value ?? Number.NaN;
}

async function openApp(browser, { size, worker, throttle }) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(installObservers);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  const query = new URLSearchParams({ limit: String(size), ...(worker ? {} : { worker: 'off' }) });
  await page.goto(`${BASE}?${query}`);
  await page.waitForFunction(() => performance.getEntriesByName('catalog-ready').length > 0, null, { timeout: 300_000 });
  return { context, page, cdp, errors };
}

/** One frame-time run: wait WARMUP_MS after the catalogue is ready, then measure WINDOW_MS. */
async function frameRun(browser, config) {
  const { context, page, cdp, errors } = await openApp(browser, config);
  try {
    const readyMs = await page.evaluate(() => performance.getEntriesByName('catalog-ready')[0].startTime);
    // The count the app shows ("1,000 objects · A–Z"), as a plain number: a check that ?limit worked.
    const objects = await page.evaluate(() =>
      (document.querySelector('#object-list-meta')?.textContent ?? '').split(' ')[0].replace(/\D/g, ''),
    );
    await page.waitForTimeout(WARMUP_MS);
    const busyBefore = await mainThreadSeconds(cdp);
    const windowStart = await page.evaluate(() => performance.now());
    const frames = await page.evaluate(collectFrames, WINDOW_MS);
    const windowEnd = await page.evaluate(() => performance.now());
    const busyAfter = await mainThreadSeconds(cdp);
    const longTasks = await page.evaluate(
      ([a, b]) => window.__longTasks.filter((t) => t.start >= a && t.start <= b),
      [windowStart, windowEnd],
    );
    const f = summarize(frames);
    return {
      ...config,
      objects,
      ready_ms: readyMs.toFixed(0),
      frames: frames.length,
      fps: ((1000 * frames.length) / (windowEnd - windowStart)).toFixed(2),
      frame_median_ms: f.median.toFixed(3),
      frame_p95_ms: f.p95.toFixed(3),
      frames_over_50ms: frames.filter((d) => d > LONG_FRAME_MS).length,
      main_thread_busy_pct: ((100 * (busyAfter - busyBefore) * 1000) / (windowEnd - windowStart)).toFixed(2),
      long_tasks: longTasks.length,
      long_task_ms: longTasks.reduce((s, t) => s + t.duration, 0).toFixed(1),
      errors: errors.length,
    };
  } finally {
    await context.close();
  }
}

/** One scan-time run: from the scan's start mark to its done mark, up to SCAN_CAP_MS. */
async function scanRun(browser, config) {
  const { context, page, errors } = await openApp(browser, config);
  try {
    const done = await page
      .waitForFunction(() => performance.getEntriesByName('conjunction-scan-done').length > 0, null, {
        timeout: SCAN_CAP_MS,
        polling: 1000,
      })
      .then(() => true)
      .catch(() => false);
    const [start, end] = await page.evaluate(() => [
      performance.getEntriesByName('conjunction-scan-start')[0]?.startTime ?? Number.NaN,
      performance.getEntriesByName('conjunction-scan-done')[0]?.startTime ?? Number.NaN,
    ]);
    return {
      ...config,
      finished: done,
      scan_s: done ? ((end - start) / 1000).toFixed(1) : '',
      cap_s: (SCAN_CAP_MS / 1000).toFixed(0),
      errors: errors.length,
    };
  } finally {
    await context.close();
  }
}

/** Display refresh rate (Hz) from frame intervals on an empty page in the same window size. */
async function refreshRate(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.setContent('<!doctype html><title>refresh</title><body style="background:#000"></body>');
  const frames = await page.evaluate(collectFrames, 3000);
  const screen = await page.evaluate(() => ({ width: screen.width, height: screen.height, devicePixelRatio: Math.round(devicePixelRatio * 100) / 100 }));
  await context.close();
  const median = summarize(frames.slice(5)).median;
  return { refreshHz: Number((1000 / median).toFixed(1)), frameIntervalMedianMs: Number(median.toFixed(3)), screen };
}

async function gpuName(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const name = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : (gl?.getParameter(gl.RENDERER) ?? 'unknown');
  });
  await context.close();
  return name;
}

function onMainsPower() {
  if (platform() !== 'win32') return null;
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-Command', '(Get-CimInstance Win32_Battery).BatteryStatus'], {
      encoding: 'utf8',
    }).trim();
    return out === '' ? 'no battery' : out === '2' ? 'plugged in' : `on battery (status ${out})`;
  } catch {
    return null;
  }
}

/** The runs in an order that alternates worker on/off and the slowdown, reversed every other repeat. */
export function runOrder(repeats, sizes, throttles) {
  const combos = throttles.flatMap((throttle) => sizes.flatMap((size) => [true, false].map((worker) => ({ size, worker, throttle }))));
  return Array.from({ length: repeats }, (_, r) => (r % 2 === 0 ? combos : [...combos].reverse()).map((c) => ({ ...c, repeat: r + 1 }))).flat();
}

function toCsv(rows) {
  const header = Object.keys(rows[0]);
  return `${[header.join(','), ...rows.map((r) => header.map((h) => r[h]).join(','))].join('\n')}\n`;
}

function summaryCsv(rows) {
  const metrics = ['fps', 'frame_median_ms', 'frame_p95_ms', 'frames_over_50ms', 'main_thread_busy_pct', 'long_tasks', 'long_task_ms', 'ready_ms'];
  const out = [];
  for (const throttle of THROTTLES) {
    for (const size of SIZES) {
      for (const worker of [true, false]) {
        const group = rows.filter((r) => r.size === size && r.worker === worker && r.throttle === throttle);
        if (group.length === 0) continue;
        const row = { throttle, size, worker: worker ? 'on' : 'off', runs: group.length };
        for (const m of metrics) {
          const s = summarize(group.map((r) => Number(r[m])));
          row[`${m}_median`] = s.median.toFixed(3);
          row[`${m}_std`] = s.std.toFixed(3);
        }
        out.push(row);
      }
    }
  }
  return toCsv(out);
}

async function startPreview() {
  const vite = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  const child = spawn(process.execPath, [vite, 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (d) => (output += d));
  child.stderr.on('data', (d) => (output += d));
  let lastError = '';
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(BASE);
      if (res.ok) return child;
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = String(err.cause?.code ?? err.cause?.message ?? err.cause ?? err.message);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  stopPreview(child);
  throw new Error(`vite preview did not start on port ${PORT} (${lastError}). Its output:\n${output}`);
}

function stopPreview(child) {
  if (platform() === 'win32') execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill();
}

async function main() {
  const outDir = join(HERE, 'results');
  await mkdir(outDir, { recursive: true });
  const preview = await startPreview();
  const browser = await chromium.launch({ channel: 'msedge', headless: !HEADED, args: BROWSER_ARGS });
  try {
    const env = {
      when: new Date().toISOString(),
      browser: `Microsoft Edge ${browser.version()}`,
      headed: HEADED,
      ...(await refreshRate(browser)),
      gpu: await gpuName(browser),
      cpu: cpus()[0]?.model,
      cores: cpus().length,
      memoryGb: Math.round(totalmem() / 1e9),
      os: `${platform()} ${release()}`,
      power: onMainsPower(),
      viewport: '1440x900',
      warmupMs: WARMUP_MS,
      windowMs: WINDOW_MS,
      cpuThrottleNote: 'Emulation.setCPUThrottlingRate slows the page main thread; Web Workers may not be slowed.',
    };
    await writeFile(join(outDir, 'browser-env.json'), `${JSON.stringify(env, null, 2)}\n`);
    console.log(`Display ${env.refreshHz} Hz, ${env.gpu}, ${env.browser}, headed: ${HEADED}, power: ${env.power}`);

    if (PHASE !== 'scan') await measureFrames(outDir);
    if (PHASE !== 'frames') await measureScans(outDir);
  } finally {
    await browser.close();
    stopPreview(preview);
  }

  async function measureFrames(outDir) {
    const order = runOrder(REPEATS, SIZES, THROTTLES);
    const rows = [];
    for (const [i, config] of order.entries()) {
      const row = await frameRun(browser, config);
      rows.push(row);
      console.log(`[${i + 1}/${order.length}] ${config.size} objects, worker ${config.worker ? 'on' : 'off'}, CPU x${config.throttle}: ${row.fps} fps, busy ${row.main_thread_busy_pct}%`);
      await writeFile(join(outDir, 'browser-runs.csv'), toCsv(rows)); // saved as it goes
    }
    await writeFile(join(outDir, 'browser-summary.csv'), summaryCsv(rows));
  }

  async function measureScans(outDir) {
    const scans = [];
    for (const config of runOrder(SCAN_REPEATS, SIZES, [1])) {
      const row = await scanRun(browser, config);
      scans.push(row);
      console.log(`scan ${config.size} objects, worker ${config.worker ? 'on' : 'off'}: ${row.finished ? `${row.scan_s} s` : `not finished in ${row.cap_s} s`}`);
      await writeFile(join(outDir, 'browser-scan.csv'), toCsv(scans));
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(`browser-bench: FAILED — ${err.message}`);
    process.exit(1);
  });
}
