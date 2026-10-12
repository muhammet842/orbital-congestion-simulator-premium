/**
 * Display-layer cleanup for radio-frequency rows.
 *
 * Rows come from AMSAT/SatNOGS/curated sources and are shown as published, but
 * a few quirks make the table hard to read: service labels that repeat the
 * frequency or are just a bare number, identical rows, and no way to tell
 * amateur channels from weather/navigation/commercial ones. This works on the
 * dataset as it is today, so it needs no catalog refresh.
 */
import type { RadioFrequency } from '../types';

export interface RadioRow extends RadioFrequency {
  /** True when `service` was empty/numeric and replaced with a generic label. */
  genericService: boolean;
  /** True when the published mode contains an AMSAT-style `*` marker. */
  hasMarker: boolean;
}

const NUMERIC_ONLY = /^[0-9\s.,/–-]+(?:mhz)?$/i;

function normalizeService(frequency: RadioFrequency): { service: string; generic: boolean } {
  let service = frequency.service.trim();
  // Drop an embedded copy of this row's own frequency, e.g. "ARGOS-3 A-DCS 465.9875MHz".
  const own = [frequency.uplinkMHz, frequency.downlinkMHz, frequency.listenMHz].filter(
    (value): value is string => Boolean(value),
  );
  for (const value of own) {
    const unitless = service.toLowerCase().endsWith('mhz') ? service.slice(0, -3).trimEnd() : service;
    if (unitless.toLowerCase().endsWith(value.toLowerCase())) {
      service = unitless.slice(0, unitless.length - value.length).trim();
    }
  }
  if (!service || NUMERIC_ONLY.test(service)) return { service: '', generic: true };
  return { service, generic: false };
}

function rowKey(row: RadioFrequency): string {
  return [row.service, row.uplinkMHz, row.downlinkMHz, row.listenMHz, row.mode, row.note]
    .map((value) => value ?? '')
    .join('|');
}

/**
 * Normalises, de-duplicates and orders rows: confirmed amateur channels first,
 * then unclassified, then confirmed non-amateur. Order is otherwise preserved.
 */
export function prepareRadioRows(frequencies: readonly RadioFrequency[]): RadioRow[] {
  const seen = new Set<string>();
  const rows: RadioRow[] = [];
  for (const frequency of frequencies) {
    const { service, generic } = normalizeService(frequency);
    const row: RadioRow = {
      ...frequency,
      service,
      genericService: generic,
      hasMarker: frequency.mode.includes('*'),
    };
    const key = rowKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(row);
  }
  const rank = (row: RadioRow): number => (row.amateur === true ? 0 : row.amateur === false ? 2 : 1);
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => rank(a.row) - rank(b.row) || a.index - b.index)
    .map(({ row }) => row);
}
