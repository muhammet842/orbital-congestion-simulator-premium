import { getState, subscribe } from '../state/appState';
import { getLang, setLang, SUPPORTED_LANGS, t } from '../i18n/i18n';
import { githubMark, icon } from './icons';

/** Must match the max-width used for `.app-grid`'s mobile layout in style.css. */
export const MOBILE_BREAKPOINT_PX = 860;

/** Remembered between visits: which side panels the user collapsed on desktop. */
const LS_PANELS_KEY = 'orbital-panels';

interface CollapsedPanels {
  left: boolean;
  right: boolean;
}

function loadCollapsed(): CollapsedPanels {
  try {
    const parsed = JSON.parse(localStorage.getItem(LS_PANELS_KEY) ?? 'null');
    return { left: parsed?.left === true, right: parsed?.right === true };
  } catch {
    return { left: false, right: false };
  }
}

function saveCollapsed(state: CollapsedPanels): void {
  try {
    localStorage.setItem(LS_PANELS_KEY, JSON.stringify(state));
  } catch {
    // storage blocked: the choice just won't survive a reload
  }
}

/** Set by createLayout so the guided tour can reveal a collapsed panel temporarily. */
let desktopPanels: { setTour: (side: 'left' | 'right' | null) => void } | null = null;

export function createLayout(root: HTMLElement): {
  leftPanel: HTMLElement;
  rightPanel: HTMLElement;
  sceneContainer: HTMLElement;
  timeBar: HTMLElement;
} {
  root.innerHTML = `
    <div class="app-grid">
      <header class="app-header">
        <button id="toggle-left-panel" class="panel-toggle-btn icon-btn" type="button" aria-label="${t('layout.toggle_left')}" title="${t('layout.toggle_left')}" data-i18n-aria="layout.toggle_left" data-i18n-title="layout.toggle_left" aria-expanded="false">${icon('panelLeft', 20)}</button>

        <div class="header-brand">
          <span class="header-mark" aria-hidden="true">
            <span class="header-mark__core"></span>
            <span class="header-mark__ring header-mark__ring--inner"></span>
            <span class="header-mark__ring header-mark__ring--outer"></span>
          </span>
          <h1 class="header-title">
            <span class="header-title-full" data-i18n="brand.full">${t('brand.full')}</span>
            <span class="header-title-short" data-i18n="brand.short">${t('brand.short')}</span>
          </h1>
        </div>

        <div class="header-actions" id="header-actions">
          <div class="header-more" id="header-more">
            <button id="header-more-btn" class="icon-btn header-more-btn" type="button" aria-haspopup="true" aria-expanded="false" aria-controls="header-menu" aria-label="${t('layout.more')}" title="${t('layout.more')}" data-i18n-aria="layout.more" data-i18n-title="layout.more">${icon('more', 20)}</button>
            <div class="header-menu" id="header-menu" hidden>
              <label class="header-menu-item header-lang">
                ${icon('globe')}
                <span class="header-menu-label" data-i18n="layout.language">${t('layout.language')}</span>
                <select id="lang-select" class="lang-select" aria-label="${t('layout.lang_aria')}" data-i18n-aria="layout.lang_aria">
                  ${SUPPORTED_LANGS.map((l) => `<option value="${l}"${l === getLang() ? ' selected' : ''}>${l.toUpperCase()}</option>`).join('')}
                </select>
              </label>
              <a
                class="header-menu-item header-github"
                href="https://github.com/muhammet842/orbital-congestion-simulator-premium"
                target="_blank"
                rel="noopener noreferrer"
                title="${t('layout.github_title')}"
                data-i18n-title="layout.github_title"
              >
                ${githubMark(17)}
                <span class="header-menu-label" data-i18n="layout.github_label">${t('layout.github_label')}</span>
                ${icon('external', 14)}
              </a>
            </div>
          </div>
        </div>

        <button id="toggle-right-panel" class="panel-toggle-btn icon-btn" type="button" aria-label="${t('layout.toggle_right')}" title="${t('layout.toggle_right')}" data-i18n-aria="layout.toggle_right" data-i18n-title="layout.toggle_right" aria-expanded="false">${icon('panelRight', 20)}</button>
      </header>
      <aside id="left-panel" class="panel panel-left"></aside>
      <main id="scene-container" class="scene-container" aria-label="${t('layout.scene_label')}" data-i18n-aria="layout.scene_label"></main>
      <aside id="right-panel" class="panel panel-right"></aside>
      <div id="mobile-backdrop" class="mobile-backdrop"></div>
      <footer id="time-bar" class="time-bar"></footer>
    </div>
  `;

  const leftPanel = root.querySelector<HTMLElement>('#left-panel')!;
  const rightPanel = root.querySelector<HTMLElement>('#right-panel')!;
  const sceneContainer = root.querySelector<HTMLElement>('#scene-container')!;
  const timeBar = root.querySelector<HTMLElement>('#time-bar')!;

  setupMobilePanelToggles(root, leftPanel, rightPanel);
  setupDesktopPanelToggles(root);
  setupLangSelect(root);
  setupHeaderMenu(root);

  return { leftPanel, rightPanel, sceneContainer, timeBar };
}

