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
| 1,000 | 2.27 ms | 0.42 ms | 2.27 µs |
| 5,000 | 10.97 ms | 0.52 ms | 2.19 µs |
| 10,000 | 22.74 ms | 1.46 ms | 2.27 µs |
| 28,000 | 61.49 ms | 0.68 ms | 2.20 µs |

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
- **With workers off, the scan time is set by slicing, not by computing power.** To keep the screen responsive, the fallback splits the scan into small pieces (at most 1,000 objects' positions at a time) and runs each piece when the browser is idle (`requestIdleCallback`), usually once per frame ([`src/orbital/conjunction/upcomingScan.ts`](../../src/orbital/conjunction/upcomingScan.ts)). The 24-hour scan has 1,440 time steps. In a trial run with 1,000 objects, the scan took 2.6 seconds with workers and 124 seconds without; with 28,000 objects and no workers it had not finished after 10 minutes.
- **One computer:** the results belong to this computer and GPU; on other devices the numbers change, and the ratios are more meaningful.

## Files

| File | Contents |
|---|---|
| `sgp4-node.mjs` | Calculation time measurement (Node). |
| `browser-bench.mjs` | Browser measurement (Playwright). |
| `register-ts.mjs`, `ts-hooks.mjs` | Let Node import the app's `.ts` files. |
| `results/sgp4-node-summary.csv`, `-runs.csv`, `-env.json` | Calculation time: summary, every measurement, environment. |
| `results/browser-summary.csv`, `-runs.csv`, `-scan.csv`, `-scan-summary.csv`, `-env.json` | Browser: frame summary (median and standard deviation of each measure), every frame measurement, every scan, scan summary, environment. |
| `browser-bench.test.ts` | Tests of the scan run order and the scan summary. |

## References

- Chrome DevTools Protocol: `Performance.getMetrics`, `Emulation.setCPUThrottlingRate`. https://chromedevtools.github.io/devtools-protocol/
- W3C Long Tasks API. https://w3c.github.io/longtasks/
- W3C `requestIdleCallback`. https://w3c.github.io/requestidlecallback/
- Playwright. https://playwright.dev
