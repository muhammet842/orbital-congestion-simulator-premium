/**
 * Live Satellite Spotter — sky map + turn / tilt guide for the selected object.
 *
 * Look direction follows the back camera (through the screen into the sky),
 * not the top bezel. Shows how far to rotate and tip until the target is centered.
 * Heavy globe rendering is paused while this panel is open.
 *
 * Always uses wall-clock UTC — never the simulator’s 10×/100× speed — so the
 * sky map matches what is overhead now. Catalog scan is chunked (skyScan) to
 * avoid multi-thousand SGP4 stalls on the UI thread.
 */

import {
  assessPhotoConditions,
  computeLookAngles,
  findNextPass,
  GOOD_ELEV_DEG,
  headingDelta,
  skyAngularSeparationDeg,
  type LookAngles,
  type PassEvent,
} from '../orbital/lookAngles';
import {
  CARDINAL_AZIMUTHS,
  DEFAULT_FOV_DEG,
  MAX_FOV_DEG,
  MIN_FOV_DEG,
  horizonYForPitch,
  projectAzElToCanvas,
  skyAngularDistanceDeg,
} from '../orbital/skyProjection';
import {
  buildSkyScanPool,
  finalizeSkyScanHits,
  scanSkyCandidatesChunk,
  type SkyScanHit,
  type SkyScanObject,
} from '../orbital/skyScan';
import { createSkyViewStabilizer } from '../orbital/skyViewStabilizer';
import { getFunctionGroupColor } from '../orbital/classify';
import type { ObjectFunctionGroup } from '../types';
import { getSunEci } from '../scene/dayNight';
import { getState, isLiveMode, subscribe } from '../state/appState';
import { onLangChange, t } from '../i18n/i18n';
import {
  GPS_ACCURACY_WARN_M,
  getSensorSnapshot,
  setManualLocation,
  startObserverSensors,
  startOrientation,
  stopObserverSensors,
  subscribeSensors,
  type SensorSnapshot,
} from './observerSensors';
import { escapeHtml } from './escapeHtml';
import { icon } from './icons';

let backdropEl: HTMLElement | null = null;
let panelEl: HTMLElement | null = null;
let timerId = 0;
let unsubState: (() => void) | null = null;
let unsubSensors: (() => void) | null = null;
let unsubLang: (() => void) | null = null;
let lastLook: LookAngles | null = null;
let lastLookMs = 0;
let lastTurnText = '';
let lastTiltText = '';
let lastSelectedIndex: number | null = null;
let skyCanvas: HTMLCanvasElement | null = null;
let skyCtx: CanvasRenderingContext2D | null = null;
let lastSkyKey = '';
let cachedPass: PassEvent | null = null;
let cachedPassKey = '';
let passComputeScheduled = false;
let lastLightText = '';
let lastChipsHtml = '';
let lastPhoto: PhotoAssessment | null = null;
let skyHits: SkyScanHit[] = [];
let lastSkyScanMs = 0;
let lastSkyProgressMs = 0;
let lastSkyCountText = '';
/** Current horizontal FOV for sky projection (pinch / buttons). */
let skyFovDeg = DEFAULT_FOV_DEG;
let pinchStartDist = 0;
let pinchStartFov = DEFAULT_FOV_DEG;
let zoomUnbind: (() => void) | null = null;
/** Soft EMA sky follow — no hard freeze when paused on a satellite. */
const skyViewStab = createSkyViewStabilizer({
  autoFreeze: false,
  followAlpha: 0.42,
});
/** Chunked catalog scan state (avoids multi-thousand SGP4 stalls). */
let skyScanActive = false;
let skyScanIndex = 0;
let skyScanAccum: SkyScanHit[] = [];
let skyScanObjects: SkyScanObject[] = [];
let skyScanView = { headingDeg: 0, pitchDeg: 45 };
let skyScanSelectedId: number | null = null;
let skyScanObserver: { latitudeDeg: number; longitudeDeg: number; altitudeKm: number } | null =
  null;
let skyScanDateMs = 0;

type PhotoAssessment = NonNullable<ReturnType<typeof assessPhotoConditions>>;

/** Poll sensors + refresh guide (no continuous rAF). */
const TICK_MS = 100;
/** Recompute selected satellite az/el at most this often. */
const LOOK_INTERVAL_MS = 500;
/** Start a new sky scan at most this often (after one completes). */
const SKY_SCAN_INTERVAL_MS = 5_000;
/** Force a new scan when look moves this far from last scan view. */
const SKY_RESCAN_VIEW_DEG = 18;
/** Max objects to SGP4 per tick (also capped by time budget). */
const SKY_SCAN_CHUNK = 120;
/** Soft wall-clock budget for one scan chunk (ms) — keeps the UI responsive. */
const SKY_SCAN_BUDGET_MS = 6;
/** Publish interim dots this often while a scan is still running. */
const SKY_SCAN_PROGRESS_MS = 350;
/** Cap dots drawn on the sky canvas. */
const SKY_MAX_HITS = 50;
const DEADBAND_DEG = 3;
/** Warn in Spotter when catalog is older than this (LEO drifts fast). */
const TLE_STALE_WARN_DAYS = 2;
/** Photo-condition refresh cadence (sunlit / daytime). */
const PHOTO_INTERVAL_MS = 2_000;
const SKY_CSS_W = 320;
const SKY_CSS_H = 280;
let lastPhotoMs = 0;

