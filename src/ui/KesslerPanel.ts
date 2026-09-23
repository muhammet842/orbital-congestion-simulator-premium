/**
 * KesslerPanel — "Future Projection" overlay.
 *
 * A self-contained, opt-in modal that lets any visitor run a simplified
 * "what if" Kessler-syndrome scenario (launch rate / debris mitigation /
 * collision risk) and scrub through the projected years. Deliberately kept
 * independent of the main Three.js scene and global app state: it owns its
 * own tiny Canvas-2D visualizations and local component state, so it can
 * never interfere with the live orbital simulation's performance or state.
 */

import {
  classifyOutlook,
  KESSLER_PRESETS,
  projectKesslerTimeline,
  REAL_WORLD_BASELINE_OBJECTS,
  type KesslerOutlookBand,
  type KesslerPresetId,
  type KesslerScenarioParams,
  type KesslerYearPoint,
} from '../orbital/kesslerProjection';
import { onLangChange, t } from '../i18n/i18n';

// ── Module-local component state ────────────────────────────────────────────

interface SliderTicks {
  /** Launch-rate tick, 0-600 → 0x-6.0x. */
  launch: number;
  /** Mitigation tick, 0-300 → 0x-3.0x. */
  mitigation: number;
  /** Collision-risk tick, 0-600 → 0x-6.0x. */
  risk: number;
  targetYear: number;
}

const CURRENT_YEAR = new Date().getUTCFullYear();
const DEFAULT_TARGET_YEAR = CURRENT_YEAR + 25;

const PRESET_IDS: KesslerPresetId[] = ['bau', 'boom', 'green', 'asat'];

const sliderTicks: SliderTicks = {
  launch: 100,
  mitigation: 100,
  risk: 100,
  targetYear: DEFAULT_TARGET_YEAR,
};

let timeline: KesslerYearPoint[] = [];
let startYear = CURRENT_YEAR;
let baselineTotal = 0;
let scrubIndex = 0;
let animating = false;
let animTimer: ReturnType<typeof setInterval> | null = null;
let activePreset: KesslerPresetId | null = 'bau';

let backdropEl: HTMLElement | null = null;
let panelEl: HTMLElement | null = null;

const BASE_DOT_COUNT = 80;
const MAX_DOT_COUNT = 600;

/**
 * Projection UI copy is English (and mixed-language labels). Force en-US so
 * browser Turkish locale cannot turn 144357 into "144.357", 21.8 into "21,8",
 * or compact "155.9K" into Turkish "155,9 B" (B = bin / thousand).
 */
const KP_NUMBER_LOCALE = 'en-US';

function formatCount(value: number, maxFractionDigits = 0): string {
  if (!Number.isFinite(value)) return '—';
  return value.toLocaleString(KP_NUMBER_LOCALE, { maximumFractionDigits: maxFractionDigits });
}

