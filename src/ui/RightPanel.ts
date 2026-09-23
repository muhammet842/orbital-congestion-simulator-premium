/**
 * Right panel: empty state, selected satellite detail, VERIFY chrome, or
 * historical event detail + replay HUD. Opens Spotter via #btn-spotter.
 * Re-renders on subscribe(); keep Spotter side effects idempotent.
 */
import {
  getDistanceAtTime,
  getRelativeVelocityAtTime,
  getVerificationAssessment,
  getColocatedObjectNames,
  formatRelativeVelocityKmS,
  getVerificationRewindMs,
  isCoOrbitingPair,
} from '../orbital/conjunction';
import { propagateObject, toObjectSnapshot } from '../orbital/propagator';
import type { ConjunctionEvent } from '../types';
import {
  formatUtcDateTime,
  getSimulationTime,
  getState,
  exitConjunctionView,
  setShowOrbitTrail,
  setShowGroundTrack,
  setEventReplayPartial,
  stopEventReplay,
  subscribe,
  EVENT_REPLAY_REWIND_MS,
  EVENT_REPLAY_SCRUB_STEP_MS,
  getEventReplayWindowMs,
} from '../state/appState';
import type { HistoricalEvent } from './EventCards';
import { getHistoricalEvent } from './EventCards';
import { isRecentlyLaunched } from '../data/newLaunches';
import { t, onLangChange } from '../i18n/i18n';
import { openSpotterPanel } from './SpotterPanel';

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


function verificationRiskClass(status: string): string {
  if (status === 'COLLISION CONFIRMED') return 'conjunction-risk--confirmed';
  if (status === 'COLLISION AVERTED') return 'conjunction-risk--averted';
  if (status === 'CRITICAL RISK') return 'conjunction-risk--critical';
  if (status === 'LOW RISK' || status === 'NO RISK') return 'conjunction-risk--low';
  return 'conjunction-risk--monitor';
}

/** Canonical English risk/status labels from conjunction.ts → i18n keys for display. */
const RISK_LABEL_KEYS: Record<string, string> = {
  'NO RISK': 'risk.no',
  'LOW RISK': 'risk.low',
  MONITORING: 'risk.monitoring',
  'CRITICAL RISK': 'risk.critical',
  PENDING: 'risk.pending',
  APPROACHING: 'risk.approaching',
  'COLLISION CONFIRMED': 'risk.confirmed',
  'COLLISION AVERTED': 'risk.averted',
  UNAVAILABLE: 'risk.unavailable',
};

function translateRiskLabel(label: string): string {
  const key = RISK_LABEL_KEYS[label];
  return key ? t(key, label) : label;
}

/**
 * Rebuilds the localized hint text from the assessment's status/riskLabel
 * rather than translating conjunction.ts's English `hint` string directly —
 * keeps the orbital-math module UI-agnostic (see getVerificationAssessment).
 */
function translateVerificationHint(
  assessment: ReturnType<typeof getVerificationAssessment>,
  liveDistanceKm: number | null,
): string {
  if (assessment.riskLabel === 'UNAVAILABLE') return t('conj.hint_unavailable');
  if (assessment.status === 'COLLISION CONFIRMED') {
    return t('conj.hint_confirmed').replace('{km}', (liveDistanceKm ?? 0).toFixed(3));
  }
  if (assessment.status === 'COLLISION AVERTED') {
    return t('conj.hint_averted').replace('{km}', (liveDistanceKm ?? 0).toFixed(3));
  }
  if (assessment.status === 'APPROACHING') return t('conj.hint_approaching');
  return t('conj.hint_paused');
}

