/**
 * Radio panel: find satellites a hobbyist can actually receive.
 *
 * A header button opens a modal. First-time visitors see one choice, "Over me
 * now | All satellites" (the location comes from the Spotter's store or a
 * one-shot "Use my location"), a search and the list. Band / mode / amateur /
 * minimum elevation sit in a folded "Filters" section, the data notes in a
 * folded "About this data". CSV export and a shareable link that carries the
 * filters. Everything runs in the browser from the catalog's radio data;
 * nothing is sent anywhere.
 *
 * Accessibility: the dialog is labelled, chips are toggle buttons, and no live
 * region is rewritten on a timer (elevations refresh quietly every 10 s).
 */
import { onLangChange, t } from '../i18n/i18n';
import { getState, selectObject } from '../state/appState';
import { BAND_IDS, BAND_RANGES, MODE_FILTERS, type BandId, type ModeFilter } from '../data/radioBands';
import {
  DEFAULT_RADIO_FILTERS,
  buildCsv,
  buildRadioIndex,
  filterRadioEntries,
  formatMHz,
  radioFiltersFromSearch,
  radioLinkSearch,
  receiveFrequencies,
  type CsvExtras,
  type RadioEntry,
  type RadioFilters,
  type RadioMatch,
} from '../data/radioIndex';
import { computeLookAngles, findNextPass, type ObserverLocation, type PassEvent } from '../orbital/lookAngles';
import { closeKesslerPanel } from './KesslerPanel';
import { getSensorSnapshot, setManualLocation } from './observerSensors';
import { formatGroundPosition } from '../orbital/groundPosition';
import { satnogsLikelyObserved, satnogsObservationsUrl } from '../data/satnogsLinks';
import { escapeHtml, safeHttpUrl } from './escapeHtml';
import { icon } from './icons';
import { attachModalKeyboard } from './modalKeyboard';

const MAX_ROWS = 150;
const REFRESH_MS = 10_000;
const PASS_HORIZON_HOURS = 12;
const PASS_CACHE_MS = 10 * 60_000;
const PASS_CHUNK = 5;

/** Why there is no location yet; each failure gets its own explanation. */
type LocationState = 'idle' | 'busy' | 'denied' | 'unavailable' | 'timeout' | 'unsupported' | 'invalid';

let backdropEl: HTMLElement | null = null;
let panelEl: HTMLElement | null = null;
/** Ends the window's keyboard handling and gives focus back (see modalKeyboard.ts). */
let detachKeyboard: (() => void) | null = null;

let filters: RadioFilters = { ...DEFAULT_RADIO_FILTERS };
let visibleNow = false;
/** Minimum elevation (degrees) for "above my horizon"; 5° is a realistic hobby antenna. */
let minElevDeg = 5;
const MIN_ELEVATION_CHOICES = [0, 5, 10, 15];
let locationState: LocationState = 'idle';
/** The folded "Filters" and "About this data" sections (kept across re-renders). */
let filtersOpen = false;
let aboutOpen = false;
let index: RadioEntry[] = [];

let matches: RadioMatch[] = [];
let elevations = new Map<number, number>();
const passCache = new Map<number, { at: number; pass: PassEvent | null }>();
let passRun = 0;
let refreshTimer: number | undefined;
let passTimer: number | undefined;
let linkFeedbackTimer: number | undefined;

// ── helpers ──────────────────────────────────────────────────────────────────

function observerLocation(): ObserverLocation | null {
  return getSensorSnapshot().location;
}

function rangeTitle(band: BandId): string {
  const { minMHz, maxMHz } = BAND_RANGES[band];
  return Number.isFinite(maxMHz) ? `${minMHz}–${maxMHz} MHz` : '';
}

function formatIn(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  const h = (n: number | string): string => t('dur.h').replace('{n}', String(n));
  const m = (n: number | string): string => t('dur.m').replace('{n}', String(n));
  if (minutes >= 60) return `${h(Math.floor(minutes / 60))} ${m(String(minutes % 60).padStart(2, '0'))}`;
  return m(minutes);
}

function fill(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce((s, [k, v]) => s.replace(`{${k}}`, String(v)), template);
}

