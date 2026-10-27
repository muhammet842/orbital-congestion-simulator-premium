/**
 * Advanced Filters: altitude and inclination ranges.
 */
import {
  getState,
  subscribe,
  setAltitudeFilter,
  setInclinationFilter,
  resetAdvancedFilters,
} from '../../state/appState';
import { t } from '../../i18n/i18n';
import { formatNumber } from '../../i18n/format';
import { escapeHtml } from '../escapeHtml';

// ── Advanced Filters ──────────────────────────────────────────────────────────

const ALT_MIN_DEFAULT  =     0;
const ALT_MAX_DEFAULT  = 36000;
const INCL_MIN_DEFAULT =     0;
const INCL_MAX_DEFAULT =   180;

/** Build the static HTML scaffold (inputs + tracks). Called once on init and on language change. */
function buildAdvancedFiltersHTML(
  altMin: number, altMax: number,
  inclMin: number, inclMax: number,
  shown: number, hasFilter: boolean,
): string {
  const altPctMin  = (altMin  / ALT_MAX_DEFAULT)  * 100;
  const altPctMax  = (altMax  / ALT_MAX_DEFAULT)  * 100;
  const inclPctMin = (inclMin / INCL_MAX_DEFAULT) * 100;
  const inclPctMax = (inclMax / INCL_MAX_DEFAULT) * 100;

  return `
    <div class="af-group">
      <div class="af-label-row">
        <span class="af-label" data-i18n="filter.altitude">${t('filter.altitude')}</span>
        <span class="af-values" id="af-alt-values">${formatNumber(altMin)} km — ${formatNumber(altMax)} km</span>
      </div>
      <div class="dual-range">
        <div class="dual-range-track">
          <div class="dual-range-fill" id="af-alt-fill"
               style="left:${altPctMin.toFixed(1)}%;width:${(altPctMax - altPctMin).toFixed(1)}%"></div>
        </div>
        <input type="range" class="dr-input dr-min" id="af-alt-min" aria-label="${escapeHtml(t('a11y.range_min').replace('{name}', t('filter.altitude')))}"
               min="${ALT_MIN_DEFAULT}" max="${ALT_MAX_DEFAULT}" step="50" value="${altMin}">
        <input type="range" class="dr-input dr-max" id="af-alt-max" aria-label="${escapeHtml(t('a11y.range_max').replace('{name}', t('filter.altitude')))}"
               min="${ALT_MIN_DEFAULT}" max="${ALT_MAX_DEFAULT}" step="50" value="${altMax}">
      </div>
    </div>

    <div class="af-group">
      <div class="af-label-row">
        <span class="af-label" data-i18n="filter.inclination">${t('filter.inclination')}</span>
        <span class="af-values" id="af-incl-values">${inclMin}° — ${inclMax}°</span>
      </div>
      <div class="dual-range">
        <div class="dual-range-track">
          <div class="dual-range-fill" id="af-incl-fill"
               style="left:${inclPctMin.toFixed(1)}%;width:${(inclPctMax - inclPctMin).toFixed(1)}%"></div>
        </div>
        <input type="range" class="dr-input dr-min" id="af-incl-min" aria-label="${escapeHtml(t('a11y.range_min').replace('{name}', t('filter.inclination')))}"
               min="${INCL_MIN_DEFAULT}" max="${INCL_MAX_DEFAULT}" step="1" value="${inclMin}">
        <input type="range" class="dr-input dr-max" id="af-incl-max" aria-label="${escapeHtml(t('a11y.range_max').replace('{name}', t('filter.inclination')))}"
               min="${INCL_MIN_DEFAULT}" max="${INCL_MAX_DEFAULT}" step="1" value="${inclMax}">
      </div>
    </div>

    <div class="af-footer">
      <span class="af-count muted" id="af-count" role="status">${t('filter.objects_shown').replace('{n}', formatNumber(shown))}</span>
      <button type="button" id="af-reset"
              class="btn-af-reset${hasFilter ? '' : ' btn-af-reset--dim'}"
              ${hasFilter ? '' : 'disabled'}>${t('filter.reset')}</button>
    </div>
  `;
}

/**
 * Update only the display elements (labels, fills, count, reset state) without
 * touching the <input> elements. Called on every state change so that dragging
 * is never interrupted by an innerHTML replacement.
 */
