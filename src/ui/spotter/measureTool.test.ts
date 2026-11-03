// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLang } from '../../i18n/i18n';
import type { SensorSnapshot } from '../observerSensors';
import { describeDevice } from './deviceInfo';
import {
  bindMeasureTool,
  loadMeasurements,
  measureModeEnabled,
  measurementFrom,
  measurementsCsv,
  measureToolHtml,
  updateMeasureTool,
} from './measureTool';

const sensors = (over: Partial<SensorSnapshot> = {}): SensorSnapshot => ({
  location: { latitudeDeg: 40.88765, longitudeDeg: 29.30012, altitudeKm: 0.035 },
  locationSource: 'gps',
  locationError: null,
  accuracyMeters: 6,
  headingDeg: 48.456,
  headingReliable: true,
  headingSource: 'absolute',
  pitchDeg: 3.14,
  declinationDeg: 5.93,
  headingError: null,
  orientationPermission: 'granted',
  ...over,
});
/** What Spotter's sensors report when they stop trusting the compass: no direction at all. */
const untrusted = (headingError = 'needs_compass') =>
  sensors({ headingDeg: null, headingReliable: false, headingSource: null, headingError });

const PIXEL = 'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UQ1A.240205.004) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

beforeEach(() => {
  setLang('en');
  localStorage.clear();
  document.body.innerHTML = '';
});
afterEach(() => localStorage.clear());

describe('measureModeEnabled', () => {
  it('is on only with ?spotter=measure', () => {
    expect(measureModeEnabled('')).toBe(false);
    expect(measureModeEnabled('?spotter=on')).toBe(false);
    expect(measureModeEnabled('?object=25544&spotter=measure')).toBe(true);
  });
});

describe('measurementFrom', () => {
  it('keeps the full values, rounded only when written out', () => {
    const r = measurementFrom(sensors(), new Date('2026-11-05T11:10:07Z'))!;
    expect(r).toMatchObject({ utc: '2026-11-05T11:10:07.000Z', headingDeg: 48.456, pitchDeg: 3.14, headingSource: 'absolute', headingTrusted: true, compassState: '' });
  });

  it('keeps a reading while the compass is not trusted: the tilt, no direction, and why', () => {
    const r = measurementFrom(untrusted('stale'), new Date())!;
    expect(r).toMatchObject({ headingDeg: null, pitchDeg: 3.14, headingTrusted: false, compassState: 'stale', headingSource: '' });
  });

  it('never saves a direction Spotter itself does not trust', () => {
    // headingReliable false with a leftover number: the number is not kept.
    expect(measurementFrom(sensors({ headingReliable: false }), new Date())!.headingDeg).toBeNull();
  });

  it('saves nothing when there is neither a direction nor a tilt', () => {
    expect(measurementFrom(sensors({ headingDeg: null, headingReliable: false, pitchDeg: null }), new Date())).toBeNull();
  });
});

describe('measurementsCsv', () => {
  const records = [
    measurementFrom(sensors(), new Date('2026-11-05T11:10:07Z'), describeDevice(PIXEL))!,
    measurementFrom(untrusted(), new Date('2026-11-05T11:11:00Z'), describeDevice(IPHONE))!,
  ];
  const csv = measurementsCsv(records);
  const lines = csv.replace(/^\uFEFF/, '').trim().split('\r\n');
  const header = lines[0].split(';');
  const cell = (row: number, column: string) => {
    // The User-Agent is quoted and contains semicolons; it is the last column, so split before it.
    const fields = lines[row].slice(0, lines[row].lastIndexOf(';"')).split(';');
    return fields[header.indexOf(column)];
  };

  it('starts with a UTF-8 mark for Excel and quotes the User-Agent, which contains semicolons', () => {
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain(`"${PIXEL}"`);
  });

  it('writes the phone, operating system, platform, browser and compass source on every row', () => {
    expect([cell(1, 'telefon'), cell(1, 'isletim_sistemi'), cell(1, 'platform'), cell(1, 'tarayici'), cell(1, 'pusula_kaynagi')])
      .toEqual(['Pixel 7', 'Android 14', 'Android', 'Chrome 130', 'absolute']);
    expect([cell(2, 'telefon'), cell(2, 'isletim_sistemi'), cell(2, 'platform'), cell(2, 'tarayici')])
      .toEqual(['iPhone', 'iOS 17.5', 'iOS', 'Safari 17']);
  });

  it('marks a reading taken while the compass was not trusted, with an empty direction', () => {
    expect([cell(1, 'pusula_guvenilir'), cell(1, 'telefon_azimut')]).toEqual(['evet', '48,5']);
    expect([cell(2, 'pusula_guvenilir'), cell(2, 'pusula_durumu'), cell(2, 'telefon_azimut'), cell(2, 'telefon_yukseklik')])
      .toEqual(['hayir', 'needs_compass', '', '3,1']);
  });
});

