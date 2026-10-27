/**
 * Right panel: empty state, selected satellite detail, VERIFY chrome, or
 * historical event detail + replay HUD. Opens Spotter via #btn-spotter.
 * Re-renders on subscribe(); keep Spotter side effects idempotent.
 */
import { propagateObject, toObjectSnapshot } from '../orbital/propagator';
import {
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
import { isRecentlyLaunched } from '../data/newLaunches';
import { t, onLangChange } from '../i18n/i18n';
import { openSpotterPanel } from './SpotterPanel';
import { escapeHtml } from './escapeHtml';
import { formatCountdown } from '../data/launches';
import { durationUnits } from './LaunchesPanel';
import { setTextIfChanged } from './dom';
import {
  refreshConjunctionVerification,
  renderConjunctionDetail,
} from './rightPanel/closeApproachDetail';
import {
  refreshEventReplayHUD,
  renderEventReplayPanel,
  renderHistoricalEvent,
} from './rightPanel/eventReplay';
import { renderLaunchDetail } from './rightPanel/launchDetail';
import {
  groundPositionText,
  orbitDataNote,
  renderDockedComponents,
  renderRadioFrequencies,
} from './rightPanel/objectDetail';

/** How often live values in the details panel refresh. */
const DYNAMIC_REFRESH_MS = 100;

export function initRightPanel(container: HTMLElement): void {
  container.innerHTML = `<div id="object-detail" class="object-detail"></div>`;

  let renderKey = '';
  let subjectKey = '';

  const maybeRender = (): void => {
    const state = getState();
    const key = `${state.selectedIndex}|${state.selectedEventId}|${state.selectedConjunctionSessionKey}|${state.conjunctionRevision}|${state.showOrbitTrail}|${state.showGroundTrack}|${state.eventReplay?.eventId ?? ''}|${state.selectedLaunch?.id ?? ''}`;
    if (key === renderKey) return;
    renderKey = key;
    render(container);
    // Something new to show (not just a trail toggle): start at its name, not
    // halfway down the previous object's details.
    const subject = `${state.selectedIndex}|${state.selectedEventId}|${state.selectedConjunctionSessionKey}|${state.selectedLaunch?.id ?? ''}`;
    if (subject !== subjectKey) {
      subjectKey = subject;
      container.scrollTop = 0;
    }
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

    const countdownEl = container.querySelector<HTMLElement>('[data-field="launch-countdown"]');
    if (countdownEl?.dataset.net) {
      const text = formatCountdown(Date.parse(countdownEl.dataset.net) - Date.now(), durationUnits());
      if (countdownEl.textContent !== text) countdownEl.textContent = text;
    }

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

    const snapshot = {
      ...toObjectSnapshot(obj.noradId, obj.name, obj.category, obj.country, obj.owner, propagation),
      // The catalogue layer (from the orbit's shape), so the panel agrees with the filters.
      layer: obj.layer,
    };
    const detailEl = container.querySelector('#object-detail');
    if (!detailEl) return;

    setTextIfChanged(detailEl.querySelector('[data-field="altitude"]'), `${snapshot.altitudeKm.toFixed(0)} km`);
    setTextIfChanged(detailEl.querySelector('[data-field="velocity"]'), `${snapshot.velocityKmS.toFixed(2)} km/s`);
    setTextIfChanged(detailEl.querySelector('[data-field="position"]'), groundPositionText(snapshot));
  };

  // Ten refreshes a second keep the numbers lively; doing it every frame also
  // ran an extra orbit calculation 60 times a second for no visible change.
  let lastRefreshAt = Number.NEGATIVE_INFINITY;
  const tick = (now: number): void => {
    if (now - lastRefreshAt >= DYNAMIC_REFRESH_MS) {
      lastRefreshAt = now;
      refreshDynamicValues();
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
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

  if (state.selectedIndex == null && state.selectedLaunch) {
    renderLaunchDetail(detailEl, state.selectedLaunch.id, state.selectedLaunch.name);
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

  const snapshot = {
    ...toObjectSnapshot(obj.noradId, obj.name, obj.category, obj.country, obj.owner, propagation),
    // The catalogue layer (from the orbit's shape), so the panel agrees with the filters.
    layer: obj.layer,
  };

  const newBadge = isRecentlyLaunched(obj)
    ? `<span class="new-launch-badge" title="${escapeHtml(t('badge.new_launch_title'))}">${t('badge.new_launch')}</span>`
    : '';
  // Debris has no operational radio payload. Keep the empty/dashed state for
  // spacecraft whose frequencies are unknown, but omit the section entirely
  // for fragments and rocket bodies.
  const radioSection = obj.category === 'debris'
    ? ''
    : renderRadioFrequencies(obj.radioFrequencies, obj.noradId);

  detailEl.innerHTML = `
    <div class="detail-header">
      <div class="norad-id">NORAD ${snapshot.noradId}</div>
      <div class="object-name">${escapeHtml(snapshot.name)}${newBadge}</div>
    </div>
    <dl class="detail-list detail-list--meta">
      <div class="detail-row"><dt>${t('sat.country')}</dt><dd>${escapeHtml(snapshot.country)}</dd></div>
      <div class="detail-row"><dt>${t('sat.operator_owner')}</dt><dd>${escapeHtml(snapshot.owner)}</dd></div>
      ${renderDockedComponents(obj.dockedComponents)}
    </dl>
    <hr class="detail-divider" />
    <dl class="detail-list">
      <div class="detail-row"><dt>${t('sat.altitude')}</dt><dd data-field="altitude">${snapshot.altitudeKm.toFixed(0)} km</dd></div>
      <div class="detail-row"><dt>${t('sat.velocity')}</dt><dd data-field="velocity">${snapshot.velocityKmS.toFixed(2)} km/s</dd></div>
      <div class="detail-row"><dt>${t(snapshot.layer === 'GEO' ? 'sat.slot' : 'sat.position')}</dt><dd data-field="position">${groundPositionText(snapshot)}</dd></div>
      <div class="detail-row"><dt>${t('sat.layer')}</dt><dd>${snapshot.layer}</dd></div>
      <div class="detail-row"><dt>${t('sat.category')}</dt><dd>${t(`cat.${snapshot.category}`)}</dd></div>
      <div class="detail-row"><dt>${t('sat.inclination')}</dt><dd>${snapshot.inclinationDeg.toFixed(1)}°</dd></div>
    </dl>
    ${orbitDataNote(obj)}
    ${radioSection}
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