/** Spotter aims at the real sky — always wall-clock, never 10x/100x sim time. */
function getSpotterTime(): Date {
  return new Date();
}

export function isSpotterOpen(): boolean {
  return backdropEl != null;
}

export function openSpotterPanel(): void {
  if (backdropEl) return;
  const state = getState();
  if (state.selectedIndex == null) return;

  const backdrop = document.createElement('div');
  backdrop.id = 'spotter-backdrop';
  backdrop.className = 'spotter-backdrop';

  const panel = document.createElement('div');
  panel.id = 'spotter-panel';
  panel.className = 'spotter-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');

  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);
  backdropEl = backdrop;
  panelEl = panel;

  lastLook = null;
  lastLookMs = 0;
  lastTurnText = '';
  lastTiltText = '';
  lastSelectedIndex = state.selectedIndex;
  skyCanvas = null;
  skyCtx = null;
  lastSkyKey = '';
  cachedPass = null;
  cachedPassKey = '';
  passComputeScheduled = false;
  lastLightText = '';
  lastChipsHtml = '';
  lastPhoto = null;
  lastPhotoMs = 0;
  skyHits = [];
  lastSkyScanMs = 0;
  lastSkyProgressMs = 0;
  lastSkyCountText = '';
  skyFovDeg = DEFAULT_FOV_DEG;
  pinchStartDist = 0;
  pinchStartFov = DEFAULT_FOV_DEG;
  skyViewStab.reset();
  resetSkyScanState();

  startObserverSensors();
  renderShell();
  bindShellEvents();

  unsubSensors = subscribeSensors(() => {
    // Location/permission only — do not nuke an in-flight sky scan on every GPS tick.
    cachedPass = null;
    cachedPassKey = '';
    tick();
  });
  unsubState = subscribe(() => {
    const s = getState();
    if (s.selectedIndex == null) {
      closeSpotterPanel();
      return;
    }
    // Ignore simulation-time churn — only react to selection changes.
    if (s.selectedIndex !== lastSelectedIndex) {
      lastSelectedIndex = s.selectedIndex;
      lastLook = null;
      cachedPass = null;
      cachedPassKey = '';
      skyHits = [];
      lastSkyScanMs = 0;
      lastSkyKey = '';
      resetSkyScanState();
      renderShell();
      bindShellEvents();
      tick();
    }
  });
  unsubLang = onLangChange(() => {
    renderShell();
    bindShellEvents();
    tick();
  });

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeSpotterPanel();
  });
  document.addEventListener('keydown', handleEsc);

  tick();
  timerId = window.setInterval(tick, TICK_MS);
}

export function closeSpotterPanel(): void {
  if (timerId) {
    clearInterval(timerId);
    timerId = 0;
  }
  stopObserverSensors();
  unsubState?.();
  unsubSensors?.();
  unsubLang?.();
  unsubState = null;
  unsubSensors = null;
  unsubLang = null;
  document.removeEventListener('keydown', handleEsc);
  backdropEl?.remove();
  backdropEl = null;
  panelEl = null;
  skyCanvas = null;
  skyCtx = null;
  lastLook = null;
  cachedPass = null;
  cachedPassKey = '';
  skyHits = [];
  resetSkyScanState();
  skyViewStab.reset();
  zoomUnbind?.();
  zoomUnbind = null;
}

function resetSkyScanState(): void {
  skyScanActive = false;
  skyScanIndex = 0;
  skyScanAccum = [];
  skyScanObjects = [];
  skyScanSelectedId = null;
  skyScanObserver = null;
  skyScanDateMs = 0;
}

function handleEsc(e: KeyboardEvent): void {
  if (e.key === 'Escape') closeSpotterPanel();
}

