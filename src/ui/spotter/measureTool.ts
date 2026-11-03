/**
 * Spotter measurement readout for research/spotter/PROTOCOL.md, shown only
 * with `?spotter=measure`. It shows the direction and tilt Spotter uses for
 * its cues (the back camera's true-north azimuth and elevation) to one
 * decimal, and saves readings on this device to download as a CSV laid out
 * like the protocol's sheet. Nothing changes without the flag.
 */
import { t } from '../../i18n/i18n';
import type { SensorSnapshot } from '../observerSensors';

const STORAGE_KEY = 'orbital-spotter-measurements-v1';

/** True when the address asks for the measurement readout (`?spotter=measure`). */
export function measureModeEnabled(search = globalThis.location?.search ?? ''): boolean {
  return new URLSearchParams(search).get('spotter') === 'measure';
}

/** One saved reading: what the phone reported at the moment Save was pressed. */
export interface MeasurementRecord {
  utc: string;
  headingDeg: number;
  pitchDeg: number;
  headingSource: string;
  declinationDeg: number | null;
  gpsAccuracyM: number | null;
  latitudeDeg: number | null;
  longitudeDeg: number | null;
  browser: string;
}

/** A reading from the sensors, or null when there is no trusted direction and tilt to save. */
export function measurementFrom(sensors: SensorSnapshot, now: Date, browser = ''): MeasurementRecord | null {
  if (!sensors.headingReliable || sensors.headingDeg == null || sensors.pitchDeg == null) return null;
  return {
    utc: now.toISOString(),
    headingDeg: sensors.headingDeg,
    pitchDeg: sensors.pitchDeg,
    headingSource: sensors.headingSource ?? '',
    declinationDeg: sensors.declinationDeg,
    gpsAccuracyM: sensors.accuracyMeters,
    latitudeDeg: sensors.location?.latitudeDeg ?? null,
    longitudeDeg: sensors.location?.longitudeDeg ?? null,
    browser,
  };
}

/** The protocol sheet's columns (research/spotter/data/olcum-sablonu.csv), then extra columns. */
const SHEET_COLUMNS = [
  'olcum_no', 'tarih_saat', 'telefon', 'tarayici', 'hedef_turu', 'hedef_adi',
  'gozlemci_enlem', 'gozlemci_boylam', 'gozlemci_yukseklik_m', 'hedef_enlem', 'hedef_boylam', 'hedef_yukseklik_m',
  'gercek_azimut', 'gercek_yukseklik', 'telefon_azimut', 'telefon_yukseklik', 'gps_dogruluk_m', 'mag_sapma',
  'kalibrasyon', 'ortam', 'tutus', 'notlar',
];
const EXTRA_COLUMNS = ['utc_saat', 'pusula_kaynagi', 'gps_enlem', 'gps_boylam'];

/** Decimal comma, as a Turkish Excel expects next to semicolons; empty when unknown. */
function decimal(value: number | null, digits: number): string {
  return value == null || !Number.isFinite(value) ? '' : value.toFixed(digits).replace('.', ',');
}

