# Performance: object count and Web Workers

**Questions:**
1. How long does computing one moment's positions take, depending on the number of objects?
2. In the browser, how do frame time, main-thread load and the 24-hour close-approach scan time change with the Web Workers on and off?

Object counts: **1,000 / 5,000 / 10,000 / 28,000**.

## Measurement flags in the app

None is set in normal use; without them the app behaves exactly as before (see [`src/perfFlags.ts`](../../src/perfFlags.ts) and its tests).

| Address | What it does |
|---|---|
| `?worker=off` | No Web Worker is started. Positions and the close-approach scan run on the main thread, through the fallback the app already has for browsers without workers. No new calculation path was added. |
| `?limit=5000` | 5,000 objects of the catalog are used, picked evenly after sorting by NORAD number (`pickEvenly`). The same objects are picked every time, and the share of each orbit type stays the same. |
| (always) | `performance.mark` points: `catalog-ready` (catalog ready to draw), `conjunction-scan-start` and `conjunction-scan-done` (24-hour scan started / finished). They show nothing to the user; the measurement script reads them. |

## 1. Calculation time (Node)

```bash
npm run research:perf-node
```

- It uses the app's own `propagateObject` function ([`src/orbital/propagator.ts`](../../src/orbital/propagator.ts)): the work the position worker (or, with `?worker=off`, the main thread) does on every catalog update. There is no drawing.
- The objects come from the archive's 2026-11-02 file and are picked with the same `pickEvenly` function as `?limit` (28,000 of 28,297 for the largest size).
- For each object count there are first 5 warm-up passes (not counted: the JavaScript engine optimises the code during them), then **30 measurements**. Each measurement computes a different minute, so no result can be reused.
- Node cannot resolve the app's extensionless `.ts` imports by itself, so a small helper is used ([`ts-hooks.mjs`](ts-hooks.mjs)): when an import is not found, it tries the `.ts` extension. It does not touch the app's code.

**Result** (AMD Ryzen 5 7520U, Node 24.17.0; [`results/sgp4-node-summary.csv`](results/sgp4-node-summary.csv)):

| Objects | Median | Standard deviation | Per object |
|---|---|---|---|
| 1,000 | 2.15 ms | 0.41 ms | 2.15 µs |
| 5,000 | 10.59 ms | 0.48 ms | 2.12 µs |
| 10,000 | 21.24 ms | 0.95 ms | 2.12 µs |
| 28,000 | 59.42 ms | 0.53 ms | 2.12 µs |

For comparison: one frame on a 60 Hz display has 16.7 ms.

## 2. Browser measurement (Playwright, Microsoft Edge)

```bash
npm run pull-data            # current catalog (changes public/data/tle.json)
npm run build
git checkout -- public/data/tle.json   # undo that change so it is not committed
npm run research:perf-browser -- --phase frames   # frame measurements, ~1.5 hours
npm run research:perf-browser -- --phase scan     # scan times, can take hours
```

The script starts and stops the `vite preview` server itself and opens a **visible (headed) Edge window**.

### What is measured

**Frame measurement** (each object count × workers on/off × normal CPU / 4× slower, **10 repeats**; each repeat is a fresh page):
- The page opens; after the `catalog-ready` mark it waits **10 seconds** (so loading settles), then measures for **15 seconds**.
- `fps`, `frame_median_ms`, `frame_p95_ms`: time between frames measured with `requestAnimationFrame`.
- `frames_over_50ms`: frames that took longer than 50 ms (seen as stutter).
- `main_thread_busy_pct`: the share of the measurement window the main thread was busy, from Chrome's own counter (`Performance.getMetrics`, `TaskDuration`). The workers' benefit shows most clearly here: work done in a worker is not counted.
- `long_tasks`, `long_task_ms`: main-thread tasks longer than 50 ms (Long Tasks API).
- `ready_ms`: time from opening the page until the catalog is ready.

**Scan measurement** (each object count × workers on/off, 3 repeats by default, `--scan-repeats`): the time between `conjunction-scan-start` and `conjunction-scan-done`. If it has not finished after 15 minutes (the default, `--scan-cap-min`), it is recorded as not finished, which is a result, not an error. A case that always hits the cap can be given fewer repeats, e.g. `--scan-repeats 10 --scan-repeats-for 28000:off=1`. A run that breaks (for example the page never gets ready) is kept in the file with the reason in the `failure` column. `browser-scan-summary.csv` gives, per case, the number of runs, finished, not finished and failed runs, and the median and standard deviation of the finished scan times.

### Keeping it fair

- **Alternating order:** the runs alternate between workers on/off and the CPU speeds, and the order is reversed on every repeat. If the computer slows down as it warms up, the effect is spread evenly over both sides.
- **Visible window:** the browser slows down drawing when its window is in the background; Chrome options that prevent this are set (`--disable-backgrounding-occluded-windows` and others). **Still, do not use the computer or open other programs during the measurement.**
- **Environment record** (`results/browser-env.json`): browser version, whether it was headed, **display refresh rate** (from 3 seconds of frame intervals on an empty page), GPU, CPU, memory, operating system, whether it was plugged in, and the window size (1440×900).
- Each measurement row is written to the file as soon as it is done, so if the run is interrupted nothing measured so far is lost.

### Reading the results