function renderShell(): void {
  if (!panelEl) return;
  const state = getState();
  const obj = state.selectedIndex != null ? state.objects[state.selectedIndex] : null;
  const name = obj?.name ?? '—';
  const sensors = getSensorSnapshot();
  const lat = sensors.location?.latitudeDeg.toFixed(5) ?? '';
  const lon = sensors.location?.longitudeDeg.toFixed(5) ?? '';
  const needLoc = !sensors.location;

  panelEl.innerHTML = `
    <div class="spotter-header">
      <div class="spotter-title">${t('spotter.title')}</div>
      <button type="button" class="spotter-close" id="spotter-close" aria-label="${t('spotter.close')}">${icon('close')}</button>
    </div>
    <div class="spotter-body spotter-body--sky">
      <p class="spotter-target">${escapeHtml(name)}</p>

      <div class="spotter-sky-wrap">
        <canvas id="spotter-sky" class="spotter-sky" width="${SKY_CSS_W}" height="${SKY_CSS_H}" aria-label="${t('spotter.sky_label')}"></canvas>
        <div class="spotter-sky-hud" aria-live="polite">
          <p class="spotter-cue spotter-cue--turn" id="spotter-turn">—</p>
          <p class="spotter-cue spotter-cue--tilt" id="spotter-tilt">—</p>
        </div>
        <div class="spotter-sky-zoom" role="group" aria-label="${t('spotter.sky_zoom')}">
          <button type="button" class="spotter-zoom-btn" id="spotter-zoom-out" aria-label="${t('spotter.sky_zoom_out')}">−</button>
          <button type="button" class="spotter-zoom-btn" id="spotter-zoom-in" aria-label="${t('spotter.sky_zoom_in')}">+</button>
        </div>
        <p class="spotter-sky-meta" id="spotter-sky-meta"></p>
      </div>
      <div class="spotter-sky-legend" aria-hidden="true">
        <span class="spotter-legend-item"><i class="spotter-legend-dot spotter-legend-dot--station"></i>${t('spotter.sky_legend_stations')}</span>
        <span class="spotter-legend-item"><i class="spotter-legend-dot spotter-legend-dot--active"></i>${t('spotter.sky_legend_sats')}</span>
        <span class="spotter-legend-item"><i class="spotter-legend-dot spotter-legend-dot--starlink"></i>${t('spotter.sky_legend_starlink')}</span>
      </div>

      <div class="spotter-chips" id="spotter-chips"></div>
      <p class="spotter-light" id="spotter-light"></p>
      ${!isLiveMode() ? `<p class="spotter-realtime-note">${t('spotter.realtime_only')}</p>` : ''}

      <details class="spotter-sensors" ${needLoc ? 'open' : ''}>
        <summary>${t('spotter.location')} · <span id="spotter-loc-status">${locationStatusText(sensors)}</span></summary>
        <div class="spotter-manual">
          <label>${t('spotter.lat')}
            <input id="spotter-lat" type="number" step="0.0001" value="${lat}" />
          </label>
          <label>${t('spotter.lon')}
            <input id="spotter-lon" type="number" step="0.0001" value="${lon}" />
          </label>
          <button type="button" id="spotter-apply-loc" class="spotter-btn spotter-btn--secondary">${t('spotter.apply_location')}</button>
        </div>
        <button type="button" id="spotter-enable-compass" class="spotter-btn spotter-btn--secondary">${t('spotter.enable_compass')}</button>
      </details>
    </div>
  `;
  skyCanvas = panelEl.querySelector('#spotter-sky');
  skyCtx = skyCanvas?.getContext('2d') ?? null;
  lastTurnText = '';
  lastTiltText = '';
  lastLightText = '';
  lastChipsHtml = '';
  lastSkyCountText = '';
  lastSkyKey = '';
}

function bindShellEvents(): void {
  panelEl?.querySelector('#spotter-close')?.addEventListener('click', closeSpotterPanel);
  panelEl?.querySelector('#spotter-enable-compass')?.addEventListener('click', () => {
    void startOrientation();
  });
  panelEl?.querySelector('#spotter-apply-loc')?.addEventListener('click', () => {
    const latEl = panelEl?.querySelector<HTMLInputElement>('#spotter-lat');
    const lonEl = panelEl?.querySelector<HTMLInputElement>('#spotter-lon');
    if (!latEl || !lonEl) return;
    const latitudeDeg = Number(latEl.value);
    const longitudeDeg = Number(lonEl.value);
    if (!Number.isFinite(latitudeDeg) || !Number.isFinite(longitudeDeg)) return;
    setManualLocation({ latitudeDeg, longitudeDeg, altitudeKm: 0 });
  });
  bindSkyZoomControls();
}

function clampSkyFov(fov: number): number {
  return Math.min(MAX_FOV_DEG, Math.max(MIN_FOV_DEG, fov));
}

function setSkyFov(next: number): void {
  const clamped = clampSkyFov(next);
  if (Math.abs(clamped - skyFovDeg) < 0.05) return;
  skyFovDeg = clamped;
  lastSkyKey = '';
  lastSkyScanMs = 0;
  tick();
}

