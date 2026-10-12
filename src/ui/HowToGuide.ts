/**
 * First-visit language gate + 9-step UI tour (header "?" reopens).
 * Completion flag: localStorage `orbital-help-seen-v3` — bump the suffix when
 * step list changes so returning users see the updated tour once.
 * Steps may open mobile drawers via setTourPanel; keep selectors in sync with Layout.
 */
import { applyTranslations, onLangChange, setLang, SUPPORTED_LANGS, t, type Lang } from '../i18n/i18n';
import { closeKesslerPanel, openKesslerPanel } from './KesslerPanel';
import { setTourPanel } from './Layout';
import { escapeHtml } from './escapeHtml';

const LS_HELP_SEEN = 'orbital-help-seen-v3';

const LANG_LABELS: Record<Lang, string> = {
  en: 'English',
  tr: 'Türkçe',
  de: 'Deutsch',
  ru: 'Русский',
  zh: '中文',
};

const STEPS = [
  'globe',
  'language',
  'github',
  'search',
  'details',
  'approaches',
  'events',
  'time',
  'projection',
] as const;

type StepId = (typeof STEPS)[number];
type Phase = 'lang' | 'tour';

interface StepConfig {
  id: StepId;
  target: string;
  panel: 'left' | 'right' | null;
  openKessler?: boolean;
}

const STEP_CONFIG: StepConfig[] = [
  { id: 'globe', target: '#scene-container', panel: null },
  { id: 'language', target: '.header-lang', panel: null },
  { id: 'github', target: '.header-github', panel: null },
  { id: 'search', target: '#tour-region-search', panel: 'left' },
  { id: 'details', target: '#right-panel', panel: 'right' },
  { id: 'approaches', target: '#tour-region-approaches', panel: 'left' },
  { id: 'events', target: '.event-cards', panel: 'left' },
  { id: 'time', target: '#time-bar', panel: null },
  // Open the projection modal and spotlight the panel itself (not the tiny
  // header button). The tooltip docks beside it in the free space.
  { id: 'projection', target: '#kessler-panel', panel: null, openKessler: true },
];

/**
 * Steps shown in the current layout. A step whose target exists but is hidden
 * (e.g. the GitHub link, which phones collapse away) is skipped instead of
 * being spotlit as a 0x0 box in the top-left corner.
 */
let activeSteps: StepConfig[] = STEP_CONFIG;

function isHiddenByCss(el: HTMLElement): boolean {
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    if (window.getComputedStyle(node).display === 'none') return true;
  }
  return false;
}

function stepApplies(config: StepConfig): boolean {
  if (config.panel || config.openKessler) return true;
  const target = document.querySelector<HTMLElement>(config.target);
  // A missing target keeps its step (shown centered); only a hidden one is dropped.
  return !target || !isHiddenByCss(target);
}

function refreshActiveSteps(): void {
  const current = activeSteps[stepIndex];
  const applicable = STEP_CONFIG.filter(stepApplies);
  activeSteps = applicable.length > 0 ? applicable : STEP_CONFIG;
  const kept = current ? activeSteps.indexOf(current) : -1;
  // Keep the same step after a rotation/resize; otherwise stay in range.
  stepIndex = kept >= 0 ? kept : Math.min(stepIndex, activeSteps.length - 1);
}

let rootEl: HTMLElement | null = null;
let phase: Phase = 'lang';
let stepIndex = 0;
let langUnsub: (() => void) | null = null;
let resizeObserver: ResizeObserver | null = null;
let repositionRaf = 0;
let boundScrollParents: HTMLElement[] = [];
let scrollGuardRaf = 0;

function hasSeenGuide(): boolean {
  try {
    return localStorage.getItem(LS_HELP_SEEN) === '1';
  } catch {
    return true;
  }
}

function markGuideSeen(): void {
  try {
    localStorage.setItem(LS_HELP_SEEN, '1');
  } catch {
    /* ignore */
  }
}


function syncLangSelect(lang: Lang): void {
  const select = document.querySelector<HTMLSelectElement>('#lang-select');
  if (select) select.value = lang;
}

