/**
 * HTML for the build-time satellite pages: one page per satellite, a list
 * page, a 404 page and the sitemap. Plain HTML with an inline stylesheet:
 * nothing runs in the page except the cookieless visit counter.
 *
 * Texts shared with the app (radio table, disclaimer, orbit-data notes) come
 * from the English dictionary so both say the same thing.
 */
import { translations } from '../i18n/translations';
import { escapeHtml, safeHttpUrl } from '../ui/escapeHtml';
import { prepareRadioRows } from '../data/radioDisplay';
import { satnogsLikelyObserved, satnogsObservationsUrl } from '../data/satnogsLinks';
import { DEFAULT_RADIO_FILTERS, formatMHz, radioLinkSearch } from '../data/radioIndex';
import type { ObjectCategory } from '../types';
import type { SatPageEntry } from './catalog';

/** The site's address (the same as NEW_ORIGIN in src/movedNotice.ts). */
export const SITE_ORIGIN = 'https://orbital-congestion.vercel.app';
const SITE_NAME = 'Orbital Congestion Simulator';
/** Orbit data older than this gets a note, as in the app's details panel. */
const ORBIT_DATA_NOTE_AGE_DAYS = 7;

/** Built font files, as absolute paths (e.g. /assets/ibm-plex-sans-latin-400-normal-x.woff2). */
export interface PageFonts {
  sans400?: string;
  sans600?: string;
  mono400?: string;
}

export interface PageContext {
  /** When the catalogue was fetched (ISO). */
  fetchedAt: string;
  fonts: PageFonts;
}

const en = translations.en;
function text(key: string): string {
  return en[key] ?? key;
}

const CATEGORY_LABEL: Record<ObjectCategory, string> = {
  stations: 'Space station',
  active: 'Satellite',
  debris: 'Debris or rocket body',
};

export function satPagePath(noradId: number): string {
  return `/sat/${noradId}/`;
}

export const SAT_LIST_PATH = '/sat/';

function formatDateUtc(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} UTC`;
}

function km(value: number): string {
  return Number.isFinite(value) ? `${Math.round(value).toLocaleString('en-US')} km` : '—';
}

function fontFace(family: string, weight: number, path: string | undefined): string {
  return path
    ? `@font-face{font-family:'${family}';font-weight:${weight};font-style:normal;font-display:swap;src:url('${path}') format('woff2')}`
    : '';
}

function stylesheet(fonts: PageFonts): string {
  return [
    fontFace('IBM Plex Sans', 400, fonts.sans400),
    fontFace('IBM Plex Sans', 600, fonts.sans600),
    fontFace('IBM Plex Mono', 400, fonts.mono400),
    // Tokens from src/styles/base.css.
    `:root{--bg:#090a0c;--panel:rgba(14,15,18,.9);--border:rgba(236,232,225,.08);--text:#ece8e1;--muted:#9a958c;--accent:#e8a45a;--font:'IBM Plex Sans','Segoe UI',system-ui,sans-serif;--mono:'IBM Plex Mono',ui-monospace,monospace;color-scheme:dark}`,
    `*{box-sizing:border-box}`,
    `body{margin:0;background:var(--bg);color:var(--text);font:16px/1.55 var(--font)}`,
    `a{color:var(--accent)}`,
    `main,header,footer{max-width:960px;margin:0 auto;padding:0 16px}`,
    `header{padding-top:16px;font-size:.9rem}header a{text-decoration:none}`,
    `h1{font-size:1.9rem;line-height:1.2;margin:24px 0 4px}`,
    `h2{font-size:1.15rem;margin:32px 0 8px}`,
    `.muted{color:var(--muted)}`,
    `.lead{color:var(--muted);margin:0 0 16px}`,
    `.actions{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0}`,
    `.button{display:inline-block;padding:8px 14px;border:1px solid var(--accent);border-radius:6px;text-decoration:none;font-weight:600}`,
    `.button--primary{background:var(--accent);color:var(--bg)}`,
    `.table-wrap{overflow-x:auto;border:1px solid var(--border);border-radius:8px;background:var(--panel)}`,
    `table{border-collapse:collapse;width:100%;font-size:.92rem}`,
    `th,td{padding:8px 10px;text-align:left;vertical-align:top;border-bottom:1px solid var(--border)}`,
    `th{color:var(--muted);font-weight:600;white-space:nowrap}`,
    `td.freq{font-family:var(--mono);white-space:nowrap}`,
    `tr.other td{color:var(--muted)}`,
    `tr.note td,tr.source td{padding-top:0;font-size:.85rem}`,
    `tr.source td{padding-bottom:12px}`,
    `.badge{display:inline-block;margin-left:4px;padding:0 5px;border:1px solid var(--accent);border-radius:3px;color:var(--accent);font-size:.7em;letter-spacing:.04em;text-transform:uppercase;vertical-align:middle}`,
    `dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 16px;margin:0}`,
    `dt{color:var(--muted)}dd{margin:0}`,
    `ul.parts{margin:0;padding-left:18px}`,
    `footer{margin-top:40px;padding-bottom:32px;font-size:.85rem;color:var(--muted);border-top:1px solid var(--border);padding-top:16px}`,
  ].join('');
}

