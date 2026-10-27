/**
 * Close-approach cards: sort choice, countdowns, Show more / Show less, clicks.
 */
import {
  conjunctionSessionKey,
  countConjunctionOverflow,
  hasUpcomingConjunctionScanCompleted,
  isUpcomingConjunctionScanPending,
  selectConjunctionAlertsForDisplay,
  filterConjunctionAlertsInHorizon,
  MAX_DISPLAY_ALERTS,
  PREDICTION_RANGE_DAYS,
  isWithinPredictionRange,
  type ConjunctionSortMode,
} from '../../orbital/conjunction';
import {
  getGlobalSimulationTime,
  getState,
  toggleConjunctionFromAlert,
  setConjunctionSortMode,
} from '../../state/appState';
import { t } from '../../i18n/i18n';
import { escapeHtml } from '../escapeHtml';
import { formatNumber } from '../../i18n/format';

const SORT_MODES: ConjunctionSortMode[] = ['time', 'criticality'];

export function renderConjunctionFilters(container: HTMLElement): void {
  const el = container.querySelector('#conjunction-filters');
  if (!el) return;
  const { conjunctionSortMode } = getState();

  const options = SORT_MODES.map(
    (mode) => `
      <label class="conjunction-sort-option">
        <input
          type="radio"
          name="conjunction-sort"
          value="${mode}"
          data-sort="${mode}"
          ${conjunctionSortMode === mode ? 'checked' : ''}
        />
        <span>${t(`conj.sort_${mode}`)}</span>
      </label>
    `,
  ).join('');

  el.innerHTML = `
    <div class="conjunction-sort" role="radiogroup" aria-label="${t('conj.sort_label')}">
      ${options}
    </div>
  `;
}

/**
 * Why no close approaches are predicted: the clock was moved too far from the
 * data's date, or the data itself is too old (its daily refresh has failed).
 */
function outOfRangeText(): string {
  const { fetchedAt } = getState().stats;
  if (!isWithinPredictionRange(Date.now(), fetchedAt)) {
    const days = Math.floor((Date.now() - new Date(fetchedAt).getTime()) / 86_400_000);
    return t('conj.out_of_range_data').replace('{n}', String(days));
  }
  return t('conj.out_of_range').replace('{days}', String(PREDICTION_RANGE_DAYS));
}

/** Cards added per "Show more" click. */
const SHOW_MORE_STEP = 10;
/** Cards currently shown; starts at the default and grows with "Show more". */
let conjunctionShowCount = MAX_DISPLAY_ALERTS;
/** Currently visible alert cards — click handler reads this, not the raw pool. */
let displayedConjunctions: ReturnType<typeof selectConjunctionAlertsForDisplay> = [];

function getVisibleConjunctions() {
  const { conjunctions, conjunctionSortMode } = getState();
  return selectConjunctionAlertsForDisplay(conjunctions, {
    nowMs: getGlobalSimulationTime().getTime(),
    sortMode: conjunctionSortMode,
    limit: conjunctionShowCount,
  });
}

/**
 * "Show more" while stored close approaches are hidden, "Show less" once the
 * list is longer than the default. The scan keeps a pool of the soonest and
 * tightest passes; the rest are only counted (the "+N more" line), so the
 * list can grow up to that pool, not to the full count.
 */
function renderShowMoreControls(container: HTMLElement, shown: number, available: number): void {
  const el = container.querySelector('#conjunction-more-controls');
  if (!el) return;
  const more = available > shown;
  const less = shown > MAX_DISPLAY_ALERTS;
  const key = `${more}|${less}`;
  if ((el as HTMLElement).dataset.state === key && el.childElementCount === Number(more) + Number(less)) return;
  (el as HTMLElement).dataset.state = key;
  el.innerHTML = [
    more ? `<button type="button" class="conjunction-more-btn" data-conj-more="more">${escapeHtml(t('conj.show_more'))}</button>` : '',
    less ? `<button type="button" class="conjunction-more-btn" data-conj-more="less">${escapeHtml(t('conj.show_less'))}</button>` : '',
  ].join('');
}

