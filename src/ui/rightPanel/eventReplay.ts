/**
 * Historical events: the info card, the replay panel and its live HUD.
 */
import { formatUtcDateTime, getState, EVENT_REPLAY_REWIND_MS } from '../../state/appState';
import { getHistoricalEvent, type HistoricalEvent } from '../EventCards';
import { t } from '../../i18n/i18n';
import { escapeHtml } from '../escapeHtml';
import { formatDate } from '../../i18n/format';

/**
 * Compute the 3-D separation in km between the two collision objects at T-5min,
 * using the same orbital back-tracking geometry as EventReplayVisuals.setup().
 * This mirrors the slerp model so the displayed distance decreases to 0 at T=0.
 */

function computeInitialSeparationKm(event: HistoricalEvent, _startMs: number): number {
  if (!event.approachB) return 0;
  const { collisionGeo, approachA, approachB } = event;
  const GM = 398600;
  const R = 6371 + collisionGeo.altKm;
  const v = Math.sqrt(GM / R);
  const arcRad = (v * EVENT_REPLAY_REWIND_MS / 1000) / R;
  const DEG = Math.PI / 180;

  function backtrack(
    incl: number,
    asc: boolean,
  ): [number, number] { // [latRad, lonRad] at startMs
    const lat1 = collisionGeo.latDeg * DEG;
    const lon1 = collisionGeo.lonDeg * DEG;
    const sinAz = Math.min(1, Math.abs(Math.cos(incl * DEG) / Math.cos(lat1)));
    const az = Math.asin(sinAz);
    const prograde = incl <= 90;
    let bearing: number;
    if (asc) { bearing = prograde ? az : -az; }
    else      { bearing = prograde ? Math.PI - az : Math.PI + az; }
    const back = bearing + Math.PI;
    const sinLat2 = Math.sin(lat1)*Math.cos(arcRad) + Math.cos(lat1)*Math.sin(arcRad)*Math.cos(back);
    const lat2 = Math.asin(Math.max(-Math.sin(incl*DEG), Math.min(Math.sin(incl*DEG), sinLat2)));
    const n = Math.sin(back)*Math.sin(arcRad)*Math.cos(lat1);
    const d = Math.cos(arcRad)-Math.sin(lat1)*Math.sin(lat2);
    const lon2 = (Math.abs(d) < 1e-9 && Math.abs(n) < 1e-9) ? lon1 : lon1 + Math.atan2(n, d);
    return [lat2, lon2];
  }

  const [latA, lonA] = backtrack(approachA.inclinationDeg, approachA.ascending);
  const [latB, lonB] = backtrack(approachB.inclinationDeg, approachB.ascending);

  // Haversine between start positions
  const dLat = latB - latA;
  const dLon = lonB - lonA;
  const a = Math.sin(dLat/2)**2 + Math.cos(latA)*Math.cos(latB)*Math.sin(dLon/2)**2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Cache for event replay initial separation values.
 * Key = eventId, value = initial separation in km at T-5min.
 */
const replayInitialSepCache: Map<string, number> = new Map();


function buildInfoCard(event: ReturnType<typeof getHistoricalEvent>): string {
  if (!event?.info) return '';
  const eType = event.eventType ?? 'collision';
  const title   = t(`event.${event.id}.info.title`,   event.info.title);
  const reason  = t(`event.${event.id}.info.reason`,  event.info.reason);
  const outcome = t(`event.${event.id}.info.outcome`, event.info.outcome);
  return `
    <div class="eic eic--${escapeHtml(eType)}">
      <div class="eic__title">
        <span class="eic__badge">${escapeHtml(title)}</span>
      </div>
      <div class="eic__section">
        <h4 class="eic__heading">${t('detail.why')}</h4>
        <p class="eic__text">${escapeHtml(reason)}</p>
      </div>
      <div class="eic__section">
        <h4 class="eic__heading">${t('detail.outcome')}</h4>
        <p class="eic__text">${escapeHtml(outcome)}</p>
      </div>
    </div>
  `;
}

export function renderHistoricalEvent(detailEl: Element, eventId: string): void {
  const event = getHistoricalEvent(eventId);
  if (!event) {
    detailEl.innerHTML = `<p class="muted">${t('detail.event_not_found')}</p>`;
    return;
  }

  const formattedDate = formatDate(new Date(`${event.date}T00:00:00Z`), {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  detailEl.innerHTML = `
    <h2 class="panel-heading">${t('detail.historical')}</h2>
    <div class="event-detail">
      <div class="event-detail-title">${escapeHtml(t(`event.${event.id}.title`, event.title))}</div>
      <div class="event-detail-date">${formattedDate}</div>
      <p class="event-detail-description">${escapeHtml(t(`event.${event.id}.description`, event.description))}</p>
      <dl class="detail-list">
        <div class="detail-row"><dt>${t('detail.debris')}</dt><dd>${escapeHtml(event.debrisCount)}</dd></div>
      </dl>
    </div>
    ${buildInfoCard(event)}
  `;
}

const REPLAY_PANEL_META = {
  collision: { headingKey: 'replay.heading.collision', ttiKey: 'replay.tti.collision', bannerKey: 'replay.banner.collision', showSep: true  },
  asat:      { headingKey: 'replay.heading.asat',      ttiKey: 'replay.tti.asat',      bannerKey: 'replay.banner.asat',      showSep: false },
  docking:   { headingKey: 'replay.heading.docking',   ttiKey: 'replay.tti.docking',   bannerKey: 'replay.banner.docking',   showSep: true  },
  breakup:   { headingKey: 'replay.heading.breakup',   ttiKey: 'replay.tti.breakup',   bannerKey: 'replay.banner.breakup',   showSep: false },
} as const;

export function renderEventReplayPanel(detailEl: Element, eventId: string): void {
  const event = getHistoricalEvent(eventId);
  if (!event) return;

  const eType = event.eventType ?? 'collision';
  const meta  = REPLAY_PANEL_META[eType] ?? REPLAY_PANEL_META.collision;

  const objectBHtml = (() => {
    if (event.objectB) {
      return `<div class="era-sat era-sat--b" title="${escapeHtml(event.objectB.name)}">
                <span class="era-dot era-dot--b"></span>
                <span class="era-label">${escapeHtml(event.objectB.name)}</span>
              </div>`;
    }
    if (eType === 'asat') {
      return `<div class="era-sat era-sat--missile"><span class="era-missile">⚡</span><span class="era-label">${t('replay.asat_missile')}</span></div>`;
    }
    return '';
  })();

  detailEl.innerHTML = `
    <h2 class="panel-heading panel-heading--alert">${escapeHtml(t(meta.headingKey))}</h2>
    <div class="event-replay-title">${escapeHtml(t(`event.${event.id}.title`, event.title))}</div>

    <div class="event-replay-approach">
      <div class="era-sat era-sat--a" title="${escapeHtml(event.objectA.name)}">
        <span class="era-dot era-dot--a"></span>
        <span class="era-label">${escapeHtml(event.objectA.name)}</span>
      </div>
      ${objectBHtml}
    </div>

    <div class="era-timeline">
      <input
        type="range"
        id="era-scrub"
        class="era-scrub"
        min="0"
        max="100"
        step="0.1"
        value="0"
        aria-label="${t('replay.sim_time')}"
      />
      <div class="era-timeline-labels">
        <span>T−${(EVENT_REPLAY_REWIND_MS / 60000).toFixed(0)}m</span>
        <span>${eType === 'docking' ? t('replay.dock_label') : t('replay.impact_label')}</span>
      </div>
    </div>

    <dl class="detail-list era-stats">
      <div class="detail-row"><dt>${t('replay.sim_time')}</dt><dd data-field="era-simtime">—</dd></div>
      <div class="detail-row"><dt>${escapeHtml(t(meta.ttiKey))}</dt><dd data-field="era-tti">—</dd></div>
      ${meta.showSep
        ? `<div class="detail-row"><dt>${t('replay.separation')}</dt><dd data-field="era-dist">—</dd></div>`
        : ''
      }
    </dl>

    <div class="era-impact-banner" data-field="era-impact" hidden>
      <div class="era-impact-ring"></div>
      <div class="era-impact-text">${escapeHtml(t(meta.bannerKey))}</div>
    </div>

    <div class="era-completed-banner" data-field="era-completed" hidden>
      ${t('replay.complete')}
    </div>

    <div class="era-controls">
      <button type="button" id="btn-replay-back" class="btn-era-ctrl" title="${t('time.back_5s')}" aria-label="${t('time.back_5s')}">⏮</button>
      <button type="button" id="btn-replay-restart" class="btn-era-ctrl" title="${t('time.restart')}" aria-label="${t('time.restart')}">↺</button>
      <button type="button" id="btn-replay-play" class="btn-era-ctrl btn-era-play" data-field="era-play-btn" aria-label="${t('time.pause')}">⏸</button>
      <button type="button" id="btn-replay-fwd" class="btn-era-ctrl" title="${t('time.fwd_5s')}" aria-label="${t('time.fwd_5s')}">⏭</button>
    </div>

    <button type="button" id="btn-replay-exit" class="btn-exit-conjunction">
      ${t('replay.return')}
    </button>

    ${buildInfoCard(event)}
  `;
}

export function refreshEventReplayHUD(container: HTMLElement, eventId: string, collisionTimeMs: number): void {
  const detailEl = container.querySelector('#object-detail');
  if (!detailEl) return;

  const { eventReplay } = getState();
  if (!eventReplay) return;

  const simTime = new Date(eventReplay.currentMs);
  const msToImpact = collisionTimeMs - eventReplay.currentMs;
  const totalWindow = EVENT_REPLAY_REWIND_MS;
  const elapsed = totalWindow - msToImpact;
  const progress = Math.max(0, Math.min(1, elapsed / totalWindow));

  const simTimeEl = detailEl.querySelector('[data-field="era-simtime"]');
  const ttiEl = detailEl.querySelector('[data-field="era-tti"]');
  const distEl = detailEl.querySelector('[data-field="era-dist"]');
  const scrubEl = detailEl.querySelector<HTMLInputElement>('#era-scrub');
  const impactEl = detailEl.querySelector<HTMLElement>('[data-field="era-impact"]');
  const playBtn = detailEl.querySelector<HTMLElement>('[data-field="era-play-btn"]');

  if (simTimeEl) simTimeEl.textContent = formatUtcDateTime(simTime);

  if (ttiEl) {
    if (msToImpact > 0) {
      const secs = Math.ceil(msToImpact / 1000);
      ttiEl.textContent = secs >= 60
        ? `T−${Math.floor(secs / 60)}m ${secs % 60}s`
        : `T−${secs}s`;
      ttiEl.className = '';
    } else {
      const secsPast = Math.abs(Math.floor(msToImpact / 1000));
      ttiEl.textContent = `T+${secsPast}s`;
      ttiEl.className = 'era-past-impact';
    }
  }

  if (scrubEl && document.activeElement !== scrubEl) {
    scrubEl.value = String(progress * 100);
  }

  if (playBtn) {
    playBtn.textContent = eventReplay.playing ? '⏸' : '▶';
    playBtn.setAttribute('aria-label', t(eventReplay.playing ? 'time.pause' : 'time.play'));
  }

  // Distance — computed from the same linear slerp model used in EventReplayVisuals.
  // separation(progress) = (1 − progress) × initialSeparationKm  → 0 at T=0.
  if (distEl) {
    const event = getHistoricalEvent(eventId);
    if (event?.approachB) {
      // Compute initialSeparationKm once: 3-D distance between the two backtracked
      // start positions. Uses the same geometry as EventReplayVisuals.setup().
      if (!replayInitialSepCache.has(eventId)) {
        const startMs = collisionTimeMs - EVENT_REPLAY_REWIND_MS;
        const sep = computeInitialSeparationKm(event, startMs);
        replayInitialSepCache.set(eventId, sep);
      }
      const startMs = collisionTimeMs - EVENT_REPLAY_REWIND_MS;
      const progress = Math.max(0, Math.min(1,
        (eventReplay.currentMs - startMs) / (collisionTimeMs - startMs),
      ));
      const initialSep = replayInitialSepCache.get(eventId) ?? 0;
      const distKm = (1 - progress) * initialSep;
      distEl.textContent = distKm < 1
        ? `${distKm.toFixed(2)} km`
        : `${distKm.toFixed(0)} km`;
    }
  }

  // Impact banner — show from T=0 onwards (replay pauses here automatically)
  if (impactEl) {
    const atOrPastImpact = msToImpact <= 0;
    impactEl.hidden = !atOrPastImpact;
    impactEl.classList.toggle('era-impact--active', atOrPastImpact);
  }

  // "Replay complete" label: visible when paused at the collision moment
  const completedEl = container.querySelector<HTMLElement>('[data-field="era-completed"]');
  if (completedEl) {
    const pausedAtImpact = msToImpact <= 0 && !eventReplay.playing;
    completedEl.hidden = !pausedAtImpact;
  }
}