function handleEsc(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return;
  e.stopPropagation();
  dismissHowToGuide();
}

function cleanupStepSideEffects(): void {
  closeKesslerPanel();
  setTourPanel(null);
  document.querySelectorAll('.tour-target--lit').forEach((el) => {
    el.classList.remove('tour-target--lit');
  });
}

export function closeHowToGuide(): void {
  document.removeEventListener('keydown', handleEsc, true);
  window.removeEventListener('resize', scheduleReposition);
  window.removeEventListener('scroll', scheduleReposition, true);
  unbindScrollParents();
  if (repositionRaf) cancelAnimationFrame(repositionRaf);
  repositionRaf = 0;
  if (scrollGuardRaf) cancelAnimationFrame(scrollGuardRaf);
  scrollGuardRaf = 0;
  resizeObserver?.disconnect();
  resizeObserver = null;
  langUnsub?.();
  langUnsub = null;
  cleanupStepSideEffects();
  rootEl?.remove();
  rootEl = null;
}

function dismissHowToGuide(): void {
  markGuideSeen();
  closeHowToGuide();
}

export function isHowToGuideOpen(): boolean {
  return rootEl != null;
}

function ensureRoot(): HTMLElement {
  if (rootEl) return rootEl;
  const root = document.createElement('div');
  root.id = 'help-tour-root';
  root.className = 'tour-root';
  root.innerHTML = `
    <div class="tour-dim" id="tour-dim" aria-hidden="true"></div>
    <div class="tour-pad" id="tour-pad-top" aria-hidden="true"></div>
    <div class="tour-pad" id="tour-pad-left" aria-hidden="true"></div>
    <div class="tour-pad" id="tour-pad-right" aria-hidden="true"></div>
    <div class="tour-pad" id="tour-pad-bottom" aria-hidden="true"></div>
    <div class="tour-highlight" id="tour-highlight" aria-hidden="true"></div>
    <div class="tour-card" id="tour-card" role="dialog" aria-modal="true"></div>
  `;
  document.body.appendChild(root);
  rootEl = root;
  document.addEventListener('keydown', handleEsc, true);
  window.addEventListener('resize', scheduleReposition);
  window.addEventListener('scroll', scheduleReposition, true);
  return root;
}

function scheduleReposition(): void {
  if (!rootEl || phase !== 'tour') return;
  if (repositionRaf) cancelAnimationFrame(repositionRaf);
  repositionRaf = requestAnimationFrame(() => {
    repositionRaf = 0;
    positionHighlightAndCard();
  });
}