function filtersAreDefault(): boolean {
  return (
    filters.band === DEFAULT_RADIO_FILTERS.band &&
    filters.mode === DEFAULT_RADIO_FILTERS.mode &&
    filters.amateurOnly === DEFAULT_RADIO_FILTERS.amateurOnly
  );
}

/** "Easy · VHF/UHF, FM, Amateur only": what the folded Filters section is set to. */
function filterSummary(): string {
  const parts = [t(`radio.band.${filters.band}`), t(`radio.mode.${filters.mode}`)];
  if (filters.amateurOnly) parts.push(t('radio.amateur_only'));
  return parts.join(', ');
}

// ── data ─────────────────────────────────────────────────────────────────────

/** Recomputes `matches` (and elevations) from the current filters. */
function computeMatches(): void {
  const objects = getState().objects;
  let result = filterRadioEntries(index, filters);
  const observer = observerLocation();
  elevations = new Map();

  if (observer) {
    const now = new Date();
    for (const m of result) {
      const sat = objects[m.entry.index]?.satrec;
      const look = sat ? computeLookAngles(sat, observer, now) : null;
      if (look) elevations.set(m.entry.noradId, look.elevationDeg);
    }
    if (visibleNow) {
      result = result
        .filter((m) => (elevations.get(m.entry.noradId) ?? -90) >= minElevDeg)
        .sort((a, b) => (elevations.get(b.entry.noradId) ?? -90) - (elevations.get(a.entry.noradId) ?? -90));
    }
  }
  // No location yet: listing every satellite here would look as if the filter
  // did nothing. The hint above the list asks for the location instead.
  if (visibleNow && !observer) result = [];
  matches = result;
}

function whenText(entry: RadioEntry): string {
  const elevation = elevations.get(entry.noradId);
  if (elevation != null && elevation >= minElevDeg && elevation > 0) return `▲ ${Math.round(elevation)}°`;
  const cached = passCache.get(entry.noradId);
  const rise = cached?.pass?.rise?.time;
  if (rise) {
    const max = Math.round(cached?.pass?.max?.elevationDeg ?? 0);
    return fill(t('radio.rises'), { t: formatIn(rise.getTime() - Date.now()), deg: max });
  }
  return '';
}

/** Next passes for the rows on screen, a few per tick so the page never stalls. */
function schedulePasses(): void {
  window.clearTimeout(passTimer);
  passRun += 1;
  const run = passRun;
  const observer = observerLocation();
  if (!observer) return;

  const now = Date.now();
  const objects = getState().objects;
  const todo = matches
    .slice(0, MAX_ROWS)
    .filter((m) => (elevations.get(m.entry.noradId) ?? -90) < Math.max(minElevDeg, 0.001))
    .filter((m) => {
      const cached = passCache.get(m.entry.noradId);
      return !cached || now - cached.at > PASS_CACHE_MS;
    });

  const step = (): void => {
    if (run !== passRun || !panelEl) return;
    for (const m of todo.splice(0, PASS_CHUNK)) {
      const sat = objects[m.entry.index]?.satrec;
      const pass = sat ? findNextPass(sat, observer, new Date(), PASS_HORIZON_HOURS, 60) : null;
      passCache.set(m.entry.noradId, { at: Date.now(), pass });
      const cell = panelEl.querySelector<HTMLElement>(`[data-when="${m.entry.noradId}"]`);
      if (cell) cell.textContent = whenText(m.entry);
    }
    if (todo.length > 0) passTimer = window.setTimeout(step, 0);
  };
  passTimer = window.setTimeout(step, 0);
}

// ── rendering ────────────────────────────────────────────────────────────────

function chipsHtml(): { bands: string; modes: string } {
  const bands = BAND_IDS.map((id) => {
    const on = filters.band === id;
    return `<button type="button" class="radio-chip${on ? ' radio-chip--on' : ''}" data-band="${id}" aria-pressed="${on}" title="${escapeHtml(rangeTitle(id))}">${escapeHtml(t(`radio.band.${id}`))}</button>`;
  }).join('');
  const modes = MODE_FILTERS.map((id) => {
    const on = filters.mode === id;
    return `<button type="button" class="radio-chip${on ? ' radio-chip--on' : ''}" data-mode="${id}" aria-pressed="${on}">${escapeHtml(t(`radio.mode.${id}`))}</button>`;
  }).join('');
  return { bands, modes };
}

