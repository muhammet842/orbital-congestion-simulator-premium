# SGP4 verification (Vallado test set)

**Question:** does the SGP4 library the app uses (satellite.js 7.1.0) give the same results as the published reference implementation of SGP4?

**Why it matters:** every position, close approach and pass prediction in the app is computed with this library. If the library had a bug, every other measurement would be wrong too.

## How to run

```bash
npm run research:sgp4-verify   # writes the results to results/
npm test                       # the same checks also run as tests
```

No internet is needed: the data files are in `data/`.

## Data and source

Vallado, D. A., Crawford, P., Hujsak, R. and Kelso, T. S. (2006). *Revisiting Spacetrack Report #3.* AIAA/AAS Astrodynamics Specialist Conference, AIAA 2006-6753. Paper and attachments: https://celestrak.org/publications/AIAA/2006-6753/

The paper defines the SGP4 version in use today and publishes the authors' own implementations together with the output of 33 test cases. The files were taken unchanged from the paper's "Source code" attachment (`AIAA-2006-6753.zip`, downloaded 2026-11-03):

| File | Place in the zip | Contents | SHA-256 |
|---|---|---|---|
| `data/SGP4-VER.TLE` | `sgp4/mat/` | 33 test TLEs; above each, a note on what it tests; after line 2, the start, stop and step times (minutes) | `d246d1d9…ffe2881` |
| `data/tmatverDec2015.out` | `sgp4/mat/` | Output of the authors' MATLAB implementation (December 2015): **the main reference** | `60dc65d6…f8414b7` |
| `data/tforverf.out` | `sgp4/for/` | Output of the authors' Fortran implementation: the cross-check | `cbe6f3ed…f1efec7` |

SHA-256 of the zip file: `3642043b706c76be87cf012db3f22e04da6b80498d00f515e51879e0ffadc115`. The hashes let anyone check that the files are identical to the source (`sha256sum data/*`).

The reference outputs were made in the **"afspc" (`'a'`) operation mode with the WGS-72 constants** (MATLAB test program `testmat.m`: `opsmode = 'a'`, `whichconst = 72`). satellite.js uses the **"improved" (`'i'`) mode** and the WGS-72 constants.

## Method

1. Each test TLE is read with satellite.js's `twoline2satrec`, the same function the app uses.
2. Position and velocity are computed with `sgp4` at **every time listed in the reference output** (666 points in total).
3. At each point, the distance between satellite.js's position and the reference position (mm) and the difference between the velocities (mm/s) are found. The largest difference is reported for each test case.
4. **Cross-check:** the same comparison is made with the Fortran output. The distance between the two references is also measured: at most **0.081 mm**, the level of the reference files' print precision (positions are written to 0.01 mm).
5. **Error behaviour:** some test TLEs are deliberately broken or describe re-entering objects. The reference program stops with an error in those cases. For each, it is checked whether satellite.js also reports an error at the next time after the reference stopped.
6. **Mode diagnostic:** to find the source of a difference, the calculation is repeated with satellite.js switched to the `'a'` mode. This is only a diagnostic: because the mode is changed after the orbit is read, it affects only the propagation part of the algorithm. The app always uses the `'i'` mode.
7. **Skipped line:** the MATLAB output ends with a line whose time goes backwards. It is not a computed point (the Fortran output does not have it), so it is counted and left out.

## Results

([`results/summary.csv`](results/summary.csv), every point: [`results/points.csv`](results/points.csv), totals: [`results/totals.json`](results/totals.json))

| Measure | Result |
|---|---|
| Test cases | 33 (666 points) |
| Difference under 1 mm (the app's `'i'` mode) | **32 / 33**; largest difference 0.008 mm |
| Difference under 1 mm (`'a'` mode diagnostic) | **33 / 33**; largest difference 0.008 mm |
| Largest velocity difference (32 cases) | 0.001 mm/s |
| satellite.js stops where the reference stops | **33 / 33** |
| Distance between the two references | at most 0.081 mm |

**The only different case: 23599 (ARIANE 42P+3 R/B).** Test note: *"Lyddane bug at > 280.5 min"*. The difference starts after minute 420 and reaches at most 964 m. In the `'a'` mode it drops to 0.008 mm. So the difference is not a calculation error: it comes from the known Lyddane behaviour in certain deep-space orbits, which Vallado et al. fixed in the "improved" mode. The reference shows the old behaviour, satellite.js the fixed one.

**The 7 cases that stop with an error.** In each, satellite.js reports an error at the first time after the reference stopped:

| NORAD | Points the reference computed / planned | When satellite.js reports the error (min) | Error code |
|---|---|---|---|
| 22312 | 23 / 72 | 494.2 | 1 |
| 28350 | 13 / 25 | 1,560 | 1 |
| 28872 | 11 / 13 | 55 | 6 |
| 29141 | 22 / 23 | 440 | 6 |
| 33333 | 5 / 31 | 25 | 4 |
| 33334 | 1 / 1,441 (epoch line only) | at the start (while reading the TLE) | 3 |
| 20413 (2nd case) | 70 / 222 | 1,844,345 | 6 |

Error codes (Vallado et al. and satellite.js): **1** mean elements invalid (eccentricity ≥ 1 or semi-major axis too small) · **3** perturbed elements with eccentricity outside 0–1 · **4** semi-latus rectum negative · **6** the object has decayed. For 33334, the reference program stops after writing the epoch line, while satellite.js reports the same error (3) when reading the TLE and returns no position.

## Reading the results

- This verification shows that satellite.js **implements SGP4 correctly**; it does not show **how well SGP4 predicts reality**. That question is the subject of the [`../tle-age/`](../tle-age/README.md) measurement.
- The test cases deliberately include SGP4's hard edge cases (resonant orbits, re-entry, deep space); ordinary satellites are easier.
- What is verified is the app's satellite.js version (7.1.0). If the version changes, `npm test` repeats these checks and fails on any drift.

## Code layout

| File | Purpose |
|---|---|
| [`lib.mjs`](lib.mjs) | Reading the test and reference files, comparing with satellite.js, checking the error behaviour. |
| [`run.mjs`](run.mjs) | Runs the comparison and writes CSV and JSON. |
| [`lib.test.ts`](lib.test.ts) | The same checks as tests: 32 cases within 1 mm (all but 23599), all 33 in the `'a'` mode, an error in all 7 early stops. |

## References

- Vallado, D. A., Crawford, P., Hujsak, R. and Kelso, T. S. (2006). *Revisiting Spacetrack Report #3.* AIAA 2006-6753.
- Hoots, F. R. and Roehrich, R. L. (1980). *Spacetrack Report No. 3: Models for Propagation of NORAD Element Sets.*
- satellite.js 7.1.0: https://github.com/shashwatak/satellite-js
