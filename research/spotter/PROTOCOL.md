# Spotter accuracy: measurement protocol

**Question:** when you point the phone in a direction, how many degrees is the direction Spotter says the phone is facing off from the true direction?

Spotter uses the phone's compass (magnetometer) and tilt sensors (accelerometer, gyroscope). Their errors decide how far Spotter's cues, like "turn right 12°", can be trusted. This protocol measures that error. **It measures how well the phone finds directions, not how accurate the satellite prediction is**; the satellite prediction is the subject of the [`../tle-age/`](../tle-age/README.md) and [`../sgp4-verify/`](../sgp4-verify/README.md) measurements.

## Two angles

- **Azimuth (direction):** the angle along the horizon, clockwise from true north. North 0°, east 90°, south 180°, west 270°.
- **Elevation (tilt):** the angle above the horizon. Horizon 0°, straight up 90°, below the horizon negative.

Each measurement gives two errors: the **azimuth error** (phone's value − true value; positive means the phone points to the right of the truth) and the **elevation error** (positive means the phone points higher). Also the **total error** combining both: the angle on the sky between the two directions, the number a person would notice. It is computed with the app's own function (`skyAngularSeparationDeg`).

**Note:** in Spotter, "where the phone is facing" is **where the back camera faces**, i.e. the line going through the screen and out of the back. It is not the direction of the phone's top edge. Hold the phone so that, looking at its screen, you would "see" the target behind it.

## Reading the phone's value

Spotter's normal screen only gives whole-degree cues relative to the selected satellite, like "turn right 12°" (and "on target" within 3°), which is not precise enough for measuring. The measurement therefore uses the **measurement readout**:

1. On the phone, open the site with `?spotter=measure` at the end of the address, for example `https://orbital-congestion.vercel.app/?object=25544&spotter=measure` (any satellite works; one must be selected to open Spotter).
2. Press **Spotter** in the right panel. The panel shows a "Measurement (research)" box (the app's buttons and labels appear in the selected language):
   - **Direction**: where the back camera faces, from true north (declination corrected), to one decimal.
   - **Tilt**: the back camera's elevation above the horizon, to one decimal.
   - Below them: the compass source (`absolute` on Android, `webkit` on iPhone), the declination applied and the GPS accuracy.
   These are the same values Spotter uses for its cues.
3. **Save**: adds the current values to a list; the count ("Saved: 12") goes up and is highlighted briefly. **It also saves while the compass is not trusted** (the box border turns yellow): Spotter keeps no direction then, so the row has an empty direction, the tilt is saved, and the row is marked `compass_trusted = no` with the reason (`compass_state`).
4. **Remove last**: undoes a wrong press. **Delete all**: asks first.
5. **Download CSV**: downloads the readings as a file with the same columns as the protocol's template. The columns the phone knows are filled: `local_time`, `phone_model` (when the browser tells it), `browser`, `phone_azimuth`, `phone_elevation`, `gps_accuracy_m`, `declination`; and at the end `utc_time`, `platform` (`iOS` / `Android` / `other`), `os` (e.g. `Android 14`, `iOS 17.5`), `compass_source`, `compass_trusted`, `compass_state`, `gps_lat`, `gps_lon` and the browser's full User-Agent, `user_agent`. iPhones never give their model (only "iPhone"); Chrome on Android usually does. If the model is empty, fill in `phone_model` yourself. You fill in the target, true direction and conditions afterwards in a spreadsheet.

The readings are kept in the phone's browser: they survive a page reload or a locked screen. Still, download the CSV at the end of every session. Opened at the normal address (without the flag), Spotter is unchanged.

## What you need

- A phone (and if possible a second one, to see whether the results depend on the device).
- **A fixed support:** a phone tripod or a holder that keeps the phone upright. Hand-held readings can be measured too, but are recorded separately.
- **A real spirit level** (from a hardware store; not a phone level app, which uses the very sensor being measured).
- Google Maps (or a similar map) for the coordinates of distant landmarks.
- For night measurements, Stellarium (free planetarium software, https://stellarium-web.org) or similar.
- The template next to this file: [`data/sheet-template.csv`](data/sheet-template.csv).

## Step 1: Preparation (at the start of each session)

1. **Go to an open area.** Stay at least 2–3 m away from cars, iron railings, reinforced concrete, loudspeakers and power cables. A magnetic compass is affected by all of them.
2. **Remove magnetic cases and accessories** (magnetic car-mount plates, MagSafe wallets and the like).
3. **Get a location fix:** allow location in Spotter and wait until the GPS accuracy shown is below 20 m. (Spotter only warns above 80 m; this measurement needs better.) For landmark measurements you take your own position from the map, so the GPS error does not affect the true direction, but Spotter's declination depends on the location.
4. **Calibrate the compass:** move the phone in a big figure 8 in the air a few times. Spotter asks for this when the compass is not ready. Record whether you calibrated (`calibrated` column). To see the effect of calibration, take some readings before calibrating too.
5. Note the **declination** Spotter shows ("Mag …°") (`declination` column). Spotter turns the compass's magnetic north into true north with this value; directions on a map are relative to true north too.

## Step 2: Targets with a known true direction

Use three kinds of target. Each measures a different side of the error.

### A. Distant landmark (daytime, azimuth and elevation)

Pick a distant point whose position on the map is exact: a minaret, a tower, a radio mast, a distinct mountain top, the corner of a distant building.

- **It should be at least 1 km away.** A 10 m error in either position gives about 0.6° of direction error at 1 km and 0.2° at 3 km. The farther the target, the more exactly its true direction is known.
- **Pick at least 4 targets in different directions** (roughly north, east, south and west). Compass errors often change with direction; measuring in one direction would hide that.
- Coordinates: long-press the point in Google Maps and copy the value shown, like "40.88765, 29.30012". Find your own standing point on the map the same way (the phone's GPS can be off by a few metres; marking your spot on the map is more exact).
- Heights (above sea level, metres): the map's elevation information or a tool like https://www.freemaptools.com/elevation-finder.htm. For towers and buildings, add the height of the top. The elevation angle is small for distant targets; the azimuth is what is mainly measured.
- Compute the true direction:

  ```bash
  npm run research:spotter-direction -- --from 40.88765,29.30012,35 --to 40.90510,29.33120,180
  ```

  Write the **true azimuth** and **true elevation** from the output into the sheet. If you write the coordinates into the sheet and leave the true-direction columns empty, the analysis script computes them itself.

### B. Polaris (night, azimuth and elevation)

Polaris (the North Star) barely moves on the sky: it is always within 1° of north, and its height above the horizon roughly equals your latitude (about 41° in Istanbul). Read its exact azimuth and elevation at the time of measuring from Stellarium (set the location and time correctly) and write them into the sheet. It is the only target type well above the horizon, so it also tests the tilt at height.

Other bright stars and planets can be used the same way. **Never look at the Sun or point the phone's camera at it.**

### C. Spirit level (elevation only)

To test the tilt sensor apart from the compass:

- **Horizon (0°):** hold the phone upright with the screen facing you; put the spirit level against the phone's side edge to check it is exactly vertical. The back camera then faces the horizon exactly: true elevation **0°**.
- **Zenith (90°):** lay the phone screen-down on a flat table (check the table with the spirit level). The back camera faces straight up: **90°**.
- In these rows **leave the true azimuth empty**: the azimuth is unknown, so only the elevation error is computed. At the zenith the azimuth is meaningless anyway (all directions meet there).

## Step 3: Measuring

For each target:

1. Put the phone on the support and aim its back camera at the target. To aim, look at the target over the middle of the screen's top edge, with the screen perpendicular to your line of sight.
2. **Wait 5 seconds without moving it.** Spotter smooths the sensor values to reduce jitter; the value takes a few seconds to settle.
3. Press **Save** in the measurement readout. (Touching the phone can move it; on a tripod, check that the value did not change after the press, and if it did, use **Remove last** and wait again.) Note on paper which readings belong to which target: "readings 1–10: minaret".
4. **Take the phone off, turn it in another direction, then aim again and take the next reading.** Each reading should come from a separate aim; otherwise you record the same reading ten times.
5. Take **10 readings** per target.

**Suggested minimum plan** (about 2–3 hours, can be split into two sessions):

| Target | Condition | Readings |
|---|---|---|
| 4 landmarks (N, E, S, W) | tripod, calibrated | 4 × 10 |
| The same 4 landmarks | hand-held, calibrated | 4 × 10 |
| 1 landmark | tripod, before calibrating | 10 |
| Spirit level: horizon and zenith | table / upright | 2 × 10 |
| Polaris (night) | tripod | 10 |
| (Optional) a second phone | same plan | — |
| (Optional) 1 m from a car | tripod | 10 |

The last row shows the effect of metal and magnets: measuring the same target next to and away from a car gives a number to the question "why measure in an open area?".

**What to expect:** next to metal the phone usually still calls the compass trusted and gives a direction; only that direction is wrong. The effect then shows in the **azimuth error** (how many degrees off is the same target next to the car?). If Spotter stops trusting the compass (for example when it asks for calibration), the readout says so in yellow with a "compass not trusted" message; those readings have no direction, but how often it happened can be counted from the `compass_trusted` column. The two results should be reported separately: a wrong direction, and no direction at all.

## Step 4: Recording

Save the CSV downloaded from the measurement readout as `data/measurements.csv` (files from several sessions can be stacked in a spreadsheet; renumber the `measurement_no` column) and fill in the target and condition columns from your paper notes. Without the readout you can also fill in the empty template, [`data/sheet-template.csv`](data/sheet-template.csv), by hand. The file is semicolon-separated so that spreadsheets in decimal-comma locales (such as Turkish or German Excel) open it in columns; decimal commas are accepted (12,5). When saving, choose "CSV (semicolon delimited)".

| Column | What to write | Example |
|---|---|---|
| `measurement_no` | Running number | 17 |
| `local_time` | Local date and time | 2026-11-05 14:10 |
| `phone_model` | Model | Redmi Note 12 |
| `browser` | Browser and version | Chrome 130 |
| `target_type` | `landmark`, `polaris` or `spirit_level` | landmark |
| `target_name` | Short name | Tuzla minaret |
| `observer_lat`, `observer_lon`, `observer_height_m` | Where you stood (landmarks only) | 40,88765 · 29,30012 · 35 |
| `target_lat`, `target_lon`, `target_height_m` | Where the target is (landmarks only) | 40,90510 · 29,33120 · 180 |
| `true_azimuth`, `true_elevation` | True direction (from the script, Stellarium, or 0 / 90 for the spirit level). Can stay empty if you wrote the coordinates. Leave the azimuth empty for the spirit level. | 53,49 · 2,53 |
| `phone_azimuth`, `phone_elevation` | What the measurement readout showed | 48,5 · 3,1 |
| `gps_accuracy_m` | GPS accuracy shown by Spotter | 5 |
| `declination` | Declination shown by Spotter ("Mag …°") | 5,9 |
| `calibrated` | `yes` / `no` (figure 8 done?) | yes |
| `surroundings` | `open_area`, `indoors` or `near_metal` | open_area |
| `mount` | `tripod` or `hand` | tripod |
| `notes` | If needed: wind, warnings, what happened | a car drove past |

If something went wrong in a row, do not delete it; write it in `notes`. Decide which readings to leave out before the analysis, by writing down the rule.

## Step 5: Analysis

```bash
npm run research:spotter-analyze
```

The script reads `data/measurements.csv` and writes two files:

- `results/errors.csv`: the azimuth, elevation and total error of every reading.
- `results/summary.csv`: for all readings, and grouped by platform (iPhone / Android), operating system, phone, target type, calibration, surroundings, mount, whether the compass was trusted, and platform + target type: the **mean** (systematic bias: does the phone always lean one way?), **median**, **standard deviation** (spread: how consistently does it show the same target?), and the total error's median, 95th percentile and maximum.

Readings taken while the compass was not trusted have no direction, so they count for the elevation error only; the `n_azimuth` and `n_elevation` columns show how many rows each measure is based on.

Read the mean and median together: a mean far from zero means the phone has a systematic bias (for example it always points 4° to the right); a large standard deviation means the readings are scattered.

## Error sources (to discuss in a write-up)

| Source | Effect | Precaution in this protocol |
|---|---|---|
| Magnetic disturbance (metal, magnets, electricity) | Up to tens of degrees in azimuth | Open area, no case; plus a deliberate "near metal" measurement |
| Compass calibration | A few to tens of degrees in azimuth | Figure 8; before/after calibration comparison |
| Aiming | About 1–2° | Tripod; a fresh aim for each reading; hand-held/tripod comparison |
| The target's true direction | Position error / distance (10 m at 1 km → 0.6°) | Targets at least 1 km away, positions marked on the map |
| Declination model | Usually under 1° | `declination` is recorded |
| Sensor smoothing | A few degrees if read before it settles | 5-second wait |
| Phone model | Sensors differ between devices | Optional second phone |

## Safety

- Never look at the Sun, directly or through the phone's camera.
- At night, measure in a safe, lit, familiar place, with someone with you.
- Do not measure at the roadside.

## Files

| File | Purpose |
|---|---|
| [`../../src/ui/spotter/measureTool.ts`](../../src/ui/spotter/measureTool.ts) | The measurement readout in the app (`?spotter=measure`): reading, saving, CSV download. |
| [`sheet.test.ts`](sheet.test.ts) | Checks that the file the readout downloads has the template's columns and that the analysis reads it. |
| [`data/sheet-template.csv`](data/sheet-template.csv) | Empty template (semicolon-separated, spreadsheet-friendly). |
| [`true-direction.mjs`](true-direction.mjs) | True azimuth, elevation angle and distance from two coordinates. |
| [`analyze.mjs`](analyze.mjs) | Summarizes the filled-in sheet. |
| [`lib.mjs`](lib.mjs), [`lib.test.ts`](lib.test.ts) | The calculations and their tests (correct directions, 3° between 359° and 2° across north, semicolon CSV from Excel). |

The true direction is computed by converting both points on the WGS-84 ellipsoid to Earth-centred coordinates and turning the line between them into the observer's east–north–up axes; this takes the Earth's curvature into account. Refraction in the air is not included (under 0.05° over a few km).
