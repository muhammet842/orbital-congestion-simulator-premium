# Operations checklist

## TLE refresh

- Workflow: [`.github/workflows/tle-refresh.yml`](../.github/workflows/tle-refresh.yml) (daily at 03:17 UTC).
- Manual (local): `npm run fetch-tle` updates your local `public/data/tle.json`. Don't commit it — see "Where the data lives" below. Manual (GitHub): Actions → TLE Refresh → Run workflow.
- Each fetch pulls CelesTrak **TLE groups** and joins **SATCAT** (`satcat.csv`) for country/owner fields. If SATCAT is temporarily unavailable, the script still writes TLEs and the UI falls back to name heuristics.
- The fetch refuses to write a catastrophically thin catalog (hard minimums on total, stations, active and debris counts), and refuses to overwrite `tle.json` when any category (or the total) drops more than 15% (and ≥50 objects) versus the previous file — usually a partial CelesTrak outage, and the next daily run normally recovers. If the drop is intentional (e.g. caps changed), run `ALLOW_CATALOG_DROP=1 npm run fetch-tle`. TLE lines with a bad checksum or length are dropped at parse time.
- The workflow builds and unit-tests the new dataset before publishing it, because its `GITHUB_TOKEN` push does not trigger `ci.yml`.

### Where the data lives

The ~5 MB catalog is **not committed to `main`** by the bot any more — every clone used to carry every day's copy.

1. Each run force-replaces a single-commit **`data` branch** that holds `tle.json` (no history accumulates).
2. It then commits only a tiny pointer, `public/data/data-ref.json` (snapshot commit SHA, `fetchedAt`, count), to `main`. That commit makes Vercel redeploy.
3. On Vercel (`VERCEL=1`), `npm run build` first runs `scripts/pull-data.mjs` (the `prebuild` hook): it downloads `tle.json` **by commit SHA** (an immutable URL, so no CDN can serve yesterday's file), validates it (≥ 8,000 objects, valid timestamp, well-formed records) and writes it over the committed seed.
4. The committed `public/data/tle.json` on `main` is only a **seed** for local dev, tests and CI, and will be out of date. `npm run pull-data` fetches the latest published snapshot into your working tree.

**Fails closed:** if the snapshot named by `data-ref.json` can't be fetched or fails validation, the Vercel build fails and Vercel keeps serving the previous good deployment. Set `PULL_DATA_OPTIONAL=1` on Vercel to turn that into a warning (the build then ships the seed — only do this to unblock an urgent code deploy).

**If something is wrong:** the live site shows the in-app staleness warning after ~3 days. Check Actions → TLE Refresh and the latest Vercel deployment's build log for `pull-data:` lines. Don't delete the `data` branch (the next refresh recreates it, but builds in between fail until it exists).
- In-app UI warns when `fetchedAt` is older than ~3 days — keep Actions green.
- Verify on GitHub → **Actions → TLE Refresh** that the latest run succeeded.
- Live catalog: open the deployed app and check **Live Stats → TLE data updated**. `/data/data-ref.json` on the live site shows which snapshot is deployed.

## CI

- Unit tests + build + i18n key parity (`npm run check:i18n`): every push/PR.
- Playwright e2e: push to `main` **and** pull requests targeting `main`.