function touchDistance(a: Touch, b: Touch): number {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function bindSkyZoomControls(): void {
  zoomUnbind?.();
  zoomUnbind = null;
  const canvas = panelEl?.querySelector<HTMLCanvasElement>('#spotter-sky');
  const zoomIn = panelEl?.querySelector('#spotter-zoom-in');
  const zoomOut = panelEl?.querySelector('#spotter-zoom-out');
  if (!canvas) return;

  const onZoomIn = () => setSkyFov(skyFovDeg * 0.82);
  const onZoomOut = () => setSkyFov(skyFovDeg * 1.22);
  zoomIn?.addEventListener('click', onZoomIn);
  zoomOut?.addEventListener('click', onZoomOut);

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.08 : 0.92;
    setSkyFov(skyFovDeg * factor);
  };
  canvas.addEventListener('wheel', onWheel, { passive: false });

  const onTouchStart = (e: TouchEvent) => {
    if (e.touches.length === 2) {
      pinchStartDist = touchDistance(e.touches[0], e.touches[1]);
      pinchStartFov = skyFovDeg;
    }
  };
  const onTouchMove = (e: TouchEvent) => {
    if (e.touches.length !== 2 || pinchStartDist <= 0) return;
    e.preventDefault();
    const dist = touchDistance(e.touches[0], e.touches[1]);
    // Pinch out → zoom in (narrower FOV)
    setSkyFov(pinchStartFov * (pinchStartDist / dist));
  };
  const onTouchEnd = () => {
    if (!canvas) return;
    // Reset pinch baseline when fingers lift
    pinchStartDist = 0;
  };
  canvas.addEventListener('touchstart', onTouchStart, { passive: true });
  canvas.addEventListener('touchmove', onTouchMove, { passive: false });
  canvas.addEventListener('touchend', onTouchEnd);
  canvas.addEventListener('touchcancel', onTouchEnd);

  zoomUnbind = () => {
    zoomIn?.removeEventListener('click', onZoomIn);
    zoomOut?.removeEventListener('click', onZoomOut);
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('touchstart', onTouchStart);
    canvas.removeEventListener('touchmove', onTouchMove);
    canvas.removeEventListener('touchend', onTouchEnd);
    canvas.removeEventListener('touchcancel', onTouchEnd);
  };
}

function locationStatusText(sensors: SensorSnapshot): string {
  if (sensors.locationSource === 'gps') {
    const acc = sensors.accuracyMeters;
    if (acc != null && acc >= GPS_ACCURACY_WARN_M) {
      return t('spotter.loc_gps_weak').replace('{m}', Math.round(acc).toString());
    }
    return t('spotter.loc_gps');
  }
  if (sensors.locationSource === 'manual') return t('spotter.loc_manual');
  if (sensors.locationSource === 'cached') return t('spotter.loc_cached');
  if (sensors.locationError === 'denied') return t('spotter.loc_denied');
  if (sensors.locationError === 'unsupported') return t('spotter.loc_unsupported');
  return t('spotter.loc_waiting');
}

function tick(): void {
  if (!panelEl) return;
  const state = getState();
  const sensors = getSensorSnapshot();
  const now = performance.now();

  const locStatus = panelEl.querySelector('#spotter-loc-status');
  if (locStatus) locStatus.textContent = locationStatusText(sensors);

  if (state.selectedIndex == null || !sensors.location) {
    lastLook = null;
    lastPhoto = null;
    skyHits = [];
    setCue('spotter-turn', t('spotter.need_location'));
    setCue('spotter-tilt', '');
    setLight('');
    setChipsHtml('');
    setSkyMeta('');
    maybeDrawSky(sensors, null);
    return;
  }

  const obj = state.objects[state.selectedIndex];
  if (!lastLook || now - lastLookMs >= LOOK_INTERVAL_MS) {
    lastLookMs = now;
    lastLook = computeLookAngles(obj.satrec, sensors.location, getSpotterTime());
  }

  if (lastLook?.visible && (now - lastPhotoMs >= PHOTO_INTERVAL_MS || !lastPhoto)) {
    lastPhotoMs = now;
    lastPhoto = assessPhotoConditions(
      obj.satrec,
      sensors.location,
      getSpotterTime(),
      getSunEci(getSpotterTime()),
    );
  } else if (!lastLook?.visible) {
    lastPhoto = null;
  }

  if (lastLook && !lastLook.visible) {
    schedulePassCompute(obj.satrec, sensors.location);
  }

  updateCues(lastLook, sensors, lastPhoto);
  updateChips(sensors, lastLook, lastPhoto);
  updateLightHint(lastLook, lastPhoto);
  maybeRefreshSkyScan(state, sensors, now);
  maybeDrawSky(
    sensors,
    state.selectedIndex != null ? state.objects[state.selectedIndex]?.noradId ?? null : null,
  );
}

