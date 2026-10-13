/**
 * "Upcoming Launches" section of the left panel.
 *
 * Shows the next launches (and any in flight): rocket, provider, pad, destination
 * and a live countdown. Picking a launch marks its pad on the globe; for ISS
 * missions a second action selects the station. Data comes from our own
 * /api/launches function (see src/data/launches.ts).
 *
 * Countdowns use the real wall clock, not the simulation clock: a launch is a
 * real-world event, whatever time the globe is currently showing.
 */
import { getLang, onLangChange, t } from '../i18n/i18n';
import {
  ISS_NORAD_ID,
  fetchLaunches,
  formatCountdown,
  launchPollIntervalMs,
  type Launch,
} from '../data/launches';
import { getState, selectLaunch, selectObject, subscribe } from '../state/appState';
import { escapeHtml, safeHttpUrl } from './escapeHtml';

type LoadState = 'loading' | 'ready' | 'error';

const RETRY_AFTER_ERROR_MS = 60_000;
const LOCALES: Record<string, string> = { en: 'en-GB', tr: 'tr-TR', de: 'de-DE', ru: 'ru-RU', zh: 'zh-CN' };

function formatNet(netIso: string): string {
  const locale = LOCALES[getLang()] ?? 'en-GB';
  const text = new Date(netIso).toLocaleString(locale, {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${text} UTC`;
}

/** Status chips only where they add information: "Go" and "date TBD" are the quiet default. */
const CHIP_STATUSES: ReadonlySet<string> = new Set(['tbc', 'hold', 'in_flight', 'success', 'failure', 'partial_failure']);

/** "Cape Canaveral SFS, FL, USA" -> "Cape Canaveral SFS". */
function shortPlace(launch: Launch): string | null {
  const full = launch.locationName ?? launch.padName;
  return full ? full.split(',')[0].trim() : null;
}

function renderCard(launch: Launch, selectedId: string | null, issAvailable: boolean, nowMs: number): string {
  const selected = launch.id === selectedId;
  const hasPad = launch.latitude != null && launch.longitude != null;

  // "Unknown Payload" says nothing: lead with the rocket instead.
  const unknownPayload = /^unknown payload$/i.test(launch.name);
  const title = unknownPayload ? launch.rocket : launch.name;
  const subtitle = (unknownPayload ? [launch.provider] : [launch.rocket, launch.provider]).filter(Boolean).join(' · ');
  const route = [shortPlace(launch), launch.destination].filter(Boolean).join(' → ');

  // A placeholder date is not a countdown.
  const dateTbd = launch.status === 'tbd';
  const countdown = dateTbd ? t('launch.status.tbd') : formatCountdown(Date.parse(launch.net) - nowMs);
  const exactTime = `${t('launch.net')} ${formatNet(launch.net)}`;
  const chip = CHIP_STATUSES.has(launch.status)
    ? `<span class="launch-status launch-status--${launch.status}">${escapeHtml(t(`launch.status.${launch.status}`))}</span>`
    : '';

  const actions: string[] = [];
  if (launch.toIss && issAvailable) {
    actions.push(`<button type="button" class="launch-action" data-action="iss">${escapeHtml(t('launch.show_iss'))}</button>`);
  }
  if (launch.webcastUrl) {
    actions.push(
      `<a class="launch-action" href="${escapeHtml(safeHttpUrl(launch.webcastUrl))}" target="_blank" rel="noopener noreferrer">${escapeHtml(t('launch.watch'))}</a>`,
    );
  }

  return `
    <article class="launch-card launch-card--${launch.status}${selected ? ' launch-card--selected' : ''}" data-launch-id="${escapeHtml(launch.id)}">
      <button type="button" class="launch-card-main" data-action="site" aria-pressed="${selected}"${hasPad ? '' : ' disabled'}>
        ${chip}
        <span class="launch-card-top">
          <span class="launch-name" title="${escapeHtml(title)}">${escapeHtml(title)}</span>
          <span class="launch-countdown"${dateTbd ? '' : ` data-net="${escapeHtml(launch.net)}"`} title="${escapeHtml(exactTime)}">${escapeHtml(countdown)}</span>
        </span>
        <span class="launch-meta">${escapeHtml(subtitle)}</span>
        ${route ? `<span class="launch-meta">${escapeHtml(route)}</span>` : ''}
      </button>
      ${actions.length ? `<div class="launch-actions">${actions.join('')}</div>` : ''}
    </article>
  `;
}

/** Mounts the section at the end of `container`; returns a function that stops its timers. */
export function initLaunchesPanel(container: HTMLElement): () => void {
  const section = document.createElement('section');
  section.id = 'tour-region-launches';
  section.className = 'launches-section tour-region';
  section.innerHTML = `
    <h2 class="panel-heading" data-i18n="ui.launches">${escapeHtml(t('ui.launches'))}</h2>
    <p class="panel-lede" data-i18n="launch.lede">${escapeHtml(t('launch.lede'))}</p>
    <div class="launch-list" id="launch-list" aria-live="polite"></div>
    <p class="muted launch-credit" data-i18n="launch.credit">${escapeHtml(t('launch.credit'))}</p>
  `;
  container.appendChild(section);
  const listEl = section.querySelector<HTMLElement>('#launch-list')!;

  let launches: Launch[] = [];
  let loadState: LoadState = 'loading';
  let pollTimer: number | undefined;
  let stopped = false;

  const render = (): void => {
    if (loadState === 'loading' && launches.length === 0) {
      listEl.innerHTML = `<p class="muted launch-empty">${escapeHtml(t('launch.loading'))}</p>`;
      return;
    }
    if (launches.length === 0) {
      const key = loadState === 'error' ? 'launch.unavailable' : 'launch.empty';
      listEl.innerHTML = `<p class="muted launch-empty">${escapeHtml(t(key))}</p>`;
      return;
    }
    const state = getState();
    const issAvailable = state.objects.some((o) => o.noradId === ISS_NORAD_ID);
    const now = Date.now();
    listEl.innerHTML = launches
      .map((launch) => renderCard(launch, state.selectedLaunch?.id ?? null, issAvailable, now))
      .join('');
  };

  const tickCountdowns = (): void => {
    const now = Date.now();
    listEl.querySelectorAll<HTMLElement>('.launch-countdown[data-net]').forEach((el) => {
      const text = formatCountdown(Date.parse(el.dataset.net ?? '') - now);
      if (el.textContent !== text) el.textContent = text;
    });
  };

  const refresh = async (): Promise<void> => {
    if (stopped) return;
    let next = RETRY_AFTER_ERROR_MS;
    try {
      launches = await fetchLaunches();
      loadState = 'ready';
      next = launchPollIntervalMs(launches, Date.now());
    } catch {
      // Keep any launches we already have; only show "unavailable" when there are none.
      loadState = 'error';
    }
    if (stopped) return;
    render();
    pollTimer = window.setTimeout(() => void refresh(), next);
  };

  listEl.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
    const card = button?.closest<HTMLElement>('[data-launch-id]');
    if (!button || !card) return;
    const launch = launches.find((l) => l.id === card.dataset.launchId);
    if (!launch) return;

    if (button.dataset.action === 'site') {
      if (launch.latitude == null || launch.longitude == null) return;
      if (getState().selectedLaunch?.id === launch.id) {
        selectLaunch(null);
      } else {
        selectLaunch({
          id: launch.id,
          name: launch.name,
          latitudeDeg: launch.latitude,
          longitudeDeg: launch.longitude,
          padName: launch.padName,
        });
      }
    } else if (button.dataset.action === 'iss') {
      const index = getState().objects.findIndex((o) => o.noradId === ISS_NORAD_ID);
      if (index >= 0) selectObject(index);
    }
  });

  // Re-render on selection / catalog changes (cheap: a handful of cards).
  let lastSelectedId = getState().selectedLaunch?.id ?? null;
  let lastObjects = getState().objects;
  const unsubscribeState = subscribe(() => {
    const s = getState();
    const id = s.selectedLaunch?.id ?? null;
    if (id !== lastSelectedId || s.objects !== lastObjects) {
      lastSelectedId = id;
      lastObjects = s.objects;
      render();
    }
  });
  const unsubscribeLang = onLangChange(render);
  const tickTimer = window.setInterval(tickCountdowns, 1000);

  render();
  void refresh();

  return () => {
    stopped = true;
    window.clearTimeout(pollTimer);
    window.clearInterval(tickTimer);
    unsubscribeState();
    unsubscribeLang();
  };
}
