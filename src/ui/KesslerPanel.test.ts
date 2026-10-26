// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initState } from '../state/appState';
import {
  closeKesslerPanel,
  formatCompactNumber,
  initKesslerPanel,
  isKesslerPanelOpen,
  openKesslerPanel,
} from './KesslerPanel';

function mountHeader(): void {
  document.body.innerHTML = `
    <header class="app-header">
      <div class="header-brand">
        <div class="header-title">Orbital Congestion Simulator</div>
      </div>
      <div class="header-actions" id="header-actions">
        <div class="header-more" id="header-more">
          <button id="header-more-btn" type="button" aria-expanded="false">More</button>
          <div class="header-menu" id="header-menu">
            <div class="header-lang"><button id="lang-toggle" type="button">Language</button></div>
            <a class="header-github" href="https://github.com/muhammet842/orbital-congestion-simulator-premium">GitHub</a>
          </div>
        </div>
      </div>
    </header>
  `;
}

beforeEach(() => {
  mountHeader();
  initState([], {
    total: 12000,
    leoPercent: 80,
    avgAltitude: 600,
    categoryCounts: { active: 6000, debris: 5000, stations: 1000 },
    fetchedAt: new Date().toISOString(),
  });
});

afterEach(() => {
  closeKesslerPanel();
  document.body.innerHTML = '';
});

describe('initKesslerPanel', () => {
  it('adds a labelled header button before the More menu', () => {
    initKesslerPanel();
    const btn = document.getElementById('kessler-panel-btn');
    const more = document.getElementById('header-more');
    const actions = document.getElementById('header-actions');
    expect(btn).not.toBeNull();
    expect(actions?.contains(btn!)).toBe(true);
    expect(btn?.nextElementSibling).toBe(more);
    expect(btn?.querySelector('svg')).not.toBeNull();
    expect(btn?.textContent).toBe('Future Projection');
  });

  it('opens the panel when the header button is clicked', () => {
    initKesslerPanel();
    expect(isKesslerPanelOpen()).toBe(false);
    document.getElementById('kessler-panel-btn')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(isKesslerPanelOpen()).toBe(true);
  });
});