function maybeRefreshSkyScan(
  state: ReturnType<typeof getState>,
  sensors: SensorSnapshot,
  now: number,
): void {
  if (!sensors.location || !sensors.headingReliable || sensors.headingDeg == null) {
    skyHits = [];
    resetSkyScanState();
    return;
  }

  const scanOpts = {
    selectedNoradId: skyScanSelectedId,
    maxCount: SKY_MAX_HITS,
    minElevationDeg: 0,
    includeDebris: false,
    fovDeg: skyFovDeg,
  };

  // Continue an in-flight chunked scan (time-budgeted for mobile).
  if (skyScanActive && skyScanObserver) {
    const liveCenter = skyViewStab.getCenter();
    const livePitch = liveCenter?.pitchDeg ?? sensors.pitchDeg ?? skyScanView.pitchDeg;
    const liveHeading = liveCenter?.headingDeg ?? sensors.headingDeg;
    if (
      liveHeading != null &&
      skyAngularDistanceDeg(
        { azimuthDeg: skyScanView.headingDeg, elevationDeg: skyScanView.pitchDeg },
        { azimuthDeg: liveHeading, elevationDeg: livePitch },
      ) >= SKY_RESCAN_VIEW_DEG
    ) {
      resetSkyScanState();
      lastSkyScanMs = 0;
    } else {
      const chunk = scanSkyCandidatesChunk(
        skyScanObjects,
        skyScanObserver,
        new Date(skyScanDateMs),
        skyScanView,
        scanOpts,
        skyScanIndex,
        SKY_SCAN_CHUNK,
        skyScanAccum,
        SKY_SCAN_BUDGET_MS,
      );
      skyScanIndex = chunk.nextIndex;

      // Progressive publish so the sky is not empty for seconds.
      if (chunk.done || now - lastSkyProgressMs >= SKY_SCAN_PROGRESS_MS) {
        lastSkyProgressMs = now;
        const nextHits = finalizeSkyScanHits(skyScanAccum, scanOpts);
        if (!sameSkyHitSet(skyHits, nextHits)) {
          skyHits = nextHits;
          lastSkyKey = '';
        }
      }

      if (chunk.done) {
        lastSkyScanMs = now;
        resetSkyScanState();
      }
      return;
    }
  }

  const center = skyViewStab.getCenter();
  const pitch = center?.pitchDeg ?? sensors.pitchDeg ?? 45;
  const heading = center?.headingDeg ?? sensors.headingDeg;
  if (heading == null) return;

  // Re-rank when the look direction moves a lot (zenith vs horizon need different pools).
  const viewMoved =
    skyAngularDistanceDeg(
      { azimuthDeg: skyScanView.headingDeg, elevationDeg: skyScanView.pitchDeg },
      { azimuthDeg: heading, elevationDeg: pitch },
    ) >= SKY_RESCAN_VIEW_DEG;
  if (now - lastSkyScanMs < SKY_SCAN_INTERVAL_MS && skyHits.length > 0 && !viewMoved) {
    return;
  }

  const selected =
    state.selectedIndex != null ? state.objects[state.selectedIndex] : null;

  const rawPool: SkyScanObject[] = state.objects.map((o) => ({
    noradId: o.noradId,
    name: o.name,
    satrec: o.satrec,
    category: o.category,
    functionGroup: o.functionGroup,
  }));
  skyScanObjects = buildSkyScanPool(rawPool, selected?.noradId ?? null);
  skyScanObserver = {
    latitudeDeg: sensors.location.latitudeDeg,
    longitudeDeg: sensors.location.longitudeDeg,
    altitudeKm: sensors.location.altitudeKm ?? 0,
  };
  skyScanDateMs = getSpotterTime().getTime();
  skyScanView = { headingDeg: heading, pitchDeg: pitch };
  skyScanSelectedId = selected?.noradId ?? null;
  skyScanAccum = [];
  skyScanIndex = 0;
  skyScanActive = true;
  lastSkyProgressMs = now;
}

function schedulePassCompute(
  _satrec: import('satellite.js').SatRec,
  location: NonNullable<SensorSnapshot['location']>,
): void {
  const time = getSpotterTime();
  const key = `${getState().selectedIndex}|${location.latitudeDeg.toFixed(3)}|${location.longitudeDeg.toFixed(3)}|${Math.floor(time.getTime() / 60_000)}`;
  if (key === cachedPassKey && cachedPass) return;
  if (passComputeScheduled) return;
  passComputeScheduled = true;

  // Defer so the first paint of turn/tilt cues is not blocked by the scan.
  window.setTimeout(() => {
    passComputeScheduled = false;
    if (!backdropEl) return;
    const state = getState();
    const sensors = getSensorSnapshot();
    if (state.selectedIndex == null || !sensors.location) return;
    const obj = state.objects[state.selectedIndex];
    const wallTime = getSpotterTime();
    const nextKey = `${state.selectedIndex}|${sensors.location.latitudeDeg.toFixed(3)}|${sensors.location.longitudeDeg.toFixed(3)}|${Math.floor(wallTime.getTime() / 60_000)}`;
    cachedPassKey = nextKey;
    cachedPass = findNextPass(obj.satrec, sensors.location, wallTime, 18, 30);
    // Refresh below-horizon cue with the predicted rise.
    if (lastLook && !lastLook.visible) updateCues(lastLook, sensors, null);
  }, 0);
}