function renderChips(): void {
  if (!panelEl) return;
  const { bands, modes } = chipsHtml();
  const bandEl = panelEl.querySelector('#radio-bands');
  const modeEl = panelEl.querySelector('#radio-modes');
  if (bandEl) bandEl.innerHTML = bands;
  if (modeEl) modeEl.innerHTML = modes;
  const modeHint = panelEl.querySelector('#radio-mode-hint');
  if (modeHint) modeHint.textContent = t(`radio.mode_hint.${filters.mode}`);
  const summary = panelEl.querySelector('#radio-filter-summary');
  if (summary) summary.textContent = filterSummary();
}

function renderScope(): void {
  panelEl?.querySelectorAll<HTMLButtonElement>('button[data-scope]').forEach((btn) => {
    const on = (btn.dataset.scope === 'now') === visibleNow;
    btn.classList.toggle('radio-scope-btn--on', on);
    btn.setAttribute('aria-pressed', String(on));
  });
}

const LOCATION_MESSAGES: Record<LocationState, string> = {
  idle: 'radio.location_needed',
  busy: 'radio.location_needed',
  denied: 'radio.location_denied',
  unavailable: 'radio.location_unavailable',
  timeout: 'radio.location_timeout',
  unsupported: 'radio.location_unsupported',
  invalid: 'radio.manual_invalid',
};

function renderLocationHint(): void {
  const el = panelEl?.querySelector('#radio-location');
  if (!el) return;
  if (!visibleNow) {
    el.innerHTML = '';
    return;
  }
  const observer = observerLocation();
  if (observer && locationState === 'idle') {
    const pos = formatGroundPosition(observer.latitudeDeg, observer.longitudeDeg);
    el.innerHTML = `<p class="muted radio-location-note">${icon('pin', 15)}<span>${escapeHtml(fill(t('radio.your_location'), { pos }))}</span> <button type="button" class="radio-link-btn" data-action="locate">${escapeHtml(t('radio.update_location'))}</button></p>`;
    return;
  }
  const busy = locationState === 'busy';
  const button =
    locationState === 'unsupported'
      ? ''
      : `<button type="button" class="radio-link-btn" data-action="locate"${busy ? ' disabled' : ''}>${escapeHtml(t(busy ? 'radio.locating' : 'radio.use_location'))}</button>`;
  // Typing coordinates always works, even on a computer with no location service.
  const manual = `
    <form class="radio-manual" id="radio-manual" novalidate>
      <span class="radio-manual-label">${escapeHtml(t('radio.manual_label'))}</span>
      <input type="text" inputmode="decimal" id="radio-lat" aria-label="${escapeHtml(t('radio.manual_lat'))}" placeholder="${escapeHtml(t('radio.manual_lat'))} (41.01)" autocomplete="off" />
      <input type="text" inputmode="decimal" id="radio-lon" aria-label="${escapeHtml(t('radio.manual_lon'))}" placeholder="${escapeHtml(t('radio.manual_lon'))} (28.97)" autocomplete="off" />
      <button type="submit" class="radio-link-btn">${escapeHtml(t('radio.manual_set'))}</button>
    </form>`;
  el.innerHTML = `<p class="muted radio-location-note">${escapeHtml(t(LOCATION_MESSAGES[locationState]))} ${button}</p>${manual}`;
}