/** Below 100,000: plain en-US number. At/above: compact with English K/M/B. */
export function formatCompactNumber(value: number, maxFractionDigits: number): string {
  if (!Number.isFinite(value)) return '—';
  if (Math.abs(value) < 100_000) {
    return formatCount(value, maxFractionDigits);
  }
  return new Intl.NumberFormat(KP_NUMBER_LOCALE, {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

function tickToMultiplier(tick: number): number {
  return tick / 100;
}

function formatMultiplier(tick: number): string {
  return `${tickToMultiplier(tick).toFixed(1)}×`;
}

function formatRiskMultiplier(riskIndex: number): string {
  return `${(riskIndex / 100).toFixed(1)}×`;
}

function currentScenario(): KesslerScenarioParams {
  return {
    launchRateMultiplier: tickToMultiplier(sliderTicks.launch),
    mitigationRate: tickToMultiplier(sliderTicks.mitigation),
    collisionRiskMultiplier: tickToMultiplier(sliderTicks.risk),
  };
}

function applyPresetToSliders(id: KesslerPresetId): void {
  const preset = KESSLER_PRESETS[id];
  sliderTicks.launch = Math.round(preset.launchRateMultiplier * 100);
  sliderTicks.mitigation = Math.round(preset.mitigationRate * 100);
  sliderTicks.risk = Math.round(preset.collisionRiskMultiplier * 100);
  activePreset = id;
}

// ── Header trigger button ───────────────────────────────────────────────────

export function initKesslerPanel(): void {
  const btn = document.createElement('button');
  btn.id = 'kessler-panel-btn';
  btn.className = 'kessler-header-btn';
  btn.type = 'button';
  btn.textContent = '🌌';

  const refreshLabel = (): void => {
    const label = t('kessler.button');
    btn.title = label;
    btn.setAttribute('aria-label', label);
  };
  refreshLabel();
  btn.addEventListener('click', openKesslerPanel);

  const header = document.querySelector('.app-header');
  const actions = document.getElementById('header-actions');
  const langSel = document.getElementById('lang-select');
  if (actions && langSel) actions.insertBefore(btn, langSel.closest('.header-lang') ?? langSel);
  else if (header) {
    if (langSel) header.insertBefore(btn, langSel);
    else header.appendChild(btn);
  }

  onLangChange(() => {
    refreshLabel();
    if (backdropEl) renderPanelContent();
  });
}

// ── Modal open / close ───────────────────────────────────────────────────────

function handleEsc(e: KeyboardEvent): void {
  if (e.key === 'Escape') closeKesslerPanel();
}

function handleResize(): void {
  if (timeline.length > 0) redrawCanvases();
}

export function openKesslerPanel(): void {
  if (backdropEl) return;

  const backdrop = document.createElement('div');
  backdrop.id = 'kessler-panel-backdrop';
  backdrop.className = 'modal-backdrop kessler-backdrop';

  const panel = document.createElement('div');
  panel.id = 'kessler-panel';
  panel.className = 'modal-panel kessler-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', t('kessler.title'));

  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);
  backdropEl = backdrop;
  panelEl = panel;

  applyPresetToSliders('bau');
  renderPanelContent();
  runProjection();

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeKesslerPanel();
  });
  document.addEventListener('keydown', handleEsc);
  window.addEventListener('resize', handleResize);
}

export function closeKesslerPanel(): void {
  stopAnimation();
  backdropEl?.remove();
  backdropEl = null;
  panelEl = null;
  document.removeEventListener('keydown', handleEsc);
  window.removeEventListener('resize', handleResize);
}

export function isKesslerPanelOpen(): boolean {
  return backdropEl != null;
}

// ── Render ───────────────────────────────────────────────────────────────────

