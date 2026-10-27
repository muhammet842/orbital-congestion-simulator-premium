/**
 * Orbit layers, object types and display options.
 */
import { LAYER_HEX, type ObjectCategory, type OrbitLayer } from '../../types';
import {
  getState,
  setCategoryFilter,
  toggleLayerFilter,
  setColorByFunction,
  setShowOnlyRecentLaunches,
} from '../../state/appState';
import { t } from '../../i18n/i18n';
import { hasAnyRecentlyLaunched } from '../../data/newLaunches';
import { escapeHtml } from '../escapeHtml';

const LAYERS: OrbitLayer[] = ['LEO', 'MEO', 'GEO', 'HEO'];
const CATEGORY_FILTERS: Array<ObjectCategory | 'all'> = ['all', 'active', 'stations', 'debris'];

/** "● Starlink  ● Stations …": one coloured dot before each name, in the order of ui.cbf_hint. */
function functionLegendHtml(): string {
  const groups = ['starlink', 'station', 'active', 'debris', 'amateur'];
  return t('ui.cbf_hint')
    .split(' · ')
    .map(
      (label, i) =>
        `<span class="function-legend-item"><span class="function-dot function-dot--${groups[i] ?? 'active'}" aria-hidden="true"></span>${escapeHtml(label)}</span>`,
    )
    .join('');
}


export function renderLayerFilters(container: HTMLElement): void {
  const filtersEl = container.querySelector('#layer-filters')!;
  const { layerFilters } = getState();

  filtersEl.innerHTML = `
    <div class="filter-chip-grid" role="group" aria-label="${t('ui.orbit_layers')}">
      ${LAYERS.map(
        (layer) => `
          <button
            type="button"
            class="filter-chip${layerFilters[layer] ? ' filter-chip--on' : ''}"
            data-layer="${layer}"
            aria-pressed="${layerFilters[layer]}"
          >
            <span class="filter-chip-dot" style="background: ${LAYER_HEX[layer]}"></span>
            <span class="filter-chip-label">${layer}</span>
          </button>
        `,
      ).join('')}
    </div>
  `;

  filtersEl.querySelectorAll<HTMLButtonElement>('button[data-layer]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const layer = btn.dataset.layer as OrbitLayer;
      toggleLayerFilter(layer);
    });
  });
}

export function renderCategoryFilters(container: HTMLElement): void {
  const el = container.querySelector('#category-filters');
  if (!el) return;
  const { categoryFilter } = getState();

  el.innerHTML = `
    <div class="filter-segment" role="radiogroup" aria-label="${t('ui.object_types')}">
      ${CATEGORY_FILTERS.map(
        (cat) => `
          <label class="filter-segment-option${categoryFilter === cat ? ' filter-segment-option--on' : ''}">
            <input
              type="radio"
              name="category-filter"
              value="${cat}"
              data-category="${cat}"
              ${categoryFilter === cat ? 'checked' : ''}
            />
            <span class="filter-segment-swatch filter-segment-swatch--${cat}" aria-hidden="true"></span>
            <span>${t(cat === 'all' ? 'cat.filter_all' : `cat.${cat}`)}</span>
          </label>
        `,
      ).join('')}
    </div>
  `;

  el.querySelectorAll<HTMLInputElement>('input[data-category]').forEach((input) => {
    input.addEventListener('change', () => {
      setCategoryFilter(input.value as ObjectCategory | 'all');
    });
  });
}

export function renderDisplayOptions(container: HTMLElement): void {
  const optionsEl = container.querySelector('#display-options')!;
  const showRecentToggle = hasAnyRecentlyLaunched(getState().objects);
  const { colorByFunction, showOnlyRecentLaunches } = getState();

  optionsEl.innerHTML = `
    <button
      type="button"
      class="filter-toggle-card${colorByFunction ? ' filter-toggle-card--on' : ''}"
      id="color-by-function"
      aria-pressed="${colorByFunction}"
    >
      <span class="filter-toggle-copy">
        <strong>${t('ui.color_by_function')}</strong>
        <span class="muted function-legend-list">${functionLegendHtml()}</span>
      </span>
    </button>
    ${
      showRecentToggle
        ? `
    <button
      type="button"
      class="filter-toggle-card${showOnlyRecentLaunches ? ' filter-toggle-card--on' : ''}"
      id="show-recent-launches"
      aria-pressed="${showOnlyRecentLaunches}"
      title="${escapeHtml(t('badge.new_launch_title'))}"
    >
      <span class="new-launch-badge" aria-hidden="true">${t('badge.new_launch')}</span>
      <span class="filter-toggle-copy">
        <strong>${t('ui.recent_launches')}</strong>
        <span class="muted">${t('ui.recent_launches_hint')}</span>
      </span>
    </button>
    `
        : ''
    }
  `;

  const colorBtn = optionsEl.querySelector('#color-by-function') as HTMLButtonElement;
  colorBtn.addEventListener('click', () => {
    setColorByFunction(!getState().colorByFunction);
  });

  const recentBtn = optionsEl.querySelector('#show-recent-launches') as HTMLButtonElement | null;
  recentBtn?.addEventListener('click', () => {
    setShowOnlyRecentLaunches(!getState().showOnlyRecentLaunches);
  });

  if (!showRecentToggle && getState().showOnlyRecentLaunches) {
    setShowOnlyRecentLaunches(false);
  }
}
