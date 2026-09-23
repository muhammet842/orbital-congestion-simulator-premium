import { getState, subscribe } from '../state/appState';
import { getLang, setLang, SUPPORTED_LANGS, t } from '../i18n/i18n';

/** Must match the max-width used for `.app-grid`'s mobile layout in style.css. */
export const MOBILE_BREAKPOINT_PX = 860;

export function createLayout(root: HTMLElement): {
  leftPanel: HTMLElement;
  rightPanel: HTMLElement;
  sceneContainer: HTMLElement;
  timeBar: HTMLElement;
} {
  root.innerHTML = `
    <div class="app-grid">
      <header class="app-header">
        <button id="toggle-left-panel" class="panel-toggle-btn" type="button" aria-label="${t('layout.toggle_left')}" data-i18n-aria="layout.toggle_left" aria-expanded="false">☰</button>

        <div class="header-brand">
          <span class="header-mark" aria-hidden="true">
            <span class="header-mark__core"></span>
            <span class="header-mark__ring header-mark__ring--inner"></span>
            <span class="header-mark__ring header-mark__ring--outer"></span>
          </span>
          <div class="header-title">
            <span class="header-title-full" data-i18n="brand.full">${t('brand.full')}</span>
            <span class="header-title-short" data-i18n="brand.short">${t('brand.short')}</span>
          </div>
        </div>

        <button id="toggle-right-panel" class="panel-toggle-btn" type="button" aria-label="${t('layout.toggle_right')}" data-i18n-aria="layout.toggle_right" aria-expanded="false">ℹ</button>

        <div class="header-actions" id="header-actions">
          <label class="header-lang">
            <span class="header-lang-icon" aria-hidden="true">🌐</span>
            <select id="lang-select" class="lang-select" aria-label="${t('layout.lang_aria')}" data-i18n-aria="layout.lang_aria">
              ${SUPPORTED_LANGS.map((l) => `<option value="${l}"${l === getLang() ? ' selected' : ''}>${l.toUpperCase()}</option>`).join('')}
            </select>
          </label>
          <a
            class="header-github"
            href="https://github.com/muhammet842/orbital-congestion-simulator-premium"
            target="_blank"
            rel="noopener noreferrer"
            title="${t('layout.github_title')}"
            data-i18n-title="layout.github_title"
          >
            <svg class="header-github-icon" viewBox="0 0 16 16" aria-hidden="true" width="14" height="14">
              <path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82A7.68 7.68 0 0 1 8 4.77c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/>
            </svg>
            <span class="header-github-label" data-i18n="layout.github_label">${t('layout.github_label')}</span>
          </a>
        </div>
      </header>
      <aside id="left-panel" class="panel panel-left"></aside>
      <main id="scene-container" class="scene-container"></main>
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
  setupLangSelect(root);

  return { leftPanel, rightPanel, sceneContainer, timeBar };
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

  toggleLeftBtn.addEventListener('click', () => togglePanel(leftPanel, toggleLeftBtn));
  toggleRightBtn.addEventListener('click', () => togglePanel(rightPanel, toggleRightBtn));
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

  mobileQuery.addEventListener('change', (e) => {
    if (!e.matches) closePanels();
  });
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

  if (!isMobileLayout() || side == null) return;

  const panel = side === 'left' ? leftPanel : rightPanel;
  const btn = side === 'left' ? toggleLeftBtn : toggleRightBtn;
  panel.classList.add('panel--open');
  btn.setAttribute('aria-expanded', 'true');
  backdrop.classList.add('mobile-backdrop--visible');
}
