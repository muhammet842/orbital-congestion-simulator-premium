// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { createLayout } from './Layout';

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
