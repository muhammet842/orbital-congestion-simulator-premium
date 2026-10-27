// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLayout, setTourPanel } from './Layout';
import { selectLaunch, setState } from '../state/appState';
import { getLang, setLang } from '../i18n/i18n';

beforeEach(() => {
  // jsdom has no matchMedia; the layout uses it for the mobile breakpoint.
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
});

describe('createLayout', () => {
  it("renders the app title as the page's single h1", () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    createLayout(root);
    const headings = root.querySelectorAll('h1');
    expect(headings).toHaveLength(1);
    expect(headings[0].textContent).toMatch(/Orbital Congestion/);
    document.body.removeChild(root);
  });
});

describe('language choice in the More menu', () => {
  it('opens the list under the Language row, switches language and closes the menu', () => {
    setLang('en');
    const root = document.createElement('div');
    document.body.appendChild(root);
    createLayout(root);
    const menu = root.querySelector<HTMLElement>('#header-menu')!;
    const toggle = root.querySelector<HTMLButtonElement>('#lang-toggle')!;
    const list = root.querySelector<HTMLElement>('#lang-list')!;
    expect(root.querySelector('select')).toBeNull();

    root.querySelector<HTMLButtonElement>('#header-more-btn')!.click();
    expect(list.hidden).toBe(true);
    toggle.click();
    expect(menu.hidden).toBe(false); // opening the list keeps the menu open
    expect(list.hidden).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    list.querySelector<HTMLButtonElement>('[data-lang="tr"]')!.click();
    expect(getLang()).toBe('tr');
    expect(menu.hidden).toBe(true);
    expect(list.hidden).toBe(true); // closed with the menu
    expect(root.querySelector('#lang-current')?.textContent).toBe('Türkçe');
    expect(list.querySelector('[data-lang="tr"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(list.querySelector('[data-lang="en"]')?.getAttribute('aria-pressed')).toBe('false');

    setLang('en');
    document.body.removeChild(root);
  });
});

describe('mobile drawers and launches', () => {
  function mockMatchMedia(matches: boolean): void {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: (query: string) => ({
        matches,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }

  const pad = { id: 'launch-drawer-test', name: 'CRS-35', latitudeDeg: 28.56, longitudeDeg: -80.58, padName: null };

  it('closes the open drawer on a phone when a launch is picked, so the pad marker is visible', () => {
    mockMatchMedia(true);
    setState({ selectedLaunch: null });
    const root = document.createElement('div');
    document.body.appendChild(root);
    createLayout(root);

    root.querySelector<HTMLButtonElement>('#toggle-left-panel')!.click();
    expect(root.querySelector('#left-panel')!.classList.contains('panel--open')).toBe(true);

    selectLaunch(pad);
    expect(root.querySelector('#left-panel')!.classList.contains('panel--open')).toBe(false);
    selectLaunch(null);
    document.body.removeChild(root);
  });

  it('leaves the panels alone on desktop', () => {
    mockMatchMedia(false);
    setState({ selectedLaunch: null });
    const root = document.createElement('div');
    document.body.appendChild(root);
    createLayout(root);
    const left = root.querySelector('#left-panel')!;
    left.classList.add('panel--open');

    selectLaunch({ ...pad, id: 'launch-desktop-test' });
    expect(left.classList.contains('panel--open')).toBe(true);
    selectLaunch(null);
    document.body.removeChild(root);
  });
});

describe('collapsible panels on desktop', () => {
  function stubMedia(mobile: boolean): void {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: (query: string) => ({
        matches: mobile,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }

  function mount(): { root: HTMLElement; grid: HTMLElement; left: HTMLButtonElement; right: HTMLButtonElement } {
    const root = document.createElement('div');
    document.body.appendChild(root);
    createLayout(root);
    return {
      root,
      grid: root.querySelector<HTMLElement>('.app-grid')!,
      left: root.querySelector<HTMLButtonElement>('#toggle-left-panel')!,
      right: root.querySelector<HTMLButtonElement>('#toggle-right-panel')!,
    };
  }

  beforeEach(() => {
    localStorage.clear();
    stubMedia(false);
    setState({ selectedIndex: null, selectedEventId: null, selectedConjunction: null, selectedLaunch: null });
  });

  afterEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    setTourPanel(null);
  });

  it('starts with both panels open', () => {
    const { grid, left, right } = mount();
    expect(grid.classList.contains('app-grid--left-collapsed')).toBe(false);
    expect(grid.classList.contains('app-grid--right-collapsed')).toBe(false);
    expect([left.getAttribute('aria-expanded'), right.getAttribute('aria-expanded')]).toEqual(['true', 'true']);
  });

  it('collapses and re-opens each panel from its header button, and remembers the choice', () => {
    const { grid, left, right } = mount();

    left.click();
    expect(grid.classList.contains('app-grid--left-collapsed')).toBe(true);
    expect(left.getAttribute('aria-expanded')).toBe('false');
    expect(JSON.parse(localStorage.getItem('orbital-panels')!)).toEqual({ left: true, right: false });

    right.click();
    expect(grid.classList.contains('app-grid--right-collapsed')).toBe(true);
    expect(JSON.parse(localStorage.getItem('orbital-panels')!)).toEqual({ left: true, right: true });

    left.click();
    right.click();
    expect(grid.classList.contains('app-grid--left-collapsed')).toBe(false);
    expect(grid.classList.contains('app-grid--right-collapsed')).toBe(false);
    expect(JSON.parse(localStorage.getItem('orbital-panels')!)).toEqual({ left: false, right: false });
  });

  it('restores a remembered choice on the next visit, and shrugs off corrupt storage', () => {
    localStorage.setItem('orbital-panels', JSON.stringify({ left: true, right: false }));
    const first = mount();
    expect(first.grid.classList.contains('app-grid--left-collapsed')).toBe(true);
    expect(first.grid.classList.contains('app-grid--right-collapsed')).toBe(false);
    expect(first.left.getAttribute('aria-expanded')).toBe('false');

    document.body.innerHTML = '';
    localStorage.setItem('orbital-panels', '{not json');
    const second = mount();
    expect(second.grid.classList.contains('app-grid--left-collapsed')).toBe(false);
  });

  it('opens the details panel again when something is selected, without changing the saved choice', () => {
    localStorage.setItem('orbital-panels', JSON.stringify({ left: false, right: true }));
    const { grid, right } = mount();
    expect(grid.classList.contains('app-grid--right-collapsed')).toBe(true);

    setState({ selectedIndex: 3 });
    expect(grid.classList.contains('app-grid--right-collapsed')).toBe(false);
    expect(right.getAttribute('aria-expanded')).toBe('true');
    expect(JSON.parse(localStorage.getItem('orbital-panels')!)).toEqual({ left: false, right: true });

    // Clearing the selection leaves it as the user now sees it.
    setState({ selectedIndex: null });
    expect(grid.classList.contains('app-grid--right-collapsed')).toBe(false);
  });

  it('also opens it for an event replay and for a launch (its details show there)', () => {
    localStorage.setItem('orbital-panels', JSON.stringify({ left: false, right: true }));
    const { grid } = mount();

    selectLaunch({ id: 'launch-1', name: 'x', latitudeDeg: 1, longitudeDeg: 2, padName: null });
    expect(grid.classList.contains('app-grid--right-collapsed')).toBe(false);
    selectLaunch(null);
  });

  it('opens it for an event replay', () => {
    localStorage.setItem('orbital-panels', JSON.stringify({ left: false, right: true }));
    const { grid } = mount();
    setState({ selectedEventId: 'iridium-cosmos' });
    expect(grid.classList.contains('app-grid--right-collapsed')).toBe(false);
  });

  it('shows a collapsed panel for its tour step and puts it back afterwards', () => {
    localStorage.setItem('orbital-panels', JSON.stringify({ left: true, right: true }));
    const { grid } = mount();

    setTourPanel('left');
    expect(grid.classList.contains('app-grid--left-collapsed')).toBe(false);
    expect(grid.classList.contains('app-grid--right-collapsed')).toBe(true);

    setTourPanel('right');
    expect(grid.classList.contains('app-grid--left-collapsed')).toBe(true);
    expect(grid.classList.contains('app-grid--right-collapsed')).toBe(false);

    setTourPanel(null);
    expect(grid.classList.contains('app-grid--left-collapsed')).toBe(true);
    expect(grid.classList.contains('app-grid--right-collapsed')).toBe(true);
    expect(JSON.parse(localStorage.getItem('orbital-panels')!)).toEqual({ left: true, right: true });
  });

  it('leaves phones alone: the buttons keep working as drawers and never change the desktop choice', () => {
    stubMedia(true);
    const { grid, left } = mount();
    left.click();
    expect(grid.classList.contains('app-grid--left-collapsed')).toBe(false);
    expect(document.querySelector('#left-panel')!.classList.contains('panel--open')).toBe(true);
    expect(left.getAttribute('aria-expanded')).toBe('true');
    expect(localStorage.getItem('orbital-panels')).toBeNull();
  });
});
