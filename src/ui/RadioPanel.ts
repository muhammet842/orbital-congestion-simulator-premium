/**
 * Radio panel: find satellites a hobbyist can actually receive.
 *
 * A header button opens a modal with band / mode / amateur filters, an optional
 * "above my horizon now" filter (from the observer location already stored for
 * the Spotter, or a one-shot "Use my location"), a result list, CSV export and a
 * shareable link that carries the filters. Everything runs in the browser from
 * the catalog's radio data; nothing is sent anywhere.
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
import { escapeHtml, safeHttpUrl } from './escapeHtml';

const MAX_ROWS = 150;
const REFRESH_MS = 10_000;
const PASS_HORIZON_HOURS = 12;
const PASS_CACHE_MS = 10 * 60_000;
const PASS_CHUNK = 5;

type LocationState = 'idle' | 'busy' | 'denied' | 'unsupported';

let backdropEl: HTMLElement | null = null;
let panelEl: HTMLElement | null = null;
let opener: HTMLElement | null = null;

let filters: RadioFilters = { ...DEFAULT_RADIO_FILTERS };
let visibleNow = false;
/** Minimum elevation (degrees) for "above my horizon"; 5° is a realistic hobby antenna. */
let minElevDeg = 5;
const MIN_ELEVATION_CHOICES = [0, 5, 10, 15];
let locationState: LocationState = 'idle';
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
}

function renderLocationHint(): void {
  const el = panelEl?.querySelector('#radio-location');
  if (!el) return;
  if (!visibleNow || observerLocation()) {
    el.innerHTML = '';
    return;
  }
  const message =
    locationState === 'denied'
      ? t('radio.location_denied')
      : locationState === 'unsupported'
        ? t('radio.location_unsupported')
        : t('radio.location_needed');
  const button =
    locationState === 'unsupported'
      ? ''
      : `<button type="button" class="radio-link-btn" data-action="locate"${locationState === 'busy' ? ' disabled' : ''}>${escapeHtml(t(locationState === 'busy' ? 'radio.locating' : 'radio.use_location'))}</button>`;
  el.innerHTML = `<p class="muted radio-location-note">${escapeHtml(message)} ${button}</p>`;
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
  return `
    <li class="radio-row">
      <button type="button" class="radio-row-main" data-index="${entry.index}">
        <span class="radio-row-name">${escapeHtml(entry.name)}${badge}</span>
        ${lines.join('')}
      </button>
      <span class="radio-row-when" data-when="${entry.noradId}">${escapeHtml(whenText(entry))}</span>
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
    list.innerHTML = `<li class="radio-empty muted">${escapeHtml(t('radio.empty'))}</li>`;
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
      <button type="button" class="modal-close" id="radio-close" aria-label="${escapeHtml(t('radio.close'))}" title="${escapeHtml(t('radio.close'))}">✕</button>
    </div>
    <div class="modal-body radio-body">
      <p class="radio-lede muted">${escapeHtml(t('radio.lede'))}</p>

      <div class="radio-group">
        <span class="radio-group-label" id="radio-band-label">${escapeHtml(t('radio.band_label'))}</span>
        <div class="radio-chips" id="radio-bands" role="group" aria-labelledby="radio-band-label">${bands}</div>
      </div>
      <div class="radio-group">
        <span class="radio-group-label" id="radio-mode-label">${escapeHtml(t('radio.mode_label'))}</span>
        <div class="radio-chips" id="radio-modes" role="group" aria-labelledby="radio-mode-label">${modes}</div>
      </div>

      <div class="radio-toggles">
        <label class="radio-check"><input type="checkbox" id="radio-amateur"${filters.amateurOnly ? ' checked' : ''} /> ${escapeHtml(t('radio.amateur_only'))}</label>
        <label class="radio-check"><input type="checkbox" id="radio-visible"${visibleNow ? ' checked' : ''} /> ${escapeHtml(t('radio.visible_now'))}</label>
      </div>
      <label class="radio-check radio-minelev"><span>${escapeHtml(t('radio.minelev'))}</span>
        <select id="radio-minelev" aria-describedby="radio-minelev-hint">${MIN_ELEVATION_CHOICES.map((d) => `<option value="${d}"${d === minElevDeg ? ' selected' : ''}>${d === 0 ? escapeHtml(t('radio.minelev_any')) : d + '°'}</option>`).join('')}</select>
      </label>
      <p class="muted radio-hint" id="radio-minelev-hint">${escapeHtml(t('radio.minelev_hint'))}</p>
      <div id="radio-location"></div>

      <input type="search" id="radio-search" class="radio-search" placeholder="${escapeHtml(t('radio.search'))}" aria-label="${escapeHtml(t('radio.search'))}" value="${escapeHtml(searchValue)}" autocomplete="off" />

      <div class="radio-bar">
        <span class="radio-summary" id="radio-summary" role="status"></span>
        <span class="radio-actions">
          <button type="button" class="radio-link-btn" data-action="export">${escapeHtml(t('radio.export'))}</button>
          <button type="button" class="radio-link-btn" data-action="copy" id="radio-copy">${escapeHtml(t('radio.copy_link'))}</button>
        </span>
      </div>

      <ul class="radio-list" id="radio-list"></ul>

      <p class="radio-note muted">${escapeHtml(t('radio.note'))}</p>
      <p class="radio-note muted">${escapeHtml(t('radio.credit'))}</p>
    </div>
  `;
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
  if (!button) return;
  button.textContent = t(ok ? 'radio.link_copied' : 'radio.link_failed');
  window.clearTimeout(linkFeedbackTimer);
  linkFeedbackTimer = window.setTimeout(() => {
    button.textContent = t('radio.copy_link');
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
      renderLocationHint();
      renderResults();
    },
    () => {
      locationState = 'denied';
      renderLocationHint();
    },
    { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
  );
}

function onPanelClick(event: MouseEvent): void {
  const target = event.target as HTMLElement;
  const chip = target.closest<HTMLButtonElement>('button[data-band], button[data-mode]');
  if (chip?.dataset.band) return setFilters({ band: chip.dataset.band as BandId });
  if (chip?.dataset.mode) return setFilters({ mode: chip.dataset.mode as ModeFilter });

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
  if (target.id === 'radio-visible') {
    visibleNow = target.checked;
    renderLocationHint();
    renderResults();
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') closeRadioPanel();
}

// ── open / close ─────────────────────────────────────────────────────────────

export function openRadioPanel(): void {
  if (backdropEl) return;
  closeKesslerPanel();
  opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
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

  renderShell();

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeRadioPanel();
  });
  panel.addEventListener('click', onPanelClick);
  panel.addEventListener('input', onPanelInput);
  panel.addEventListener('change', onPanelChange);
  document.addEventListener('keydown', onKeydown);
  refreshTimer = window.setInterval(() => {
    if (observerLocation()) renderResults();
  }, REFRESH_MS);

  panel.querySelector<HTMLButtonElement>('#radio-close')?.focus();
}