function rowHtml(m: RadioMatch): string {
  const { entry, channels } = m;
  // Several channels can share a frequency and mode (different services): show each line once.
  const unique = [
    ...new Set(
      channels.map((ch) => `${receiveFrequencies(ch, filters.band).slice(0, 2).map(formatMHz).join(' / ')} MHz · ${ch.mode}`),
    ),
  ];
  const lines = unique.slice(0, 2).map((text) => `<span class="radio-row-line">${escapeHtml(text)}</span>`);
  const extra = unique.length - 2;
  if (extra > 0) lines.push(`<span class="radio-row-line">${escapeHtml(fill(t('radio.more'), { n: extra }))}</span>`);
  const badge = channels.some((c) => c.amateur === true)
    ? ` <span class="radio-badge">${escapeHtml(t('sat.radio_amateur'))}</span>`
    : '';
  const sourceUrl = channels.map((c) => safeHttpUrl(c.sourceUrl)).find((u) => u !== '#');
  const obsUrl = satnogsLikelyObserved(channels) ? satnogsObservationsUrl(entry.noradId) : null;
  return `
    <li class="radio-row">
      <button type="button" class="radio-row-main" data-index="${entry.index}">
        <span class="radio-row-name">${escapeHtml(entry.name)}${badge}</span>
        ${lines.join('')}
      </button>
      <span class="radio-row-when" data-when="${entry.noradId}">${escapeHtml(whenText(entry))}</span>
      ${obsUrl ? `<a class="radio-row-obs" href="${escapeHtml(obsUrl)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(t('radio.observations_title'))}" aria-label="${escapeHtml(t('radio.observations_title'))}: ${escapeHtml(entry.name)}">SatNOGS</a>` : ''}
      ${sourceUrl ? `<a class="radio-row-src" href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(t('sat.radio_source'))}" title="${escapeHtml(t('sat.radio_source'))}">↗</a>` : ''}
    </li>`;
}

function renderResults(): void {
  if (!panelEl) return;
  computeMatches();

  const channelCount = matches.reduce((n, m) => n + m.channels.length, 0);
  const summary = panelEl.querySelector('#radio-summary');
  if (summary) {
    summary.textContent = fill(t('radio.count'), { sats: matches.length, channels: channelCount });
  }
  const actions = panelEl.querySelectorAll<HTMLButtonElement>('[data-action="export"]');
  actions.forEach((btn) => { btn.disabled = matches.length === 0; });

  const list = panelEl.querySelector('#radio-list');
  if (!list) return;
  if (matches.length === 0) {
    const emptyKey = visibleNow && !observerLocation() ? 'radio.list_needs_location' : 'radio.empty';
    list.innerHTML = `<li class="radio-empty muted">${escapeHtml(t(emptyKey))}</li>`;
  } else {
    const shown = matches.slice(0, MAX_ROWS);
    list.innerHTML =
      shown.map(rowHtml).join('') +
      (matches.length > shown.length
        ? `<li class="radio-empty muted">${escapeHtml(fill(t('radio.capped'), { n: shown.length }))}</li>`
        : '');
  }
  schedulePasses();
}

function renderShell(): void {
  if (!panelEl) return;
  const searchValue = panelEl.querySelector<HTMLInputElement>('#radio-search')?.value ?? filters.query;
  const { bands, modes } = chipsHtml();

  panelEl.innerHTML = `
    <div class="modal-header">
      <div class="modal-title" id="radio-title">${escapeHtml(t('radio.title'))}</div>
      <button type="button" class="modal-close" id="radio-close" aria-label="${escapeHtml(t('radio.close'))}" title="${escapeHtml(t('radio.close'))}">${icon('close')}</button>
    </div>
    <div class="modal-body radio-body">
      <p class="radio-lede muted">${escapeHtml(t('radio.lede'))}</p>

      <!-- The question most visitors have first: what can I hear from here, now? -->
      <div class="radio-scope" role="group" aria-label="${escapeHtml(t('radio.scope_label'))}">
        <button type="button" class="radio-scope-btn" data-scope="now" aria-pressed="false">${escapeHtml(t('radio.scope_now'))}</button>
        <button type="button" class="radio-scope-btn" data-scope="all" aria-pressed="false">${escapeHtml(t('radio.scope_all'))}</button>
      </div>
      <div id="radio-location" aria-live="polite"></div>

      <input type="search" id="radio-search" class="radio-search" placeholder="${escapeHtml(t('radio.search'))}" aria-label="${escapeHtml(t('radio.search'))}" value="${escapeHtml(searchValue)}" autocomplete="off" />

      <details class="radio-fold radio-filters" id="radio-filters"${filtersOpen ? ' open' : ''}>
        <summary>
          ${icon('chevronDown', 14)}
          <span class="radio-fold-title">${escapeHtml(t('radio.filters'))}</span>
          <span class="radio-filter-summary" id="radio-filter-summary">${escapeHtml(filterSummary())}</span>
        </summary>
        <div class="radio-fold-body">
          <div class="radio-group">
            <span class="radio-group-label" id="radio-band-label">${escapeHtml(t('radio.band_label'))}</span>
            <div class="radio-chips" id="radio-bands" role="group" aria-labelledby="radio-band-label">${bands}</div>
          </div>
          <div class="radio-group">
            <span class="radio-group-label" id="radio-mode-label">${escapeHtml(t('radio.mode_label'))}</span>
            <div class="radio-chips" id="radio-modes" role="group" aria-labelledby="radio-mode-label" aria-describedby="radio-mode-hint">${modes}</div>
            <p class="muted radio-hint" id="radio-mode-hint">${escapeHtml(t(`radio.mode_hint.${filters.mode}`))}</p>
          </div>
          <label class="radio-check"><input type="checkbox" id="radio-amateur"${filters.amateurOnly ? ' checked' : ''} /> ${escapeHtml(t('radio.amateur_only'))}</label>
          <div class="radio-group">
            <label class="radio-check radio-minelev"><span>${escapeHtml(t('radio.minelev'))}</span>
              <select id="radio-minelev" aria-describedby="radio-minelev-hint">${MIN_ELEVATION_CHOICES.map((d) => `<option value="${d}"${d === minElevDeg ? ' selected' : ''}>${d === 0 ? escapeHtml(t('radio.minelev_any')) : d + '°'}</option>`).join('')}</select>
            </label>
            <p class="muted radio-hint" id="radio-minelev-hint">${escapeHtml(t('radio.minelev_hint'))}</p>
          </div>
        </div>
      </details>

      <div class="radio-bar">
        <span class="radio-summary" id="radio-summary" role="status"></span>
        <span class="radio-actions">
          <button type="button" class="radio-action-btn" data-action="export" title="${escapeHtml(t('radio.export'))}" aria-label="${escapeHtml(t('radio.export'))}">${icon('download', 15)}<span>${escapeHtml(t('radio.export_short'))}</span></button>
          <button type="button" class="radio-action-btn" data-action="copy" id="radio-copy" title="${escapeHtml(t('radio.copy_link'))}">${icon('link', 15)}<span class="radio-copy-label">${escapeHtml(t('radio.copy_link'))}</span></button>
        </span>
      </div>

      <ul class="radio-list" id="radio-list"></ul>

      <details class="radio-fold radio-about" id="radio-about"${aboutOpen ? ' open' : ''}>
        <summary>${icon('info', 15)}<span class="radio-fold-title">${escapeHtml(t('radio.about'))}</span></summary>
        <div class="radio-fold-body">
          <p class="radio-note muted">${escapeHtml(t('radio.active_only'))}</p>
          <p class="radio-note muted">${escapeHtml(t('radio.note'))}</p>
          <p class="radio-note muted">${escapeHtml(t('radio.credit'))}</p>
        </div>
      </details>
    </div>
  `;
  // `toggle` does not bubble, so each fold gets its own listener.
  panelEl.querySelector('#radio-filters')?.addEventListener('toggle', (e) => {
    filtersOpen = (e.currentTarget as HTMLDetailsElement).open;
  });
  panelEl.querySelector('#radio-about')?.addEventListener('toggle', (e) => {
    aboutOpen = (e.currentTarget as HTMLDetailsElement).open;
  });
  renderScope();
  renderLocationHint();
  renderResults();
}

// ── actions ──────────────────────────────────────────────────────────────────

function setFilters(patch: Partial<RadioFilters>): void {
  filters = { ...filters, ...patch };
  renderChips();
  renderResults();
}

function exportCsv(): void {
  const extras = new Map<number, CsvExtras>();
  for (const m of matches) {
    const extra: CsvExtras = {};
    const el = elevations.get(m.entry.noradId);
    if (el != null) extra.elevationDeg = el;
    const rise = passCache.get(m.entry.noradId)?.pass?.rise?.time;
    if (rise) extra.nextPassUtc = rise.toISOString();
    if (extra.elevationDeg != null || extra.nextPassUtc) extras.set(m.entry.noradId, extra);
  }
  const csv = buildCsv(matches, extras);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `satellite-radio-${filters.band}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copyLink(): Promise<void> {
  const link = `${window.location.origin}${window.location.pathname}${radioLinkSearch(filters)}`;
  const button = panelEl?.querySelector<HTMLButtonElement>('#radio-copy');
  let ok = true;
  try {
    await navigator.clipboard.writeText(link);
  } catch {
    ok = false;
  }
  const label = button?.querySelector('.radio-copy-label');
  if (!label) return;
  label.textContent = t(ok ? 'radio.link_copied' : 'radio.link_failed');
  window.clearTimeout(linkFeedbackTimer);
  linkFeedbackTimer = window.setTimeout(() => {
    label.textContent = t('radio.copy_link');
  }, 2000);
}

