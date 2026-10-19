/**
 * Searchable index over the catalog's radio data, plus the helpers behind the
 * Radio panel's filters, CSV export and shareable links.
 *
 * Only what a hobbyist can RECEIVE is indexed: downlinks and beacon/listen
 * channels (not uplinks). Pure functions only, so it is easy to test.
 */
import { nameCollator } from './nameOrder';
import type { TrackedObject } from '../types';
import {
  BAND_RANGES,
  bandContains,
  isBandId,
  isModeFilter,
  modeClasses,
  parseMHz,
  type BandId,
  type ModeClass,
  type ModeFilter,
} from './radioBands';

export interface RadioChannel {
  service: string;
  downMHz: number[];
  listenMHz: number[];
  upMHz: number[];
  /** Published mode text, e.g. "FM · CTCSS 67.0 Hz". */
  mode: string;
  modeClasses: ModeClass[];
  /** true = amateur service, false = confirmed other, undefined = unclassified. */
  amateur: boolean | undefined;
  sourceUrl: string;
}

export interface RadioEntry {
  /** Index into the catalog (state.objects), so a row can select the satellite. */
  index: number;
  noradId: number;
  name: string;
  category: string;
  /** True if any channel is amateur; false if all are confirmed other; else undefined. */
  amateur: boolean | undefined;
  channels: RadioChannel[];
}

export interface RadioFilters {
  band: BandId;
  mode: ModeFilter;
  amateurOnly: boolean;
  query: string;
}

export const DEFAULT_RADIO_FILTERS: Readonly<RadioFilters> = {
  band: 'easy',
  mode: 'all',
  amateurOnly: false,
  query: '',
};

export interface RadioMatch {
  entry: RadioEntry;
  /** The channels that satisfy the filters (what the row shows and the CSV lists). */
  channels: RadioChannel[];
}

export function buildRadioIndex(objects: readonly TrackedObject[]): RadioEntry[] {
  const entries: RadioEntry[] = [];
  objects.forEach((obj, index) => {
    const channels: RadioChannel[] = [];
    for (const f of obj.radioFrequencies ?? []) {
      const downMHz = parseMHz(f.downlinkMHz);
      const listenMHz = parseMHz(f.listenMHz);
      if (downMHz.length === 0 && listenMHz.length === 0) continue;
      channels.push({
        service: f.service,
        downMHz,
        listenMHz,
        upMHz: parseMHz(f.uplinkMHz),
        mode: f.mode,
        modeClasses: modeClasses(f.mode),
        amateur: f.amateur,
        sourceUrl: f.sourceUrl,
      });
    }
    if (channels.length === 0) return;
    entries.push({
      index,
      noradId: obj.noradId,
      name: obj.name,
      category: obj.category,
      amateur: channels.some((c) => c.amateur === true)
        ? true
        : channels.every((c) => c.amateur === false)
          ? false
          : undefined,
      channels,
    });
  });
  return entries;
}

export function channelMatches(channel: RadioChannel, filters: RadioFilters): boolean {
  if (!bandContains(filters.band, [...channel.downMHz, ...channel.listenMHz])) return false;
  if (filters.mode !== 'all' && !channel.modeClasses.includes(filters.mode)) return false;
  if (filters.amateurOnly && channel.amateur !== true) return false;
  return true;
}

/** A bare launch designator ("2023-091J") says nothing to a hobbyist; list named satellites first. */
const DESIGNATOR_NAME = /^\d{4}-\d{3}[A-Z]*$/;

/** Entries with at least one matching channel: amateur first, named before bare designators, then by name. */
export function filterRadioEntries(entries: readonly RadioEntry[], filters: RadioFilters): RadioMatch[] {
  const query = filters.query.trim().toLowerCase();
  const matches: RadioMatch[] = [];
  for (const entry of entries) {
    if (query && !entry.name.toLowerCase().includes(query) && !String(entry.noradId).includes(query)) continue;
    const channels = entry.channels.filter((c) => channelMatches(c, filters));
    if (channels.length > 0) matches.push({ entry, channels });
  }
  const amateurRank = (m: RadioMatch): number => (m.channels.some((c) => c.amateur === true) ? 0 : 1);
  const nameRank = (m: RadioMatch): number => (DESIGNATOR_NAME.test(m.entry.name.trim()) ? 1 : 0);
  return matches.sort(
    (a, b) =>
      amateurRank(a) - amateurRank(b) ||
      nameRank(a) - nameRank(b) ||
      nameCollator.compare(a.entry.name, b.entry.name),
  );
}

