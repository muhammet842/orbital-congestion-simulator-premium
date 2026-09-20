/**
 * Fetch + assemble public/data/tle.json from CelesTrak GP groups + SATCAT.
 *
 * Invoked by `npm run fetch-tle` and `.github/workflows/tle-refresh.yml`
 * (Mon/Thu). Caps active/debris counts, stamps firstSeenAt vs previous file,
 * joins OWNER → country when satcat.csv is available.
 *
 * CRITICAL: after assembly, refuse to write if the catalog is catastrophically
 * thin (see MIN_TOTAL / MIN_STATIONS / MIN_ACTIVE / MIN_DEBRIS near the end).
 * CelesTrak 403/503 partial responses once shipped ~3.5k objects and 0 stations
 * to production; fail closed and leave the previous tle.json on disk.
 */
import { applyFirstSeenAt } from './applyFirstSeenAt.mjs';
import {
  applySatcatOwners,
  fetchSatcatMetadataMap,
  filterSatcatDecayedObjects,
} from './enrichFromSatcat.mjs';
import { filterKnownDeorbitedObjects } from './deorbitedObjects.mjs';

const STATION_SOURCES = [
  { url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=tle', category: 'stations' },
];

/** MEO/GEO and regional highlights — fetched before bulk LEO constellations. */
const ACTIVE_GROUP_SOURCES = [
  'geo',
  'gps-ops',
  'galileo',
  'beidou',
  'glo-ops',
  'intelsat',
  'eutelsat',
  'ses',
  'weather',
  'resource',
  'science',
  'military',
  'starlink',
  'oneweb',
  'satnogs',
  'planet',
  'spire',
  'cubesat',
  'amateur',
  'engineering',
  'other-comm',
  'globalstar',
  'orbcomm',
  'argos',
  'nnss',
  'education',
  'radar',
];

/** Keep in sync with src/data/objectMetadata.ts TURKISH_NORAD_IDS (+ iconic MEO/GEO). */
const PRIORITY_NORAD_IDS = [
  41875, // GÖKTÜRK-1
  39030, // GÖKTÜRK-2
  56178, // IMECE
  47306, // Turksat 5A
  50212, // Turksat 5B
  60233, // Turksat 6A
  20580, // Hubble
  40367, // GOES-16
  25994, // GPS IIF
  98268, // RAFS (Rubidium Atomic Frequency Standard) — TUA/TÜBİTAK 6U CubeSat,
         // Transporter-17 rideshare (2026-07-07). Temporary catalog number;
         // no public TLE/SupGP exists yet as of 2026-07-20 (normal for a
         // small rideshare payload — SSN correlation across a dense
         // multi-payload deployment can take weeks). Keeping this here so
         // it's picked up — and flagged "NEW" — the moment data appears.
];

/** Prevent one mega-constellation from filling the entire spacecraft budget. */
const GROUP_CAPS = {
  starlink: 4500,
  oneweb: 600,
};

const DEBRIS_SOURCES = [
  { url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=cosmos-2251-debris&FORMAT=tle', category: 'debris' },
  { url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=fengyun-1c-debris&FORMAT=tle', category: 'debris' },
  { url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=iridium-33-debris&FORMAT=tle', category: 'debris' },
  { url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=cosmos-1408-debris&FORMAT=tle', category: 'debris' },
  { url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=analyst&FORMAT=tle', category: 'debris' },
];

/** Trackable fragments whose name contains DEB — fills leftover debris budget after named clouds. */
const DEBRIS_NAME_FILL = {
  url: 'https://celestrak.org/NORAD/elements/gp.php?NAME=DEB&FORMAT=tle',
  category: 'debris',
};

const MAX_SATELLITES = 7_000;
const MAX_DEBRIS = 5_000;
const FETCH_DELAY_MS = 450;
const OUTPUT_PATH = new URL('../public/data/tle.json', import.meta.url);
const FALLBACK_PATHS = [
  new URL('../dist/data/tle.json', import.meta.url),
  new URL('../public/data/tle.full.json', import.meta.url),
];

const REQUEST_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/plain,*/*',
  'Accept-Language': 'en-US,en;q=0.9',
};

const DEBRIS_NAME = /DEB|R\/B|COBJECT|SL-\d|COSMOS\s+\d+\s+DEB|OBJECT\s+[A-Z0-9]+/i;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseTleText(text, category) {
  if (text.includes('Invalid query') || text.includes('not found')) {
    console.warn(`Skipping invalid source response for category=${category}`);
    return [];
  }

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const objects = [];

  for (let i = 0; i + 2 < lines.length; i++) {
    const name = lines[i];
    const line1 = lines[i + 1];
    const line2 = lines[i + 2];

    if (!line1.startsWith('1 ') || !line2.startsWith('2 ')) {
      continue;
    }

    const noradMatch = line1.match(/^1\s+(\d+)/);
    if (!noradMatch) continue;

    objects.push({
      noradId: parseInt(noradMatch[1], 10),
      name,
      line1,
      line2,
      category,
    });

    i += 2;
  }

  return objects;
}

async function fetchUrl(url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch(url, { headers: REQUEST_HEADERS });
    if (response.ok) return response.text();
    if (response.status === 403 && attempt === 0) {
      await sleep(1500);
      continue;
    }
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  throw new Error(`Failed to fetch ${url}`);
}

async function fetchSource(source) {
  const text = await fetchUrl(source.url);
  return parseTleText(text, source.category);
}

async function fetchActiveGroup(group) {
  const url = `https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=tle`;
  const text = await fetchUrl(url);
  return parseTleText(text, 'active');
}

async function fetchNoradCatalog(noradId) {
  const url = `https://celestrak.org/NORAD/elements/gp.php?CATNR=${noradId}&FORMAT=tle`;
  const text = await fetchUrl(url);
  const objects = parseTleText(text, 'active');
  return objects[0] ?? null;
}

function groupNameFromObject(name) {
  if (/STARLINK/i.test(name)) return 'starlink';
  if (/ONEWEB/i.test(name)) return 'oneweb';
  return null;
}

function groupCount(seen, group) {
  let count = 0;
  for (const obj of seen.values()) {
    if (obj.category !== 'active' && obj.category !== 'stations') continue;
    if (groupNameFromObject(obj.name) === group) count++;
  }
  return count;
}

function spacecraftCount(seen) {
  let count = 0;
  for (const obj of seen.values()) {
    if (obj.category === 'stations' || obj.category === 'active') count++;
  }
  return count;
}

function debrisCount(seen) {
  let count = 0;
  for (const obj of seen.values()) {
    if (obj.category === 'debris') count++;
  }
  return count;
}

function activePriority(name) {
  if (/STARLINK/i.test(name)) return 0;
  if (/ONEWEB/i.test(name)) return 1;
  if (/PLANET|SPIRE|KUIPER/i.test(name)) return 2;
  return 3;
}

/**
 * Loads the *currently published* dataset (the one about to be overwritten)
 * purely to carry forward `firstSeenAt` timestamps. Returns a Map from
 * noradId to its previously-recorded `firstSeenAt` (only for objects that
 * already had one) plus the full set of previously-known NORAD IDs, so a
 * freshly-appearing ID can be distinguished from one that was simply
 * dropped-and-re-added by a re-ordering of the fetch groups.
 */
async function loadPreviousFirstSeenMap() {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');

  try {
    const raw = await readFile(fileURLToPath(OUTPUT_PATH), 'utf8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data.objects)) return { known: new Set(), firstSeenAt: new Map() };

    const known = new Set();
    const firstSeenAt = new Map();
    for (const obj of data.objects) {
      known.add(obj.noradId);
      if (obj.firstSeenAt) firstSeenAt.set(obj.noradId, obj.firstSeenAt);
    }
    return { known, firstSeenAt };
  } catch {
    return { known: new Set(), firstSeenAt: new Map() };
  }
}

async function loadFallbackDataset() {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');

  for (const url of FALLBACK_PATHS) {
    try {
      const path = fileURLToPath(url);
      const raw = await readFile(path, 'utf8');
      const data = JSON.parse(raw);
      if (Array.isArray(data.objects) && data.objects.length > 1000) {
        console.log(`  fallback: ${path} (${data.objects.length} objects)`);
        return data.objects;
      }
    } catch {
      // try next fallback
    }
  }
  return null;
}

function fillSpacecraftFromFallback(seen, fallbackObjects) {
  const candidates = fallbackObjects
    .filter((obj) => obj.category === 'active' || obj.category === 'stations')
    .sort((a, b) => {
      const rank = { stations: 0, active: 1 };
      const diff = rank[a.category] - rank[b.category];
      if (diff !== 0) return diff;
      const p = activePriority(a.name) - activePriority(b.name);
      if (p !== 0) return p;
      return a.noradId - b.noradId;
    });

  let added = 0;
  for (const obj of candidates) {
    if (spacecraftCount(seen) >= MAX_SATELLITES) break;
    if (seen.has(obj.noradId)) continue;
    seen.set(obj.noradId, {
      noradId: obj.noradId,
      name: obj.name,
      line1: obj.line1,
      line2: obj.line2,
      category: obj.category,
    });
    added++;
  }
  return added;
}

function fillDebrisFromFallback(seen, fallbackObjects) {
  let added = 0;

  const debrisCandidates = fallbackObjects
    .filter((obj) => obj.category === 'debris')
    .sort((a, b) => a.noradId - b.noradId);

  for (const obj of debrisCandidates) {
    if (debrisCount(seen) >= MAX_DEBRIS) break;
    if (seen.has(obj.noradId)) continue;
    seen.set(obj.noradId, {
      noradId: obj.noradId,
      name: obj.name,
      line1: obj.line1,
      line2: obj.line2,
      category: 'debris',
    });
    added++;
  }

  if (debrisCount(seen) >= MAX_DEBRIS) return added;

  const extraCandidates = fallbackObjects
    .filter((obj) => obj.category === 'active' && DEBRIS_NAME.test(obj.name))
    .sort((a, b) => a.noradId - b.noradId);

  for (const obj of extraCandidates) {
    if (debrisCount(seen) >= MAX_DEBRIS) break;
    if (seen.has(obj.noradId)) continue;
    seen.set(obj.noradId, {
      noradId: obj.noradId,
      name: obj.name,
      line1: obj.line1,
      line2: obj.line2,
      category: 'debris',
    });
    added++;
  }

  if (debrisCount(seen) >= MAX_DEBRIS) return added;

  const rocketCandidates = fallbackObjects
    .filter(
      (obj) =>
        obj.category === 'active' &&
        /R\/B|ROCKET BODY|SYLDA|PAM-|FREGAT|CENTAUR|DEBRIS|FRAGMENT|OBJECT [A-Z0-9]/i.test(obj.name),
    )
    .sort((a, b) => a.noradId - b.noradId);

  for (const obj of rocketCandidates) {
    if (debrisCount(seen) >= MAX_DEBRIS) break;
    if (seen.has(obj.noradId)) continue;
    seen.set(obj.noradId, {
      noradId: obj.noradId,
      name: obj.name,
      line1: obj.line1,
      line2: obj.line2,
      category: 'debris',
    });
    added++;
  }

  return added;
}

async function main() {
  const seen = new Map();

  for (const source of STATION_SOURCES) {
    try {
      const objects = await fetchSource(source);
      let added = 0;
      for (const obj of objects) {
        if (spacecraftCount(seen) >= MAX_SATELLITES) break;
        if (seen.has(obj.noradId)) continue;
        seen.set(obj.noradId, obj);
        added++;
      }
      console.log(`  ${source.category}: ${objects.length} fetched, ${added} kept`);
    } catch (err) {
      console.warn(`  ${source.category}: fetch failed — ${err.message}`);
    }
    await sleep(FETCH_DELAY_MS);
  }

  console.log('Fetching priority satellites by NORAD ID...');
  for (const noradId of PRIORITY_NORAD_IDS) {
    if (spacecraftCount(seen) >= MAX_SATELLITES) break;
    if (seen.has(noradId)) {
      console.log(`  priority/${noradId}: already in dataset`);
      continue;
    }

    try {
      const obj = await fetchNoradCatalog(noradId);
      if (obj) {
        seen.set(obj.noradId, obj);
        console.log(`  priority/${noradId}: ${obj.name}`);
      } else {
        console.warn(`  priority/${noradId}: no TLE returned`);
      }
    } catch (err) {
      console.warn(`  priority/${noradId}: fetch failed — ${err.message}`);
    }
    await sleep(FETCH_DELAY_MS);
  }

  for (const group of ACTIVE_GROUP_SOURCES) {
    if (spacecraftCount(seen) >= MAX_SATELLITES) break;

    try {
      const objects = await fetchActiveGroup(group);
      const cap = GROUP_CAPS[group] ?? Infinity;
      // Celestrak returns each group roughly ordered by catalog number
      // (oldest first). For a capped, fast-growing constellation like
      // Starlink — currently ~10,800 objects against a 4,500 cap — taking
      // them in that order means we'd only ever keep satellites from
      // 2019-2021 and would *never* see this week's launches, silently
      // breaking "new launch" detection for the group that launches most
      // often. Sort newest-first so a cap (or the global MAX_SATELLITES
      // budget) always drops the *oldest* objects, not the newest.
      const newestFirst = [...objects].sort((a, b) => b.noradId - a.noradId);
      let added = 0;
      for (const obj of newestFirst) {
        if (spacecraftCount(seen) >= MAX_SATELLITES) break;
        if (groupCount(seen, group) >= cap) break;
        if (seen.has(obj.noradId)) continue;
        seen.set(obj.noradId, obj);
        added++;
      }
      console.log(
        `  active/${group}: ${objects.length} fetched, ${added} kept (${spacecraftCount(seen)}/${MAX_SATELLITES})`,
      );
    } catch (err) {
      console.warn(`  active/${group}: fetch failed — ${err.message}`);
    }
    await sleep(FETCH_DELAY_MS);
  }

  for (const source of DEBRIS_SOURCES) {
    if (debrisCount(seen) >= MAX_DEBRIS) break;

    try {
      const objects = await fetchSource(source);
      let sourceAdded = 0;
      for (const obj of objects) {
        if (debrisCount(seen) >= MAX_DEBRIS) break;
        if (seen.has(obj.noradId)) continue;
        seen.set(obj.noradId, obj);
        sourceAdded++;
      }
      console.log(`  debris (${source.url.split('GROUP=')[1]?.split('&')[0]}): ${sourceAdded} added (${debrisCount(seen)}/${MAX_DEBRIS})`);
    } catch (err) {
      console.warn(`  debris source failed — ${err.message}`);
    }
    await sleep(FETCH_DELAY_MS);
  }

  if (debrisCount(seen) < MAX_DEBRIS) {
    try {
      const objects = await fetchSource(DEBRIS_NAME_FILL);
      // Same newest-first rule as Starlink: CelesTrak returns oldest catalog
      // numbers first, so taking that order would fill the cap with 1960s
      // fragments and hide recent LEO breakups.
      const newestFirst = [...objects].sort((a, b) => b.noradId - a.noradId);
      let added = 0;
      for (const obj of newestFirst) {
        if (debrisCount(seen) >= MAX_DEBRIS) break;
        if (seen.has(obj.noradId)) continue;
        seen.set(obj.noradId, obj);
        added++;
      }
      console.log(
        `  debris (NAME=DEB fill): ${objects.length} fetched, ${added} kept (${debrisCount(seen)}/${MAX_DEBRIS})`,
      );
    } catch (err) {
      console.warn(`  debris NAME=DEB fill failed — ${err.message}`);
    }
    await sleep(FETCH_DELAY_MS);
  }

  const fallbackObjects = await loadFallbackDataset();
  if (fallbackObjects) {
    if (spacecraftCount(seen) < MAX_SATELLITES) {
      const added = fillSpacecraftFromFallback(seen, fallbackObjects);
      console.log(`  fallback spacecraft: +${added} (${spacecraftCount(seen)}/${MAX_SATELLITES})`);
    }
    if (debrisCount(seen) < MAX_DEBRIS) {
      const added = fillDebrisFromFallback(seen, fallbackObjects);
      console.log(`  fallback debris: +${added} (${debrisCount(seen)}/${MAX_DEBRIS})`);
    }
  }

  const fetchedAt = new Date().toISOString();
  const previous = await loadPreviousFirstSeenMap();
  const { newlyLaunchedCount, skippedReason, droppedCorrupt, rejectedStaleLaunch } = applyFirstSeenAt(
    seen,
    previous,
    fetchedAt,
  );
  if (droppedCorrupt > 0) {
    console.log(`  dropped ${droppedCorrupt} bulk-corrupt firstSeenAt stamp(s) from previous catalog`);
  }
  if (rejectedStaleLaunch > 0) {
    console.log(`  rejected ${rejectedStaleLaunch} stale-launch false NEW stamp(s) (TLE launch year too old)`);
  }
  if (skippedReason) {
    console.log(`  new-launch stamping skipped (${skippedReason})`);
  }
  console.log(`  new since last fetch: ${newlyLaunchedCount} object(s)`);

  // Join CelesTrak SATCAT OWNER → country (and org owner when applicable).
  // One CSV download covers the full catalog; name heuristics remain the
  // runtime fallback in objectMetadata.ts when a field is still missing.
  console.log('Enriching country/owner from SATCAT…');
  try {
    await sleep(FETCH_DELAY_MS);
    const satcatMetadata = await fetchSatcatMetadataMap(fetch, { headers: REQUEST_HEADERS });
    const decayedFromSatcat = filterSatcatDecayedObjects(seen, satcatMetadata, new Date(fetchedAt));
    const ownerByNorad = new Map(
      Array.from(satcatMetadata, ([norad, metadata]) => [norad, metadata.owner])
        .filter(([, owner]) => Boolean(owner)),
    );
    const { matched, unmatched, withOwner } = applySatcatOwners(seen, ownerByNorad);
    console.log(
      `  satcat: ${ownerByNorad.size} catalog rows → ${matched} matched, ${unmatched} unmatched, ${withOwner} with org owner`,
    );
    console.log(`  satcat: removed ${decayedFromSatcat} object(s) with a recorded decay date`);
  } catch (err) {
    console.warn(`  satcat enrichment failed — ${err.message} (heuristics will fill gaps)`);
  }

  // SATCAT can lag a confirmed re-entry. Keep this override after the remote
  // join so it is also effective when SATCAT was temporarily unreachable.
  const knownDeorbited = filterKnownDeorbitedObjects(seen, new Date(fetchedAt));
  if (knownDeorbited > 0) {
    console.log(`  overrides: removed ${knownDeorbited} confirmed de-orbited object(s)`);
  }

  const allObjects = Array.from(seen.values()).sort((a, b) => {
    const rank = { stations: 0, active: 1, debris: 2 };
    const diff = rank[a.category] - rank[b.category];
    if (diff !== 0) return diff;
    return a.noradId - b.noradId;
  });

  const counts = allObjects.reduce(
    (acc, obj) => {
      acc[obj.category] = (acc[obj.category] ?? 0) + 1;
      return acc;
    },
    {},
  );

  const dataset = {
    fetchedAt,
    source: 'celestrak.org',
    count: allObjects.length,
    limits: { maxSatellites: MAX_SATELLITES, maxDebris: MAX_DEBRIS },
    counts,
    objects: allObjects,
  };

  const stations = counts.stations ?? 0;
  const active = counts.active ?? 0;
  const debris = counts.debris ?? 0;
  // CelesTrak outages / 403 bursts used to write a half-empty catalog (e.g.
  // ~3.5k objects and zero stations) and the Actions bot would ship it to
  // production. Refuse catastrophically thin results so the previous good
  // tle.json stays on disk and CI fails closed.
  const MIN_TOTAL = 8_000;
  const MIN_STATIONS = 5;
  const MIN_ACTIVE = 3_000;
  const MIN_DEBRIS = 2_000;
  if (
    allObjects.length < MIN_TOTAL ||
    stations < MIN_STATIONS ||
    active < MIN_ACTIVE ||
    debris < MIN_DEBRIS
  ) {
    throw new Error(
      `Refusing to write incomplete catalog: total=${allObjects.length} ` +
        `(need ≥${MIN_TOTAL}), stations=${stations} (need ≥${MIN_STATIONS}), ` +
        `active=${active} (need ≥${MIN_ACTIVE}), debris=${debris} (need ≥${MIN_DEBRIS}). ` +
        `Previous public/data/tle.json left unchanged.`,
    );
  }

  const { mkdir, writeFile } = await import('node:fs/promises');
  const { dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');

  const outPath = fileURLToPath(OUTPUT_PATH);
  await mkdir(dirname(outPath), { recursive: true });
  // Compact (no indentation): this file is fetched by the browser, not
  // hand-edited, and pretty-printing ~12k objects adds ~500 KB of pure
  // whitespace for zero benefit.
  await writeFile(outPath, JSON.stringify(dataset));

  const spacecraftTotal = stations + active;
  console.log(`\nFetched ${allObjects.length} objects at ${fetchedAt}`);
  console.log(`  stations: ${stations}`);
  console.log(`  active:   ${active}`);
  console.log(`  debris:   ${debris}`);
  console.log(`  spacecraft subtotal: ${spacecraftTotal} / ${MAX_SATELLITES}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