/** Nearest ancestor that actually scrolls (panel overflow), if any. */
function getScrollParent(el: HTMLElement): HTMLElement | null {
  let parent = el.parentElement;
  while (parent && parent !== document.body) {
    const style = window.getComputedStyle(parent);
    const overflowY = style.overflowY;
    const canScroll =
      (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') &&
      parent.scrollHeight > parent.clientHeight + 1;
    if (canScroll) return parent;
    parent = parent.parentElement;
  }
  return null;
}

function scrollTargetIntoView(target: HTMLElement): void {
  const parent = getScrollParent(target);
  if (!parent) {
    if (typeof target.scrollIntoView === 'function') {
      target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
    }
    return;
  }

  const parentRect = parent.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const delta =
    targetRect.top - parentRect.top - (parentRect.height - targetRect.height) / 2;
  parent.scrollTop += delta;
}

function unbindScrollParents(): void {
  for (const el of boundScrollParents) {
    el.removeEventListener('scroll', handleTourParentScroll);
  }
  boundScrollParents = [];
}

function bindScrollParent(target: HTMLElement | null): void {
  unbindScrollParents();
  if (!target) return;
  const parent = getScrollParent(target);
  if (!parent) return;
  parent.addEventListener('scroll', handleTourParentScroll, { passive: true });
  boundScrollParents.push(parent);
}

/** If the user scrolls the spotlight away, pull it back and re-place the hole. */
function handleTourParentScroll(): void {
  if (!rootEl || phase !== 'tour') return;
  if (scrollGuardRaf) cancelAnimationFrame(scrollGuardRaf);
  scrollGuardRaf = requestAnimationFrame(() => {
    scrollGuardRaf = 0;
    const config = activeSteps[stepIndex];
    if (!config) return;
    const target = document.querySelector<HTMLElement>(config.target);
    if (!target) return;

    const parent = getScrollParent(target);
    const visible = getVisibleTargetRect(target, parent);
    if (!visible) {
      scrollTargetIntoView(target);
    }
    positionHighlightAndCard();
  });
}

type HoleRect = { top: number; left: number; width: number; height: number };

/** Target box clipped to its scroll parent’s visible area (null if fully scrolled away). */
function getVisibleTargetRect(target: HTMLElement, parent: HTMLElement | null): HoleRect | null {
  const rect = target.getBoundingClientRect();
  if (!parent) {
    // A collapsed (display:none / 0x0) target would otherwise be drawn as a
    // spotlight stuck at the top-left corner.
    if (rect.width < 1 || rect.height < 1) return null;
    return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
  }
  const pr = parent.getBoundingClientRect();
  const top = Math.max(rect.top, pr.top + 4);
  const left = Math.max(rect.left, pr.left + 4);
  const right = Math.min(rect.right, pr.right - 4);
  const bottom = Math.min(rect.bottom, pr.bottom - 4);
  const width = right - left;
  const height = bottom - top;
  if (width < 24 || height < 24) return null;
  return { top, left, width, height };
}

function prepareStep(config: StepConfig): HTMLElement | null {
  cleanupStepSideEffects();
  if (config.panel) setTourPanel(config.panel);
  if (config.openKessler) openKesslerPanel();

  // Prefer the live panel when present; fall back to the header trigger.
  const target =
    document.querySelector<HTMLElement>(config.target) ??
    (config.openKessler ? document.querySelector<HTMLButtonElement>('#kessler-panel-btn') : null);
  if (!target) return null;

  target.classList.add('tour-target--lit');
  scrollTargetIntoView(target);
  bindScrollParent(target);
  return target;
}

function setPadsHidden(hidden: boolean): void {
  if (!rootEl) return;
  for (const id of ['tour-pad-top', 'tour-pad-left', 'tour-pad-right', 'tour-pad-bottom']) {
    const el = rootEl.querySelector<HTMLElement>(`#${id}`);
    if (el) el.hidden = hidden;
  }
}

function layoutPads(hole: HoleRect): void {
  if (!rootEl) return;
  const top = rootEl.querySelector<HTMLElement>('#tour-pad-top')!;
  const left = rootEl.querySelector<HTMLElement>('#tour-pad-left')!;
  const right = rootEl.querySelector<HTMLElement>('#tour-pad-right')!;
  const bottom = rootEl.querySelector<HTMLElement>('#tour-pad-bottom')!;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const holeBottom = hole.top + hole.height;
  const holeRight = hole.left + hole.width;

  setPadsHidden(false);
  Object.assign(top.style, { top: '0px', left: '0px', width: `${vw}px`, height: `${Math.max(0, hole.top)}px` });
  Object.assign(bottom.style, {
    top: `${holeBottom}px`,
    left: '0px',
    width: `${vw}px`,
    height: `${Math.max(0, vh - holeBottom)}px`,
  });
  Object.assign(left.style, {
    top: `${hole.top}px`,
    left: '0px',
    width: `${Math.max(0, hole.left)}px`,
    height: `${hole.height}px`,
  });
  Object.assign(right.style, {
    top: `${hole.top}px`,
    left: `${holeRight}px`,
    width: `${Math.max(0, vw - holeRight)}px`,
    height: `${hole.height}px`,
  });
}

function positionHighlightAndCard(): void {
  if (!rootEl || phase !== 'tour') return;
  const config = activeSteps[stepIndex];
  if (!config) return;

  const highlight = rootEl.querySelector<HTMLElement>('#tour-highlight');
  const card = rootEl.querySelector<HTMLElement>('#tour-card');
  const dim = rootEl.querySelector<HTMLElement>('#tour-dim');
  if (!highlight || !card || !dim) return;

  const target = document.querySelector<HTMLElement>(config.target);
  if (!target) {
    highlight.hidden = true;
    setPadsHidden(true);
    dim.classList.add('tour-dim--full');
    placeCardCentered(card);
    return;
  }

  const parent = getScrollParent(target);
  let hole = getVisibleTargetRect(target, parent);
  if (!hole) {
    scrollTargetIntoView(target);
    hole = getVisibleTargetRect(target, parent);
  }
  if (!hole) {
    highlight.hidden = true;
    setPadsHidden(true);
    dim.classList.add('tour-dim--full');
    placeCardCentered(card);
    return;
  }

  dim.classList.remove('tour-dim--full');
  highlight.hidden = false;

  const pad = 8;
  const top = Math.max(8, hole.top - pad);
  const left = Math.max(8, hole.left - pad);
  const width = Math.min(window.innerWidth - left - 8, hole.width + pad * 2);
  const height = Math.min(window.innerHeight - top - 8, hole.height + pad * 2);
  const framed: HoleRect = { top, left, width, height };

  highlight.style.top = `${top}px`;
  highlight.style.left = `${left}px`;
  highlight.style.width = `${width}px`;
  highlight.style.height = `${height}px`;
  layoutPads(framed);

  placeCardNear(card, framed);
}

function placeCardCentered(card: HTMLElement): void {
  card.classList.add('tour-card--center');
  card.style.top = '';
  card.style.left = '';
  card.style.bottom = '';
  card.style.right = '';
  card.style.transform = '';
}

type Rect = { top: number; left: number; width: number; height: number };

function overlapArea(a: Rect, b: Rect): number {
  const x = Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left));
  const y = Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));
  return x * y;
}

