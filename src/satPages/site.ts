/**
 * Every file the satellite pages add to the build, as (path in dist/, content).
 * Writing them is left to the build plugin in vite.config.ts.
 */
import { buildSatPageCatalog } from './catalog';
import {
  renderListPage,
  renderNotFoundPage,
  renderSatPage,
  renderSitemap,
  SAT_LIST_PATH,
  satPagePath,
  type PageFonts,
} from './render';

export interface SatSite {
  /** Path relative to dist/ (e.g. "sat/25544/index.html") → file content. */
  files: Map<string, string>;
  /** Number of satellite pages (not counting the list, 404 and sitemap). */
  satelliteCount: number;
  /** Objects with frequencies left out because their orbit no longer propagates. */
  skippedCount: number;
}

export function buildSatSite(raw: unknown, fonts: PageFonts, asOf = new Date()): SatSite {
  const { fetchedAt, entries, skippedCount } = buildSatPageCatalog(raw, asOf);
  const ctx = { fetchedAt, fonts };
  const files = new Map<string, string>();
  for (const entry of entries) {
    files.set(`${satPagePath(entry.noradId).slice(1)}index.html`, renderSatPage(entry, ctx));
  }
  files.set(`${SAT_LIST_PATH.slice(1)}index.html`, renderListPage(entries, ctx));
  files.set('404.html', renderNotFoundPage(ctx));
  files.set(
    'sitemap.xml',
    renderSitemap(['/', SAT_LIST_PATH, ...entries.map((e) => satPagePath(e.noradId))], fetchedAt),
  );
  return { files, satelliteCount: entries.length, skippedCount };
}
