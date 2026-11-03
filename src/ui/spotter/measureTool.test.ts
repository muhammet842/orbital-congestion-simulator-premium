// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLang } from '../../i18n/i18n';
import type { SensorSnapshot } from '../observerSensors';
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
  it('saves nothing without a trusted direction and tilt', () => {
    const now = new Date();
    expect(measurementFrom(sensors({ headingReliable: false }), now)).toBeNull();
    expect(measurementFrom(sensors({ headingDeg: null }), now)).toBeNull();
    expect(measurementFrom(sensors({ pitchDeg: null }), now)).toBeNull();
  });

  it('keeps the full values, rounded only when written out', () => {
    const r = measurementFrom(sensors(), new Date('2026-11-05T11:10:07Z'), 'UA')!;
    expect(r).toMatchObject({ utc: '2026-11-05T11:10:07.000Z', headingDeg: 48.456, pitchDeg: 3.14, headingSource: 'absolute' });
  });
});

describe('measurementsCsv', () => {
  const records = [
    measurementFrom(sensors(), new Date('2026-11-05T11:10:07Z'), 'Mozilla/5.0 (Linux; Android 14)')!,
    measurementFrom(sensors({ headingDeg: 359.96, accuracyMeters: null }), new Date('2026-11-05T11:11:00Z'), 'x')!,
  ];

  it('writes decimal commas and quotes a browser name that contains a semicolon', () => {
    const csv = measurementsCsv(records);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('"Mozilla/5.0 (Linux; Android 14)"');
    expect(csv).toContain(';48,5;3,1;6;5,9;');
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

  it('cannot save while the compass is not trusted', () => {
    const { root, set } = mount(sensors());
    set(sensors({ headingReliable: false }));
    expect(text(root, 'spotter-measure-heading')).toBe('—');
    expect(root.querySelector<HTMLButtonElement>('#spotter-measure-save')!.disabled).toBe(true);
  });
});
