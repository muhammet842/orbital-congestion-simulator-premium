# Orbital Congestion Simulator

> Real-time 3D visualization of Earth orbit congestion using CelesTrak TLE data and SGP4 orbital propagation.

**Live demo:** [https://orbital-congestion-simulator.vercel.app](https://orbital-congestion-simulator.vercel.app)

![Orbital Congestion Simulator — English UI at 1440×900](docs/screenshot-en.png)

## What it does

Orbital Congestion Simulator renders thousands of satellites and debris fragments orbiting Earth in real time. It uses Two-Line Element (TLE) data from CelesTrak and propagates each object with the SGP4 algorithm via [satellite.js](https://github.com/shashwatak/satellite-js).

Explore orbit layers (LEO, MEO, GEO, HEO), filter by congestion type, click any object to inspect its orbital parameters, scrub through time, replay historical collisions, and inspect close-approach pairs in a dedicated verification view.

## Features

- **Live 3D globe** with instanced orbital points, day/night Earth shading, and a LEO shell reference ring
- **Orbit layers & filters** — LEO / MEO / GEO / HEO; satellites / stations / debris; search; altitude & inclination ranges
- **Color by Function** — Starlink, stations, active payloads, and debris at a glance
- **New to this catalog** — filter objects first seen in this app’s TLE list within the last 14 days (`firstSeenAt`)
- **Object details** — altitude, velocity, country/owner, curated photos, orbit trail, ground track, footprint
- **Close-approach alerts** — next-24h scanning with sortable cards and a VERIFY playback mode (T−60s → CPA → T+15s)
- **Historical event replays** — seven landmark collisions, ASAT tests, and breakups
- **Kessler “Future Projection”** — header 🌌 panel with live scenario sliders, charts, and narrative (no separate run button)
- **Satellite Spotter** — mobile sky guide using device sensors and magnetic declination correction
- **Interactive how-to tour** — language gate + spotlight walkthrough (header `?`)
- **i18n** — English, Turkish, German, Russian, Chinese
- **Deep links** — `?object=<NORAD>` / `?event=<id>`
- **Admin analytics overlay** (optional Firebase RTDB) — local PIN, visitor metrics (`Ctrl+Shift+A`)
- **Automated TLE refresh** — GitHub Actions twice weekly (TLE + SATCAT country join)

## Why it matters

Earth orbit is increasingly crowded. About **40,000** objects larger than 10 cm are tracked in near-Earth space (this globe shows a 12,000-object sample). Collisions like Iridium 33–Cosmos 2251 demonstrated the Kessler Syndrome risk — where one collision creates debris that triggers more collisions. Operators like SpaceX perform hundreds of collision-avoidance maneuvers each year. This simulator makes that invisible traffic visible.

## Tech stack

| Layer | Technology |
|-------|------------|
| Build | Vite 6 + TypeScript (strict) |
| 3D | Three.js |
| Orbital mechanics | satellite.js (SGP4) + Web Worker batch propagation |
| Testing | Vitest (unit) + Playwright (e2e) |
| Data | CelesTrak TLE + SATCAT (static `tle.json`) |
| Deploy | [Vercel](https://orbital-congestion-simulator.vercel.app) |

## Getting started

**Requirements:** Node.js 20+, a WebGL-capable browser.

```bash
git clone https://github.com/muhammet842/orbital-congestion-simulator.git
cd orbital-congestion-simulator
npm install
npm run dev
```

Open `http://localhost:5173`. The repo already ships with `public/data/tle.json`; run `npm run fetch-tle` only when you want a fresh CelesTrak pull.

Optional analytics: copy `.env.example` → `.env` and set `VITE_FIREBASE_RTDB_URL` (see [firebase/README.md](firebase/README.md)).

## Development & testing

```bash
npm run build        # tsc + production bundle
npm test             # Vitest unit tests
npm run test:e2e     # Playwright (Chromium + mobile-chrome)
npm run check:i18n   # translation key parity (en/tr/de/ru/zh)
npm run screenshot   # refresh docs/screenshot-en.png after UI changes
```

CI (GitHub Actions): build + unit tests on every push/PR; Playwright e2e on `main` pushes and PRs into `main`.

## How to use

On first visit the app asks you to **choose a language**, then walks through the UI step by step with on-screen highlights (globe, search/filters, details, close approaches, historical events, time bar, Future Projection). Use **Skip** anytime; reopen the tour with the **?** button in the header.

Deep links: `?object=<NORAD>` and `?event=<id>`.

## Data source

Orbital elements and catalog metadata come from [CelesTrak](https://celestrak.org/):

- **TLE / GP** — active satellites (capped at 7,000 — Starlink/OneWeb sub-capped), debris (capped at 5,000 — Cosmos 2251, Fengyun-1C, Iridium 33, Cosmos 1408, analyst objects, then other trackable `DEB` fragments), and stations (ISS, Tiangong, etc.)
- **SATCAT** — one download of [`satcat.csv`](https://celestrak.org/pub/satcat.csv) joined by NORAD ID so each object can carry a **country** (and organization **owner** when SATCAT’s `OWNER` is an agency/consortium code). Name-based heuristics in `objectMetadata.ts` remain the fallback when SATCAT has no match or only supplies a country code (so operators like SpaceX can still come from the name).

Output: `public/data/tle.json` — up to **12,000 objects**, deduplicated by NORAD ID.

A [GitHub Actions workflow](.github/workflows/tle-refresh.yml) runs `npm run fetch-tle` twice a week (Monday & Thursday), which refreshes TLEs **and** re-joins SATCAT, then commits `public/data/tle.json` so the deployed app stays under the in-app 3-day staleness warning. Manual refresh:

```bash
npm run fetch-tle
```

### “NEW” objects filter

Objects can carry a `firstSeenAt` stamp when they first appear in an automated fetch relative to the previous catalog snapshot. The UI filter **“New to this catalog”** uses that stamp — it means **first seen in this app’s TLE list within the last 14 days**, not the physical launch or formation date (and not SATCAT `LAUNCH_DATE`). Stamps accumulate across refreshes; a cold/empty baseline does not mark the whole catalog as new. See [docs/NEW_OBJECTS.md](docs/NEW_OBJECTS.md).

## Limitations (read before demoing)

- **Not live tracking** — positions are propagated from static TLE snapshots with SGP4; there is no real-time position API.
- **Educational scale** — in VERIFY close-approach mode, 3D models shrink to stay smaller than the computed miss distance so pairs do not visually overlap at sub-kilometre CPAs.
- **Projection panel** — Kessler “Future Projection” is a simplified what-if model, not an official debris forecast (see the in-panel disclaimer).
- **TLE age** — Live Stats shows when `tle.json` was last fetched; a warning appears after ~3 days without refresh.

## Orbital mechanics

Each object is propagated with **SGP4** (Simplified General Perturbations 4), the standard model used by NORAD for TLE-based prediction. Positions are computed in Earth-Centered Inertial (ECI) coordinates and scaled for Three.js display (1 unit = Earth radius).

Orbit layers are classified by altitude and eccentricity:

| Layer | Altitude |
|-------|----------|
| LEO | &lt; 2,000 km |
| MEO | 2,000 – ~32,000 km |
| GEO | ~35,786 km ± 500 km |
| HEO | High eccentricity (&gt; 0.25) |

## 3D models

`public/models/sat_leo.glb` is the bundled LEO satellite mesh. Stations, cargo craft, cubesats, and debris use **distinct procedural silhouettes** (see `SatelliteModelLoader`) so types stay visually readable without multi‑MB artist GLBs. Dropping additional `.glb` files at the paths in `modelResolver.ts` and marking them as bundled will take priority automatically.

## Earth texture

Day and night maps sourced from [NASA Visible Earth](https://visibleearth.nasa.gov/) (Blue Marble). Stored locally at `public/textures/earth.jpg` and `public/textures/earth-night.jpg` and blended in a custom shader for the terminator.

## Ops & admin

- Firebase rules and deploy notes: [firebase/README.md](firebase/README.md)
- Feature / architecture notes: [docs/FEATURES.md](docs/FEATURES.md)
- Operations checklist (TLE refresh, Firebase publish): [docs/OPERATIONS.md](docs/OPERATIONS.md)

The admin overlay (Ctrl+Shift+A) is a **local debug panel**. The PIN is hashed on-device (SHA-256); it is not remote authentication.

## Quick test guide (reviewers)

Open the [live demo](https://orbital-congestion-simulator.vercel.app) (desktop first). Skip or finish the short tour, then try:

1. **Color by Function** (Display Options) — Starlink / stations / active / debris become readable at a glance.
2. **Search** `ISS` or `25544`, select it, toggle orbit trail / ground track on the right.
3. **Historical Events** — start with Iridium 33 ↔ Cosmos 2251; scrub or Exit when done.
4. **Close Approach Alerts** — if cards appear, open one for VERIFY playback (may take a minute to scan).
5. **Future Projection** — header 🌌 button; move the sliders (no separate Run).
6. **Phone** — select a bright target → **Spot from here**; allow location/motion. Outside + figure-eight if the compass drifts.

Positions are SGP4 from a periodic TLE snapshot, not a live tracking API.

## If the live catalog looks wrong

Healthy catalog: **~12,000** objects and **stations** (ISS / Tiangong) visible in Live Stats. A thin fetch once shipped ~3.5k objects and zero stations.

1. Check GitHub → **Actions → TLE Refresh** (and CI).
2. Locally: `npm run fetch-tle` — the script **refuses** to overwrite `public/data/tle.json` if totals/stations/active/debris fall below hard minimums.
3. If the fetch succeeds with a full catalog, commit/push `public/data/tle.json` (or wait for a green scheduled run).
4. On the deployed site, confirm **Live Stats → TLE data updated** and object counts.

Details: [docs/OPERATIONS.md](docs/OPERATIONS.md).

## Stardance / NASA

Built for the [Hack Club Stardance](https://stardance.hackclub.com/) competition in collaboration with NASA themes on space sustainability and orbital debris awareness.

## License

[MIT](LICENSE)
#