function updateCues(
  look: LookAngles | null,
  sensors: SensorSnapshot,
  photo: PhotoAssessment | null,
): void {
  if (!look) {
    setCue('spotter-turn', t('spotter.propagate_fail'));
    setCue('spotter-tilt', '');
    return;
  }

  if (!look.visible) {
    const rise = cachedPass?.rise;
    const max = cachedPass?.max;
    if (rise) {
      setCue(
        'spotter-turn',
        t('spotter.below_rise').replace('{time}', formatLocalTime(rise.time)),
      );
      if (max) {
        setCue(
          'spotter-tilt',
          t('spotter.pass_max')
            .replace('{el}', max.elevationDeg.toFixed(0))
            .replace('{time}', formatLocalTime(max.time)),
        );
      } else {
        setCue('spotter-tilt', '');
      }
    } else if (cachedPassKey) {
      setCue('spotter-turn', t('spotter.below_none'));
      setCue('spotter-tilt', '');
    } else {
      setCue('spotter-turn', t('spotter.below_computing'));
      setCue('spotter-tilt', '');
    }
    return;
  }

  if (sensors.headingDeg == null || !sensors.headingReliable) {
    setCue(
      'spotter-turn',
      t('spotter.guide_no_compass')
        .replace('{az}', look.azimuthDeg.toFixed(0))
        .replace('{el}', look.elevationDeg.toFixed(0)),
    );
    setCue(
      'spotter-tilt',
      sensors.headingError === 'needs_compass' || sensors.headingError === 'stale'
        ? t('spotter.compass_calibrate')
        : t('spotter.enable_compass'),
    );
    return;
  }

  const stab = skyViewStab.getCenter();
  const cueHeading = stab?.headingDeg ?? sensors.headingDeg;
  const cuePitch = stab?.pitchDeg ?? sensors.pitchDeg;
  const cueTurn = headingDelta(cueHeading, look.azimuthDeg);
  const sep =
    cuePitch != null
      ? skyAngularSeparationDeg(cueHeading, cuePitch, look.azimuthDeg, look.elevationDeg)
      : Math.abs(cueTurn);

  // Soft on-target cue without freezing the sky view.
  if (sep < DEADBAND_DEG && look.elevationDeg >= GOOD_ELEV_DEG) {
    const lockKey =
      photo?.favorable
        ? 'spotter.cue_locked_visible'
        : !photo?.satelliteLit
          ? 'spotter.cue_locked_eclipse'
          : !photo?.observerDark
            ? 'spotter.cue_locked_day'
            : 'spotter.cue_locked';
    setCue('spotter-turn', t(lockKey));
    setCue('spotter-tilt', '');
    return;
  }

  if (Math.abs(cueTurn) < DEADBAND_DEG) {
    setCue('spotter-turn', t('spotter.cue_turn_ok'));
  } else if (cueTurn > 0) {
    setCue('spotter-turn', t('spotter.guide_right').replace('{deg}', Math.abs(cueTurn).toFixed(0)));
  } else {
    setCue('spotter-turn', t('spotter.guide_left').replace('{deg}', Math.abs(cueTurn).toFixed(0)));
  }

  if (cuePitch == null) {
    setCue('spotter-tilt', t('spotter.guide_look_up').replace('{el}', look.elevationDeg.toFixed(0)));
    return;
  }

  const elevErr = look.elevationDeg - cuePitch;
  if (Math.abs(elevErr) < DEADBAND_DEG) {
    setCue('spotter-tilt', t('spotter.cue_tilt_ok'));
  } else if (elevErr > 0) {
    setCue('spotter-tilt', t('spotter.guide_tilt_up').replace('{deg}', elevErr.toFixed(0)));
  } else {
    setCue('spotter-tilt', t('spotter.guide_tilt_down').replace('{deg}', Math.abs(elevErr).toFixed(0)));
  }
}

function sameSkyHitSet(a: SkyScanHit[], b: SkyScanHit[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].noradId !== b[i].noradId) return false;
  }
  return true;
}