interface LayoutOptions {
  title: string;
  description: string;
  /** Absolute path of the page (null for the 404 page, which has no address of its own). */
  path: string | null;
  body: string;
  ctx: PageContext;
}

function layout({ title, description, path, body, ctx }: LayoutOptions): string {
  const url = path ? `${SITE_ORIGIN}${path}` : null;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
${url ? `<link rel="canonical" href="${escapeHtml(url)}">` : '<meta name="robots" content="noindex">'}
<meta name="theme-color" content="#090a0c">
<meta name="color-scheme" content="dark">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
${url ? `<meta property="og:url" content="${escapeHtml(url)}">` : ''}
<meta property="og:image" content="${SITE_ORIGIN}/og-image.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<style>${stylesheet(ctx.fonts)}</style>
<script defer src="/_vercel/insights/script.js"></script>
</head>
<body>
<header><a href="/">${SITE_NAME}</a> · <a href="${SAT_LIST_PATH}">Satellites you can hear</a></header>
<main>
${body}
</main>
<footer>
<p>Data as of ${escapeHtml(formatDateUtc(ctx.fetchedAt))}, refreshed daily. Orbital elements: <a href="https://celestrak.org/">CelesTrak</a>. Frequencies: <a href="https://db.satnogs.org/">SatNOGS DB</a> (<a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>), the AMSAT list and official constellation plans; each row links to its source.</p>
<p>Positions in the 3D view are SGP4 predictions from these elements, not live tracking. Frequencies are a reference, not an operating authorization.</p>
<p><a href="/">${SITE_NAME}</a> · open source (<a href="https://github.com/muhammet842/orbital-congestion-simulator-premium">GitHub</a>)</p>
</footer>
</body>
</html>
`;
}

function radioCell(value: string | undefined): string {
  return `<td class="freq">${escapeHtml(value ?? '—')}</td>`;
}

/** The radio table of the details panel (src/ui/rightPanel/objectDetail.ts), as static HTML. */
export function renderRadioTable(entry: SatPageEntry): string {
  const rows = prepareRadioRows(entry.radioFrequencies);
  if (rows.length === 0) return `<p class="muted">${escapeHtml(text('sat.radio_no_data'))}</p>`;
  const body = rows
    .map((row) => {
      const service = escapeHtml(row.genericService ? text('sat.radio_generic') : row.service);
      const badge = row.amateur === true ? ` <span class="badge">${escapeHtml(text('sat.radio_amateur'))}</span>` : '';
      return `<tr${row.amateur === false ? ' class="other"' : ''}><td>${service}${badge}</td>${radioCell(row.uplinkMHz)}${radioCell(row.downlinkMHz)}${radioCell(row.listenMHz)}<td>${escapeHtml(row.mode || '—')}</td></tr>
${row.note ? `<tr class="note"><td colspan="5" class="muted">${escapeHtml(row.note)}</td></tr>` : ''}
<tr class="source"><td colspan="5"><a href="${escapeHtml(safeHttpUrl(row.sourceUrl))}" rel="noopener">${escapeHtml(text('sat.radio_source'))}</a></td></tr>`;
    })
    .join('\n');
  const marker = rows.some((row) => row.hasMarker)
    ? `<p class="muted">${escapeHtml(text('sat.radio_marker_note'))}</p>`
    : '';
  const observations = satnogsLikelyObserved(entry.radioFrequencies) ? satnogsObservationsUrl(entry.noradId) : null;
  return `<p class="muted">${escapeHtml(text('sat.radio_disclaimer'))}</p>
<div class="table-wrap"><table>
<thead><tr><th>${escapeHtml(text('sat.radio_service'))}</th><th>${escapeHtml(text('sat.radio_uplink'))}</th><th>${escapeHtml(text('sat.radio_downlink'))}</th><th>${escapeHtml(text('sat.radio_listen'))}</th><th>${escapeHtml(text('sat.radio_mode'))}</th></tr></thead>
<tbody>
${body}
</tbody>
</table></div>
${marker}
${observations ? `<p><a href="${escapeHtml(observations)}" rel="noopener">${escapeHtml(text('sat.radio_observations'))} ↗</a></p>` : ''}`;
}

/** The note the details panel shows for SatNOGS-sourced or week-old elements. */
function orbitNote(entry: SatPageEntry): string {
  const days = String(entry.elementsAgeDays);
  if (entry.tleSource === 'satnogs') return text('sat.orbit_satnogs').replace('{d}', days);
  if (entry.elementsAgeDays > ORBIT_DATA_NOTE_AGE_DAYS) return text('sat.orbit_old').replace('{d}', days);
  return '';
}

/** Up to three receive frequencies with their modes, for the meta description. */
function frequencySummary(entry: SatPageEntry): string {
  const freqs = entry.listFrequenciesMHz.slice(0, 3).map((f) => `${formatMHz(f)} MHz`);
  const modes = entry.listModes.slice(0, 2);
  return `${freqs.join(', ')}${modes.length ? ` (${modes.join(', ')})` : ''}`;
}

export function satPageTitle(entry: SatPageEntry): string {
  return `${entry.name} (NORAD ${entry.noradId}): radio frequencies and orbit`;
}

/** "Amateur radio satellite", "Space station with amateur radio", or the category. */
function kindLabel(entry: SatPageEntry): string {
  if (!entry.amateur) return CATEGORY_LABEL[entry.category];
  return entry.category === 'stations' ? 'Space station with amateur radio' : 'Amateur radio satellite';
}

export function renderSatPage(entry: SatPageEntry, ctx: PageContext): string {
  const kind = kindLabel(entry);
  const description = `${entry.name} (NORAD ${entry.noradId}), ${kind.toLowerCase()}. Receive on ${frequencySummary(entry)}. Uplink and downlink frequencies, modes, sources and orbit, updated daily.`;
  const radioPanel = `/${radioLinkSearch({ ...DEFAULT_RADIO_FILTERS, query: String(entry.noradId) })}`;
  const note = orbitNote(entry);
  const docked = entry.dockedComponents?.length
    ? `<dt>${escapeHtml(text('sat.docked_parts'))}</dt><dd><ul class="parts">${entry.dockedComponents
        .map((part) => `<li>${escapeHtml(part.name)} <span class="muted">NORAD ${part.noradId}</span></li>`)
        .join('')}</ul></dd>`
    : '';
  const body = `<h1>${escapeHtml(entry.name)}</h1>
<p class="lead">NORAD ${entry.noradId} · ${escapeHtml(kind)} · ${escapeHtml(entry.country)}</p>
<div class="actions">
<a class="button button--primary" href="/?object=${entry.noradId}">Open in 3D</a>
<a class="button" href="${escapeHtml(radioPanel)}">Open in the Radio panel</a>
</div>
<p class="muted">The Radio panel can show whether ${escapeHtml(entry.name)} is above your horizon now and when it passes next (tick “Above my horizon now”).</p>
<h2>${escapeHtml(text('sat.radio_heading'))}</h2>
${renderRadioTable(entry)}
<h2>Orbit</h2>
<dl>
<dt>${escapeHtml(text('sat.layer'))}</dt><dd>${escapeHtml(entry.layer)}</dd>
<dt>${escapeHtml(text('sat.inclination'))}</dt><dd>${entry.inclinationDeg.toFixed(1)}°</dd>
<dt>Period</dt><dd>${Number.isFinite(entry.periodMin) ? `${entry.periodMin.toFixed(1)} min` : '—'}</dd>
<dt>Altitude (perigee – apogee)</dt><dd>${km(entry.perigeeKm)} – ${km(entry.apogeeKm)}</dd>
<dt>Orbit data from</dt><dd>${escapeHtml(formatDateUtc(entry.epoch))}</dd>
</dl>
${note ? `<p class="muted">${escapeHtml(note)}</p>` : ''}
<h2>Details</h2>
<dl>
<dt>${escapeHtml(text('sat.category'))}</dt><dd>${escapeHtml(CATEGORY_LABEL[entry.category])}</dd>
<dt>${escapeHtml(text('sat.country'))}</dt><dd>${escapeHtml(entry.country)}</dd>
<dt>${escapeHtml(text('sat.operator_owner'))}</dt><dd>${escapeHtml(entry.owner)}</dd>
${docked}
</dl>
<p><a href="${SAT_LIST_PATH}">All satellites you can hear on VHF/UHF</a></p>`;
  return layout({ title: `${satPageTitle(entry)} | ${SITE_NAME}`, description, path: satPagePath(entry.noradId), body, ctx });
}

export function renderListPage(entries: readonly SatPageEntry[], ctx: PageContext): string {
  const amateurCount = entries.filter((e) => e.amateur).length;
  const rows = entries
    .map((e) => {
      const freqs = e.listFrequenciesMHz.slice(0, 4).map(formatMHz).join(', ') + (e.listFrequenciesMHz.length > 4 ? ', …' : '');
      const modes = e.listModes.slice(0, 2).join('; ') + (e.listModes.length > 2 ? '; …' : '');
      const badge = e.amateur ? ` <span class="badge">${escapeHtml(text('sat.radio_amateur'))}</span>` : '';
      return `<tr><td><a href="${satPagePath(e.noradId)}">${escapeHtml(e.name)}</a>${badge}</td><td>${e.noradId}</td><td class="freq">${escapeHtml(freqs)}</td><td>${escapeHtml(modes)}</td></tr>`;
    })
    .join('\n');
  const body = `<h1>Satellites you can hear on VHF/UHF</h1>
<p class="lead">${entries.length} satellites with published receive frequencies between 30 and 500 MHz, the range a handheld radio or a small Yagi can receive. ${amateurCount} of them carry an amateur-radio service and are listed first. This is the same list as the Radio panel’s “Easy · VHF/UHF” view.</p>
<div class="actions"><a class="button button--primary" href="/${escapeHtml(radioLinkSearch(DEFAULT_RADIO_FILTERS))}">Open the Radio panel</a></div>
<p class="muted">${escapeHtml(text('sat.radio_disclaimer'))}</p>
<div class="table-wrap"><table>
<thead><tr><th>Satellite</th><th>NORAD</th><th>Receive MHz</th><th>${escapeHtml(text('sat.radio_mode'))}</th></tr></thead>
<tbody>
${rows}
</tbody>
</table></div>`;
  return layout({
    title: `Satellites you can hear on VHF/UHF: radio frequencies | ${SITE_NAME}`,
    description: `${entries.length} satellites you can receive with a handheld radio or small Yagi (30–500 MHz): downlink frequencies, modes and sources, ${amateurCount} amateur satellites first. Updated daily.`,
    path: SAT_LIST_PATH,
    body,
    ctx,
  });
}

export function renderNotFoundPage(ctx: PageContext): string {
  const body = `<h1>Page not found</h1>
<p class="lead">There is no page at this address. A satellite’s page goes away when it re-enters or stops appearing on the VHF/UHF list.</p>
<div class="actions"><a class="button button--primary" href="${SAT_LIST_PATH}">All satellites you can hear</a><a class="button" href="/">Open the 3D view</a></div>`;
  return layout({ title: `Page not found | ${SITE_NAME}`, description: 'This page does not exist.', path: null, body, ctx });
}

export function renderSitemap(paths: readonly string[], lastmod: string): string {
  const day = lastmod.slice(0, 10);
  const urls = paths
    .map((p) => `  <url>\n    <loc>${escapeHtml(`${SITE_ORIGIN}${p}`)}</loc>\n    <lastmod>${escapeHtml(day)}</lastmod>\n  </url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}
