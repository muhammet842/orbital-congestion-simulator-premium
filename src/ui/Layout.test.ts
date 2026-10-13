// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { createLayout } from './Layout';
import { selectLaunch, setState } from '../state/appState';

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