export function initRightPanel(container: HTMLElement): void {
  container.innerHTML = `<div id="object-detail" class="object-detail"></div>`;

  let renderKey = '';

  const maybeRender = (): void => {
    const state = getState();
    const key = `${state.selectedIndex}|${state.selectedEventId}|${state.selectedConjunctionSessionKey}|${state.conjunctionRevision}|${state.showOrbitTrail}|${state.showGroundTrack}|${state.eventReplay?.eventId ?? ''}`;
    if (key === renderKey) return;
    renderKey = key;
    render(container);
  };

  maybeRender();
  subscribe(maybeRender);

  // Force re-render when language changes so all translated strings update
  onLangChange(() => {
    renderKey = '';
    maybeRender();
  });

  container.addEventListener('click', (e) => {
    const spotterBtn = (e.target as HTMLElement).closest('#btn-spotter');
    if (spotterBtn) {
      e.preventDefault();
      openSpotterPanel();
      return;
    }

    const trailBtn = (e.target as HTMLElement).closest('#btn-orbit-trail');
    if (trailBtn) {
      e.preventDefault();
      const { showOrbitTrail } = getState();
      setShowOrbitTrail(!showOrbitTrail);
      return;
    }

    const gtBtn = (e.target as HTMLElement).closest('#btn-ground-track');
    if (gtBtn) {
      e.preventDefault();
      const { showGroundTrack } = getState();
      setShowGroundTrack(!showGroundTrack);
      return;
    }
    const exitBtn = (e.target as HTMLElement).closest('#btn-exit-conjunction');
    if (exitBtn) {
      e.preventDefault();
      exitConjunctionView();
      return;
    }

    const replayPlayBtn = (e.target as HTMLElement).closest('#btn-replay-play');
    if (replayPlayBtn) {
      e.preventDefault();
      const { eventReplay } = getState();
      if (eventReplay) setEventReplayPartial({ playing: !eventReplay.playing });
      return;
    }

    const replayRestartBtn = (e.target as HTMLElement).closest('#btn-replay-restart');
    if (replayRestartBtn) {
      e.preventDefault();
      const { eventReplay } = getState();
      if (eventReplay) {
        setEventReplayPartial({
          currentMs: eventReplay.collisionTimeMs - EVENT_REPLAY_REWIND_MS,
          playing: true,
        });
      }
      return;
    }

    const replayBackBtn = (e.target as HTMLElement).closest('#btn-replay-back');
    if (replayBackBtn) {
      e.preventDefault();
      const { eventReplay } = getState();
      if (eventReplay) {
        setEventReplayPartial({
          currentMs: eventReplay.currentMs - EVENT_REPLAY_SCRUB_STEP_MS,
          playing: false,
        });
      }
      return;
    }

    const replayFwdBtn = (e.target as HTMLElement).closest('#btn-replay-fwd');
    if (replayFwdBtn) {
      e.preventDefault();
      const { eventReplay } = getState();
      if (eventReplay) {
        setEventReplayPartial({
          currentMs: eventReplay.currentMs + EVENT_REPLAY_SCRUB_STEP_MS,
          playing: false,
        });
      }
      return;
    }

    const replayExitBtn = (e.target as HTMLElement).closest('#btn-replay-exit');
    if (replayExitBtn) {
      e.preventDefault();
      stopEventReplay();
    }
  });

  container.addEventListener('input', (e) => {
    const scrub = (e.target as HTMLElement).closest<HTMLInputElement>('#era-scrub');
    if (!scrub) return;
    const { eventReplay } = getState();
    if (!eventReplay) return;
    const { startMs, endMs } = getEventReplayWindowMs(eventReplay.collisionTimeMs);
    const t = Number(scrub.value) / 100;
    setEventReplayPartial({
      currentMs: startMs + t * (endMs - startMs),
      playing: false,
    });
  });

  const refreshDynamicValues = (): void => {
    const state = getState();

    if (state.selectedConjunction) {
      refreshConjunctionVerification(container, state.selectedConjunction);
      return;
    }

    if (state.eventReplay) {
      refreshEventReplayHUD(container, state.eventReplay.eventId, state.eventReplay.collisionTimeMs);
      return;
    }

    if (state.selectedEventId || state.selectedIndex == null) return;

    const obj = state.objects[state.selectedIndex];
    if (!obj) return;

    const propagation = propagateObject(obj.satrec, getSimulationTime());
    if (!propagation) return;

    const snapshot = toObjectSnapshot(
      obj.noradId,
      obj.name,
      obj.category,
      obj.country,
      obj.owner,
      propagation,
    );
    const detailEl = container.querySelector('#object-detail');
    if (!detailEl) return;

    const altitude = detailEl.querySelector('[data-field="altitude"]');
    const velocity = detailEl.querySelector('[data-field="velocity"]');
    if (altitude) altitude.textContent = `${snapshot.altitudeKm.toFixed(0)} km`;
    if (velocity) velocity.textContent = `${snapshot.velocityKmS.toFixed(2)} km/s`;
  };

  const tick = (): void => {
    refreshDynamicValues();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function refreshConjunctionVerification(container: HTMLElement, conjunction: ConjunctionEvent): void {
  const detailEl = container.querySelector('#object-detail');
  if (!detailEl) return;

  const state = getState();
  const simTime = getSimulationTime();
  const liveDistance = getDistanceAtTime(
    state.objects,
    conjunction.indexA,
    conjunction.indexB,
    simTime,
  );
  const liveRelativeVelocity = getRelativeVelocityAtTime(
    state.objects,
    conjunction.indexA,
    conjunction.indexB,
    simTime,
  );
  const assessment = getVerificationAssessment(
    liveDistance,
    simTime.getTime(),
    conjunction.time.getTime(),
    conjunction.distanceKm,
    state.verificationTime?.playing ?? false,
  );

  const simTimeEl = detailEl.querySelector('[data-field="sim-time"]');
  const liveDistanceEl = detailEl.querySelector('[data-field="live-distance"]');
  const relativeVelocityEl = detailEl.querySelector('[data-field="relative-velocity"]');
  const timeToCpaEl = detailEl.querySelector('[data-field="time-to-cpa"]');
  const riskEl = detailEl.querySelector('[data-field="verification-risk"]');
  const hintEl = detailEl.querySelector('[data-field="verification-hint"]');

  if (simTimeEl) simTimeEl.textContent = formatUtcDateTime(simTime);
  if (liveDistanceEl) {
    liveDistanceEl.textContent =
      liveDistance == null ? '—' : `${liveDistance.toFixed(3)} km`;
  }
  if (relativeVelocityEl) {
    relativeVelocityEl.textContent =
      liveRelativeVelocity == null ? '—' : formatRelativeVelocityKmS(liveRelativeVelocity);
  }
  if (timeToCpaEl) {
    const msToCpa = conjunction.time.getTime() - simTime.getTime();
    timeToCpaEl.textContent =
      msToCpa > 0
        ? t('conj.t_minus').replace('{s}', String(Math.ceil(msToCpa / 1000)))
        : t('conj.t_plus').replace('{s}', String(Math.ceil(-msToCpa / 1000)));
  }
  if (riskEl) {
    riskEl.textContent = translateRiskLabel(assessment.riskLabel);
    riskEl.className = verificationRiskClass(assessment.riskLabel);
  }
  if (hintEl) hintEl.textContent = translateVerificationHint(assessment, liveDistance);
}

function render(container: HTMLElement): void {
  const detailEl = container.querySelector('#object-detail')!;
  const state = getState();

  if (state.selectedConjunction) {
    renderConjunctionDetail(detailEl, state.selectedConjunction);
    refreshConjunctionVerification(container, state.selectedConjunction);
    return;
  }

  if (state.eventReplay) {
    renderEventReplayPanel(detailEl, state.eventReplay.eventId);
    refreshEventReplayHUD(container, state.eventReplay.eventId, state.eventReplay.collisionTimeMs);
    return;
  }

  if (state.selectedEventId) {
    renderHistoricalEvent(detailEl, state.selectedEventId);
    return;
  }

  if (state.selectedIndex == null) {
    detailEl.innerHTML = `
      <h2 class="panel-heading">${t('sat.empty_title')}</h2>
      <p class="muted">${t('sat.empty_body')}</p>
    `;
    return;
  }

  const obj = state.objects[state.selectedIndex];
  if (!obj) return;

  const propagation = propagateObject(obj.satrec, getSimulationTime());
  if (!propagation) {
    detailEl.innerHTML = `
      <h2 class="panel-heading">${escapeHtml(obj.name)}</h2>
      <p class="muted">${t('sat.unavailable')}</p>
    `;
    return;
  }

  const snapshot = toObjectSnapshot(
    obj.noradId,
    obj.name,
    obj.category,
    obj.country,
    obj.owner,
    propagation,
  );

  const newBadge = isRecentlyLaunched(obj)
    ? `<span class="new-launch-badge" title="${escapeHtml(t('badge.new_launch_title'))}">${t('badge.new_launch')}</span>`
    : '';

  detailEl.innerHTML = `
    <div class="detail-header">
      <div class="norad-id">NORAD ${snapshot.noradId}</div>
      <div class="object-name">${escapeHtml(snapshot.name)}${newBadge}</div>
    </div>
    <dl class="detail-list detail-list--meta">
      <div class="detail-row"><dt>${t('sat.country')}</dt><dd>${escapeHtml(snapshot.country)}</dd></div>
      <div class="detail-row"><dt>${t('sat.operator_owner')}</dt><dd>${escapeHtml(snapshot.owner)}</dd></div>
    </dl>
    <hr class="detail-divider" />
    <dl class="detail-list">
      <div class="detail-row"><dt>${t('sat.altitude')}</dt><dd data-field="altitude">${snapshot.altitudeKm.toFixed(0)} km</dd></div>
      <div class="detail-row"><dt>${t('sat.velocity')}</dt><dd data-field="velocity">${snapshot.velocityKmS.toFixed(2)} km/s</dd></div>
      <div class="detail-row"><dt>${t('sat.layer')}</dt><dd>${snapshot.layer}</dd></div>
      <div class="detail-row"><dt>${t('sat.category')}</dt><dd>${t(`cat.${snapshot.category}`)}</dd></div>
      <div class="detail-row"><dt>${t('sat.inclination')}</dt><dd>${snapshot.inclinationDeg.toFixed(1)}°</dd></div>
    </dl>
    <button type="button" id="btn-spotter" class="btn-orbit-trail btn-spotter">
      ${t('spotter.open')}
    </button>
    <button type="button" id="btn-orbit-trail" class="btn-orbit-trail${state.showOrbitTrail ? ' active' : ''}">
      ${state.showOrbitTrail ? t('sat.hide_trail') : t('sat.show_trail')}
    </button>
    <button type="button" id="btn-ground-track" class="btn-orbit-trail${state.showGroundTrack ? ' active' : ''}">
      ${state.showGroundTrack ? t('sat.hide_ground') : t('sat.show_ground')}
    </button>
  `;
}

function renderConjunctionDetail(detailEl: Element, conjunction: ConjunctionEvent): void {
  const state = getState();
  const colocatedA = getColocatedObjectNames(state.objects, conjunction.indexA);
  const colocatedB = getColocatedObjectNames(state.objects, conjunction.indexB);
  let colocatedNote = '';
  if (colocatedA.length > 1 || colocatedB.length > 1) {
    const appearsWith =
      colocatedA.length > 1
        ? `${t('conj.colocated_appears_with')
            .replace('{name}', escapeHtml(conjunction.objectA))
            .replace('{names}', escapeHtml(colocatedA.filter((n) => n !== conjunction.objectA).join(', ')))} `
        : '';
    colocatedNote = `<p class="muted conjunction-colocated-note">${t('conj.colocated_prefix')} ${appearsWith}${t('conj.colocated_suffix')}</p>`;
  } else if (isCoOrbitingPair(conjunction.relativeVelocityKmS)) {
    colocatedNote = `<p class="muted conjunction-colocated-note">${t('conj.coorbiting_note')}</p>`;
  }

  detailEl.innerHTML = `
    <h2 class="panel-heading panel-heading--alert">${t('conj.heading')}</h2>
    <div class="conjunction-detail-title">
      ${escapeHtml(conjunction.objectA)} vs ${escapeHtml(conjunction.objectB)}
    </div>
    <dl class="detail-list">
      <div class="detail-row"><dt>${t('conj.cpa_event')}</dt><dd>${formatUtcDateTime(conjunction.time)}</dd></div>
      <div class="detail-row"><dt>${t('conj.sim_time')}</dt><dd data-field="sim-time">—</dd></div>
      <div class="detail-row"><dt>${t('conj.time_to_cpa')}</dt><dd data-field="time-to-cpa">—</dd></div>
      <div class="detail-row"><dt>${t('conj.live_separation')}</dt><dd data-field="live-distance">—</dd></div>
      <div class="detail-row"><dt>${t('conj.cpa_minimum')}</dt><dd>${conjunction.distanceKm.toFixed(3)} km</dd></div>
      <div class="detail-row"><dt>${t('conj.relative_velocity')}</dt><dd data-field="relative-velocity">—</dd></div>
      <div class="detail-row"><dt>${t('conj.risk_assessment')}</dt><dd data-field="verification-risk" class="conjunction-risk--monitor">—</dd></div>
    </dl>
    ${colocatedNote}
    <p class="muted conjunction-detail-hint" data-field="verification-hint">
      ${t('conj.hint_rewound').replace('{s}', String(Math.round(getVerificationRewindMs(conjunction.relativeVelocityKmS) / 1000)))}
    </p>
    <button type="button" id="btn-exit-conjunction" class="btn-exit-conjunction">
      ${t('conj.return_global')}
    </button>
  `;
}

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

function renderHistoricalEvent(detailEl: Element, eventId: string): void {
  const event = getHistoricalEvent(eventId);
  if (!event) {
    detailEl.innerHTML = `<p class="muted">${t('detail.event_not_found')}</p>`;
    return;
  }

  const formattedDate = new Date(`${event.date}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
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

function renderEventReplayPanel(detailEl: Element, eventId: string): void {
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
      <button type="button" id="btn-replay-back" class="btn-era-ctrl" title="Back 5 seconds">⏮</button>
      <button type="button" id="btn-replay-restart" class="btn-era-ctrl" title="Restart">↺</button>
      <button type="button" id="btn-replay-play" class="btn-era-ctrl btn-era-play" data-field="era-play-btn">⏸</button>
      <button type="button" id="btn-replay-fwd" class="btn-era-ctrl" title="Forward 5 seconds">⏭</button>
    </div>

    <button type="button" id="btn-replay-exit" class="btn-exit-conjunction">
      ${t('replay.return')}
    </button>

    ${buildInfoCard(event)}
  `;
}

function refreshEventReplayHUD(container: HTMLElement, eventId: string, collisionTimeMs: number): void {
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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
