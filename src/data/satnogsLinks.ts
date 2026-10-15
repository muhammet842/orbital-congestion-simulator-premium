/** SatNOGS Network page listing recent observations (with waterfalls and audio) of one satellite. */
export function satnogsObservationsUrl(noradId: number): string | null {
  if (!Number.isInteger(noradId) || noradId <= 0) return null;
  return `https://network.satnogs.org/observations/?norad=${noradId}`;
}

/**
 * SatNOGS stations mostly listen to amateur and open telemetry links, so the
 * observations link is only offered where SatNOGS is likely to have any:
 * a channel taken from the SatNOGS DB, or an amateur channel.
 */
export function satnogsLikelyObserved(frequencies: readonly { amateur?: boolean; sourceUrl?: string }[] | undefined): boolean {
  return (frequencies ?? []).some(
    (f) => f.amateur === true || (typeof f.sourceUrl === 'string' && f.sourceUrl.startsWith('https://db.satnogs.org/')),
  );
}