- **Frames are capped by the display.** On a 60 Hz display a frame cannot take less than 16.7 ms, so the median frame time can be 16.7 ms in both cases. Look for the difference in `main_thread_busy_pct`, `frame_p95_ms` and the stutter counts.
- **The CPU slowdown may not slow down the workers.** Chrome's `Emulation.setCPUThrottlingRate` slows down the page's main thread; Web Workers are not guaranteed to be slowed too. This can tip the 4× round in favour of the workers. It does not stand in for a slow phone; it is only an approximate experiment.
- **With workers off, the app protects itself.** All positions are computed on the main thread not every frame but at most 4 times per second (`SYNC_FALLBACK_QUANTUM_MS = 250`, [`src/scene/SceneManager.ts`](../../src/scene/SceneManager.ts)). So with workers off the FPS can look better than expected; the cost is main-thread load and stutter.
- **With workers off, the scan time is set by slicing, not by computing power.** To keep the screen responsive, the fallback splits the scan into small pieces (at most 1,000 objects' positions at a time) and runs each piece when the browser is idle (`requestIdleCallback`), usually once per frame ([`src/orbital/conjunction/upcomingScan.ts`](../../src/orbital/conjunction/upcomingScan.ts)). The 24-hour scan has 1,440 time steps. So the scan times with and without workers measure two different things and should not be turned into one speed-up factor.
- **One computer:** the results belong to this computer and GPU; on other devices the numbers change, and the ratios are more meaningful.

### Results

One laptop: AMD Ryzen 5 7520U, AMD Radeon integrated GPU (ANGLE, Direct3D 11), 8 GB memory, Windows 11, Microsoft Edge 156, 60 Hz display, plugged in. Catalog fetched 2026-11-03 (28,294 objects). Full details: [`results/run-metadata.json`](results/run-metadata.json).

**Main-thread load and stutter** ([`results/browser-summary.csv`](results/browser-summary.csv), median of 10 runs; workers on / off):

| CPU | Objects | Main thread busy | Long tasks (count) | Long-task time in 15 s | FPS (supporting) |
|---|---|---|---|---|---|
| normal | 1,000 | 7.5% / 11.5% | 0 / 0 | 0 / 0 ms | 60.0 / 60.0 |
| normal | 5,000 | 8.2% / 15.9% | 0 / 0 | 0 / 0 ms | 60.1 / 60.1 |
| normal | 10,000 | 8.1% / 17.1% | 0 / 0 | 0 / 0 ms | 60.0 / 58.1 |
| normal | 28,000 | 10.3% / 33.3% | 0 / 29 | 0 / 2,853 ms | 60.0 / 51.9 |
| 4× slower | 1,000 | 28.0% / 42.0% | 0 / 0 | 0 / 0 ms | 60.0 / 60.0 |
| 4× slower | 5,000 | 31.7% / 55.0% | 0 / 29 | 0 / 2,353 ms | 60.0 / 53.9 |
| 4× slower | 10,000 | 35.1% / 67.6% | 0 / 30 | 0 / 4,674 ms | 60.0 / 44.1 |
| 4× slower | 28,000 | 41.3% / 98.1% | 0.5 / 29 | 26 / 12,358 ms | 57.9 / 13.5 |

`ready_ms` (time until the catalog is ready) is about the same with workers on and off.

**24-hour close-approach scan** ([`results/browser-scan-summary.csv`](results/browser-scan-summary.csv), every run in [`results/browser-scan.csv`](results/browser-scan.csv); limit 15 minutes):

| Objects | Workers on (median ± std, 10 runs) | Workers off |
|---|---|---|
| 1,000 | 2.3 ± 0.1 s | 125.3 ± 0.2 s (10 runs) |
| 5,000 | 12.4 ± 0.2 s | 521.0 ± 0.2 s (10 runs) |
| 10,000 | 28.9 ± 0.9 s | not finished in 15 minutes (10 of 10 runs) |
| 28,000 | 134.7 ± 10.3 s | not finished in 15 minutes (1 run) |

With workers on, the first run at 1,000, 10,000 and 28,000 objects was slower than the later ones (28,000 objects: 166.0 s, then 130.3–137.6 s); there was no upward drift over the repeats. The first run is kept, and it makes most of the 10.3 s standard deviation. No run failed.

## Files

| File | Contents |
|---|---|
| `sgp4-node.mjs` | Calculation time measurement (Node). |
| `browser-bench.mjs` | Browser measurement (Playwright). |
| `register-ts.mjs`, `ts-hooks.mjs` | Let Node import the app's `.ts` files. |
| `results/sgp4-node-summary.csv`, `-runs.csv`, `-env.json` | Calculation time: summary, every measurement, environment. |
| `results/browser-summary.csv`, `-runs.csv`, `-scan.csv`, `-scan-summary.csv` | Browser: frame summary (median and standard deviation of each measure), every frame measurement, every scan, scan summary. |
| `results/browser-env-frames.json`, `browser-env.json` | Browser environment of the frame and the scan phase. |
| `results/run-metadata.json` | Commit, catalog, commands, power settings and notes of the run. |
| `results/frames-console.log`, `scan-console.log` | Console output of the two phases. |

Each result CSV starts with `#` lines giving the commit, date, command, catalog, display refresh rate, browser, GPU and power; the env JSON files have the same in their `run` block.
| `browser-bench.test.ts` | Tests of the scan run order and the scan summary. |

## References

- Chrome DevTools Protocol: `Performance.getMetrics`, `Emulation.setCPUThrottlingRate`. https://chromedevtools.github.io/devtools-protocol/
- W3C Long Tasks API. https://w3c.github.io/longtasks/
- W3C `requestIdleCallback`. https://w3c.github.io/requestidlecallback/
- Playwright. https://playwright.dev