function clampCardPos(
  top: number,
  left: number,
  cardWidth: number,
  cardHeight: number,
): { top: number; left: number } {
  const edge = 12;
  return {
    top: Math.max(edge, Math.min(top, window.innerHeight - cardHeight - edge)),
    left: Math.max(edge, Math.min(left, window.innerWidth - cardWidth - edge)),
  };
}

/**
 * Place the tooltip where it stays fully on-screen and covers as little of the
 * highlighted hole as possible. Large targets (globe / full modal) dock to a
 * screen edge instead of floating over the middle of the feature.
 */
function placeCardNear(card: HTMLElement, hole: Rect): void {
  card.classList.remove('tour-card--center');
  card.style.transform = '';

  const margin = 12;
  const edge = 12;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cardWidth = Math.min(360, vw - edge * 2);
  card.style.width = `${cardWidth}px`;

  // Force layout so offsetHeight reflects the current step copy.
  const cardHeight = Math.min(Math.max(card.offsetHeight, 120), Math.floor(vh * 0.42));

  const holeArea = Math.max(1, hole.width * hole.height);
  const viewportArea = vw * vh;
  const largeHole = holeArea / viewportArea > 0.35;
  const tallModal = hole.height > vh * 0.55 && hole.width > vw * 0.35;
  const spaceRight = vw - (hole.left + hole.width);
  const spaceLeft = hole.left;

  const candidates: Array<{ top: number; left: number; weight: number }> = [
    // Beside the hole (best for open modals like Future Projection).
    {
      top: Math.max(edge, hole.top + 24),
      left: hole.left + hole.width + margin,
      weight: spaceRight >= cardWidth + margin ? -2e6 : 0,
    },
    {
      top: Math.max(edge, hole.top + 24),
      left: hole.left - cardWidth - margin,
      weight: spaceLeft >= cardWidth + margin ? -2e6 : 0,
    },
    // Above / below
    { top: hole.top - cardHeight - margin, left: hole.left + hole.width / 2 - cardWidth / 2, weight: 0 },
    { top: hole.top + hole.height + margin, left: hole.left + hole.width / 2 - cardWidth / 2, weight: 0 },
    // Screen-edge docks for huge highlights (globe, full-bleed targets).
    { top: vh - cardHeight - edge, left: (vw - cardWidth) / 2, weight: largeHole ? -4e5 : 0 },
    { top: edge + 56, left: (vw - cardWidth) / 2, weight: largeHole ? -3e5 : 0 },
    { top: vh - cardHeight - edge, left: edge, weight: largeHole ? -3e5 : 0 },
    { top: vh - cardHeight - edge, left: vw - cardWidth - edge, weight: largeHole || tallModal ? -5e5 : 0 },
    { top: edge + 56, left: vw - cardWidth - edge, weight: tallModal ? -6e5 : 0 },
    { top: edge + 56, left: edge, weight: tallModal ? -4e5 : 0 },
  ];

  let best = clampCardPos(candidates[0]!.top, candidates[0]!.left, cardWidth, cardHeight);
  let bestScore = Number.POSITIVE_INFINITY;

  for (const raw of candidates) {
    const pos = clampCardPos(raw.top, raw.left, cardWidth, cardHeight);
    const cardRect: Rect = { top: pos.top, left: pos.left, width: cardWidth, height: cardHeight };
    const overlap = overlapArea(cardRect, hole);
    const centerPenalty = overlapArea(cardRect, {
      top: hole.top + hole.height * 0.15,
      left: hole.left + hole.width * 0.15,
      width: hole.width * 0.7,
      height: hole.height * 0.5,
    });
    const score = overlap * 3 + centerPenalty + raw.weight;
    if (score < bestScore) {
      bestScore = score;
      best = pos;
    }
  }

  card.style.top = `${best.top}px`;
  card.style.left = `${best.left}px`;
  card.style.bottom = 'auto';
  card.style.right = 'auto';
}

