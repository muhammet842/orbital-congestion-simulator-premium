// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { initPanelSections } from './panelSections';
import { applyTranslations, setLang } from '../i18n/i18n';

function mount(): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = `
    <div id="tour-region-search">
      <h2 class="panel-heading" data-i18n="ui.search_objects">Search Objects</h2>
      <input id="search" />
      <h2 class="panel-heading" data-i18n="ui.advanced_filters">Advanced Filters</h2>
      <div id="advanced"></div>
    </div>
    <h2 class="panel-heading" data-i18n="ui.live_stats">Live Stats</h2>
    <dl id="stats"></dl>
    <div id="approaches">
      <h2 class="panel-heading" data-i18n="ui.close_approach">Close approaches</h2>
      <p class="panel-lede" id="lede">Why it matters</p>
      <p id="note" data-section-info>Accuracy</p>
      <p id="stale" hidden>Stale data</p>
      <div id="list"></div>
    </div>
  `;
  document.body.replaceChildren(root);
  return root;
}

const collapsed = (root: HTMLElement, id: string): boolean =>
  root.querySelector(`#${id}`)!.classList.contains('section-collapsed');

describe('initPanelSections', () => {
  beforeEach(() => {
    localStorage.clear();
    setLang('en');
  });

  it('turns each heading into a toggle and starts the chosen sections closed', () => {
    const root = mount();
    initPanelSections(root, ['ui.advanced_filters', 'ui.live_stats']);
    expect(root.querySelectorAll('.section-toggle')).toHaveLength(4);
    expect(collapsed(root, 'search')).toBe(false);
    expect(collapsed(root, 'advanced')).toBe(true);
    // A section ends at the next heading, even one nested in a wrapper.
    expect(collapsed(root, 'stats')).toBe(true);
    expect(root.querySelector('#approaches')!.classList.contains('section-collapsed')).toBe(false);
  });

  it('opens and closes a section and remembers the choice', () => {
    let root = mount();
    initPanelSections(root, ['ui.advanced_filters']);
    const toggle = root.querySelectorAll<HTMLButtonElement>('.section-toggle')[1];
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(collapsed(root, 'advanced')).toBe(false);

    root = mount();
    initPanelSections(root, ['ui.advanced_filters']);
    expect(collapsed(root, 'advanced')).toBe(false);
  });

  it('folds the explanation behind an info button, leaving other notes alone', () => {
    const root = mount();
    initPanelSections(root);
    const info = root.querySelectorAll<HTMLButtonElement>('.section-info-btn');
    expect(info).toHaveLength(1);
    const lede = root.querySelector('#lede')!;
    const note = root.querySelector('#note')!;
    expect(lede.classList.contains('section-info')).toBe(true);
    expect(note.classList.contains('section-info')).toBe(true);
    expect(root.querySelector('#stale')!.classList.contains('section-info')).toBe(false);

    info[0].click();
    expect(info[0].getAttribute('aria-expanded')).toBe('true');
    expect(lede.classList.contains('section-info--open')).toBe(true);
    expect(note.classList.contains('section-info--open')).toBe(true);
  });

  it('keeps the heading translatable after a language change', () => {
    const root = mount();
    initPanelSections(root);
    setLang('tr');
    applyTranslations(root);
    const label = root.querySelector('.section-toggle-label')!;
    expect(label.textContent).not.toBe('Search Objects');
    expect(root.querySelector('.section-toggle svg')).not.toBeNull();
  });
});