/**
 * The "More" menu holds what people use rarely: language, the guided tour and
 * the GitHub link. A simple disclosure (it contains a select, so not role=menu):
 * closes on an outside click, Escape, or once something in it has been used.
 */
function setupHeaderMenu(root: HTMLElement): void {
  const button = root.querySelector<HTMLButtonElement>('#header-more-btn');
  const menu = root.querySelector<HTMLElement>('#header-menu');
  if (!button || !menu) return;
  const setOpen = (open: boolean): void => {
    menu.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
  };
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    const open = Boolean(menu.hidden);
    setOpen(open);
    if (open) menu.querySelector<HTMLElement>('select, button, a')?.focus();
  });
  document.addEventListener('click', (event) => {
    if (!menu.hidden && !menu.contains(event.target as Node)) setOpen(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !menu.hidden) {
      setOpen(false);
      button.focus();
    }
  });
  menu.addEventListener('click', (event) => {
    if ((event.target as Element).closest('a, button')) setOpen(false);
  });
  menu.addEventListener('change', () => setOpen(false));
}

function setupLangSelect(root: HTMLElement): void {
  const select = root.querySelector<HTMLSelectElement>('#lang-select');
  if (!select) return;
  select.addEventListener('change', () => {
    setLang(select.value as Parameters<typeof setLang>[0]);
  });
}