function renderPanelContent(): void {
  if (!panelEl) return;
  const hasRun = timeline.length > 0;

  const presetButtons = PRESET_IDS.map((id) => {
    const active = activePreset === id ? ' kp-preset--active' : '';
    return `<button type="button" class="kp-preset${active}" data-preset="${id}">${t(`kessler.preset.${id}`)}</button>`;
  }).join('');

  panelEl.innerHTML = `
    <div class="modal-header">
      <div class="modal-title">${t('kessler.title')}</div>
      <button class="modal-close" id="kp-close" aria-label="${t('kessler.close')}" title="${t('kessler.close')}">✕</button>
    </div>
    <div class="modal-body">
      <p class="kp-subtitle">${t('kessler.subtitle')}</p>

      <div class="modal-section">
        <h3 class="modal-section-title">${t('kessler.presets_heading')}</h3>
        <div class="kp-presets" id="kp-presets">${presetButtons}</div>

        <h3 class="modal-section-title kp-scenario-title">${t('kessler.scenario_heading')}</h3>

        <div class="kp-slider-row">
          <div class="kp-slider-label-row">
            <span class="kp-slider-label">${t('kessler.param.launch_rate')}</span>
            <span class="kp-slider-value" id="kp-launch-val">${formatMultiplier(sliderTicks.launch)}</span>
          </div>
          <span class="kp-slider-hint">${t('kessler.param.launch_rate_hint')}</span>
          <input type="range" id="kp-launch" class="kp-range" min="0" max="600" step="5" value="${sliderTicks.launch}" />
        </div>

        <div class="kp-slider-row">
          <div class="kp-slider-label-row">
            <span class="kp-slider-label">${t('kessler.param.mitigation')}</span>
            <span class="kp-slider-value" id="kp-mitigation-val">${formatMultiplier(sliderTicks.mitigation)}</span>
          </div>
          <span class="kp-slider-hint">${t('kessler.param.mitigation_hint')}</span>
          <input type="range" id="kp-mitigation" class="kp-range" min="0" max="300" step="5" value="${sliderTicks.mitigation}" />
        </div>

        <div class="kp-slider-row">
          <div class="kp-slider-label-row">
            <span class="kp-slider-label">${t('kessler.param.collision_risk')}</span>
            <span class="kp-slider-value" id="kp-risk-val">${formatMultiplier(sliderTicks.risk)}</span>
          </div>
          <span class="kp-slider-hint">${t('kessler.param.collision_risk_hint')}</span>
          <input type="range" id="kp-risk" class="kp-range" min="0" max="600" step="5" value="${sliderTicks.risk}" />
        </div>

        <div class="kp-slider-row">
          <div class="kp-slider-label-row">
            <span class="kp-slider-label">${t('kessler.param.target_year')}</span>
            <span class="kp-slider-value" id="kp-year-val">${sliderTicks.targetYear}</span>
          </div>
          <span class="kp-slider-hint">${t('kessler.param.target_year_hint')}</span>
          <input type="range" id="kp-target-year" class="kp-range"
            min="${CURRENT_YEAR + 5}" max="${CURRENT_YEAR + 75}" step="5" value="${sliderTicks.targetYear}" />
        </div>
      </div>

      <div class="modal-section" id="kp-results-section" ${hasRun ? '' : 'hidden'}>
        <h3 class="modal-section-title">${t('kessler.results_heading')}</h3>

        <div class="kp-metrics">
          <div class="modal-metric"><div class="modal-metric-value" id="kp-stat-total">—</div><div class="modal-metric-label">${t('kessler.stat.total_objects')}</div></div>
          <div class="modal-metric"><div class="modal-metric-value" id="kp-stat-debris">—</div><div class="modal-metric-label">${t('kessler.stat.debris_objects')}</div></div>
          <div class="modal-metric"><div class="modal-metric-value" id="kp-stat-collisions">—</div><div class="modal-metric-label">${t('kessler.stat.collisions')}</div></div>
          <div class="modal-metric"><div class="modal-metric-value" id="kp-stat-risk">—</div><div class="modal-metric-label">${t('kessler.stat.risk_index')}</div></div>
        </div>

        <div class="kp-shell-grid">
          <div class="kp-shell"><span class="kp-shell-lbl">${t('kessler.stat.leo')}</span><span class="kp-shell-val" id="kp-stat-leo">—</span></div>
          <div class="kp-shell"><span class="kp-shell-lbl">${t('kessler.stat.meo')}</span><span class="kp-shell-val" id="kp-stat-meo">—</span></div>
          <div class="kp-shell"><span class="kp-shell-lbl">${t('kessler.stat.geo')}</span><span class="kp-shell-val" id="kp-stat-geo">—</span></div>
        </div>

        <p class="kp-slider-hint kp-baseline-note" id="kp-baseline-note"></p>

        <div class="kp-scrub-block">
          <div class="kp-slider-label-row">
            <span class="kp-slider-label">${t('kessler.year_scrub')}</span>
            <span class="kp-slider-value" id="kp-scrub-val">—</span>
          </div>
          <div class="kp-scrub-row">
            <input type="range" id="kp-scrub" class="kp-range" min="0" max="1" step="1" value="0" />
            <button class="kp-animate-btn" id="kp-animate">${t('kessler.play')}</button>
          </div>
        </div>

        <h4 class="modal-section-title">${t('kessler.chart_heading')}</h4>
        <canvas id="kp-chart" class="kp-chart-canvas"></canvas>
        <div class="kp-chart-legend">
          <span><i class="kp-swatch kp-swatch--total"></i>${t('kessler.chart.total')}</span>
          <span><i class="kp-swatch kp-swatch--debris"></i>${t('kessler.chart.debris')}</span>
          <span><i class="kp-swatch kp-swatch--baseline"></i>${t('kessler.chart.baseline')}</span>
        </div>

        <h4 class="modal-section-title">${t('kessler.density_heading')}</h4>
        <div class="kp-density-wrap">
          <canvas id="kp-density" class="kp-density-canvas"></canvas>
        </div>
        <div class="kp-chart-legend kp-shell-legend">
          <span><i class="kp-swatch kp-swatch--leo"></i>${t('kessler.shell.leo')}</span>
          <span><i class="kp-swatch kp-swatch--meo"></i>${t('kessler.shell.meo')}</span>
          <span><i class="kp-swatch kp-swatch--geo"></i>${t('kessler.shell.geo')}</span>
        </div>

        <p class="kp-narrative" id="kp-narrative"></p>
      </div>

      <p class="kp-disclaimer">${t('kessler.disclaimer')}</p>
    </div>
  `;

  bindEvents();

  if (hasRun) {
    updateBaselineNote();
    updateForScrubIndex(scrubIndex);
  }
}

