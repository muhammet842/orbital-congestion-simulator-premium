import { describe, expect, it } from 'vitest';
import type { SatPageEntry } from './catalog';
import {
  renderListPage,
  renderNotFoundPage,
  renderSatPage,
  renderSitemap,
  SITE_ORIGIN,
  satPagePath,
} from './render';

const ctx = { fetchedAt: '2026-11-23T13:06:37.310Z', fonts: { sans400: '/assets/ibm-plex-sans-latin-400-normal-x.woff2' } };

function entry(overrides: Partial<SatPageEntry> = {}): SatPageEntry {
  return {
    noradId: 99999,
    name: 'TEST <SAT>',
    category: 'active',
    country: 'Testland',
    owner: 'Ops & Co',
    layer: 'LEO',
    inclinationDeg: 97.51,
    periodMin: 95.2,
    perigeeKm: 500.4,
    apogeeKm: 520.6,
    epoch: '2026-11-22T06:00:00.000Z',
    elementsAgeDays: 1,
    radioFrequencies: [
      {
        service: 'FM <b>voice</b>',
        uplinkMHz: '145.850',
        downlinkMHz: '436.795',
        mode: 'FM',
        sourceUrl: 'javascript:alert(1)',
        amateur: true,
      },
      {
        service: 'Weather images',
        downlinkMHz: '137.100',
        mode: 'APT',
        sourceUrl: 'https://example.org/sat?a=1&b=2',
        amateur: false,
      },
    ],
    listFrequenciesMHz: [436.795, 137.1],
    listModes: ['FM', 'APT'],
    amateur: true,
    ...overrides,
  };
}

describe('renderSatPage', () => {
  const html = renderSatPage(entry(), ctx);

  it('escapes catalogue text', () => {
    expect(html).toContain('TEST &lt;SAT&gt;');
    expect(html).not.toContain('<SAT>');
    expect(html).toContain('FM &lt;b&gt;voice&lt;/b&gt;');
    expect(html).toContain('Ops &amp; Co');
  });

  it('only links http(s) sources', () => {
    expect(html).not.toContain('javascript:');
    expect(html).toContain('href="#"');
    expect(html).toContain('href="https://example.org/sat?a=1&amp;b=2"');
  });

  it('badges amateur channels and dims confirmed other services, as the details panel does', () => {
    expect(html).toMatch(/FM &lt;b&gt;voice&lt;\/b&gt; <span class="badge">Amateur<\/span>/);
    expect(html).toMatch(/<tr class="other"><td>Weather images<\/td>/);
    // Missing uplink shows a dash.
    expect(html).toMatch(/Weather images<\/td><td class="freq">—<\/td>/);
  });

  it('has its own canonical address, title and description', () => {
    expect(html).toContain(`<link rel="canonical" href="${SITE_ORIGIN}/sat/99999/">`);
    expect(html).toContain('<title>TEST &lt;SAT&gt; (NORAD 99999): radio frequencies and orbit | Orbital Congestion Simulator</title>');
    expect(html).toMatch(/<meta name="description" content="[^"]*436\.795 MHz, 137\.1 MHz \(FM, APT\)/);
  });

  it('runs no script of its own: only the same-origin visit counter (the CSP allows no inline script)', () => {
    const scripts = html.match(/<script\b[^>]*>/g) ?? [];
    expect(scripts).toEqual(['<script defer src="/_vercel/insights/script.js">']);
    expect(html).not.toMatch(/\son[a-z]+=/i);
  });

  it('links to the 3D view and the Radio panel for this satellite', () => {
    expect(html).toContain('href="/?object=99999"');
    expect(html).toContain('href="/?radio=easy&amp;rq=99999"');
  });

  it('loads built fonts by absolute path', () => {
    expect(html).toContain("src:url('/assets/ibm-plex-sans-latin-400-normal-x.woff2')");
  });

  it('shows the orbit summary', () => {
    expect(html).toContain('97.5°');
    expect(html).toContain('95.2 min');
    expect(html).toContain('500 km – 521 km');
  });

  it('notes week-old and SatNOGS-sourced orbit data like the app', () => {
    expect(html).not.toContain('days old');
    expect(renderSatPage(entry({ elementsAgeDays: 10 }), ctx)).toContain('Orbit data is 10 days old');
    expect(renderSatPage(entry({ tleSource: 'satnogs', elementsAgeDays: 3 }), ctx)).toContain(
      'Orbit data from the SatNOGS DB (CelesTrak publishes none for this satellite), 3 days old',
    );
  });

  it('names a station with amateur radio as a station', () => {
    expect(renderSatPage(entry({ category: 'stations' }), ctx)).toContain('Space station with amateur radio');
    expect(renderSatPage(entry({ amateur: false }), ctx)).toContain('NORAD 99999 · Satellite ·');
  });

  it('lists docked parts', () => {
    const page = renderSatPage(entry({ dockedComponents: [{ noradId: 49044, name: 'ISS (NAUKA)' }] }), ctx);
    expect(page).toContain('Docked parts');
    expect(page).toContain('ISS (NAUKA) <span class="muted">NORAD 49044</span>');
  });
});

describe('renderListPage', () => {
  it('links every satellite page and counts the amateur satellites', () => {
    const html = renderListPage([entry(), entry({ noradId: 11111, name: 'OTHER', amateur: false })], ctx);
    expect(html).toContain('href="/sat/99999/"');
    expect(html).toContain('href="/sat/11111/"');
    expect(html).toContain('2 satellites with published receive frequencies');
    expect(html).toContain('1 of them carry an amateur-radio service');
    expect(html).toContain(`<link rel="canonical" href="${SITE_ORIGIN}/sat/">`);
  });
});

describe('renderNotFoundPage', () => {
  it('is not indexed and has no canonical address', () => {
    const html = renderNotFoundPage(ctx);
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).not.toContain('rel="canonical"');
  });
});

describe('renderSitemap', () => {
  it('lists absolute addresses with the catalogue date', () => {
    const xml = renderSitemap(['/', satPagePath(25544)], ctx.fetchedAt);
    expect(xml).toContain(`<loc>${SITE_ORIGIN}/</loc>`);
    expect(xml).toContain(`<loc>${SITE_ORIGIN}/sat/25544/</loc>`);
    expect(xml.match(/<lastmod>2026-11-23<\/lastmod>/g)).toHaveLength(2);
  });
});