/** One-shot location (never a continuous watch); saved the same way the Spotter saves it. */
function requestLocation(): void {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    locationState = 'unsupported';
    renderLocationHint();
    return;
  }
  locationState = 'busy';
  renderLocationHint();
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      setManualLocation({
        latitudeDeg: pos.coords.latitude,
        longitudeDeg: pos.coords.longitude,
        altitudeKm: (pos.coords.altitude ?? 0) / 1000,
      });
      locationState = 'idle';
      passCache.clear(); // passes depend on where you are
      renderLocationHint();
      renderResults();
    },
    (err) => {
      // 1 = blocked by the user/browser, 3 = took too long, anything else = the
      // device could not work out where it is (e.g. location services off).
      locationState = err?.code === 1 ? 'denied' : err?.code === 3 ? 'timeout' : 'unavailable';
      renderLocationHint();
      renderResults();
    },
    { enableHighAccuracy: false, timeout: 15_000, maximumAge: 600_000 },
  );
}

function onPanelClick(event: MouseEvent): void {
  const target = event.target as HTMLElement;
  const chip = target.closest<HTMLButtonElement>('button[data-band], button[data-mode]');
  if (chip?.dataset.band) return setFilters({ band: chip.dataset.band as BandId });
  if (chip?.dataset.mode) return setFilters({ mode: chip.dataset.mode as ModeFilter });
  const scope = target.closest<HTMLButtonElement>('button[data-scope]')?.dataset.scope;
  if (scope) return setVisibleNow(scope === 'now');

  if (target.closest('#radio-close')) return closeRadioPanel();

  const action = target.closest<HTMLButtonElement>('button[data-action]')?.dataset.action;
  if (action === 'export') return exportCsv();
  if (action === 'copy') return void copyLink();
  if (action === 'locate') return requestLocation();

  const row = target.closest<HTMLButtonElement>('button.radio-row-main');
  if (row?.dataset.index != null) {
    const idx = Number(row.dataset.index);
    closeRadioPanel();
    selectObject(idx);
  }
}