// ── Event wiring ─────────────────────────────────────────────────────────────

function bindEvents(): void {
  panelEl?.querySelector('#kp-close')?.addEventListener('click', closeKesslerPanel);

  panelEl?.querySelectorAll<HTMLButtonElement>('[data-preset]')?.forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.preset as KesslerPresetId | undefined;
      if (!id || !(id in KESSLER_PRESETS)) return;
      applyPresetToSliders(id);
      syncSliderDom();
      syncPresetActive();
      runProjection();
    });
  });

  bindScenarioSlider('kp-launch', 'kp-launch-val', 'launch', formatMultiplier);
  bindScenarioSlider('kp-mitigation', 'kp-mitigation-val', 'mitigation', formatMultiplier);
  bindScenarioSlider('kp-risk', 'kp-risk-val', 'risk', formatMultiplier);
  bindScenarioSlider('kp-target-year', 'kp-year-val', 'targetYear', (v) => String(v));

  const scrubInput = getEl<HTMLInputElement>('kp-scrub');
  scrubInput?.addEventListener('input', () => {
    stopAnimation();
    updateForScrubIndex(Number(scrubInput.value));
  });

  getEl<HTMLButtonElement>('kp-animate')?.addEventListener('click', toggleAnimate);
}

function syncSliderDom(): void {
  const launch = getEl<HTMLInputElement>('kp-launch');
  const mitigation = getEl<HTMLInputElement>('kp-mitigation');
  const risk = getEl<HTMLInputElement>('kp-risk');
  if (launch) launch.value = String(sliderTicks.launch);
  if (mitigation) mitigation.value = String(sliderTicks.mitigation);
  if (risk) risk.value = String(sliderTicks.risk);
  setText('kp-launch-val', formatMultiplier(sliderTicks.launch));
  setText('kp-mitigation-val', formatMultiplier(sliderTicks.mitigation));
  setText('kp-risk-val', formatMultiplier(sliderTicks.risk));
}

function syncPresetActive(): void {
  panelEl?.querySelectorAll<HTMLButtonElement>('[data-preset]')?.forEach((btn) => {
    btn.classList.toggle('kp-preset--active', btn.dataset.preset === activePreset);
  });
}

function bindScenarioSlider(
  inputId: string,
  labelId: string,
  key: keyof SliderTicks,
  format: (tick: number) => string,
): void {
  const input = getEl<HTMLInputElement>(inputId);
  const label = getEl<HTMLElement>(labelId);
  if (!input) return;
  input.addEventListener('input', () => {
    const raw = Number(input.value);
    sliderTicks[key] = raw;
    if (label) label.textContent = format(raw);
    if (key !== 'targetYear') activePreset = null;
    syncPresetActive();
    if (timeline.length > 0) runProjection({ preserveScrubFraction: true });
  });
}

