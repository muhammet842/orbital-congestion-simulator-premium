/**
 * Docked stacks (ISS, CSS, MEV-2 on Intelsat 10-02) shown as one object.
 *
 * The catalog keeps one NORAD number per launched object forever, so a
 * station is several entries. Once objects dock, Space Force publishes the
 * same elements for all of them; those entries are one physical body and are
 * merged here into the earliest-launched member, with the rest listed as
 * `dockedComponents`. A vehicle that undocks gets its own elements again and
 * separates automatically.
 */
import type { RadioFrequency, TleRecord } from '../types';

/** Epoch, drag terms and orbital elements, i.e. everything but the catalog
 *  number, designator, element-set number and checksums. */
export function dockedElementsKey(record: Pick<TleRecord, 'line1' | 'line2'>): string {
  return `${record.line1.slice(18, 61)}|${record.line2.slice(8, 63)}`;
}

/** Sort key for launch order from the international designator (YYNNNP). */
function launchOrder(record: TleRecord): [number, number, number] {
  const designator = record.line1.slice(9, 17).trim();
  const yy = Number(designator.slice(0, 2));
  const launch = Number(designator.slice(2, 5));
  if (!Number.isFinite(yy) || !Number.isFinite(launch)) return [Infinity, Infinity, record.noradId];
  return [yy < 57 ? 2000 + yy : 1900 + yy, launch, record.noradId];
}

function compareLaunchOrder(a: TleRecord, b: TleRecord): number {
  const [ay, al, an] = launchOrder(a);
  const [by, bl, bn] = launchOrder(b);
  return ay - by || al - bl || an - bn;
}

function channelKey(f: RadioFrequency): string {
  return [f.uplinkMHz, f.downlinkMHz, f.listenMHz, f.mode].join('|');
}

export function mergeDockedStacks<T extends TleRecord>(records: readonly T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const record of records) {
    const key = dockedElementsKey(record);
    const group = groups.get(key);
    if (group) group.push(record);
    else groups.set(key, [record]);
  }

  const merged = new Map<T, T>();
  const absorbed = new Set<T>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const [primary, ...parts] = [...group].sort(compareLaunchOrder);

    const radioFrequencies = [...(primary.radioFrequencies ?? [])];
    for (const part of parts) {
      for (const frequency of part.radioFrequencies ?? []) {
        if (!radioFrequencies.some((f) => channelKey(f) === channelKey(frequency))) radioFrequencies.push(frequency);
      }
    }

    merged.set(primary, {
      ...primary,
      ...(radioFrequencies.length > 0 ? { radioFrequencies } : {}),
      dockedComponents: parts.map((part) => ({ noradId: part.noradId, name: part.name })),
    });
    for (const part of parts) absorbed.add(part);
  }

  if (absorbed.size === 0) return [...records];
  return records.filter((record) => !absorbed.has(record)).map((record) => merged.get(record) ?? record);
}