function onPanelInput(event: Event): void {
  const target = event.target as HTMLInputElement;
  if (target.id === 'radio-search') setFilters({ query: target.value });
}

function onPanelChange(event: Event): void {
  const target = event.target as HTMLInputElement;
  if (target.id === 'radio-minelev') {
    minElevDeg = Number(target.value);
    computeMatches();
    renderResults();
    return;
  }
  if (target.id === 'radio-amateur') setFilters({ amateurOnly: target.checked });
}

/** "Over me now" (true) or "All satellites" (false); asks for the location the first time. */
function setVisibleNow(on: boolean): void {
  if (on === visibleNow) return;
  visibleNow = on;
  renderScope();
  if (visibleNow && !observerLocation() && locationState !== 'busy' && locationState !== 'unsupported') {
    requestLocation();
  } else {
    renderLocationHint();
  }
  renderResults();
}

/** "41,01" and "41.01" both work; returns null when out of range. */
export function parseCoordinates(latText: string, lonText: string): { latitudeDeg: number; longitudeDeg: number } | null {
  const num = (v: string) => (v.trim() === '' ? Number.NaN : Number(v.trim().replace(',', '.')));
  const lat = num(latText);
  const lon = num(lonText);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { latitudeDeg: lat, longitudeDeg: lon };
}

