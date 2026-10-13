# Orbital Congestion Simulator

> Real-time 3D visualization of Earth orbit congestion using CelesTrak TLE data and SGP4 orbital propagation.

**Live demo:** [https://orbital-congestion-simulator-premiu.vercel.app](https://orbital-congestion-simulator-premiu.vercel.app)

![Orbital Congestion Simulator — the ISS selected, with its amateur-radio frequencies in the detail panel](docs/screenshot-en.png)

## What it does

Orbital Congestion Simulator renders thousands of satellites and debris fragments orbiting Earth in real time. It uses Two-Line Element (TLE) data from CelesTrak and propagates each object with the SGP4 algorithm via [satellite.js](https://github.com/shashwatak/satellite-js).

Explore orbit layers (LEO, MEO, GEO, HEO), filter by congestion type, click any object to inspect its orbital parameters, scrub through time, replay historical collisions, and inspect close-approach pairs in a dedicated verification view.

## Features

- **Live 3D globe** with instanced orbital points, day/night Earth shading, and a LEO shell reference ring
- **Orbit layers & filters** — LEO / MEO / GEO / HEO; satellites / stations / debris; search; altitude & inclination ranges
- **Color by Function** — Starlink, stations, active payloads, and debris at a glance
- **New to this catalog** — filter objects first seen in this app’s TLE list within the last 14 days (`firstSeenAt`)
- **Object details** — altitude, velocity, country/owner, orbit trail, ground track, footprint, and published radio-frequency metadata
- **Radio-frequency reference** — verified uplink, downlink, beacon/listening frequencies, modulation modes, operational notes, and direct source links for supported spacecraft and constellations. Channels the sources identify as amateur-radio services carry an **AMATEUR** badge and are listed first
- **Close-approach alerts** — next-24h scanning with sortable cards and a VERIFY playback mode (T−60s → CPA → T+15s)
- **Historical event replays** — seven landmark collisions, ASAT tests, and breakups
- **Kessler “Future Projection”** — header projection panel with live scenario sliders, charts, and narrative (no separate run button)
- **Satellite Spotter** — mobile sky guide using device sensors and magnetic declination correction
- **Interactive how-to tour** — language gate + spotlight walkthrough (header `?`)
- **i18n** — English, Turkish, German, Russian, Chinese
- **Deep links** — `?object=<NORAD>` / `?event=<id>`
- **Automated TLE refresh** — daily GitHub Actions update (TLE + SATCAT country join)

## Why it matters

Earth orbit is increasingly crowded. About **40,000** objects larger than 10 cm are tracked in near-Earth space (this globe shows a 12,000-object sample). Collisions like Iridium 33–Cosmos 2251 demonstrated the Kessler Syndrome risk — where one collision creates debris that triggers more collisions. Operators like SpaceX perform hundreds of collision-avoidance maneuvers each year. This simulator makes that invisible traffic visible.

## Tech stack

| Layer | Technology |
|-------|------------|
| Build | Vite 6 + TypeScript (strict) |
| 3D | Three.js |
| Orbital mechanics | satellite.js (SGP4) + Web Worker batch propagation |
| Testing | Vitest (unit) + Playwright (e2e) |
| Data | CelesTrak TLE and SATCAT, AMSAT and SatNOGS radio catalogs, and official constellation frequency plans |
| Deploy | [Vercel](https://orbital-congestion-simulator-premiu.vercel.app) — `vercel.json` sets a Content-Security-Policy and other security headers |

## Getting started

**Requirements:** Node.js 22+ (what CI uses), a WebGL-capable browser (without WebGL the app shows an explanatory message instead of the 3D view).

```bash
git clone https://github.com/muhammet842/orbital-congestion-simulator-premium.git
cd orbital-congestion-simulator-premium
npm install
npm run dev
```

Open `http://localhost:5173`. The repo ships a seed `public/data/tle.json` (it can be days old, so the app may show its staleness warning). Run `npm run pull-data` to fetch the latest published snapshot, or `npm run fetch-tle` for a fresh CelesTrak pull.

## Development & testing

```bash
npm run dev          # Vite dev server
npm run build        # tsc + production bundle
npm run preview      # serve the production build locally
npm test             # Vitest unit tests (npm run test:watch re-runs on change)
npm run test:e2e     # Playwright (Chromium + mobile-chrome)
npm run test:all     # unit + e2e
npm run check:i18n   # translation key parity (en/tr/de/ru/zh)
npm run pull-data    # fetch the latest published catalog snapshot (see Data source)
npm run fetch-tle    # fresh pull from CelesTrak into your local public/data/tle.json
npm run screenshot   # refresh docs/screenshot-en.png and public/og-image.png after UI changes
                     # (no Playwright browsers? PW_CHANNEL=msedge npm run screenshot)
```

CI (GitHub Actions): build + unit tests on every push/PR; Playwright e2e on `main` pushes and PRs into `main`.

## Project structure

| Path | What lives there |
|------|------------------|
| `src/orbital/` | SGP4 propagation, conjunction screening, look angles, sky projection, Kessler model |
| `src/scene/` | Three.js scene: globe, instanced points, orbit trails, replay and verification visuals |
| `src/ui/` | Panels, tour, Spotter, time controls, shared helpers such as HTML escaping |
| `src/data/` | Catalog loading and validation, object metadata, radio frequencies |
| `src/state/`, `src/routing/` | App state store and `?object` / `?event` deep links |
| `src/i18n/` | Translations (en/tr/de/ru/zh) |
| `src/workers/` | Web Workers for batch propagation and the 24 h close-approach sweep |
| `scripts/` | Catalog refresh and enrichment, snapshot pull, screenshot and i18n tooling |
| `e2e/` | Playwright tests (desktop and mobile) |
| `docs/` | Operations notes and the screenshot |

## How to use

On first visit the app asks you to **choose a language**, then walks through the UI step by step with on-screen highlights (globe, search/filters, details, close approaches, historical events, time bar, Future Projection). Use **Skip** anytime; reopen the tour with the **?** button in the header.

Select a spacecraft to inspect its orbital parameters and, when published data is available, its radio services, uplink and downlink frequencies, receive-only channels, transmission modes, operational notes, and linked reference sources. Frequency details are intentionally omitted for debris objects.

On phones the side panels open as drawers (the ☰ and ℹ buttons in the header), and the radio table switches to a stacked card layout.

In the radio table, the **AMATEUR** badge appears only where the source data says a channel is an amateur-radio service. Channels confirmed as other services (weather, navigation, broadband…) are dimmed and listed last. A channel with no badge and no dimming is simply **unclassified** by its source, which is not the same as not being amateur.

Deep links: `?object=<NORAD>` and `?event=<id>`.

## Data source

Orbital elements and catalog metadata come from [CelesTrak](https://celestrak.org/):

- **TLE / GP** — active satellites (capped at 7,000 — Starlink/OneWeb sub-capped), debris (capped at 5,000 — Cosmos 2251, Fengyun-1C, Iridium 33, Cosmos 1408, analyst objects, then other trackable `DEB` fragments), and stations (ISS, Tiangong, etc.)
- **SATCAT** — one download of [`satcat.csv`](https://celestrak.org/pub/satcat.csv) joined by NORAD ID so each object can carry a **country** (and organization **owner** when SATCAT’s `OWNER` is an agency/consortium code). Name-based heuristics in `objectMetadata.ts` remain the fallback when SATCAT has no match or only supplies a country code (so operators like SpaceX can still come from the name).
- **AMSAT and SatNOGS** — published amateur-radio and active transmitter records joined by NORAD ID. Only confirmed, operationally valid SatNOGS transmitter entries are retained.
- **Official constellation plans** — documented service bands for supported Galileo, GPS, BeiDou, Starlink, and OneWeb spacecraft families.

Output: `tle.json` — up to **12,000 objects**, deduplicated by NORAD ID. (`public/data/tle.json` in the repo is a seed; the live catalog is published by the daily workflow, see below.)

A [GitHub Actions workflow](.github/workflows/tle-refresh.yml) runs `npm run fetch-tle` every day, refreshes TLEs, re-joins SATCAT and radio-frequency sources, and publishes the catalog to a single-commit `data` branch (so the repository does not grow by ~5 MB a day). It then commits a tiny pointer, `public/data/data-ref.json`, to `main`, which redeploys the site; the Vercel build downloads that exact snapshot (`scripts/pull-data.mjs`). This keeps the deployed app under the in-app 3-day staleness warning. Manual refresh:

```bash
npm run fetch-tle
```

Radio-frequency enrichment is best-effort: an upstream radio catalog outage does not block fresh orbital data. Previously verified entries are retained when possible, while curated spacecraft records and official constellation profiles remain available.

### Credits and data licenses

- **[CelesTrak](https://celestrak.org/)** — orbital elements (GP/TLE) and SATCAT, which CelesTrak makes freely available to the space community.
- **[SatNOGS DB](https://db.satnogs.org/)** (Libre Space Foundation) — transmitter data, licensed [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Radio-frequency entries derived from it keep that license: credit SatNOGS DB and share any reuse alike.
- **AMSAT** amateur-satellite frequency lists, via [palewire/amateur-satellite-database](https://github.com/palewire/amateur-satellite-database) (an MIT-licensed repository).
- **Constellation frequency plans** (Galileo, GPS, BeiDou, Starlink, OneWeb) come from public specifications and filings; each row links to its source.
- **Earth textures** — [NASA Visible Earth](https://visibleearth.nasa.gov/); **fonts** — see Fonts below.

### “NEW” objects filter

Objects can carry a `firstSeenAt` stamp when they first appear in an automated fetch relative to the previous catalog snapshot. The UI filter **“New to this catalog”** uses that stamp — it means **first seen in this app’s TLE list within the last 14 days**, not the physical launch or formation date (and not SATCAT `LAUNCH_DATE`). Stamps accumulate across refreshes; a cold/empty baseline does not mark the whole catalog as new. See [docs/NEW_OBJECTS.md](docs/NEW_OBJECTS.md).

## Security notes

- Catalog text (names, owners, countries) comes from an external feed and is HTML-escaped (`src/ui/escapeHtml.ts`) before it reaches the DOM; external links are limited to http(s).
- `public/data/tle.json` is validated at load time (`src/data/validateDataset.ts`) and again in `npm test`, which the TLE refresh workflow runs before publishing a new snapshot.
- If you add a new origin (fonts, tiles, APIs), update the CSP in `vercel.json`.

## Privacy

- No analytics, cookies, accounts or tracking. After the page loads, the app only talks to its own origin (fonts are self-hosted too).
- Three small items are kept in your browser's local storage and never sent anywhere: your language, whether you have seen the tour, and — only if you use the Spotter — your last observer location.
- Location and device-motion permissions are requested only when you use the Spotter, and the browser asks you first.

## Limitations (read before demoing)

- **Close approaches are screening estimates, not operational conjunction assessments** — they are computed from public TLEs, which typically carry a kilometre or more of position error and no uncertainty (covariance) data. Treat distances and risk labels as illustrative; real operators use higher-precision tracking.
- **Alert threshold** — the list shows pairs predicted to pass within 3 km in the next 24 hours. On a busy day that is thousands of events, so the app shows the few most relevant and a "+N more" count.
- **Online only** — there is no offline mode or installable app; the catalog and the page are fetched on each visit.
- **Not live tracking** — positions are propagated from static TLE snapshots with SGP4; there is no real-time position API.
- **Educational scale** — in VERIFY close-approach mode, 3D models shrink to stay smaller than the computed miss distance so pairs do not visually overlap at sub-kilometre CPAs.
- **Projection panel** — Kessler “Future Projection” is a simplified what-if model, not an official debris forecast (see the in-panel disclaimer).
- **TLE age** — Live Stats shows when `tle.json` was last fetched; a warning appears after ~3 days without refresh.
- **Radio-frequency use** — displayed frequencies are a reference compiled from published sources, not operating authorization. Services may be retuned, inactive, geographically restricted, or subject to licensing; verify the linked source and applicable regulations before transmitting.

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

## Fonts

[IBM Plex Sans](https://github.com/IBM/plex), [IBM Plex Mono](https://github.com/IBM/plex) and [Syne](https://fonts.google.com/specimen/Syne) (SIL Open Font License 1.1), self-hosted through [Fontsource](https://fontsource.org/) — the app makes no third-party requests, and the CSP in `vercel.json` only allows fonts from its own origin.

## Earth texture

Day and night maps sourced from [NASA Visible Earth](https://visibleearth.nasa.gov/) (Blue Marble). Stored locally at `public/textures/earth.jpg` and `public/textures/earth-night.jpg` and blended in a custom shader for the terminator.

## Operations

- Operations checklist: [docs/OPERATIONS.md](docs/OPERATIONS.md)

## Quick test guide (reviewers)

Open the [live demo](https://orbital-congestion-simulator-premiu.vercel.app) (desktop first). Skip or finish the short tour, then try:

1. **Color by Function** (Display Options) — Starlink / stations / active / debris become readable at a glance.
2. **Search** `ISS` or `25544`, select it, inspect the sourced radio-frequency table, and toggle orbit trail / ground track on the right.
3. **Historical Events** — start with Iridium 33 ↔ Cosmos 2251; scrub or Exit when done.
4. **Close Approach Alerts** — if cards appear, open one for VERIFY playback (may take a minute to scan).
5. **Future Projection** — open the projection panel from the header and move the sliders (no separate Run).
6. **Phone** — select a bright target → **Spot from here**; allow location/motion. Outside + figure-eight if the compass drifts.

Positions are SGP4 from a periodic TLE snapshot, not a live tracking API.

## If the live catalog looks wrong

Healthy catalog: **~12,000** objects and **stations** (ISS / Tiangong) visible in Live Stats. A thin fetch once shipped ~3.5k objects and zero stations.

1. Check GitHub → **Actions → TLE Refresh** (and CI).
2. Locally: `npm run fetch-tle` — the script **refuses** to overwrite `public/data/tle.json` if totals/stations/active/debris fall below hard minimums, or if any category (or the total) drops more than 15% versus the previous file (override an intentional drop with `ALLOW_CATALOG_DROP=1`).
3. If the fetch succeeds with a full catalog, run the **TLE Refresh** workflow from the Actions tab (don't commit `tle.json` by hand — see [docs/OPERATIONS.md](docs/OPERATIONS.md#where-the-data-lives)).
4. On the deployed site, confirm **Live Stats → TLE data updated** and object counts.

Details: [docs/OPERATIONS.md](docs/OPERATIONS.md).

## Stardance / NASA

Built for the [Hack Club Stardance](https://stardance.hackclub.com/) competition in collaboration with NASA themes on space sustainability and orbital debris awareness.

## Contributing

Issues and pull requests are welcome. Before opening a PR, run `npm run build`, `npm test` and `npm run check:i18n`. New UI text must be added to all five languages in `src/i18n/translations.ts` (parity is checked in CI), and PRs into `main` also run the Playwright suite. Please don't commit refreshed catalogs by hand — see [docs/OPERATIONS.md](docs/OPERATIONS.md).

## Author

Created by **Muhammet** ([@muhammet842](https://github.com/muhammet842)). Feedback, bug reports and ideas are very welcome — please [open an issue](https://github.com/muhammet842/orbital-congestion-simulator-premium/issues).

## License

[MIT](LICENSE)
