# Newly tracked objects (`firstSeenAt`)

## What “NEW” means

The **NEW** badge and the **“New to this catalog”** filter mark objects whose NORAD ID was **first observed by this app’s automated TLE fetch** within the last 14 days.

It does **not** mean:

- the object was launched in the last 14 days,
- the object physically formed today,
- the official SATCAT `LAUNCH_DATE` (SATCAT is used for **country/owner** enrichment in `tle.json`, not for this badge),
- or a confirmed collision/breakup event.

Analyst / `UNKNOWN` objects (uncorrelated tracks with no international designator) are excluded from the catalog, so they never appear here.

## How stamps are written

`scripts/fetch-tle.mjs` loads the previous `public/data/tle.json`, then `applyFirstSeenAt`:

- seeds silently when there is no previous catalog (avoids marking ~12k objects NEW),
- stamps only IDs absent from the previous `known` set,
- refuses bulk false positives (`MAX_NEW_LAUNCHES_PER_FETCH`),
- rejects decades-old international designators even if they reappear after catalog churn.

## Why the filter can look empty

Most of the committed catalog predates the stamping feature (or arrived in a seed fetch), so they have **no** `firstSeenAt`. Only IDs that newly entered on a later refresh keep the stamp for 14 days. Over successive successful TLE refreshes the filter becomes more demonstrable.
