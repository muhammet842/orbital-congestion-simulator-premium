# TLE age and position difference

**Question:** as a TLE gets older, how far does the position computed from it drift from the position a newer TLE of the same object gives?

> ⚠️ **This measures the difference between two TLEs, not the true error.** The "newer" TLE in each comparison is also an estimate; the object's true position is unknown. Read the results as "how far the older TLE strays from a more recent estimate". This note is also on the first line of every CSV file and under every chart.

## How to run

```bash
npm run research:tle-age
# or with your own archive folder:
npm run research:tle-age -- --archive "C:\Users\...\Documents\tle-archive"
```

- If the archive folder is empty or missing, the files are downloaded from the repository's [`tle-archive` release](https://github.com/muhammet842/orbital-congestion-simulator-premium/releases/tag/tle-archive) (no login needed) into `research/data/tle-archive/` (not tracked by git).
- The run takes about 2 minutes on a normal computer. Nothing is random: the same archive always gives the same results.
- `--split 2026-10-19`: the first day of the main period (the default).

## Data

The archive holds daily copies of the public catalog published by CelesTrak (see [docs/OPERATIONS.md](../../docs/OPERATIONS.md), "TLE archive"). There is one file per day; because only one copy is taken per day, an object's updates within a day are not seen.

| Period | Days | Catalogs | Objects | Note |
|---|---|---|---|---|
| **Main** | 2026-10-19 → 2026-11-02 | 13 | 28,378 | Full catalog (~28,000 objects). 21 and 23 October are missing. |
| **Early** (reported separately) | 2026-07-03 → 2026-10-18 | 47 | 17,159 | ~10,000–12,000-object catalog; every 3–4 days in July–August, nothing on 1–19 September. |

The two periods are never mixed: the catalog's choice of objects differs, so each is measured on its own.

## Method, step by step