function quoted(value: string): string {
  return /[;"\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** "2026-11-05 14:10:07" in the phone's own time zone. */
function localTime(utc: string): string {
  const d = new Date(utc);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * The saved readings as a semicolon CSV with the protocol sheet's columns.
 * The phone fills the columns it knows; target, true direction and
 * conditions are left empty to fill in Excel. GPS position goes in the extra
 * columns, not the observer columns: the protocol takes the observer's place
 * from the map, which is more exact than the phone's GPS.
 */
export function measurementsCsv(records: readonly MeasurementRecord[]): string {
  const rows = records.map((r, i) => {
    const sheet: Record<string, string> = {
      olcum_no: String(i + 1),
      tarih_saat: localTime(r.utc),
      tarayici: r.browser,
      telefon_azimut: decimal(r.headingDeg, 1),
      telefon_yukseklik: decimal(r.pitchDeg, 1),
      gps_dogruluk_m: decimal(r.gpsAccuracyM, 0),
      mag_sapma: decimal(r.declinationDeg, 1),
      utc_saat: r.utc,
      pusula_kaynagi: r.headingSource,
      gps_enlem: decimal(r.latitudeDeg, 6),
      gps_boylam: decimal(r.longitudeDeg, 6),
    };
    return [...SHEET_COLUMNS, ...EXTRA_COLUMNS].map((c) => quoted(sheet[c] ?? '')).join(';');
  });
  // The BOM makes Excel read the file as UTF-8.
  return `\uFEFF${[[...SHEET_COLUMNS, ...EXTRA_COLUMNS].join(';'), ...rows].join('\r\n')}\r\n`;
}

export function loadMeasurements(): MeasurementRecord[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? (parsed as MeasurementRecord[]) : [];
  } catch {
    return [];
  }
}

function storeMeasurements(records: readonly MeasurementRecord[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch {
    // Storage full or blocked: the readings stay in memory until the page closes.
  }
}

let records: MeasurementRecord[] = [];

/** The readout's markup, placed in the Spotter panel when measureModeEnabled(). */
export function measureToolHtml(): string {
  return `
    <section class="spotter-measure" id="spotter-measure" aria-labelledby="spotter-measure-title">
      <h3 class="spotter-measure-title" id="spotter-measure-title">${t('spotter.measure_title')}</h3>
      <div class="spotter-measure-values" aria-live="off">
        <div><span class="spotter-measure-label">${t('spotter.measure_heading')}</span><span class="spotter-measure-value" id="spotter-measure-heading">—</span></div>
        <div><span class="spotter-measure-label">${t('spotter.measure_tilt')}</span><span class="spotter-measure-value" id="spotter-measure-tilt">—</span></div>
      </div>
      <p class="spotter-measure-details" id="spotter-measure-details"></p>
      <div class="spotter-measure-actions">
        <button type="button" class="spotter-btn" id="spotter-measure-save">${t('spotter.measure_save')}</button>
        <button type="button" class="spotter-btn spotter-btn--secondary" id="spotter-measure-download">${t('spotter.measure_download')}</button>
        <button type="button" class="spotter-btn spotter-btn--secondary" id="spotter-measure-undo">${t('spotter.measure_undo')}</button>
        <button type="button" class="spotter-btn spotter-btn--secondary" id="spotter-measure-clear">${t('spotter.measure_clear')}</button>
      </div>
      <p class="spotter-measure-count" id="spotter-measure-count" aria-live="polite"></p>
    </section>`;
}

/** Wires the buttons; `sensors` gives the reading at the moment Save is pressed. */
export function bindMeasureTool(root: ParentNode, sensors: () => SensorSnapshot): void {
  records = loadMeasurements();
  const button = (id: string) => root.querySelector<HTMLButtonElement>(`#${id}`);
  button('spotter-measure-save')?.addEventListener('click', () => {
    const record = measurementFrom(sensors(), new Date(), navigator.userAgent);
    if (!record) return;
    records = [...records, record];
    storeMeasurements(records);
    updateCount(root, true);
  });
  button('spotter-measure-undo')?.addEventListener('click', () => {
    records = records.slice(0, -1);
    storeMeasurements(records);
    updateCount(root, false);
  });
  button('spotter-measure-clear')?.addEventListener('click', () => {
    if (records.length === 0 || !window.confirm(t('spotter.measure_clear_confirm').replace('{n}', String(records.length)))) return;
    records = [];
    storeMeasurements(records);
    updateCount(root, false);
  });
  button('spotter-measure-download')?.addEventListener('click', () => {
    if (records.length === 0) return;
    const url = URL.createObjectURL(new Blob([measurementsCsv(records)], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `spotter-olcumler-${localTime(new Date().toISOString()).replace(/[: ]/g, '-')}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  updateCount(root, false);
}

function updateCount(root: ParentNode, justSaved: boolean): void {
  const count = root.querySelector('#spotter-measure-count');
  if (count) count.textContent = t('spotter.measure_saved').replace('{n}', String(records.length));
  if (justSaved && count) {
    // A short highlight on the count, so a press in the field is clearly confirmed.
    count.classList.add('spotter-measure-count--flash');
    setTimeout(() => count.classList.remove('spotter-measure-count--flash'), 600);
  }
  for (const id of ['spotter-measure-download', 'spotter-measure-undo', 'spotter-measure-clear']) {
    const b = root.querySelector<HTMLButtonElement>(`#${id}`);
    if (b) b.disabled = records.length === 0;
  }
}

const deg = (v: number) => `${v.toFixed(1)}°`;

/** Refreshes the readout from the current sensors (called on the panel's 100 ms tick). */
export function updateMeasureTool(root: ParentNode, sensors: SensorSnapshot): void {
  const heading = root.querySelector('#spotter-measure-heading');
  if (!heading) return;
  const reading = measurementFrom(sensors, new Date());
  heading.textContent = reading ? deg(reading.headingDeg) : '—';
  const tilt = root.querySelector('#spotter-measure-tilt');
  if (tilt) tilt.textContent = sensors.pitchDeg != null ? deg(sensors.pitchDeg) : '—';
  const details = root.querySelector('#spotter-measure-details');
  if (details) {
    details.textContent = reading
      ? t('spotter.measure_details')
          .replace('{source}', reading.headingSource || '—')
          .replace('{mag}', reading.declinationDeg != null ? reading.declinationDeg.toFixed(1) : '—')
          .replace('{gps}', reading.gpsAccuracyM != null ? reading.gpsAccuracyM.toFixed(0) : '—')
      : t('spotter.measure_no_compass');
  }
  const save = root.querySelector<HTMLButtonElement>('#spotter-measure-save');
  if (save) save.disabled = !reading;
}
