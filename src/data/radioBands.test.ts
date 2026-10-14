import { describe, expect, it } from 'vitest';
import { BAND_IDS, BAND_RANGES, bandContains, isBandId, isModeFilter, modeClasses, parseMHz } from './radioBands';

describe('parseMHz', () => {
  it.each([
    ['145.825', [145.825]],
    ['145.935-145.995', [145.935, 145.995]],
    ['435.670-435.610', [435.67, 435.61]], // inverting transponder: downlink runs backwards
    ['450 (nominal)', [450]],
    ['145.925 / 436.680', [145.925, 436.68]],
    ['27500–29100 / 29500–30000', [27500, 29100, 29500, 30000]],
    ['465.9875MHz', [465.9875]],
    ['', []],
    ['—', []],
  ])('%s -> %j', (text, expected) => {
    expect(parseMHz(text)).toEqual(expected);
  });

  it('tolerates missing values and drops absurd numbers', () => {
    expect(parseMHz(undefined)).toEqual([]);
    expect(parseMHz(null)).toEqual([]);
    expect(parseMHz('999999999')).toEqual([]);
  });
});

describe('bands', () => {
  it('knows every preset and rejects junk ids', () => {
    expect(BAND_IDS.every(isBandId)).toBe(true);
    expect(isBandId('nope')).toBe(false);
    expect(isBandId(undefined)).toBe(false);
  });

  it('matches typical hobbyist frequencies', () => {
    expect(bandContains('ham2m', [145.8])).toBe(true);
    expect(bandContains('ham2m', [437.8])).toBe(false);
    expect(bandContains('ham70cm', [437.8])).toBe(true);
    expect(bandContains('vhf137', [137.1, 137.9125])).toBe(true);
    expect(bandContains('uhf400', [401.7])).toBe(true);
    expect(bandContains('easy', [137.1])).toBe(true);
    expect(bandContains('easy', [1575.42])).toBe(false); // GPS L1: needs a dish/preamp
    expect(bandContains('dish', [1575.42])).toBe(true);
    expect(bandContains('easy', [12000])).toBe(false); // Ku band
    expect(bandContains('all', [12000])).toBe(true);
  });

  it('includes band edges', () => {
    expect(bandContains('ham2m', [BAND_RANGES.ham2m.minMHz])).toBe(true);
    expect(bandContains('ham2m', [BAND_RANGES.ham2m.maxMHz])).toBe(true);
  });

  it('matches if ANY of several frequencies is inside', () => {
    expect(bandContains('ham70cm', [145.925, 436.68])).toBe(true);
    expect(bandContains('ham70cm', [])).toBe(false);
  });
});

describe('modeClasses', () => {
  it.each([
    ['FM', ['fm']],
    ['FMN · 12500 baud', ['fm', 'digital']],
    ['FM · CTCSS 67.0 Hz', ['fm']],
    ['AFSK · 1200 baud', ['digital']],
    ['FM · 1200 bps packet', ['fm', 'digital']],
    ['SSB CW*', ['cw', 'ssb']],
    ['LSB / USB', ['ssb']],
    ['USB', ['ssb']],
    ['CW · 25 baud', ['cw', 'digital']],
    ['BPSK PMT-A3 · 800 baud', ['digital']],
    ['9k6 GFSK/G3RUH', ['digital']],
    ['MSK AX.100 Mode 5 · 2400 baud', ['digital']],
    ['SSTV', ['other']],
    ['', ['other']],
  ])('%s -> %j', (mode, expected) => {
    expect(modeClasses(mode)).toEqual(expected);
  });

  it('does not mistake FSK/GFSK for FM', () => {
    expect(modeClasses('GFSK')).not.toContain('fm');
    expect(modeClasses('FSK')).not.toContain('fm');
  });

  it('validates the mode filter', () => {
    expect(isModeFilter('fm')).toBe(true);
    expect(isModeFilter('all')).toBe(true);
    expect(isModeFilter('other')).toBe(false);
    expect(isModeFilter(5)).toBe(false);
  });
});