export function renderConjunctions(container: HTMLElement): void {
  const { conjunctions, conjunctionHiddenCount, selectedConjunctionSessionKey, conjunctionSortMode } =
    getState();
  const listEl = container.querySelector('#conjunction-list')!;

  if (conjunctions.length === 0) {
    renderShowMoreControls(container, 0, 0);
    previousAlertKeys.clear();
    lastConjunctionStructureKey = '';
    displayedConjunctions = [];
    const outOfRange = getState().conjunctionsOutOfRange;
    const stillScanning =
      !outOfRange && (isUpcomingConjunctionScanPending() || !hasUpcomingConjunctionScanCompleted());
    const emptyText = outOfRange ? outOfRangeText() : t(stillScanning ? 'conj.scanning' : 'conj.empty');
    const existing = listEl.querySelector('.conjunction-empty');
    if (existing && !listEl.querySelector('.conjunction-alert')) {
      if (existing.textContent !== emptyText) existing.textContent = emptyText;
      existing.classList.toggle('conjunction-empty--scanning', stillScanning);
      return;
    }
    listEl.innerHTML = `<p class="muted conjunction-empty${stillScanning ? ' conjunction-empty--scanning' : ''}">${emptyText}</p>`;
    return;
  }

  const visible = getVisibleConjunctions();
  displayedConjunctions = visible;
  const nowMs = getGlobalSimulationTime().getTime();
  renderShowMoreControls(container, visible.length, filterConjunctionAlertsInHorizon(conjunctions, { nowMs }).length);
  const overflowTotal = countConjunctionOverflow(conjunctions, {
    nowMs,
    displayedCount: visible.length,
    hiddenCount: conjunctionHiddenCount,
  });

  if (visible.length === 0) {
    previousAlertKeys.clear();
    lastConjunctionStructureKey = 'filtered-empty';
    listEl.innerHTML = `<p class="muted conjunction-empty">${t('conj.empty')}</p>`;
    return;
  }

  const structureKey = [
    selectedConjunctionSessionKey ?? '',
    conjunctionSortMode,
    ...visible.map(
      (c) =>
        `${conjunctionSessionKey(c)}:${c.distanceKm.toFixed(2)}:${c.time.getTime()}`,
    ),
  ].join('|');

  // Same cards already mounted — only refresh countdown / overflow copy
  // (avoids drop animation flicker when the scan pool grows).
  if (
    structureKey === lastConjunctionStructureKey &&
    listEl.querySelectorAll('.conjunction-alert').length === visible.length
  ) {
    updateConjunctionAlertTexts(listEl, visible, nowMs);
    updateConjunctionOverflow(listEl, overflowTotal);
    return;
  }

  lastConjunctionStructureKey = structureKey;
  const nextKeys = new Set<string>();
  const alertsHtml = visible
    .map((c) => {
      const sessionKey = conjunctionSessionKey(c);
      const isNew = !previousAlertKeys.has(sessionKey);
      const isActive = sessionKey === selectedConjunctionSessionKey;
      nextKeys.add(sessionKey);
      return `
        <button
          type="button"
          class="conjunction-alert${isNew ? ' conjunction-alert--new' : ''}${isActive ? ' conjunction-alert--active' : ''}"
          data-session-key="${escapeHtml(sessionKey)}"
        >
          <span class="conjunction-alert-text">${escapeHtml(formatAlertMessage(c, nowMs))}</span>
        </button>
      `;
    })
    .join('');

  listEl.innerHTML = alertsHtml;
  updateConjunctionOverflow(listEl, overflowTotal);
  previousAlertKeys = nextKeys;
}

function formatConjunctionOverflowText(overflowTotal: number): string {
  return t(overflowTotal === 1 ? 'conj.more_one' : 'conj.more_other').replace(
    '{n}',
    formatNumber(overflowTotal),
  );
}

function updateConjunctionOverflow(listEl: Element, overflowTotal: number): void {
  let moreEl = listEl.querySelector('.conjunction-more');
  if (overflowTotal <= 0) {
    moreEl?.remove();
    return;
  }
  const text = formatConjunctionOverflowText(overflowTotal);
  if (!moreEl) {
    moreEl = document.createElement('p');
    moreEl.className = 'conjunction-more muted';
    listEl.appendChild(moreEl);
  }
  if (moreEl.textContent !== text) {
    moreEl.textContent = text;
  }
}