describe('the readout', () => {
  function mount(current: SensorSnapshot) {
    const root = document.createElement('div');
    root.innerHTML = measureToolHtml();
    document.body.appendChild(root);
    let now = current;
    bindMeasureTool(root, () => now);
    updateMeasureTool(root, now);
    return { root, set: (s: SensorSnapshot) => ((now = s), updateMeasureTool(root, s)) };
  }
  const click = (root: HTMLElement, id: string) => root.querySelector<HTMLButtonElement>(`#${id}`)!.click();
  const text = (root: HTMLElement, id: string) => root.querySelector(`#${id}`)!.textContent;

  it('shows direction and tilt to one decimal, with the compass details', () => {
    const { root } = mount(sensors());
    expect(text(root, 'spotter-measure-heading')).toBe('48.5°');
    expect(text(root, 'spotter-measure-tilt')).toBe('3.1°');
    expect(text(root, 'spotter-measure-details')).toBe('Compass: absolute · Mag 5.9° · GPS ±6 m');
  });

  it('saves readings that survive a reload, and can remove the last one', () => {
    const { root } = mount(sensors());
    expect(root.querySelector<HTMLButtonElement>('#spotter-measure-download')!.disabled).toBe(true);
    click(root, 'spotter-measure-save');
    click(root, 'spotter-measure-save');
    expect(text(root, 'spotter-measure-count')).toBe('Saved: 2');
    expect(loadMeasurements()).toHaveLength(2);
    expect(root.querySelector<HTMLButtonElement>('#spotter-measure-download')!.disabled).toBe(false);

    click(root, 'spotter-measure-undo');
    expect(text(root, 'spotter-measure-count')).toBe('Saved: 1');
    expect(loadMeasurements()).toHaveLength(1);
  });

  it('still saves while the compass is not trusted, says so, and marks the row', () => {
    const { root, set } = mount(sensors());
    set(untrusted());
    expect(text(root, 'spotter-measure-heading')).toBe('—');
    expect(text(root, 'spotter-measure-details')).toBe('Compass not trusted (needs_compass). Save keeps the tilt and marks the row.');
    expect(root.querySelector('#spotter-measure')!.classList.contains('spotter-measure--untrusted')).toBe(true);
    expect(root.querySelector<HTMLButtonElement>('#spotter-measure-save')!.disabled).toBe(false);

    click(root, 'spotter-measure-save');
    expect(loadMeasurements()[0]).toMatchObject({ headingTrusted: false, headingDeg: null, compassState: 'needs_compass' });

    set(sensors());
    expect(root.querySelector('#spotter-measure')!.classList.contains('spotter-measure--untrusted')).toBe(false);
  });

  it('cannot save when there is neither a direction nor a tilt', () => {
    const { root, set } = mount(sensors());
    set(sensors({ headingDeg: null, headingReliable: false, pitchDeg: null }));
    expect(root.querySelector<HTMLButtonElement>('#spotter-measure-save')!.disabled).toBe(true);
  });

  it('reads readings saved before device details were recorded', () => {
    localStorage.setItem(
      'orbital-spotter-measurements-v1',
      JSON.stringify([{ utc: '2026-11-03T10:48:44.346Z', headingDeg: 54.6, pitchDeg: 2, headingSource: 'absolute', declinationDeg: 6.1, gpsAccuracyM: 6, latitudeDeg: 40.9, longitudeDeg: 29.3, browser: PIXEL }]),
    );
    expect(loadMeasurements()[0]).toMatchObject({ headingTrusted: true, compassState: '', device: { platform: 'Android', model: 'Pixel 7' } });
  });
});