function renderLangCard(card: HTMLElement): void {
  card.classList.add('tour-card--center');
  card.classList.remove('tour-card--thesis');
  card.setAttribute('aria-label', 'Choose a language to continue');
  card.innerHTML = `
    <div class="tour-card-top">
      <button type="button" class="tour-skip" id="tour-skip">${escapeHtml('Skip')}</button>
    </div>
    <h2 class="tour-title" id="tour-title">Choose a language to continue</h2>
    <p class="tour-body">${escapeHtml('Pick a language — the walkthrough continues in that language.')}</p>
    <div class="tour-lang-grid" role="group" aria-label="Languages">
      ${SUPPORTED_LANGS.map(
        (lang) => `
        <button type="button" class="tour-lang-btn" data-lang="${lang}">
          <span class="tour-lang-native">${escapeHtml(LANG_LABELS[lang])}</span>
          <span class="tour-lang-code">${lang.toUpperCase()}</span>
        </button>`,
      ).join('')}
    </div>
  `;

  card.querySelector('#tour-skip')?.addEventListener('click', dismissHowToGuide);
  card.querySelectorAll<HTMLButtonElement>('.tour-lang-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const lang = btn.dataset.lang as Lang;
      setLang(lang);
      syncLangSelect(lang);
      applyTranslations(document);
      startUiTour();
    });
  });
}

function startUiTour(): void {
  phase = 'tour';
  stepIndex = 0;
  renderTour();
}

function renderStepCard(card: HTMLElement): void {
  const config = activeSteps[stepIndex]!;
  const total = activeSteps.length;
  const isLast = stepIndex >= total - 1;
  card.classList.remove('tour-card--thesis', 'tour-card--center');
  card.setAttribute('aria-label', t(`help.step.${config.id}.title`));
  card.innerHTML = `
    <div class="tour-card-top">
      <span class="tour-progress">${stepIndex + 1} / ${total}</span>
      <button type="button" class="tour-skip" id="tour-skip">${escapeHtml(t('help.skip'))}</button>
    </div>
    <h2 class="tour-title">${escapeHtml(t(`help.step.${config.id}.title`))}</h2>
    <p class="tour-body">${escapeHtml(t(`help.step.${config.id}.body`))}</p>
    <div class="tour-actions">
      <button type="button" class="tour-secondary-btn" id="tour-back" ${stepIndex === 0 ? 'disabled' : ''}>
        ${escapeHtml(t('help.back'))}
      </button>
      <button type="button" class="tour-primary-btn" id="tour-next">
        ${escapeHtml(isLast ? t('help.done') : t('help.next'))}
      </button>
    </div>
  `;

  card.querySelector('#tour-skip')?.addEventListener('click', dismissHowToGuide);
  card.querySelector('#tour-back')?.addEventListener('click', () => {
    if (stepIndex <= 0) return;
    stepIndex -= 1;
    renderTour();
  });
  card.querySelector('#tour-next')?.addEventListener('click', () => {
    if (isLast) {
      dismissHowToGuide();
      return;
    }
    stepIndex += 1;
    renderTour();
  });
}