// ── Projection run + scrubbing ───────────────────────────────────────────────

function runProjection(opts: { preserveScrubFraction?: boolean } = {}): void {
  const wasRunning = timeline.length > 0;
  const prevFraction = wasRunning ? scrubIndex / Math.max(1, timeline.length - 1) : 1;

  baselineTotal = REAL_WORLD_BASELINE_OBJECTS;
  startYear = CURRENT_YEAR;
  timeline = projectKesslerTimeline(startYear, sliderTicks.targetYear, baselineTotal, currentScenario());

  const scrubInput = getEl<HTMLInputElement>('kp-scrub');
  if (scrubInput) {
    scrubInput.min = '0';
    scrubInput.max = String(Math.max(0, timeline.length - 1));
  }

  getEl<HTMLElement>('kp-results-section')?.removeAttribute('hidden');

  updateBaselineNote();

  const targetIdx = opts.preserveScrubFraction && wasRunning
    ? Math.round(prevFraction * (timeline.length - 1))
    : timeline.length - 1;
  updateForScrubIndex(targetIdx);
}

function updateBaselineNote(): void {
  const el = getEl<HTMLElement>('kp-baseline-note');
  if (!el) return;
  el.textContent = t('kessler.today_baseline')
    .replace('{year}', String(startYear))
    .replace('{n}', formatCount(baselineTotal));
}

function updateForScrubIndex(idx: number): void {
  if (timeline.length === 0) return;
  scrubIndex = Math.max(0, Math.min(idx, timeline.length - 1));
  const point = timeline[scrubIndex];
  if (!point) return;

  setText('kp-stat-total', formatCount(point.totalObjects));
  setText('kp-stat-debris', formatCount(point.debrisObjects));
  setText('kp-stat-collisions', formatCompactNumber(point.cumulativeCollisions, 1));
  setText('kp-stat-risk', formatRiskMultiplier(point.riskIndex));
  setText('kp-stat-leo', formatCount(point.leoObjects));
  setText('kp-stat-meo', formatCount(point.meoObjects));
  setText('kp-stat-geo', formatCount(point.geoObjects));
  setText('kp-scrub-val', `${point.year} — ${formatCount(point.totalObjects)}`);

  const scrubInput = getEl<HTMLInputElement>('kp-scrub');
  if (scrubInput && document.activeElement !== scrubInput) {
    scrubInput.value = String(scrubIndex);
  }

  redrawCanvases();
  updateNarrative(point);
}

function updateNarrative(point: KesslerYearPoint): void {
  const band: KesslerOutlookBand = classifyOutlook(point.riskIndex);
  const mult = (point.totalObjects / baselineTotal).toFixed(1);
  const risk = (point.riskIndex / 100).toFixed(1);
  const text = t(`kessler.narrative.${band}`)
    .replace('{year}', String(point.year))
    .replace('{total}', formatCount(point.totalObjects))
    .replace('{mult}', mult)
    .replace('{risk}', risk);

  const el = getEl<HTMLElement>('kp-narrative');
  if (!el) return;
  el.textContent = text;
  el.className = `kp-narrative kp-narrative--${band}`;
}

// ── Animate ──────────────────────────────────────────────────────────────────

function toggleAnimate(): void {
  if (animating) {
    stopAnimation();
    return;
  }
  if (timeline.length === 0) return;

  animating = true;
  setText('kp-animate', t('kessler.pause'));
  if (scrubIndex >= timeline.length - 1) scrubIndex = 0;

  animTimer = setInterval(() => {
    const next = scrubIndex + 1;
    if (next >= timeline.length) {
      updateForScrubIndex(timeline.length - 1);
      stopAnimation();
      return;
    }
    updateForScrubIndex(next);
  }, 90);
}