1. **Each object's different TLEs are collected.** The same TLE (the same epoch) can appear in many daily files because it was not updated in between; such a TLE is counted **once**. That way rarely updated objects do not get extra weight. Objects whose TLE never changed during the period cannot be compared, and their number is reported.
2. **Only TLEs of the same object are compared** (the same NORAD number). Every (older, newer) TLE pair of an object is one measurement.
3. **TLE age comes from the epochs, not from file dates:** age = newer TLE's epoch − older TLE's epoch (days). The epoch is columns 19–32 of TLE line 1 (`26285.85396186` = day 285.85396186 of 2026). Code: `epochFromLine1` ([lib.mjs](lib.mjs)).
4. **Position difference:** the older TLE is propagated with the SGP4 model to the newer TLE's epoch; the newer TLE is evaluated at its own epoch. The distance between the two positions is measured in km. The newer TLE's epoch is chosen because a TLE is most accurate at its own epoch. The calculations use satellite.js 7.1.0, the library the app uses (TEME frame).
5. **The difference is split into three directions** (relative to the newer TLE's orbit at that moment):
   - **along-track** (`along`): the object moved forwards or backwards along its orbit, i.e. it is "early or late";
   - **radial** (`radial`): up/down;
   - **cross-track** (`cross`): sideways, out of the orbit plane.
6. **Groups:**
   - The layer (LEO/MEO/GEO/HEO) comes from the newer TLE's orbit shape, using **the app's own function** (`classifyOrbitFromElements`, [src/orbital/classify.ts](../../src/orbital/classify.ts)).
   - Starlink satellites manoeuvre often, so they are also reported as **STARLINK**, and the other LEO objects as **LEO_EXCL_STARLINK**. **STATIONS**: the ISS and Tiangong (only two objects, so few samples).
   - Age groups: 0–14 days rounded to the nearest day (`0` = under half a day), then `15-30` and `31+`.
7. **Statistics (for each group and age):** sample count `n`, **median** (the main result), quartiles `Q1`–`Q3`, 95th percentile, mean and sample standard deviation. Quartiles use Excel's `PERCENTILE.INC` rule.
8. **Extreme differences (manoeuvres):** because the main result is the median, a few manoeuvres do not distort it. In addition, pairs above **Q3 + 3 × (Q3 − Q1)** in each group are counted as outliers (Tukey's rule). Their numbers and shares are in the summary tables, and the 1,000 largest are listed in `outliers.csv`.
9. **Pairs that cannot be computed are left out and counted:**
   - **SGP4 error:** the model could not propagate (mostly objects that are re-entering).
   - **Physically impossible result:** SGP4 sometimes returns a meaningless result without reporting an error. For example, a just-launched satellite's first TLE propagated months ahead can give billions of km. A result counts as invalid when the predicted position is inside the Earth, or its distance from Earth's centre is **more than 1,000 km** outside the newer orbit's lowest-to-highest range (`isPlausiblePosition`). Real changes are far smaller: Starlink raises its orbit from about 350 km to 550 km.

## Results (main period)

Pairs measured: **1,771,754**. Objects whose TLE never changed during the period: 228. SGP4 errors: 570 pairs. Impossible results: 0.

Median position difference (km). In brackets, the median of its along-track part:

| Group | 1 day | 3 days | 7 days | 14 days |
|---|---|---|---|---|
| LEO (no Starlink) | 0.21 (0.19) | 0.74 (0.69) | 4.09 (4.05) | 22.3 (22.3) |
| Starlink | 9.7 (9.7) | 62.6 (62.6) | 309 (308) | 1,103 (1,039) |
| MEO | 0.21 (0.17) | 0.51 (0.42) | 1.16 (1.00) | 3.25 (3.01) |
| GEO | 0.82 (0.51) | 2.86 (1.74) | 9.50 (6.23) | 26.9 (21.6) |
| HEO | 0.77 (0.62) | 2.42 (2.03) | 9.03 (7.84) | 29.5 (26.0) |
| Stations (ISS, Tiangong) | 0.53 (n=18) | 3.85 (n=15) | 31.5 (n=14) | 247 (n=2) |

All values (quartiles, 95th percentile, mean, standard deviation, radial and cross-track parts, outlier shares) are in [`results/summary-main.csv`](results/summary-main.csv). Early period: [`results/summary-early.csv`](results/summary-early.csv) (8,321,979 pairs; 24,056 SGP4 errors, 11,035 impossible results). For example, in the early period the median difference for LEO without Starlink is 0.23 km at 1 day, 3.93 km at 7 days and 17.4 km at 14 days.

Charts: [`results/error-vs-age-main.svg`](results/error-vs-age-main.svg), [`results/error-vs-age-early.svg`](results/error-vs-age-early.svg). A chart point needs at least 20 pairs, so the stations are not on the chart.

## Output files

| File | Contents |
|---|---|
| `results/summary-main.csv`, `summary-early.csv` | One row per group and age (columns below). |
| `results/error-vs-age-*.svg` | Median difference (line) and Q1–Q3 band, logarithmic y axis. Opens in a browser and can be inserted into a document. |
| `results/outliers.csv` | The 1,000 largest outlier pairs: NORAD, name, layer, age, both epochs, difference and its parts. |
| `results/run-info.json` | The days used and the counts (objects, pairs, errors). |

`summary-*.csv` columns: `period` · `group` · `age_days` age group · `n` number of pairs · `median_km` median · `q1_km`, `q3_km` quartiles · `p95_km` 95th percentile · `mean_km` mean · `std_km` standard deviation · `median_abs_along_km`, `median_abs_radial_km`, `median_abs_cross_km` medians of the parts' absolute values · `outlier_limit_km` Tukey limit · `outliers_n`, `outliers_pct` number and share of outlier pairs. The first line is a note starting with `#`; skip it when opening the file in a spreadsheet.

## Reading the results

- **Not the true error:** the newer TLE's own error is part of the difference. Especially at short ages (0–1 day), the measured difference is largely the two TLEs' errors combined.
- **Pairs are not independent:** the same TLE takes part in many pairs (day 1's TLE is compared with both day 2's and day 3's). So even though `n` is very large, the number of independent observations is smaller; do not read the standard deviation as a measurement uncertainty.
- **Mean and median can be very different:** a few very large differences (manoeuvres, just-launched satellites) inflate the mean. That is why the main result is the median.
- **Keep Starlink apart:** Starlink satellites manoeuvre often and make up a large part of the LEO objects, so the "LEO" row (Starlink included) does not represent other LEO objects.
- **Long ages (`15-30`, `31+`) are sparse, special cases:** the main period lasts 14 days, so these ages come only from objects whose TLE was not updated for a long time.
- **One copy per day:** the archive is taken once a day, so ages fall in 1-day steps and updates within a day are not seen.
- **Missing days:** 21 and 23 October and the gaps in the early period reduce the sample count in some age groups; they do not change the results.

## Code layout

| File | Purpose |
|---|---|
| [`lib.mjs`](lib.mjs) | The calculations (no file access): reading epochs, matching TLEs, the SGP4 comparison, splitting into parts, statistics. |
| [`run.mjs`](run.mjs) | Reads the archive, measures both periods, writes CSV, SVG and JSON. |
| [`chart.mjs`](chart.mjs) | An SVG line chart with no libraries. |
| [`lib.test.ts`](lib.test.ts) | Tests (run by `npm test`): for example epoch reading, splitting into parts and the Tukey limit, with examples that can be checked by hand. |

## References

- Hoots, F. R. and Roehrich, R. L. (1980). *Spacetrack Report No. 3: Models for Propagation of NORAD Element Sets.* The definition of the SGP4 model.
- Vallado, D. A., Crawford, P., Hujsak, R. and Kelso, T. S. (2006). *Revisiting Spacetrack Report #3.* AIAA/AAS Astrodynamics Specialist Conference, AIAA 2006-6753. The SGP4 version in use today.
- CelesTrak, public TLE catalog: https://celestrak.org
- satellite.js 7.1.0 (a JavaScript implementation of SGP4): https://github.com/shashwatak/satellite-js
- Tukey, J. W. (1977). *Exploratory Data Analysis.* Addison-Wesley. The outlier rule (Q3 + 3 × IQR).
