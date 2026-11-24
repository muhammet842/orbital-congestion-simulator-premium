/**
 * Which satellites get a page, and what each page says (build time only).
 *
 * The list is exactly the Radio panel's default view (Easy · VHF/UHF): the
 * catalogue is built with the app's own functions, in the app's order
 * (validateDataset → prepareCatalog → createTrackedObjects → buildRadioIndex →
 * filterRadioEntries), so a page exists for every satellite the panel lists
 * and for no other. src/satPages/catalog.test.ts checks this against the app path.
 */
import { createTrackedObjects, prepareCatalog, tleAgeDays } from '../data/tleLoader';
import { validateDataset } from '../data/validateDataset';
import { getRadioFrequencies } from '../data/radioFrequencies';
import {
  buildRadioIndex,
  DEFAULT_RADIO_FILTERS,
  filterRadioEntries,
  receiveFrequencies,
  type RadioMatch,
} from '../data/radioIndex';
import { EARTH_MEAN_RADIUS_KM, perigeeAltitudeKm, semiMajorAxisKm } from '../orbital/classify';
import type { DockedComponent, ObjectCategory, OrbitLayer, RadioFrequency, TrackedObject } from '../types';

export interface SatPageEntry {
  noradId: number;
  name: string;
  category: ObjectCategory;
  country: string;
  owner: string;
  layer: OrbitLayer;
  inclinationDeg: number;
  periodMin: number;
  perigeeKm: number;
  apogeeKm: number;
  /** Epoch of the orbital elements (ISO). */
  epoch: string;
  /** Whole days between the epoch and the build. */
  elementsAgeDays: number;
  tleSource?: 'satnogs';
  /** All published channels, as the details panel shows them. */
  radioFrequencies: RadioFrequency[];
  dockedComponents?: DockedComponent[];
  /** For the list page: receive frequencies (MHz) in the Easy band, and their modes. */
  listFrequenciesMHz: number[];
  listModes: string[];
  /** True if any listed channel is an amateur service (amateur satellites are listed first). */
  amateur: boolean;
}

export interface SatPageCatalog {
  /** When the catalogue was fetched from CelesTrak (ISO). */
  fetchedAt: string;
  /** In the Radio panel's order: amateur first, then by name. */
  entries: SatPageEntry[];
  /** Objects with frequencies left out because their orbit no longer propagates (as in the app). */
  skippedCount: number;
}

const DAY_MS = 86_400_000;

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function toEntry(obj: TrackedObject, match: RadioMatch, asOfMs: number): SatPageEntry {
  const { satrec } = obj;
  const a = semiMajorAxisKm(satrec.no);
  const ageDays = tleAgeDays(satrec, asOfMs);
  return {
    noradId: obj.noradId,
    name: obj.name,
    category: obj.category,
    country: obj.country,
    owner: obj.owner,
    layer: obj.layer,
    inclinationDeg: obj.inclinationDeg,
    // satrec.no is the mean motion in radians per minute.
    periodMin: (2 * Math.PI) / satrec.no,
    perigeeKm: perigeeAltitudeKm(satrec),
    apogeeKm: a * (1 + (satrec.ecco ?? 0)) - EARTH_MEAN_RADIUS_KM,
    epoch: new Date(asOfMs - ageDays * DAY_MS).toISOString(),
    elementsAgeDays: Math.max(0, Math.round(ageDays)),
    ...(obj.tleSource ? { tleSource: obj.tleSource } : {}),
    radioFrequencies: obj.radioFrequencies ?? [],
    ...(obj.dockedComponents?.length ? { dockedComponents: obj.dockedComponents } : {}),
    listFrequenciesMHz: unique(match.channels.flatMap((c) => receiveFrequencies(c, DEFAULT_RADIO_FILTERS.band))),
    listModes: unique(match.channels.map((c) => c.mode.trim()).filter(Boolean)),
    amateur: match.channels.some((c) => c.amateur === true),
  };
}

/**
 * The satellites the Radio panel lists by default, from a raw tle.json.
 * `asOf` plays the role of the visitor's clock: objects whose orbit can no
 * longer be propagated (re-entered) are dropped, as the app drops them.
 */
export function buildSatPageCatalog(raw: unknown, asOf = new Date()): SatPageCatalog {
  const { dataset } = validateDataset(raw);
  const catalog = prepareCatalog(dataset, asOf);
  // Only objects with a frequency can be on the list; skip propagating the rest.
  // (buildRadioIndex ignores objects without channels, so this does not change
  // which satellites are listed or their order.)
  const withRadio = catalog.objects.filter(
    (record) => (getRadioFrequencies(record.noradId) ?? record.radioFrequencies)?.length,
  );
  let skippedCount = 0;
  const objects = createTrackedObjects({ ...catalog, objects: withRadio }, asOf, () => {
    skippedCount++;
  });
  const matches = filterRadioEntries(buildRadioIndex(objects), DEFAULT_RADIO_FILTERS);
  const asOfMs = asOf.getTime();
  return {
    fetchedAt: dataset.fetchedAt,
    entries: matches.map((match) => toEntry(objects[match.entry.index], match, asOfMs)),
    skippedCount,
  };
}