/**
 * Mobile drawers slide in over ~250 ms, but the spotlight is first measured a
 * couple of frames after opening — i.e. mid-slide, at the wrong position. A
 * transform change doesn't trigger the ResizeObserver, so re-measure when the
 * slide ends (with a timer as a fallback if no transition event arrives).
 */
function repositionAfterPanelSlide(config: StepConfig): void {
  if (!config.panel) return;
  const panel = document.getElementById(config.panel === 'left' ? 'left-panel' : 'right-panel');
  if (!panel) return;
  const stepAtStart = stepIndex;
  const settle = (): void => {
    panel.removeEventListener('transitionend', settle);
    if (rootEl && phase === 'tour' && stepIndex === stepAtStart) scheduleReposition();
  };
  panel.addEventListener('transitionend', settle);
  window.setTimeout(settle, 350);
}

function renderTour(): void {
  const root = ensureRoot();
  const card = root.querySelector<HTMLElement>('#tour-card')!;
  const highlight = root.querySelector<HTMLElement>('#tour-highlight')!;
  const dim = root.querySelector<HTMLElement>('#tour-dim')!;

  resizeObserver?.disconnect();
  resizeObserver = null;

  if (phase === 'lang') {
    cleanupStepSideEffects();
    unbindScrollParents();
    highlight.hidden = true;
    setPadsHidden(true);
    dim.classList.add('tour-dim--full');
    renderLangCard(card);
    requestAnimationFrame(() => {
      card.querySelector<HTMLButtonElement>('.tour-lang-btn')?.focus();
    });
    return;
  }

  dim.classList.remove('tour-dim--full');
  refreshActiveSteps();
  const config = activeSteps[stepIndex]!;
  const target = prepareStep(config);
  renderStepCard(card);

  // Allow layout (panel open / Kessler) to settle, then place the spotlight.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      positionHighlightAndCard();
      repositionAfterPanelSlide(config);
      if (target && typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(() => scheduleReposition());
        resizeObserver.observe(target);
      }
      card.querySelector<HTMLButtonElement>('#tour-next')?.focus();
    });
  });
}

/** First visit: language then UI tour. Header ? reopens the tour only. */
export function openHowToGuide(): void {
  if (rootEl) return;
  phase = hasSeenGuide() ? 'tour' : 'lang';
  stepIndex = 0;
  renderTour();

  langUnsub = onLangChange(() => {
    if (!rootEl) return;
    if (phase !== 'tour') return;
    renderStepCard(rootEl.querySelector<HTMLElement>('#tour-card')!);
    scheduleReposition();
  });
}

/** Header help button + first-visit auto-open. */
export function initHowToGuide(): void {
  const btn = document.createElement('button');
  btn.id = 'help-guide-btn';
  btn.className = 'help-header-btn';
  btn.type = 'button';
  btn.textContent = '?';

  const refreshLabel = (): void => {
    const label = t('help.button');
    btn.title = label;
    btn.setAttribute('aria-label', label);
  };
  refreshLabel();
  btn.addEventListener('click', openHowToGuide);

  const actions = document.getElementById('header-actions');
  const langSel = document.getElementById('lang-select');
  if (actions && langSel) {
    actions.insertBefore(btn, langSel.closest('.header-lang') ?? langSel);
  } else {
    document.querySelector('.app-header')?.appendChild(btn);
  }

  onLangChange(refreshLabel);

  if (!hasSeenGuide()) {
    window.setTimeout(() => {
      if (!hasSeenGuide() && !rootEl) openHowToGuide();
    }, 700);
  }
}