function stopAnimation(): void {
  animating = false;
  if (animTimer) {
    clearInterval(animTimer);
    animTimer = null;
  }
  setText('kp-animate', t('kessler.play'));
}

// ── Canvas rendering ─────────────────────────────────────────────────────────

interface DotSlot {
  angle: number;
  band: 0 | 1 | 2;
  jitter: number;
}

let dotSlotsCache: DotSlot[] | null = null;

function getDotSlots(n: number): DotSlot[] {
  if (dotSlotsCache && dotSlotsCache.length >= n) return dotSlotsCache;
  const slots: DotSlot[] = [];
  for (let i = 0; i < n; i++) {
    slots.push({
      angle: Math.random() * Math.PI * 2,
      band: 0,
      jitter: Math.random(),
    });
  }
  dotSlotsCache = slots;
  return slots;
}

function prepareCanvas(canvas: HTMLCanvasElement, cssHeight: number): CanvasRenderingContext2D | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssWidth = canvas.clientWidth || canvas.parentElement?.clientWidth || 300;
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);
  canvas.style.height = `${cssHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function isNarrowViewport(): boolean {
  if (typeof window.matchMedia === 'function') {
    return window.matchMedia('(max-width: 640px)').matches;
  }
  return window.innerWidth <= 640;
}

function redrawCanvases(): void {
  const narrow = isNarrowViewport();
  const chartH = narrow ? 140 : 170;
  const densityH = narrow ? 170 : 220;

  const chartCanvas = getEl<HTMLCanvasElement>('kp-chart');
  if (chartCanvas) {
    const ctx = prepareCanvas(chartCanvas, chartH);
    if (ctx) drawChart(ctx, chartCanvas.clientWidth || 300, chartH, narrow);
  }

  const densityCanvas = getEl<HTMLCanvasElement>('kp-density');
  if (densityCanvas) {
    const ctx = prepareCanvas(densityCanvas, densityH);
    if (ctx) drawDensity(ctx, densityCanvas.clientWidth || 300, densityH);
  }
}

function drawChart(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  narrow = false,
): void {
  ctx.clearRect(0, 0, width, height);
  if (timeline.length === 0) return;

  const padL = narrow ? 34 : 42;
  const padR = 10;
  const padT = 14;
  const padB = 20;
  const plotW = Math.max(1, width - padL - padR);
  const plotH = Math.max(1, height - padT - padB);

  const maxVal = Math.max(
    baselineTotal,
    ...timeline.map((p) => Math.max(p.totalObjects, p.debrisObjects)),
  ) * 1.08;
  const minVal = 0;

  const xAt = (i: number): number => padL + (i / Math.max(1, timeline.length - 1)) * plotW;
  const yAt = (v: number): number => padT + plotH - ((v - minVal) / Math.max(1, maxVal - minVal)) * plotH;

  // Horizontal grid + Y labels.
  ctx.fillStyle = 'rgba(148,163,184,0.85)';
  ctx.font = '9px Inter, system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let g = 0; g <= 3; g++) {
    const v = (maxVal * g) / 3;
    const y = yAt(v);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + plotW, y);
    ctx.stroke();
    ctx.fillText(formatCompactNumber(v, 0), padL - 6, y);
  }

  // Baseline "today" reference line.
  const baseY = yAt(baselineTotal);
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padL, baseY);
  ctx.lineTo(padL + plotW, baseY);
  ctx.stroke();
  ctx.setLineDash([]);

  // Filled area under total curve.
  ctx.beginPath();
  ctx.moveTo(xAt(0), yAt(0));
  timeline.forEach((p, i) => ctx.lineTo(xAt(i), yAt(p.totalObjects)));
  ctx.lineTo(xAt(timeline.length - 1), yAt(0));
  ctx.closePath();
  const gradient = ctx.createLinearGradient(0, padT, 0, padT + plotH);
  gradient.addColorStop(0, 'rgba(232, 164, 90,0.28)');
  gradient.addColorStop(1, 'rgba(232, 164, 90,0.02)');
  ctx.fillStyle = gradient;
  ctx.fill();

  // Debris line.
  ctx.beginPath();
  timeline.forEach((p, i) => {
    const x = xAt(i);
    const y = yAt(p.debrisObjects);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = 'rgba(248,113,113,0.9)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Total line.
  ctx.beginPath();
  timeline.forEach((p, i) => {
    const x = xAt(i);
    const y = yAt(p.totalObjects);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = '#e8a45a';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Scrub marker.
  const mx = xAt(scrubIndex);
  const my = yAt(timeline[scrubIndex]?.totalObjects ?? 0);
  ctx.setLineDash([2, 2]);
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(mx, padT);
  ctx.lineTo(mx, padT + plotH);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.beginPath();
  ctx.fillStyle = '#f8fafc';
  ctx.arc(mx, my, 3.5, 0, Math.PI * 2);
  ctx.fill();

  // Axis year labels.
  ctx.fillStyle = 'rgba(148,163,184,0.9)';
  ctx.font = '10px Inter, system-ui, sans-serif';
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillText(String(startYear), padL, height - 4);
  ctx.textAlign = 'right';
  ctx.fillText(String(timeline[timeline.length - 1].year), padL + plotW, height - 4);
}

function drawDensity(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.clearRect(0, 0, width, height);
  if (timeline.length === 0) return;

  const point = timeline[scrubIndex];
  const cx = width / 2;
  const cy = height / 2;
  const maxRadius = Math.min(width, height) / 2 - 12;
  if (maxRadius <= 0) return;

  const bandRadii = [maxRadius * 0.38, maxRadius * 0.66, maxRadius * 0.92];
  const bandJitter = [maxRadius * 0.12, maxRadius * 0.07, maxRadius * 0.035];
  const bandColors = [
    'rgba(232, 164, 90,0.88)',
    'rgba(96,165,250,0.85)',
    'rgba(167,139,250,0.8)',
  ];

  // Shell guide rings (LEO / MEO / GEO).
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 1;
  for (const r of bandRadii) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Earth.
  ctx.beginPath();
  ctx.fillStyle = '#1c3d6b';
  ctx.arc(cx, cy, Math.max(4, maxRadius * 0.12), 0, Math.PI * 2);
  ctx.fill();

  const shellCounts = [point.leoObjects, point.meoObjects, point.geoObjects];
  const shellSum = shellCounts.reduce((a, b) => a + b, 0) || 1;
  const ratio = baselineTotal > 0 ? point.totalObjects / baselineTotal : 1;
  const dotCount = Math.max(12, Math.min(MAX_DOT_COUNT, Math.round(BASE_DOT_COUNT * ratio)));
  const slots = getDotSlots(MAX_DOT_COUNT);

  // Assign bands by actual shell population share (not random LEO bias).
  let assigned = 0;
  const bandTargets = shellCounts.map((c) => Math.round((c / shellSum) * dotCount));
  // Fix rounding so totals match.
  bandTargets[0] += dotCount - bandTargets.reduce((a, b) => a + b, 0);

  for (let band = 0; band < 3; band++) {
    const n = Math.max(0, bandTargets[band]);
    for (let k = 0; k < n && assigned < MAX_DOT_COUNT; k++, assigned++) {
      const slot = slots[assigned];
      const radius = bandRadii[band] + (slot.jitter - 0.5) * 2 * bandJitter[band];
      const x = cx + Math.cos(slot.angle) * radius;
      const y = cy + Math.sin(slot.angle) * radius;
      ctx.beginPath();
      ctx.fillStyle = bandColors[band];
      ctx.arc(x, y, band === 0 ? 1.55 : 1.35, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// ── DOM helpers ──────────────────────────────────────────────────────────────

function getEl<T extends HTMLElement>(id: string): T | null {
  return (panelEl?.querySelector(`#${id}`) as T | null) ?? null;
}

function setText(id: string, text: string): void {
  const el = getEl<HTMLElement>(id);
  if (el) el.textContent = text;
}
