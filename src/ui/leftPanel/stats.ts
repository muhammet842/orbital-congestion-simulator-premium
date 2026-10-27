/**
 * Object Categories, Live Stats and the note about objects left out for old data.
 */
import { countStaleScreeningExclusions } from '../../orbital/conjunction';
import {
  formatUtcDateTime,
  getSimulationTime,
  getState,
  isConjunctionVerificationActive,
  isEventReplayActive,
} from '../../state/appState';
import { t } from '../../i18n/i18n';
import { STALE_TLE_AGE_DAYS } from '../../data/tleLoader';
import { icon } from '../icons';
import { formatDate, formatNumber } from '../../i18n/format';

/** Stale-TLE count per catalogue: it only changes when a new catalogue loads. */
const staleCounts = new WeakMap<readonly object[], number>();

/** Says how many LEO objects the close-approach screen skips for old TLEs. */
export function renderStaleNote(container: HTMLElement): void {
  const el = container.querySelector<HTMLElement>('#conjunction-stale-note');
  if (!el) return;
  const { objects } = getState();
  let count = staleCounts.get(objects);
  if (count === undefined) {
    count = countStaleScreeningExclusions(objects);
    staleCounts.set(objects, count);
  }
  const text =
    count === 0
      ? ''
      : t(count === 1 ? 'conj.stale_excluded_one' : 'conj.stale_excluded_other')
          .replace('{n}', formatNumber(count))
          .replace('{days}', String(STALE_TLE_AGE_DAYS));
  if (el.textContent !== text) el.textContent = text;
  el.hidden = count === 0;
}

/** Everything renderStats shows except the clock (which ticks on its own). */
export function statsRenderKey(): string {
  const { stats, time, filteredIndices, conjunctions, conjunctionHiddenCount } = getState();
  const isLive = time.mode === 'live' && !isEventReplayActive() && !isConjunctionVerificationActive();
  const ageDays = stats.fetchedAt ? Math.floor((Date.now() - new Date(stats.fetchedAt).getTime()) / 86_400_000) : 0;
  return [
    stats.total,
    Object.values(stats.categoryCounts).join(','),
    stats.fetchedAt,
    ageDays,
    isLive,
    filteredIndices.length,
    conjunctions.length + conjunctionHiddenCount,
  ].join('|');
}

export function renderStats(container: HTMLElement): void {
  const state = getState();
  const { stats, time } = state;
  const isLive =
    time.mode === 'live' &&
    !isEventReplayActive() &&
    !isConjunctionVerificationActive();
  const simTime = getSimulationTime();

  const categoryEl = container.querySelector('#category-stats')!;
  categoryEl.innerHTML = `
    <li><span>${t('cat.active')}</span><strong>${formatNumber(stats.categoryCounts.active)}</strong></li>
    <li><span>${t('cat.debris')}</span><strong>${formatNumber(stats.categoryCounts.debris)}</strong></li>
    <li><span>${t('cat.stations')}</span><strong>${formatNumber(stats.categoryCounts.stations)}</strong></li>
  `;

  const fetchedDate = stats.fetchedAt
    ? formatDate(new Date(stats.fetchedAt), { day: 'numeric', month: 'short', year: 'numeric' })
    : '—';

  const tleAgeDays = stats.fetchedAt
    ? (Date.now() - new Date(stats.fetchedAt).getTime()) / 86_400_000
    : 0;

  const tleStaleHtml = tleAgeDays > 7
    ? `<div class="tle-stale-banner tle-stale-banner--critical">${icon('alert', 15)}<span>${t('tle.critical').replace('{n}', String(Math.floor(tleAgeDays)))}</span></div>`
    : tleAgeDays > 3
    ? `<div class="tle-stale-banner tle-stale-banner--warn">${icon('alert', 15)}<span>${t('tle.warn').replace('{n}', String(Math.floor(tleAgeDays)))}</span></div>`
    : '';

  const liveEl = container.querySelector('#live-stats')!;
  const timeLabel = isLive ? t('stats.utc_time') : t('stats.sim_time');
  const visibleCount = state.filteredIndices.length;
  const closeApproachTotal = state.conjunctions.length + state.conjunctionHiddenCount;

  liveEl.innerHTML = `
    ${tleStaleHtml}
    <div class="stat-row"><dt>${timeLabel}</dt><dd id="live-stat-time">${formatUtcDateTime(simTime)}</dd></div>
    <div class="stat-row"><dt>${t('stats.total')}</dt><dd>${formatNumber(stats.total)}</dd></div>
    <div class="stat-row"><dt>${t('stats.visible')}</dt><dd>${formatNumber(visibleCount)}</dd></div>
    <div class="stat-row"><dt>${t('stats.close_24h')}</dt><dd>${formatNumber(closeApproachTotal)}</dd></div>
    <div class="stat-row"><dt>${t('stats.tle_updated')}</dt><dd>${fetchedDate}</dd></div>
  `;
}
