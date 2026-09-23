# Operations checklist

## TLE refresh

- Workflow: [`.github/workflows/tle-refresh.yml`](../.github/workflows/tle-refresh.yml) (daily at 03:17 UTC).
- Manual: `npm run fetch-tle` then commit `public/data/tle.json` if needed.
- Each fetch pulls CelesTrak **TLE groups** and joins **SATCAT** (`satcat.csv`) for country/owner fields. If SATCAT is temporarily unavailable, the script still writes TLEs and the UI falls back to name heuristics.
- In-app UI warns when `fetchedAt` is older than ~3 days — keep Actions green.
- Verify on GitHub → **Actions → TLE Refresh** that the latest run succeeded.
- Live catalog: open the deployed app and check **Live Stats → TLE data updated**.

## CI

- Unit tests + build + i18n key parity (`npm run check:i18n`): every push/PR.
- Playwright e2e: push to `main` **and** pull requests targeting `main`.