/** The receive frequencies of a channel that fall in the band (all of them for "All"). */
export function receiveFrequencies(channel: RadioChannel, band: BandId): number[] {
  const all = [...channel.downMHz, ...channel.listenMHz];
  if (band === 'all') return all;
  const { minMHz, maxMHz } = BAND_RANGES[band];
  const inside = all.filter((f) => f >= minMHz && f <= maxMHz);
  return inside.length ? inside : all;
}

/** "145.825" / "435.670" — trims noise but keeps up to 4 decimals. */
export function formatMHz(value: number): string {
  return String(Number(value.toFixed(4)));
}

// ── CSV ─────────────────────────────────────────────────────────────────────

export interface CsvExtras {
  elevationDeg?: number;
  nextPassUtc?: string;
}

/** Quotes a cell and neutralises spreadsheet formulas (=, +, -, @ at the start). */
export function csvCell(value: string | number | boolean | undefined | null): string {
  let text = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const CSV_HEADER = [
  'name',
  'norad_id',
  'category',
  'amateur',
  'service',
  'downlink_mhz',
  'listen_mhz',
  'uplink_mhz',
  'mode',
  'source_url',
  'elevation_deg_now',
  'next_pass_utc',
];

/** One row per matching channel; Excel-friendly (UTF-8 BOM, CRLF). */
export function buildCsv(matches: readonly RadioMatch[], extras?: ReadonlyMap<number, CsvExtras>): string {
  const rows: string[] = [CSV_HEADER.join(',')];
  for (const { entry, channels } of matches) {
    const extra = extras?.get(entry.noradId);
    for (const ch of channels) {
      rows.push(
        [
          entry.name,
          entry.noradId,
          entry.category,
          ch.amateur === true ? 'yes' : ch.amateur === false ? 'no' : 'unclassified',
          ch.service,
          ch.downMHz.map(formatMHz).join(' / '),
          ch.listenMHz.map(formatMHz).join(' / '),
          ch.upMHz.map(formatMHz).join(' / '),
          ch.mode,
          ch.sourceUrl,
          extra?.elevationDeg != null ? extra.elevationDeg.toFixed(1) : '',
          extra?.nextPassUtc ?? '',
        ]
          .map(csvCell)
          .join(','),
      );
    }
  }
  return `﻿${rows.join('\r\n')}\r\n`;
}

// ── Shareable links ─────────────────────────────────────────────────────────

/** Query string carrying the filters (the location-specific "visible now" is never shared). */
export function radioLinkSearch(filters: RadioFilters): string {
  const p = new URLSearchParams();
  p.set('radio', filters.band);
  if (filters.mode !== 'all') p.set('mode', filters.mode);
  if (filters.amateurOnly) p.set('amateur', '1');
  if (filters.query.trim()) p.set('rq', filters.query.trim().slice(0, 60));
  return `?${p.toString()}`;
}

/** Filters from a URL query, or null when the URL does not ask for the Radio panel. */
export function radioFiltersFromSearch(search: string): RadioFilters | null {
  const p = new URLSearchParams(search);
  if (!p.has('radio')) return null;
  const band = p.get('radio');
  const mode = p.get('mode');
  return {
    band: isBandId(band) ? band : DEFAULT_RADIO_FILTERS.band,
    mode: isModeFilter(mode) ? mode : DEFAULT_RADIO_FILTERS.mode,
    amateurOnly: p.get('amateur') === '1',
    query: (p.get('rq') ?? '').slice(0, 60),
  };
}