describe('openKesslerPanel / closeKesslerPanel', () => {
  it('renders the scenario sliders and presets without a run button', () => {
    openKesslerPanel();
    expect(document.getElementById('kp-launch')).not.toBeNull();
    expect(document.getElementById('kp-mitigation')).not.toBeNull();
    expect(document.getElementById('kp-risk')).not.toBeNull();
    expect(document.getElementById('kp-target-year')).not.toBeNull();
    expect(document.getElementById('kp-run')).toBeNull();
    expect(document.querySelectorAll('[data-preset]').length).toBe(4);
  });

  it('auto-runs the business-as-usual projection when opened', () => {
    openKesslerPanel();
    expect(document.getElementById('kp-results-section')?.hasAttribute('hidden')).toBe(false);
    expect(document.getElementById('kp-stat-total')?.textContent).not.toBe('—');
    expect(document.getElementById('kp-stat-leo')?.textContent).not.toBe('—');
    expect(document.getElementById('kp-narrative')?.textContent?.length).toBeGreaterThan(0);
  });

  it('does not open a second backdrop if already open', () => {
    openKesslerPanel();
    openKesslerPanel();
    expect(document.querySelectorAll('#kessler-panel-backdrop').length).toBe(1);
  });

  it('shows LEO collision risk as a multiplier, not a percent', () => {
    openKesslerPanel();
    const risk = document.getElementById('kp-stat-risk')?.textContent ?? '';
    expect(risk).toMatch(/×$/);
    expect(risk).not.toContain('%');
  });

  it('projects a larger population for a higher launch-rate slider value', () => {
    openKesslerPanel();
    const baselineText = document.getElementById('kp-stat-total')?.textContent ?? '0';
    const baselineTotal = Number(baselineText.replace(/[^\d]/g, ''));

    const launchSlider = document.getElementById('kp-launch') as HTMLInputElement;
    launchSlider.value = '400';
    launchSlider.dispatchEvent(new Event('input', { bubbles: true }));

    const aggressiveText = document.getElementById('kp-stat-total')?.textContent ?? '0';
    const aggressiveTotal = Number(aggressiveText.replace(/[^\d]/g, ''));

    expect(aggressiveTotal).toBeGreaterThan(baselineTotal);
  });

  it('applies a named preset and updates the projection', () => {
    openKesslerPanel();
    const bauTotal = Number((document.getElementById('kp-stat-total')?.textContent ?? '0').replace(/[^\d]/g, ''));

    const boomBtn = document.querySelector('[data-preset="boom"]') as HTMLButtonElement;
    boomBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const boomTotal = Number((document.getElementById('kp-stat-total')?.textContent ?? '0').replace(/[^\d]/g, ''));
    expect(boomTotal).toBeGreaterThan(bauTotal);
    expect(boomBtn.classList.contains('kp-preset--active')).toBe(true);
  });

  it('colours each slider track up to its handle', () => {
    openKesslerPanel();
    const fill = (id: string): string =>
      (document.getElementById(id) as HTMLInputElement).style.getPropertyValue('--fill');

    // The timeline starts at its last year, so its track is full.
    expect(fill('kp-scrub')).toBe('100%');
    const launch = document.getElementById('kp-launch') as HTMLInputElement;
    launch.value = launch.max;
    launch.dispatchEvent(new Event('input', { bubbles: true }));
    expect(fill('kp-launch')).toBe('100%');
    launch.value = launch.min;
    launch.dispatchEvent(new Event('input', { bubbles: true }));
    expect(fill('kp-launch')).toBe('0%');
  });

  it('updates the scrubbed year display when the scrub slider changes', () => {
    openKesslerPanel();

    const scrub = document.getElementById('kp-scrub') as HTMLInputElement;
    scrub.value = '0';
    scrub.dispatchEvent(new Event('input', { bubbles: true }));

    const scrubVal = document.getElementById('kp-scrub-val')?.textContent ?? '';
    expect(scrubVal).toContain(String(new Date().getUTCFullYear() + 1));
  });

  it('closes on Escape and removes the backdrop from the DOM', () => {
    openKesslerPanel();
    expect(isKesslerPanelOpen()).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(isKesslerPanelOpen()).toBe(false);
    expect(document.getElementById('kessler-panel-backdrop')).toBeNull();
  });

  it('closes when clicking directly on the backdrop', () => {
    openKesslerPanel();
    const backdrop = document.getElementById('kessler-panel-backdrop')!;
    backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(isKesslerPanelOpen()).toBe(false);
  });

  it('formats outlook counts in en-US (comma thousands, dot decimals)', () => {
    openKesslerPanel();
    const boomBtn = document.querySelector('[data-preset="boom"]') as HTMLButtonElement;
    boomBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const total = document.getElementById('kp-stat-total')?.textContent ?? '';
    const collisions = document.getElementById('kp-stat-collisions')?.textContent ?? '';

    // Thousands use commas, not European dots (144,357 not 144.357).
    if (/\d{4,}/.test(total.replace(/,/g, ''))) {
      expect(total).toMatch(/^\d{1,3}(,\d{3})*$/);
    }
    // Decimals use a dot (25.1), never a locale comma (25,1).
    expect(collisions).not.toMatch(/,\d$/);
    if (collisions.includes('.')) {
      expect(collisions).toMatch(/^\d+(\.\d+)?$/);
    }
  });
});

describe('formatCompactNumber', () => {
  it('uses en-US decimals below 100k', () => {
    expect(formatCompactNumber(21.8, 1)).toBe('21.8');
    expect(formatCompactNumber(25.1, 1)).toBe('25.1');
    expect(formatCompactNumber(51969, 0)).toBe('51,969');
  });

  it('uses English K/M compact suffixes, not Turkish B-for-bin', () => {
    expect(formatCompactNumber(155_900, 0)).toMatch(/155\.9K/i);
    expect(formatCompactNumber(155_900, 0)).not.toMatch(/B/i);
    expect(formatCompactNumber(7_800_000, 0)).toMatch(/7\.8M/i);
  });
});