function updateAdvancedFiltersDisplay(container: HTMLElement): void {
  const el = container.querySelector('#advanced-filters');
  if (!el) return;

  const state = getState();
  const af   = state.altitudeFilter;
  const incf = state.inclinationFilter;

  const altMin  = af?.minKm    ?? ALT_MIN_DEFAULT;
  const altMax  = af?.maxKm    ?? ALT_MAX_DEFAULT;
  const inclMin = incf?.minDeg ?? INCL_MIN_DEFAULT;
  const inclMax = incf?.maxDeg ?? INCL_MAX_DEFAULT;

  // Value labels
  const altValEl = el.querySelector('#af-alt-values');
  if (altValEl) altValEl.textContent = `${formatNumber(altMin)} km — ${formatNumber(altMax)} km`;
  const inclValEl = el.querySelector('#af-incl-values');
  if (inclValEl) inclValEl.textContent = `${inclMin}° — ${inclMax}°`;

  // Fill bars
  const altPctMin  = (altMin  / ALT_MAX_DEFAULT)  * 100;
  const altPctMax  = (altMax  / ALT_MAX_DEFAULT)  * 100;
  const altFill = el.querySelector<HTMLElement>('#af-alt-fill');
  if (altFill) {
    altFill.style.left  = `${altPctMin.toFixed(1)}%`;
    altFill.style.width = `${(altPctMax - altPctMin).toFixed(1)}%`;
  }

  const inclPctMin = (inclMin / INCL_MAX_DEFAULT) * 100;
  const inclPctMax = (inclMax / INCL_MAX_DEFAULT) * 100;
  const inclFill = el.querySelector<HTMLElement>('#af-incl-fill');
  if (inclFill) {
    inclFill.style.left  = `${inclPctMin.toFixed(1)}%`;
    inclFill.style.width = `${(inclPctMax - inclPctMin).toFixed(1)}%`;
  }

  // Sync slider values in case filter was reset programmatically
  const altMinEl  = el.querySelector<HTMLInputElement>('#af-alt-min');
  const altMaxEl  = el.querySelector<HTMLInputElement>('#af-alt-max');
  const inclMinEl = el.querySelector<HTMLInputElement>('#af-incl-min');
  const inclMaxEl = el.querySelector<HTMLInputElement>('#af-incl-max');
  if (altMinEl  && document.activeElement !== altMinEl)  altMinEl.value  = String(altMin);
  if (altMaxEl  && document.activeElement !== altMaxEl)  altMaxEl.value  = String(altMax);
  if (inclMinEl && document.activeElement !== inclMinEl) inclMinEl.value = String(inclMin);
  if (inclMaxEl && document.activeElement !== inclMaxEl) inclMaxEl.value = String(inclMax);

  // Object count
  const countEl = el.querySelector('#af-count');
  if (countEl) countEl.textContent = t('filter.objects_shown').replace('{n}', formatNumber(state.filteredIndices.length));

  // Reset button
  const hasFilter = af !== null || incf !== null;
  const resetBtn  = el.querySelector<HTMLButtonElement>('#af-reset');
  if (resetBtn) {
    resetBtn.disabled = !hasFilter;
    resetBtn.classList.toggle('btn-af-reset--dim', !hasFilter);
  }
}

/** Full rebuild (called once on init and on language change only). */
export function renderAdvancedFilters(container: HTMLElement): void {
  const el = container.querySelector('#advanced-filters');
  if (!el) return;
  const state = getState();
  const af   = state.altitudeFilter;
  const incf = state.inclinationFilter;
  el.innerHTML = buildAdvancedFiltersHTML(
    af?.minKm    ?? ALT_MIN_DEFAULT, af?.maxKm    ?? ALT_MAX_DEFAULT,
    incf?.minDeg ?? INCL_MIN_DEFAULT, incf?.maxDeg ?? INCL_MAX_DEFAULT,
    state.filteredIndices.length, af !== null || incf !== null,
  );
}

export function initAdvancedFilters(container: HTMLElement): void {
  renderAdvancedFilters(container);

  container.addEventListener('input', (e) => {
    const target = e.target as HTMLInputElement;
    const id = target.id;
    if (!['af-alt-min', 'af-alt-max', 'af-incl-min', 'af-incl-max'].includes(id)) return;

    const el = container.querySelector('#advanced-filters')!;

    if (id === 'af-alt-min' || id === 'af-alt-max') {
      const minEl = el.querySelector<HTMLInputElement>('#af-alt-min')!;
      const maxEl = el.querySelector<HTMLInputElement>('#af-alt-max')!;
      let minVal = Number(minEl.value);
      let maxVal = Number(maxEl.value);
      if (minVal > maxVal) {
        if (id === 'af-alt-min') { minVal = maxVal; minEl.value = String(minVal); }
        else                     { maxVal = minVal; maxEl.value = String(maxVal); }
      }
      const isDefault = minVal === ALT_MIN_DEFAULT && maxVal === ALT_MAX_DEFAULT;
      setAltitudeFilter(isDefault ? null : { minKm: minVal, maxKm: maxVal });
    }

    if (id === 'af-incl-min' || id === 'af-incl-max') {
      const minEl = el.querySelector<HTMLInputElement>('#af-incl-min')!;
      const maxEl = el.querySelector<HTMLInputElement>('#af-incl-max')!;
      let minVal = Number(minEl.value);
      let maxVal = Number(maxEl.value);
      if (minVal > maxVal) {
        if (id === 'af-incl-min') { minVal = maxVal; minEl.value = String(minVal); }
        else                      { maxVal = minVal; maxEl.value = String(maxVal); }
      }
      const isDefault = minVal === INCL_MIN_DEFAULT && maxVal === INCL_MAX_DEFAULT;
      setInclinationFilter(isDefault ? null : { minDeg: minVal, maxDeg: maxVal });
    }
  });

  container.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).id === 'af-reset') {
      resetAdvancedFilters();
    }
  });

  // On state change: update only display elements — never replace the inputs
  subscribe(() => updateAdvancedFiltersDisplay(container));
}
