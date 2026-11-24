import { describe, expect, it } from 'vitest';
import tleRaw from '../../public/data/tle.json?raw';
import { buildSatSite } from './site';

const raw = JSON.parse(tleRaw) as { fetchedAt: string };
const site = buildSatSite(raw, {}, new Date(raw.fetchedAt));

describe('buildSatSite', () => {
  it('writes one page per satellite plus the list, 404 and sitemap', () => {
    const satPages = [...site.files.keys()].filter((p) => /^sat\/\d+\/index\.html$/.test(p));
    expect(satPages).toHaveLength(site.satelliteCount);
    expect(site.files.has('sat/index.html')).toBe(true);
    expect(site.files.has('404.html')).toBe(true);
    expect(site.files.size).toBe(site.satelliteCount + 3);
  });

  it('puts the home page, the list and every satellite page in the sitemap', () => {
    const sitemap = site.files.get('sitemap.xml') ?? '';
    expect(sitemap.match(/<loc>/g)).toHaveLength(site.satelliteCount + 2);
    expect(sitemap).toContain('<loc>https://orbital-congestion.vercel.app/sat/25544/</loc>');
  });
});
