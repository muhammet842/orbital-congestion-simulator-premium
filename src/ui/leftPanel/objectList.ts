/**
 * Search box and the object list. The list is virtualized (spacer + visible window):
 * keep renderObjectList cheap; do not mount 12k DOM rows.
 */
import {
  getListIndices,
  getState,
  selectObject,
  setSearchQuery,
  countAllQueryMatches,
  clearListFilters,
} from '../../state/appState';
import { t } from '../../i18n/i18n';
import { isRecentlyLaunched } from '../../data/newLaunches';
import { escapeHtml } from '../escapeHtml';
import { formatNumber } from '../../i18n/format';

const LIST_ITEM_HEIGHT_FINE = 36;
const LIST_ITEM_HEIGHT_COARSE = 42;
const LIST_VIEWPORT_HEIGHT_DESKTOP = 200;
const LIST_VIEWPORT_HEIGHT_MOBILE = 160;
const LIST_OVERSCAN = 6;
/** Finger movement beyond this cancels list-item selection so the viewport can scroll. */
const LIST_TAP_SLOP_PX = 10;

function matchesMedia(query: string): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
}

export function listItemHeight(): number {
  return matchesMedia('(pointer: coarse)')
    ? LIST_ITEM_HEIGHT_COARSE
    : LIST_ITEM_HEIGHT_FINE;
}

function listViewportHeight(): number {
  return matchesMedia('(max-width: 860px)')
    ? LIST_VIEWPORT_HEIGHT_MOBILE
    : LIST_VIEWPORT_HEIGHT_DESKTOP;
}

export function initSearchAndList(container: HTMLElement): void {
  const searchInput = container.querySelector('#object-search') as HTMLInputElement;
  const viewport = container.querySelector('#object-list-viewport') as HTMLElement;

  searchInput.addEventListener('input', () => {
    setSearchQuery(searchInput.value);
    viewport.scrollTop = 0;
    renderObjectList(container);
  });

  viewport.addEventListener('scroll', () => renderObjectList(container));

  // Select on tap only. Selecting on pointerdown + preventDefault blocked native
  // touch scrolling on mobile (every scroll attempt became a selection).
  let listPointer: { id: number; x: number; y: number; index: number } | null = null;
  let listPointerDragged = false;

  const clearListPointer = (): void => {
    listPointer = null;
    listPointerDragged = false;
  };

  viewport.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.object-list-item[data-index]');
    if (!btn) return;
    const index = Number(btn.dataset.index);
    if (!Number.isInteger(index) || index < 0) return;
    listPointer = { id: e.pointerId, x: e.clientX, y: e.clientY, index };
    listPointerDragged = false;
  });

  viewport.addEventListener('pointermove', (e) => {
    if (!listPointer || e.pointerId !== listPointer.id || listPointerDragged) return;
    const dx = e.clientX - listPointer.x;
    const dy = e.clientY - listPointer.y;
    if (Math.hypot(dx, dy) > LIST_TAP_SLOP_PX) {
      listPointerDragged = true;
    }
  });

  viewport.addEventListener('pointerup', (e) => {
    if (!listPointer || e.pointerId !== listPointer.id) return;
    const { index } = listPointer;
    const dragged = listPointerDragged;
    clearListPointer();
    if (dragged) return;
    selectObject(index);
    updateListSelectionHighlight(container);
  });

  viewport.addEventListener('pointercancel', (e) => {
    if (listPointer && e.pointerId === listPointer.id) clearListPointer();
  });

  renderObjectList(container);
}

let hiddenKey = '';
/**
 * A search only looks inside the current filters. When filters hide some
 * matches (e.g. "ISS" while only Satellites are shown — the ISS is a Station),
 * say how many and offer to show them, instead of a silent "0 matches".
 */
function renderHiddenByFilters(container: HTMLElement, query: string, shown: number): void {
  const el = container.querySelector<HTMLElement>('#object-list-hidden');
  if (!el) return;
  const key = `${query}|${shown}|${getState().filteredIndices.length}`;
  if (key === hiddenKey) return; // the list re-renders on every scroll
  hiddenKey = key;
  const hidden = query.trim() ? countAllQueryMatches(query) - shown : 0;
  el.hidden = hidden <= 0;
  if (hidden <= 0) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = `<span>${escapeHtml(t('ui.list_hidden_by_filters').replace('{n}', formatNumber(hidden)))}</span>
    <button type="button" class="object-list-show-all" id="object-list-show-all">${escapeHtml(t('ui.list_show_all'))}</button>`;
  el.querySelector('#object-list-show-all')?.addEventListener('click', () => {
    hiddenKey = '';
    clearListFilters();
  });
}

export function renderObjectList(container: HTMLElement): void {
  const state = getState();
  const indices = getListIndices();
  const viewport = container.querySelector('#object-list-viewport') as HTMLElement;
  const spacer = container.querySelector('#object-list-spacer') as HTMLElement;
  const itemsEl = container.querySelector('#object-list-items') as HTMLElement;
  const metaEl = container.querySelector('#object-list-meta') as HTMLElement;

  const total = indices.length;
  const n = formatNumber(total);
  metaEl.textContent = state.searchQuery.trim()
    ? t(total === 1 ? 'ui.list_match_one' : 'ui.list_match_other').replace('{n}', n)
    : t('ui.list_objects_az').replace('{n}', n);
  renderHiddenByFilters(container, state.searchQuery, total);

  const itemHeight = listItemHeight();
  spacer.style.height = `${total * itemHeight}px`;

  const scrollTop = viewport.scrollTop;
  const visibleCount = Math.ceil(listViewportHeight() / itemHeight) + LIST_OVERSCAN;
  const start = Math.max(0, Math.floor(scrollTop / itemHeight));
  const end = Math.min(total, start + visibleCount);

  itemsEl.style.transform = `translateY(${start * itemHeight}px)`;
  itemsEl.innerHTML = indices.slice(start, end).map((index) => renderListItem(state, index)).join('');
}

function renderListItem(state: ReturnType<typeof getState>, index: number): string {
  const obj = state.objects[index];
  const selected = state.selectedIndex === index;
  const name = escapeHtml(obj.name.trim() || `NORAD ${obj.noradId}`);
  const newBadge = isRecentlyLaunched(obj)
    ? `<span class="new-launch-badge" title="${escapeHtml(t('badge.new_launch_title'))}">${t('badge.new_launch')}</span>`
    : '';
  return `
    <button type="button" class="object-list-item${selected ? ' object-list-item--selected' : ''}" data-index="${index}">
      <span class="object-list-name">${name}${newBadge}</span>
      <span class="object-list-norad">${obj.noradId}</span>
    </button>
  `;
}

export function updateListSelectionHighlight(container: HTMLElement): void {
  const selectedIndex = getState().selectedIndex;
  container.querySelectorAll('.object-list-item').forEach((el) => {
    const index = Number((el as HTMLElement).dataset.index);
    el.classList.toggle('object-list-item--selected', index === selectedIndex);
  });
}
