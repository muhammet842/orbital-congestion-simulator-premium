/**
 * Runtime validation of the TLE dataset (public/data/tle.json).
 *
 * The file is produced by an unattended bot from an external feed and then
 * deployed, so the app must not trust its shape. Structural problems (missing
 * `objects`, unparseable `fetchedAt`) are fatal; individual malformed records
 * are dropped and reported so one bad row cannot break or poison the catalog.
 */
import type { TleDataset, TleRecord } from '../types';

const CATEGORIES = new Set(['stations', 'active', 'debris']);

/** Above this share of rejected records the dataset is treated as corrupt. */
export const MAX_DROPPED_FRACTION = 0.05;

export interface DatasetValidation {
  dataset: TleDataset;
  /** One human-readable reason per dropped record (capped for brevity). */
  problems: string[];
  droppedCount: number;
}

function isHttpUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

/** Returns a reason string when `record` is unusable, otherwise null. */
export function recordProblem(record: unknown): string | null {
  if (typeof record !== 'object' || record === null) return 'not an object';
  const r = record as Record<string, unknown>;
  if (!Number.isInteger(r.noradId) || (r.noradId as number) <= 0) return 'bad noradId';
  if (typeof r.name !== 'string') return 'bad name';
  if (typeof r.line1 !== 'string' || r.line1.length !== 69 || !r.line1.startsWith('1 ')) return 'bad line1';
  if (typeof r.line2 !== 'string' || r.line2.length !== 69 || !r.line2.startsWith('2 ')) return 'bad line2';
  if (Number(r.line1.slice(2, 7)) !== r.noradId || Number(r.line2.slice(2, 7)) !== r.noradId) {
    return 'noradId does not match TLE lines';
  }
  if (typeof r.category !== 'string' || !CATEGORIES.has(r.category)) return 'unknown category';
  if (r.country !== undefined && typeof r.country !== 'string') return 'bad country';
  if (r.owner !== undefined && typeof r.owner !== 'string') return 'bad owner';
  if (r.firstSeenAt !== undefined && !Number.isFinite(Date.parse(String(r.firstSeenAt)))) {
    return 'bad firstSeenAt';
  }
  if (r.radioFrequencies !== undefined) {
    if (!Array.isArray(r.radioFrequencies)) return 'bad radioFrequencies';
    for (const f of r.radioFrequencies as Record<string, unknown>[]) {
      if (typeof f?.service !== 'string' || typeof f?.mode !== 'string' || !isHttpUrl(f?.sourceUrl)) {
        return 'bad radioFrequencies entry';
      }
      if (f.amateur !== undefined && typeof f.amateur !== 'boolean') {
        return 'bad radioFrequencies entry';
      }
    }
  }
  return null;
}

/** Validates the parsed JSON; throws on a structurally unusable dataset. */
export function validateDataset(raw: unknown): DatasetValidation {
  if (typeof raw !== 'object' || raw === null) throw new Error('Orbital data is malformed.');
  const d = raw as Record<string, unknown>;
  if (!Array.isArray(d.objects)) throw new Error('Orbital data is malformed: no object list.');
  if (typeof d.fetchedAt !== 'string' || !Number.isFinite(Date.parse(d.fetchedAt))) {
    throw new Error('Orbital data is malformed: bad fetch timestamp.');
  }

  const objects: TleRecord[] = [];
  const problems: string[] = [];
  const seen = new Set<number>();
  let droppedCount = 0;

  for (const record of d.objects) {
    const problem = recordProblem(record) ?? (seen.has((record as TleRecord).noradId) ? 'duplicate noradId' : null);
    if (problem) {
      droppedCount++;
      if (problems.length < 20) {
        const id = (record as { noradId?: unknown } | null)?.noradId;
        problems.push(`NORAD ${String(id)}: ${problem}`);
      }
      continue;
    }
    seen.add((record as TleRecord).noradId);
    objects.push(record as TleRecord);
  }

  if (d.objects.length > 0 && droppedCount / d.objects.length > MAX_DROPPED_FRACTION) {
    throw new Error(
      `Orbital data rejected: ${droppedCount} of ${d.objects.length} records are invalid (${problems[0]}).`,
    );
  }

  return {
    dataset: {
      fetchedAt: d.fetchedAt,
      source: typeof d.source === 'string' ? d.source : '',
      count: objects.length,
      objects,
    },
    problems,
    droppedCount,
  };
}
