/**
 * Left panel: search/list, orbit layers, categories, display options,
 * advanced filters, live stats, close-approach alerts, historical events.
 *
 * Object list is virtualized (spacer + visible window) — keep renderObjectList
 * cheap; do not mount 12k DOM rows. Conjunction cards: max 5 displayed; sort
 * by time or criticality via appState.conjunctionSortMode.
 */
import { formatUtcDateTime, getSimulationTime, getState, subscribe } from '../state/appState';
import { initEventCards } from './EventCards';
import { initLaunchesPanel } from './LaunchesPanel';
import { t, applyTranslations, onLangChange } from '../i18n/i18n';
import { hasAnyRecentlyLaunched } from '../data/newLaunches';
import { initPanelSections } from './panelSections';
import { setTextIfChanged } from './dom';
import { initAdvancedFilters, renderAdvancedFilters } from './leftPanel/advancedFilters';
import {
  bindConjunctionListEvents,
  refreshConjunctionCountdownsEverySecond,
  renderConjunctionFilters,
  renderConjunctions,
} from './leftPanel/closeApproachList';
import {
  renderCategoryFilters,
  renderDisplayOptions,
  renderLayerFilters,
} from './leftPanel/filterControls';
import {
  initSearchAndList,
  listItemHeight,
  renderObjectList,
  updateListSelectionHighlight,
} from './leftPanel/objectList';
import { renderStaleNote, renderStats, statsRenderKey } from './leftPanel/stats';

export function initLeftPanel(container: HTMLElement): void {
  container.innerHTML = `
    <div id="tour-region-search" class="tour-region">
      <h2 class="panel-heading" data-i18n="ui.search_objects">Search Objects</h2>
      <div class="search-wrap">
        <input
          type="search"
          id="object-search"
          class="search-input"
          placeholder="${t('ui.search_ph')}"
          data-i18n-ph="ui.search_ph"
          autocomplete="off"
          spellcheck="false"
        />
      </div>
      <div class="object-list-meta" id="object-list-meta"></div>
      <div class="object-list-hidden" id="object-list-hidden" hidden></div>
      <div class="object-list-viewport" id="object-list-viewport">
        <div class="object-list-spacer" id="object-list-spacer"></div>
        <div class="object-list-items" id="object-list-items"></div>
      </div>

      <h2 class="panel-heading" data-i18n="ui.orbit_layers">Orbit Layers</h2>
      <div class="layer-filters" id="layer-filters"></div>

      <h2 class="panel-heading" data-i18n="ui.object_types">Object Types</h2>
      <p class="panel-lede" data-i18n="ui.category_hint">${t('ui.category_hint')}</p>
      <div class="category-filters" id="category-filters"></div>

      <h2 class="panel-heading" data-i18n="ui.display_options">Display Options</h2>
      <div class="display-options" id="display-options"></div>

      <h2 class="panel-heading" data-i18n="ui.advanced_filters">Advanced Filters</h2>
      <div class="advanced-filters" id="advanced-filters"></div>
    </div>

    <h2 class="panel-heading" data-i18n="ui.object_categories">Object Categories</h2>
    <ul class="category-stats" id="category-stats"></ul>

    <h2 class="panel-heading" data-i18n="ui.live_stats">Live Stats</h2>
    <dl class="stats-list" id="live-stats"></dl>

    <div id="tour-region-approaches" class="tour-region">
      <h2 class="panel-heading panel-heading--alert" data-i18n="ui.close_approach">Close Approach Alerts (Next 24h)</h2>
      <p class="panel-lede" data-i18n="conj.why_it_matters">${t('conj.why_it_matters')}</p>
      <p class="muted conjunction-accuracy-note" data-section-info data-i18n="conj.accuracy_note">${t('conj.accuracy_note')}</p>
      <p class="muted conjunction-accuracy-note" id="conjunction-stale-note" hidden></p>
      <div class="conjunction-filters" id="conjunction-filters"></div>
      <div class="conjunction-list" id="conjunction-list"></div>
      <div class="conjunction-more-controls" id="conjunction-more-controls"></div>
    </div>
  `;

  initSearchAndList(container);
  renderLayerFilters(container);
  renderCategoryFilters(container);
  renderDisplayOptions(container);
  renderStats(container);
  renderConjunctionFilters(container);
  renderConjunctions(container);
  renderStaleNote(container);
  initLaunchesPanel(container);
  initEventCards(container);
  initAdvancedFilters(container);
  // Rarely used sections start closed; the visitor's choice is remembered.
  initPanelSections(container, ['ui.advanced_filters', 'ui.object_categories', 'ui.live_stats']);

  bindConjunctionListEvents(container);

  const refreshLiveStatTime = (): void => {
    setTextIfChanged(container.querySelector('#live-stat-time'), formatUtcDateTime(getSimulationTime()));
    refreshConjunctionCountdownsEverySecond(container);
    requestAnimationFrame(refreshLiveStatTime);
  };
  requestAnimationFrame(refreshLiveStatTime);

  // On language change: update data-i18n labels and re-render dynamic sections
  onLangChange(() => {
    applyTranslations(container);
    renderDisplayOptions(container);
    renderCategoryFilters(container);
    renderLayerFilters(container);
    renderStats(container);
    renderConjunctionFilters(container);
    renderConjunctions(container);
    renderStaleNote(container);
    renderAdvancedFilters(container);
  });

  let lastListKey = '';
  let lastSelectedIndex: number | null = null;
  let lastFilterUiKey = '';

  // State changes arrive many times a second (e.g. while dragging the time
  // slider): only rebuild the parts whose content actually changed.
  let lastStatsKey = statsRenderKey();
  let lastSortMode = getState().conjunctionSortMode;
  subscribe(() => {
    const statsKey = statsRenderKey();
    if (statsKey !== lastStatsKey) {
      lastStatsKey = statsKey;
      renderStats(container);
    }
    if (getState().conjunctionSortMode !== lastSortMode) {
      lastSortMode = getState().conjunctionSortMode;
      renderConjunctionFilters(container);
    }
    renderConjunctions(container);
    renderStaleNote(container);

    const state = getState();
    const filterUiKey = [
      Object.entries(state.layerFilters).join(','),
      state.categoryFilter,
      state.colorByFunction,
      state.showOnlyRecentLaunches,
      hasAnyRecentlyLaunched(state.objects),
    ].join('|');
    if (filterUiKey !== lastFilterUiKey) {
      renderLayerFilters(container);
      renderCategoryFilters(container);
      renderDisplayOptions(container);
      lastFilterUiKey = filterUiKey;
    }

    const viewport = container.querySelector('#object-list-viewport') as HTMLElement;
    const scrollBucket = Math.floor(viewport.scrollTop / listItemHeight());
    const listKey = [
      state.searchQuery,
      scrollBucket,
      state.objects.length,
      state.filteredIndices.length,
      state.categoryFilter,
      state.showOnlyRecentLaunches,
      Object.entries(state.layerFilters).join(','),
      state.altitudeFilter?.minKm,
      state.altitudeFilter?.maxKm,
      state.inclinationFilter?.minDeg,
      state.inclinationFilter?.maxDeg,
    ].join('|');

    if (listKey !== lastListKey) {
      renderObjectList(container);
      lastListKey = listKey;
      lastSelectedIndex = state.selectedIndex;
    } else if (state.selectedIndex !== lastSelectedIndex) {
      updateListSelectionHighlight(container);
      lastSelectedIndex = state.selectedIndex;
    }
  });
}