function onPanelSubmit(event: SubmitEvent): void {
  const form = event.target as HTMLFormElement;
  if (form.id !== 'radio-manual') return;
  event.preventDefault();
  const lat = form.querySelector<HTMLInputElement>('#radio-lat')?.value ?? '';
  const lon = form.querySelector<HTMLInputElement>('#radio-lon')?.value ?? '';
  const coords = parseCoordinates(lat, lon);
  if (!coords) {
    locationState = 'invalid';
    renderLocationHint();
    const latInput = panelEl?.querySelector<HTMLInputElement>('#radio-lat');
    if (latInput) {
      latInput.value = lat;
      latInput.focus();
    }
    const lonInput = panelEl?.querySelector<HTMLInputElement>('#radio-lon');
    if (lonInput) lonInput.value = lon;
    return;
  }
  setManualLocation({ ...coords, altitudeKm: 0 });
  locationState = 'idle';
  passCache.clear();
  renderLocationHint();
  renderResults();
}

// ── open / close ─────────────────────────────────────────────────────────────

export function openRadioPanel(): void {
  if (backdropEl) return;
  closeKesslerPanel();
  index = buildRadioIndex(getState().objects);

  const backdrop = document.createElement('div');
  backdrop.id = 'radio-panel-backdrop';
  backdrop.className = 'modal-backdrop radio-backdrop';

  const panel = document.createElement('div');
  panel.id = 'radio-panel';
  panel.className = 'modal-panel radio-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'radio-title');

  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);
  backdropEl = backdrop;
  panelEl = panel;
  // A shared link (or an earlier visit) that changed the filters shows them open.
  filtersOpen = filtersOpen || !filtersAreDefault();

  renderShell();

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeRadioPanel();
  });
  panel.addEventListener('click', onPanelClick);
  panel.addEventListener('input', onPanelInput);
  panel.addEventListener('change', onPanelChange);
  panel.addEventListener('submit', onPanelSubmit);
  refreshTimer = window.setInterval(() => {
    if (observerLocation()) renderResults();
  }, REFRESH_MS);

  detachKeyboard = attachModalKeyboard(panel, closeRadioPanel, panel.querySelector<HTMLButtonElement>('#radio-close'));
}

export function closeRadioPanel(): void {
  if (!backdropEl) return;
  window.clearInterval(refreshTimer);
  window.clearTimeout(passTimer);
  window.clearTimeout(linkFeedbackTimer);
  passRun += 1;
  backdropEl.remove();
  backdropEl = null;
  panelEl = null;
  detachKeyboard?.();
  detachKeyboard = null;
}

export function isRadioPanelOpen(): boolean {
  return backdropEl != null;
}

/** For tests: forget filters, caches and any open panel. */
export function resetRadioPanelForTests(): void {
  closeRadioPanel();
  filters = { ...DEFAULT_RADIO_FILTERS };
  visibleNow = false;
  minElevDeg = 5;
  locationState = 'idle';
  filtersOpen = false;
  aboutOpen = false;
  passCache.clear();
  matches = [];
  elevations = new Map();
}

// ── header button + deep link ────────────────────────────────────────────────

/** Adds the header button; if the URL carries ?radio=…, opens the panel with those filters. */
export function initRadioPanel(): void {
  const btn = document.createElement('button');
  btn.id = 'radio-panel-btn';
  btn.className = 'kessler-header-btn header-btn radio-header-btn';
  btn.type = 'button';
  btn.innerHTML = `${icon('radio')}<span class="header-btn-label"></span>`;

  const refreshLabel = (): void => {
    const label = t('radio.button');
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.querySelector('.header-btn-label')!.textContent = label;
  };
  refreshLabel();
  btn.addEventListener('click', openRadioPanel);

  const kessler = document.getElementById('kessler-panel-btn');
  if (kessler?.parentElement) kessler.parentElement.insertBefore(btn, kessler);
  else {
    const more = document.getElementById('header-more');
    if (more?.parentElement) more.parentElement.insertBefore(btn, more);
    else document.querySelector('.app-header')?.appendChild(btn);
  }

  onLangChange(() => {
    refreshLabel();
    if (backdropEl) renderShell();
  });

  // Read the link before anything else rewrites the address bar.
  const fromUrl = radioFiltersFromSearch(window.location.search);
  if (fromUrl) {
    filters = fromUrl;
    openRadioPanel();
  }
}