function updateChips(
  sensors: SensorSnapshot,
  look: LookAngles | null,
  photo: PhotoAssessment | null,
): void {
  const chips: string[] = [];
  if (sensors.accuracyMeters != null && sensors.accuracyMeters >= GPS_ACCURACY_WARN_M) {
    chips.push(chip('warn', t('spotter.chip_gps_weak')));
  }
  if (sensors.locationSource === 'cached') {
    chips.push(chip('warn', t('spotter.chip_loc_cached')));
  }
  if (!sensors.headingReliable) {
    chips.push(chip('warn', t('spotter.chip_compass_off')));
  }
  const tleAgeDays = tleAgeDaysNow();
  if (tleAgeDays != null && tleAgeDays >= TLE_STALE_WARN_DAYS) {
    chips.push(
      chip('warn', t('spotter.chip_tle_stale').replace('{n}', String(Math.floor(tleAgeDays)))),
    );
  }
  if (look?.visible && photo) {
    if (photo.favorable) chips.push(chip('ok', t('spotter.chip_eye_good')));
    else if (!photo.satelliteLit) chips.push(chip('warn', t('spotter.chip_eye_eclipse')));
    else if (!photo.observerDark) chips.push(chip('warn', t('spotter.chip_eye_day')));
  }
  if (
    sensors.headingReliable &&
    sensors.declinationDeg != null &&
    Math.abs(sensors.declinationDeg) >= 0.5
  ) {
    const sign = sensors.declinationDeg >= 0 ? '+' : '';
    chips.push(
      chip('muted', t('spotter.chip_declination').replace('{deg}', `${sign}${sensors.declinationDeg.toFixed(1)}`)),
    );
  }
  setChipsHtml(chips.join(''));
}