export function closeRadioPanel(): void {
  if (!backdropEl) return;
  window.clearInterval(refreshTimer);
  window.clearTimeout(passTimer);
  window.clearTimeout(linkFeedbackTimer);
  passRun += 1;
  document.removeEventListener('keydown', onKeydown);
  backdropEl.remove();
  backdropEl = null;
  panelEl = null;
  opener?.focus?.();
  opener = null;
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
  passCache.clear();
  matches = [];
  elevations = new Map();
}

// ── header button + deep link ────────────────────────────────────────────────

/** Adds the header button; if the URL carries ?radio=…, opens the panel with those filters. */
export function initRadioPanel(): void {
  const btn = document.createElement('button');
  btn.id = 'radio-panel-btn';
  btn.className = 'kessler-header-btn radio-header-btn';
  btn.type = 'button';
  btn.textContent = '📻';

  const refreshLabel = (): void => {
    const label = t('radio.button');
    btn.title = label;
    btn.setAttribute('aria-label', label);
  };
  refreshLabel();
  btn.addEventListener('click', openRadioPanel);

  const kessler = document.getElementById('kessler-panel-btn');
  const actions = document.getElementById('header-actions');
  const langSel = document.getElementById('lang-select');
  if (kessler?.parentElement) kessler.parentElement.insertBefore(btn, kessler);
  else if (actions && langSel) actions.insertBefore(btn, langSel.closest('.header-lang') ?? langSel);
  else document.querySelector('.app-header')?.appendChild(btn);

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