function setupMobilePanelToggles(
  root: HTMLElement,
  leftPanel: HTMLElement,
  rightPanel: HTMLElement,
): void {
  const toggleLeftBtn = root.querySelector<HTMLButtonElement>('#toggle-left-panel')!;
  const toggleRightBtn = root.querySelector<HTMLButtonElement>('#toggle-right-panel')!;
  const backdrop = root.querySelector<HTMLElement>('#mobile-backdrop')!;
  const mobileQuery = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX}px)`);

  const isPanelOpen = (panel: HTMLElement): boolean => panel.classList.contains('panel--open');

  const closePanels = (): void => {
    leftPanel.classList.remove('panel--open');
    rightPanel.classList.remove('panel--open');
    backdrop.classList.remove('mobile-backdrop--visible');
    toggleLeftBtn.setAttribute('aria-expanded', 'false');
    toggleRightBtn.setAttribute('aria-expanded', 'false');
  };

  const openPanel = (panel: HTMLElement, btn: HTMLButtonElement): void => {
    leftPanel.classList.remove('panel--open');
    rightPanel.classList.remove('panel--open');
    toggleLeftBtn.setAttribute('aria-expanded', 'false');
    toggleRightBtn.setAttribute('aria-expanded', 'false');
    panel.classList.add('panel--open');
    btn.setAttribute('aria-expanded', 'true');
    backdrop.classList.add('mobile-backdrop--visible');
  };

  const togglePanel = (panel: HTMLElement, btn: HTMLButtonElement): void => {
    if (isPanelOpen(panel)) {
      closePanels();
    } else {
      openPanel(panel, btn);
    }
  };

  toggleLeftBtn.addEventListener('click', () => {
    if (mobileQuery.matches) togglePanel(leftPanel, toggleLeftBtn);
  });
  toggleRightBtn.addEventListener('click', () => {
    if (mobileQuery.matches) togglePanel(rightPanel, toggleRightBtn);
  });
  backdrop.addEventListener('click', closePanels);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePanels();
  });

  // Selecting an object is the main mobile action that needs the (hidden by
  // default) right panel — surface it automatically instead of leaving the
  // user stuck looking at an empty globe.
  let lastSelectedIndex: number | null = null;
  subscribe(() => {
    const { selectedIndex } = getState();
    if (!mobileQuery.matches) {
      lastSelectedIndex = selectedIndex;
      return;
    }
    if (selectedIndex != null && selectedIndex !== lastSelectedIndex) {
      openPanel(rightPanel, toggleRightBtn);
    }
    lastSelectedIndex = selectedIndex;
  });

  // Picking a launch shows its details, like picking a satellite. The globe
  // flies to the pad behind the drawer; closing the drawer shows the marker.
  let lastLaunchId: string | null = null;
  subscribe(() => {
    const launchId = getState().selectedLaunch?.id ?? null;
    if (mobileQuery.matches && launchId != null && launchId !== lastLaunchId) openPanel(rightPanel, toggleRightBtn);
    lastLaunchId = launchId;
  });

  mobileQuery.addEventListener('change', (e) => {
    if (!e.matches) closePanels();
  });
}

/**
 * Desktop: the panel buttons at either end of the header collapse the left and right panels so the
 * globe can take the space. The choice is remembered. Showing something in the
 * details panel (selecting a satellite, replaying an event, verifying a close
 * approach) opens it again for that visit, so a click never seems to do nothing.
 * Phones keep their slide-in drawers (setupMobilePanelToggles).
 */
function setupDesktopPanelToggles(root: HTMLElement): void {
  const grid = root.querySelector<HTMLElement>('.app-grid')!;
  const toggleLeft = root.querySelector<HTMLButtonElement>('#toggle-left-panel')!;
  const toggleRight = root.querySelector<HTMLButtonElement>('#toggle-right-panel')!;
  const mobileQuery = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX}px)`);

  let collapsed = loadCollapsed();
  let tourSide: 'left' | 'right' | null = null;

  const apply = (): void => {
    const left = collapsed.left && tourSide !== 'left';
    const right = collapsed.right && tourSide !== 'right';
    grid.classList.toggle('app-grid--left-collapsed', left);
    grid.classList.toggle('app-grid--right-collapsed', right);
    if (!mobileQuery.matches) {
      toggleLeft.setAttribute('aria-expanded', String(!left));
      toggleRight.setAttribute('aria-expanded', String(!right));
    }
  };

  const toggle = (side: keyof CollapsedPanels): void => {
    if (mobileQuery.matches) return;
    collapsed = { ...collapsed, [side]: !collapsed[side] };
    saveCollapsed(collapsed);
    apply();
  };
  toggleLeft.addEventListener('click', () => toggle('left'));
  toggleRight.addEventListener('click', () => toggle('right'));

  // Something to show in the details panel: open it again (not remembered).
  const selectionKey = (): string => {
    const s = getState();
    return [s.selectedIndex, s.selectedEventId, s.selectedConjunction ? 'c' : null, s.selectedLaunch?.id ?? null].join('|');
  };
  let lastSelection = selectionKey();
  subscribe(() => {
    const key = selectionKey();
    if (key === lastSelection) return;
    lastSelection = key;
    const hasSelection = key !== '||';
    if (hasSelection && collapsed.right && !mobileQuery.matches) {
      collapsed = { ...collapsed, right: false };
      apply();
    }
  });

  mobileQuery.addEventListener('change', apply);
  desktopPanels = {
    setTour: (side) => {
      tourSide = side;
      apply();
    },
  };
  apply();
}

export function isMobileLayout(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX}px)`).matches
  );
}

/** Open/close mobile drawers for guided tours. No-op on desktop. */
export function setTourPanel(side: 'left' | 'right' | null): void {
  const leftPanel = document.getElementById('left-panel');
  const rightPanel = document.getElementById('right-panel');
  const backdrop = document.getElementById('mobile-backdrop');
  const toggleLeftBtn = document.getElementById('toggle-left-panel');
  const toggleRightBtn = document.getElementById('toggle-right-panel');
  if (!leftPanel || !rightPanel || !backdrop || !toggleLeftBtn || !toggleRightBtn) return;

  leftPanel.classList.remove('panel--open');
  rightPanel.classList.remove('panel--open');
  backdrop.classList.remove('mobile-backdrop--visible');
  toggleLeftBtn.setAttribute('aria-expanded', 'false');
  toggleRightBtn.setAttribute('aria-expanded', 'false');

  // Desktop: show a collapsed panel for its tour step, restore the user's choice otherwise.
  desktopPanels?.setTour(isMobileLayout() ? null : side);

  if (!isMobileLayout() || side == null) return;

  const panel = side === 'left' ? leftPanel : rightPanel;
  const btn = side === 'left' ? toggleLeftBtn : toggleRightBtn;
  panel.classList.add('panel--open');
  btn.setAttribute('aria-expanded', 'true');
  backdrop.classList.add('mobile-backdrop--visible');
}
