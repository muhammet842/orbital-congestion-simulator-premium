/**
 * Bottom time bar: LIVE / historical speed, VERIFY and event-replay transports.
 * Displays getSimulationTime() — when VERIFY or replay is active the global
 * clock is left alone and the focused clock drives the label/slider.
 */
import {
  getVerificationWindowMs,
  VERIFY_SCRUB_STEP_MS,
} from '../orbital/conjunction';
import {
  EVENT_REPLAY_SCRUB_STEP_MS,
  enterHistoricalMode,
  enterLiveMode,
  formatUtcDateTime,
  getEventReplayState,
  getEventReplayWindowMs,
  getSimulationTime,
  getState,
  getVerificationTimeState,
  isConjunctionVerificationActive,
  isEventReplayActive,
  isVerificationPlaying,
  jumpToNow,
  setEventReplayPartial,
  setTimePartial,
  setVerificationPartial,
  subscribe,
} from '../state/appState';
import { onLangChange, t } from '../i18n/i18n';
import { setTextIfChanged } from './dom';

const SPEEDS = [1, 10, 100];
const SLIDER_RANGE_MS = 7 * 24 * 60 * 60 * 1000;

export function initTimeControls(container: HTMLElement): void {
  container.innerHTML = `
    <div class="time-controls">
      <div class="time-row time-row--transport">
        <div class="time-buttons">
          <button type="button" id="btn-rewind" title="${t('time.back_1h')}">⏮</button>
          <button type="button" id="btn-play" title="${t('time.play_title')}">⏸</button>
          <button type="button" id="btn-forward" title="${t('time.fwd_1h')}">⏭</button>
        </div>
        <input type="range" id="time-slider" class="time-slider" min="-100" max="100" step="1" value="0" />
      </div>
      <div class="time-row time-row--meta">
        <div class="time-display" id="time-display"></div>
        <div class="time-mode-btns">
          <button type="button" id="btn-now" class="btn-now" title="${t('time.now_title')}">${t('time.now')}</button>
          <button type="button" id="btn-live" class="btn-live active" title="${t('time.live_title')}">${t('time.live_on')}</button>
        </div>
        <div class="speed-controls">
          <span class="speed-label">${t('time.speed')}</span>
          <div id="speed-buttons" class="speed-buttons"></div>
        </div>
      </div>
    </div>
  `;

  const playBtn = container.querySelector('#btn-play') as HTMLButtonElement;
  const rewindBtn = container.querySelector('#btn-rewind') as HTMLButtonElement;
  const forwardBtn = container.querySelector('#btn-forward') as HTMLButtonElement;
  const nowBtn = container.querySelector('#btn-now') as HTMLButtonElement;
  const liveBtn = container.querySelector('#btn-live') as HTMLButtonElement;
  const slider = container.querySelector('#time-slider') as HTMLInputElement;
  const speedButtons = container.querySelector('#speed-buttons')!;
  const speedLabel = container.querySelector('.speed-label');

  speedButtons.innerHTML = SPEEDS.map(
    (s) => `<button type="button" class="speed-btn" data-speed="${s}">${s}x</button>`,
  ).join('');

  const applyChromeLabels = (): void => {
    nowBtn.textContent = t('time.now');
    nowBtn.title = t('time.now_title');
    liveBtn.title = t('time.live_title');
    playBtn.title = t('time.play_title');
    if (speedLabel) speedLabel.textContent = t('time.speed');
  };
  applyChromeLabels();
  onLangChange(applyChromeLabels);

  let anchorTime = Date.now();
  /** True while the user is dragging the scrubber — don't fight their input. */
  let sliderDragging = false;

  playBtn.addEventListener('click', () => {
    if (isConjunctionVerificationActive()) {
      const vt = getVerificationTimeState();
      if (!vt) return;
      const { startMs, endMs } = getVerificationWindowMs(
        vt.cpaTimeMs,
        vt.relativeVelocityKmS ?? 0,
      );
      if (!vt.playing && vt.currentMs >= endMs - 1) {
        setVerificationPartial({ currentMs: startMs, playing: true });
        return;
      }
      setVerificationPartial({ playing: !vt.playing });
      return;
    }
    if (isEventReplayActive()) {
      const er = getEventReplayState();
      if (er) setEventReplayPartial({ playing: !er.playing });
      return;
    }
    const { playing } = getState().time;
    setTimePartial({ playing: !playing });
  });

  rewindBtn.addEventListener('click', () => {
    if (isConjunctionVerificationActive()) {
      const vt = getVerificationTimeState();
      if (!vt) return;
      setVerificationPartial({
        currentMs: vt.currentMs - VERIFY_SCRUB_STEP_MS,
        playing: false,
      });
      const next = getVerificationTimeState();
      if (next) syncVerificationSlider(slider, next);
      return;
    }
    if (isEventReplayActive()) {
      const er = getEventReplayState();
      if (!er) return;
      setEventReplayPartial({
        currentMs: er.currentMs - EVENT_REPLAY_SCRUB_STEP_MS,
        playing: false,
      });
      const next = getEventReplayState();
      if (next) syncEventReplaySlider(slider, next.collisionTimeMs, next.currentMs);
      return;
    }
    const { time } = getState();
    const base = time.mode === 'live' ? Date.now() : time.current.getTime();
    enterHistoricalMode({
      current: new Date(base - 3600_000),
      playing: time.playing,
    });
    anchorTime = getState().time.current.getTime();
    slider.value = '0';
  });

  forwardBtn.addEventListener('click', () => {
    if (isConjunctionVerificationActive()) {
      const vt = getVerificationTimeState();
      if (!vt) return;
      setVerificationPartial({
        currentMs: vt.currentMs + VERIFY_SCRUB_STEP_MS,
        playing: false,
      });
      const next = getVerificationTimeState();
      if (next) syncVerificationSlider(slider, next);
      return;
    }
    if (isEventReplayActive()) {
      const er = getEventReplayState();
      if (!er) return;
      setEventReplayPartial({
        currentMs: er.currentMs + EVENT_REPLAY_SCRUB_STEP_MS,
        playing: false,
      });
      const next = getEventReplayState();
      if (next) syncEventReplaySlider(slider, next.collisionTimeMs, next.currentMs);
      return;
    }
    const { time } = getState();
    const base = time.mode === 'live' ? Date.now() : time.current.getTime();
    enterHistoricalMode({
      current: new Date(base + 3600_000),
      playing: time.playing,
    });
    anchorTime = getState().time.current.getTime();
    slider.value = '0';
  });

  liveBtn.addEventListener('click', () => {
    enterLiveMode();
    anchorTime = Date.now();
    slider.value = '0';
  });

  nowBtn.addEventListener('click', () => {
    if (isConjunctionVerificationActive() || isEventReplayActive()) return;
    jumpToNow();
    anchorTime = Date.now();
    slider.value = '0';
  });

  slider.addEventListener('pointerdown', () => {
    sliderDragging = true;
  });
  const endSliderDrag = (): void => {
    sliderDragging = false;
  };
  slider.addEventListener('pointerup', endSliderDrag);
  slider.addEventListener('pointercancel', endSliderDrag);

  slider.addEventListener('input', () => {
    if (isConjunctionVerificationActive()) {
      const vt = getVerificationTimeState();
      if (!vt) return;
      const { startMs, endMs } = getVerificationWindowMs(
        vt.cpaTimeMs,
        vt.relativeVelocityKmS ?? 0,
      );
      // Map slider −100…+100 → [window start, CPA+15s].
      const t = (parseFloat(slider.value) + 100) / 200;
      const currentMs = startMs + t * (endMs - startMs);
      setVerificationPartial({ currentMs, playing: false });
      return;
    }

    if (isEventReplayActive()) {
      const er = getEventReplayState();
      if (!er) return;
      const { startMs, endMs } = getEventReplayWindowMs(er.collisionTimeMs);
      const t = (parseFloat(slider.value) + 100) / 200;
      const currentMs = startMs + t * (endMs - startMs);
      setEventReplayPartial({ currentMs, playing: false });
      return;
    }

    const { time } = getState();
    const offset = (parseFloat(slider.value) / 100) * SLIDER_RANGE_MS;

    if (time.mode === 'live') {
      anchorTime = Date.now();
    }

    enterHistoricalMode({
      current: new Date(anchorTime + offset),
      playing: time.playing,
    });
  });

  speedButtons.querySelectorAll('.speed-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const speed = parseInt((btn as HTMLButtonElement).dataset.speed!, 10);
      const { time } = getState();

      if (isConjunctionVerificationActive()) {
        const vt = getVerificationTimeState();
        if (vt) {
          const { startMs, endMs } = getVerificationWindowMs(
            vt.cpaTimeMs,
            vt.relativeVelocityKmS ?? 0,
          );
          if (vt.currentMs >= endMs - 1) {
            setVerificationPartial({ speed, currentMs: startMs, playing: true });
            return;
          }
        }
        setVerificationPartial({ speed, playing: true });
        return;
      }

      if (isEventReplayActive()) {
        setEventReplayPartial({ speed, playing: true });
        return;
      }

      if (time.mode === 'live') {
        if (speed === 1) return;
        enterHistoricalMode({
          current: new Date(),
          speed,
          playing: time.playing,
        });
        anchorTime = Date.now();
        slider.value = '0';
        return;
      }

      enterHistoricalMode({ speed, playing: time.playing });
    });
  });

  let wasVerifying = false;
  let wasReplaying = false;

  subscribe(() => {
    const { time } = getState();
    const verifying = isConjunctionVerificationActive();
    const replaying = isEventReplayActive();
    const vt = getVerificationTimeState();
    const er = getEventReplayState();
    const focused = verifying || replaying;
    const isLive =
      (time.mode === 'live' && !focused) ||
      (verifying && isVerificationPlaying() && (vt?.speed ?? 1) === 1) ||
      (replaying && !!er?.playing && (er.speed ?? 1) === 1);

    if ((wasVerifying || wasReplaying) && !focused) {
      anchorTime = Date.now();
      slider.value = '0';
    }
    if (!wasVerifying && verifying && vt) {
      syncVerificationSlider(slider, vt);
    }
    if (!wasReplaying && replaying && er) {
      syncEventReplaySlider(slider, er.collisionTimeMs, er.currentMs);
    }
    wasVerifying = verifying;
    wasReplaying = replaying;

    const playing = verifying ? vt?.playing : replaying ? er?.playing : time.playing;
    playBtn.textContent = playing ? '⏸' : '▶';

    liveBtn.classList.toggle('active', isLive);
    liveBtn.textContent = verifying
      ? t('time.verify')
      : replaying
        ? t('time.replay')
        : isLive
          ? t('time.live_on')
          : t('time.live');

    rewindBtn.title = focused ? t('time.back_5s') : t('time.back_1h');
    forwardBtn.title = focused ? t('time.fwd_5s') : t('time.fwd_1h');
    slider.title = verifying
      ? 'Scrub within the close-approach window (approach → T+15s)'
      : replaying
        ? 'Scrub within the event replay window (T−5m → IMPACT)'
        : 'Scrub simulation time (±7 days)';

    speedButtons.querySelectorAll('.speed-btn').forEach((btn) => {
      const speed = parseInt((btn as HTMLButtonElement).dataset.speed!, 10);
      const el = btn as HTMLButtonElement;
      const activeSpeed = verifying
        ? vt?.speed ?? 1
        : replaying
          ? er?.speed ?? 1
          : time.mode === 'live'
            ? 1
            : time.speed;
      el.classList.toggle('active', speed === activeSpeed);
    });

    slider.classList.toggle('time-slider--live', time.mode === 'live' && !focused);
    slider.classList.toggle('time-slider--verify', verifying || replaying);
  });

  const display = container.querySelector('#time-display')!;
  const refreshTimeDisplay = (): void => {
    const { time } = getState();
    const verifying = isConjunctionVerificationActive();
    const replaying = isEventReplayActive();
    const vt = getVerificationTimeState();
    const er = getEventReplayState();
    const focused = verifying || replaying;
    const isLive = time.mode === 'live' && !focused;
    const displayTime = focused || time.mode === 'historical'
      ? getSimulationTime()
      : new Date();
    setTextIfChanged(display, formatUtcDateTime(displayTime));
    display.classList.toggle('time-display--live', isLive);
    display.classList.toggle('time-display--verify', focused);

    if (!sliderDragging) {
      if (verifying && vt) {
        syncVerificationSlider(slider, vt);
      } else if (replaying && er) {
        syncEventReplaySlider(slider, er.collisionTimeMs, er.currentMs);
      }
    }

    requestAnimationFrame(refreshTimeDisplay);
  };
  requestAnimationFrame(refreshTimeDisplay);
}

/** Map verification clock → slider −100…+100 across the CPA window. */
function syncVerificationSlider(
  slider: HTMLInputElement,
  vt: { cpaTimeMs: number; currentMs: number; relativeVelocityKmS?: number },
): void {
  const { startMs, endMs } = getVerificationWindowMs(
    vt.cpaTimeMs,
    vt.relativeVelocityKmS ?? 0,
  );
  syncWindowSlider(slider, startMs, endMs, vt.currentMs);
}

/** Map event-replay clock → slider −100…+100 across T−5m…IMPACT. */
function syncEventReplaySlider(
  slider: HTMLInputElement,
  collisionTimeMs: number,
  currentMs: number,
): void {
  const { startMs, endMs } = getEventReplayWindowMs(collisionTimeMs);
  syncWindowSlider(slider, startMs, endMs, currentMs);
}

function syncWindowSlider(
  slider: HTMLInputElement,
  startMs: number,
  endMs: number,
  currentMs: number,
): void {
  const span = Math.max(1, endMs - startMs);
  const clamped = Math.min(endMs, Math.max(startMs, currentMs));
  const t = (clamped - startMs) / span;
  const next = String(Math.round(t * 200 - 100));
  if (slider.value !== next) slider.value = next;
}