function tleAgeDaysNow(): number | null {
  const fetchedAt = getState().stats?.fetchedAt;
  if (!fetchedAt) return null;
  const ms = Date.now() - new Date(fetchedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return ms / 86_400_000;
}

function updateLightHint(look: LookAngles | null, photo: PhotoAssessment | null): void {
  if (!look?.visible || !photo) {
    setLight('');
    return;
  }
  if (photo.favorable) setLight(t('spotter.photo_good_short'));
  else if (!photo.satelliteLit) setLight(t('spotter.photo_eclipse_short'));
  else if (!photo.observerDark) setLight(t('spotter.photo_daytime_short'));
  else setLight(t('spotter.photo_dim_short'));
}

function chip(kind: string, label: string): string {
  return `<span class="spotter-chip spotter-chip--${kind}">${escapeHtml(label)}</span>`;
}

function setLight(text: string): void {
  if (text === lastLightText) return;
  lastLightText = text;
  const el = panelEl?.querySelector('#spotter-light');
  if (el && el.textContent !== text) el.textContent = text;
}

function setChipsHtml(html: string): void {
  if (html === lastChipsHtml) return;
  lastChipsHtml = html;
  const el = panelEl?.querySelector('#spotter-chips');
  if (el && el.innerHTML !== html) el.innerHTML = html;
}

function setCue(id: 'spotter-turn' | 'spotter-tilt', text: string): void {
  if (id === 'spotter-turn') {
    if (text === lastTurnText) return;
    lastTurnText = text;
  } else {
    if (text === lastTiltText) return;
    lastTiltText = text;
  }
  const el = panelEl?.querySelector(`#${id}`);
  if (el && el.textContent !== text) el.textContent = text;
}

function maybeDrawSky(sensors: SensorSnapshot, selectedNoradId: number | null): void {
  const rawHeading = sensors.headingReliable ? sensors.headingDeg : null;
  const view = skyViewStab.update(rawHeading, sensors.pitchDeg, performance.now());
  // While frozen the stabilizer returns bit-identical pitch; keep a coarse key anyway.
  const step = Math.max(1, skyFovDeg / 45);
  const key = [
    quantizeDeg(view.headingDeg, step),
    quantizeDeg(view.pitchDeg, step),
    skyFovDeg.toFixed(1),
    selectedNoradId ?? 'n',
    skyHits.length,
    skyHits[0]?.noradId ?? '',
  ].join('|');
  if (key === lastSkyKey) return;
  lastSkyKey = key;
  const drawHeading =
    view.headingDeg == null ? null : Number(quantizeDeg(view.headingDeg, step));
  const drawPitch = Number(quantizeDeg(view.pitchDeg, step));
  drawSky(drawHeading, drawPitch, selectedNoradId, sensors.headingReliable);
}

function quantizeDeg(deg: number | null | undefined, step: number): string {
  if (deg == null || !Number.isFinite(deg)) return 'x';
  return (Math.round(deg / step) * step).toFixed(1);
}

function groupCssColor(group: ObjectFunctionGroup, alpha = 0.9): string {
  const [r, g, b] = getFunctionGroupColor(group);
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${alpha})`;
}

function drawSky(
  headingDeg: number | null,
  pitchDeg: number,
  selectedNoradId: number | null,
  compassOk: boolean,
): void {
  const canvas = skyCanvas ?? panelEl?.querySelector<HTMLCanvasElement>('#spotter-sky');
  if (!canvas) return;
  skyCanvas = canvas;
  const ctx = skyCtx ?? canvas.getContext('2d');
  if (!ctx) return;
  skyCtx = ctx;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = SKY_CSS_W;
  const cssH = SKY_CSS_H;
  const bw = Math.round(cssW * dpr);
  const bh = Math.round(cssH * dpr);
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  // Night sky background
  const grad = ctx.createLinearGradient(0, 0, 0, cssH);
  grad.addColorStop(0, '#070b18');
  grad.addColorStop(1, '#12182a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, cssW, cssH);

  if (!compassOk || headingDeg == null) {
    ctx.fillStyle = 'rgba(248, 250, 252, 0.75)';
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(t('spotter.sky_no_compass'), cssW / 2, cssH / 2);
    setSkyMeta('');
    return;
  }

  const view = { headingDeg, pitchDeg };
  const fov = skyFovDeg;

  // Horizon
  const hy = horizonYForPitch(pitchDeg, cssH, fov);
  if (hy >= 0 && hy <= cssH) {
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(201, 184, 150, 0.55)';
    ctx.lineWidth = 1.25;
    ctx.moveTo(0, hy);
    ctx.lineTo(cssW, hy);
    ctx.stroke();
    ctx.fillStyle = 'rgba(201, 184, 150, 0.7)';
    ctx.font = '600 10px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(t('spotter.sky_horizon'), 8, Math.min(cssH - 6, hy - 4));
  }

  // Cardinals
  ctx.font = '700 11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const c of CARDINAL_AZIMUTHS) {
    const p = projectAzElToCanvas(
      view,
      { azimuthDeg: c.az, elevationDeg: Math.max(2, pitchDeg) },
      cssW,
      cssH,
      fov,
    );
    if (!p.inView) continue;
    ctx.fillStyle = 'rgba(248, 250, 252, 0.55)';
    ctx.fillText(c.key, p.x, Math.max(12, Math.min(cssH - 12, p.y)));
  }

  const cx = cssW / 2;
  const cy = cssH / 2;
  /** Angular radius under the crosshair that shows a name label. */
  const aimLabelMaxDeg = Math.max(2.2, fov * 0.055);

  let drawn = 0;
  let aimed: { hit: SkyScanHit; distDeg: number } | null = null;
  let selectedLabel: { name: string; x: number; y: number } | null = null;

  for (const hit of skyHits) {
    const p = projectAzElToCanvas(
      view,
      { azimuthDeg: hit.look.azimuthDeg, elevationDeg: hit.look.elevationDeg },
      cssW,
      cssH,
      fov,
    );
    if (!p.inView) continue;
    drawn++;
    const distDeg = Math.hypot(p.dAzDeg, p.dElDeg);
    if (distDeg <= aimLabelMaxDeg && (!aimed || distDeg < aimed.distDeg)) {
      aimed = { hit, distDeg };
    }

    const isSel = hit.noradId === selectedNoradId;
    const isStation = hit.functionGroup === 'station';
    const fill = groupCssColor(hit.functionGroup, isSel ? 0.98 : 0.88);
    const radius = isSel ? 3.5 : isStation ? 3.1 : 2.2;

    if (isSel) {
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(232, 164, 90, 0.95)';
      ctx.lineWidth = 2;
      ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
      ctx.stroke();
      selectedLabel = { name: hit.name, x: p.x, y: p.y };
    }

    ctx.beginPath();
    ctx.fillStyle = fill;
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  // Crosshair (look center)
  ctx.strokeStyle = 'rgba(248, 250, 252, 0.45)';
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  ctx.moveTo(cx - 10, cy);
  ctx.lineTo(cx + 10, cy);
  ctx.moveTo(cx, cy - 10);
  ctx.lineTo(cx, cy + 10);
  ctx.stroke();

  // Side label for selected target when it is not under the crosshair.
  if (selectedLabel && aimed?.hit.noradId !== selectedNoradId) {
    ctx.fillStyle = 'rgba(248, 250, 252, 0.88)';
    ctx.font = '600 10px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(selectedLabel.name.slice(0, 18), selectedLabel.x + 12, selectedLabel.y);
  }

  // Name of object under the crosshair
  if (aimed) {
    const label = aimed.hit.name.slice(0, 22);
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const ty = Math.max(18, cy - 14);
    const tw = ctx.measureText(label).width;
    const padX = 6;
    const padY = 3;
    ctx.fillStyle = 'rgba(7, 11, 24, 0.72)';
    ctx.fillRect(cx - tw / 2 - padX, ty - 11 - padY, tw + padX * 2, 14 + padY * 2);
    ctx.fillStyle = groupCssColor(aimed.hit.functionGroup, 1);
    ctx.fillText(label, cx, ty);
  }

  setSkyMeta(
    t('spotter.sky_count')
      .replace('{n}', String(drawn))
      .replace('{total}', String(skyHits.length)),
  );
}

function setSkyMeta(text: string): void {
  if (text === lastSkyCountText) return;
  lastSkyCountText = text;
  const el = panelEl?.querySelector('#spotter-sky-meta');
  if (el && el.textContent !== text) el.textContent = text;
}

function formatLocalTime(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