function formatAlertMessage(c: { objectA: string; objectB: string; distanceKm: number; time: Date }, nowMs: number): string {
  const msUntil = c.time.getTime() - nowMs;
  return t(msUntil > 1000 ? 'conj.alert_in' : 'conj.alert')
    .replace('{a}', c.objectA)
    .replace('{b}', c.objectB)
    .replace('{km}', c.distanceKm.toFixed(2))
    .replace('{t}', formatTimeUntil(msUntil));
}

function updateConjunctionAlertTexts(
  listEl: Element,
  conjunctions: { objectA: string; objectB: string; distanceKm: number; time: Date }[],
  nowMs: number,
): void {
  const texts = listEl.querySelectorAll('.conjunction-alert-text');
  conjunctions.forEach((c, i) => {
    const el = texts[i];
    if (!el) return;
    const message = formatAlertMessage(c, nowMs);
    if (el.textContent !== message) el.textContent = message;
  });
}

/** Tick countdowns without remounting cards (and refresh empty/scanning copy). */
function refreshConjunctionCountdowns(container: HTMLElement): void {
  const listEl = container.querySelector('#conjunction-list');
  if (!listEl) return;
  const { conjunctions } = getState();
  if (conjunctions.length === 0) {
    renderConjunctions(container);
    return;
  }
  const visible = getVisibleConjunctions();
  displayedConjunctions = visible;
  if (visible.length === 0) {
    renderConjunctions(container);
    return;
  }
  if (listEl.querySelectorAll('.conjunction-alert').length !== visible.length) {
    renderConjunctions(container);
    return;
  }
  updateConjunctionAlertTexts(listEl, visible, getGlobalSimulationTime().getTime());
}

let previousAlertKeys = new Set<string>();
let lastConjunctionStructureKey = '';
let lastConjunctionCountdownMs = 0;

/** Called every frame; updates the countdowns on the cards once a second. */
export function refreshConjunctionCountdownsEverySecond(container: HTMLElement): void {
  const now = performance.now();
  if (now - lastConjunctionCountdownMs < 1_000) return;
  lastConjunctionCountdownMs = now;
  refreshConjunctionCountdowns(container);
}

/** Sort choice, "Show more / Show less" and clicks on a close-approach card. */
export function bindConjunctionListEvents(container: HTMLElement): void {
  container.addEventListener('change', (e) => {
    const input = (e.target as HTMLElement).closest<HTMLInputElement>(
      '#conjunction-filters input[data-sort]',
    );
    if (!input?.dataset.sort) return;
    setConjunctionSortMode(input.dataset.sort as ConjunctionSortMode);
  });

  container.addEventListener('click', (e) => {
    const moreBtn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-conj-more]');
    if (moreBtn) {
      conjunctionShowCount =
        moreBtn.dataset.conjMore === 'more' ? conjunctionShowCount + SHOW_MORE_STEP : MAX_DISPLAY_ALERTS;
      renderConjunctions(container);
      // After "Show less", bring the list back into view.
      if (moreBtn.dataset.conjMore === 'less') container.querySelector('#conjunction-list')?.scrollIntoView({ block: 'nearest' });
      return;
    }
  });

  container.addEventListener('click', (e) => {
    const card = (e.target as HTMLElement).closest<HTMLButtonElement>(
      '.conjunction-alert[data-session-key]',
    );
    if (!card) return;

    e.preventDefault();
    const key = card.dataset.sessionKey;
    const match = displayedConjunctions.find((c) => conjunctionSessionKey(c) === key);
    if (match) {
      toggleConjunctionFromAlert(match);
    }
  });
}

/** Compact "in 3h 12m" / "in 45s" style duration, for predicted close approaches
 *  up to 24h out. Falls back to 0s for anything already at/past CPA. */
function formatTimeUntil(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;

  if (h > 0) return t('unit.h_m').replace('{h}', String(h)).replace('{m}', String(m));
  if (m > 0) return t('unit.m_s').replace('{m}', String(m)).replace('{s}', String(s));
  return t('unit.s').replace('{s}', String(s));
}
