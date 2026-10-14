/**
 * Frequency bands and modes for the Radio panel.
 *
 * "Easy" follows a hobbyist's reality: anything from VHF up to ~500 MHz can be
 * heard with a simple handheld or small Yagi, while L/S-band needs a dish and
 * a preamp, and X/Ku/Ka-band is out of reach. Band edges are typical, not
 * legal: amateur allocations differ by region, so the presets are labelled as
 * ranges and are a search aid only.
 */

export type BandId = 'easy' | 'ham2m' | 'ham70cm' | 'uhf400' | 'vhf137' | 'dish' | 'all';

export const BAND_IDS: readonly BandId[] = ['easy', 'ham2m', 'ham70cm', 'uhf400', 'vhf137', 'dish', 'all'];

export const BAND_RANGES: Record<BandId, { minMHz: number; maxMHz: number }> = {
  easy: { minMHz: 30, maxMHz: 500 },
  ham2m: { minMHz: 144, maxMHz: 148 },
  ham70cm: { minMHz: 430, maxMHz: 440 },
  uhf400: { minMHz: 400, maxMHz: 406.5 },
  vhf137: { minMHz: 136, maxMHz: 138.5 },
  dish: { minMHz: 1000, maxMHz: 4000 },
  all: { minMHz: 0, maxMHz: Number.POSITIVE_INFINITY },
};

export function isBandId(value: unknown): value is BandId {
  return typeof value === 'string' && (BAND_IDS as readonly string[]).includes(value);
}

/** Every number in a published frequency string: "145.935-145.995", "450 (nominal)", "145.925 / 436.680". */
export function parseMHz(text: string | undefined | null): number[] {
  if (!text) return [];
  return (String(text).match(/\d+(?:\.\d+)?/g) ?? [])
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0 && n < 100_000);
}

/** True when any of the frequencies lies inside the band (edges included). */
export function bandContains(band: BandId, freqsMHz: readonly number[]): boolean {
  const { minMHz, maxMHz } = BAND_RANGES[band];
  return freqsMHz.some((f) => f >= minMHz && f <= maxMHz);
}

export type ModeClass = 'fm' | 'cw' | 'ssb' | 'digital' | 'other';
export type ModeFilter = 'all' | Exclude<ModeClass, 'other'>;

export const MODE_FILTERS: readonly ModeFilter[] = ['all', 'fm', 'cw', 'ssb', 'digital'];

export function isModeFilter(value: unknown): value is ModeFilter {
  return typeof value === 'string' && (MODE_FILTERS as readonly string[]).includes(value);
}

const DIGITAL =
  /(PSK|FSK|MSK|QAM|LORA|AX\.?25|AX\.?100|G3RUH|CCSDS|DSSS|OFDM|BAUD|BPS|PACKET|APRS)/;

/**
 * Classifies a published mode string. A channel can belong to several classes
 * ("FM · 1200 bps packet" is both FM and digital; "SSB CW*" is both SSB and CW).
 */
export function modeClasses(mode: string | undefined | null): ModeClass[] {
  const m = String(mode ?? '').toUpperCase();
  const classes: ModeClass[] = [];
  if (/\bFMN?\b/.test(m)) classes.push('fm');
  if (/\bCW\b/.test(m)) classes.push('cw');
  if (/\b(SSB|USB|LSB)\b/.test(m)) classes.push('ssb');
  if (DIGITAL.test(m)) classes.push('digital');
  return classes.length ? classes : ['other'];
}
