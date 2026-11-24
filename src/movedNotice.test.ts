// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import vercelJsonRaw from '../vercel.json?raw';
import { setLang } from './i18n/i18n';
import { MOVED_REDIRECT_MS, NEW_ORIGIN, OLD_HOSTS, movedTarget, showMovedNotice } from './movedNotice';
import { SITE_ORIGIN } from './satPages/render';

const OLD = 'orbital-congestion-simulator-premiu.vercel.app';
const at = (hostname: string, pathname = '/', search = '', hash = '') => ({ hostname, pathname, search, hash });

describe('movedTarget', () => {
  it('sends the old address to the same page on the new one, keeping links to satellites and filters', () => {
    expect(movedTarget(at(OLD))).toBe('https://orbital-congestion.vercel.app/');
    expect(movedTarget(at(OLD, '/', '?object=40931'))).toBe('https://orbital-congestion.vercel.app/?object=40931');
    expect(movedTarget(at(OLD, '/', '?radio=ham2m&mode=fm&amateur=1', '#x'))).toBe(
      'https://orbital-congestion.vercel.app/?radio=ham2m&mode=fm&amateur=1#x',
    );
  });

  it('does nothing on the new address, previews or localhost', () => {
    expect(movedTarget(at('orbital-congestion.vercel.app'))).toBeNull();
    expect(movedTarget(at('orbital-congestion-simulator-premium-git-main-x.vercel.app'))).toBeNull();
    expect(movedTarget(at('localhost'))).toBeNull();
  });

  it('is the address the satellite pages and sitemap use', () => {
    expect(SITE_ORIGIN).toBe(NEW_ORIGIN);
  });
});

describe('vercel.json redirect', () => {
  interface Redirect {
    source: string;
    has?: { type: string; value: string }[];
    destination: string;
    statusCode?: number;
  }
  const redirects = (JSON.parse(vercelJsonRaw) as { redirects?: Redirect[] }).redirects ?? [];
  const hostPattern = (r: Redirect) => r.has?.find((h) => h.type === 'host')?.value;
  const matches = (pattern: string, host: string) => new RegExp(`^${pattern}$`).test(host);

  it.each(OLD_HOSTS)('answers %s with a 301 to the same path on the new address', (host) => {
    const rules = redirects.filter((r) => {
      const pattern = hostPattern(r);
      return pattern !== undefined && matches(pattern, host);
    });
    // On Vercel `/:path*` does not match the home page itself (seen on production:
    // every other path was redirected, `/` still answered 200), so `/` has its own rule.
    expect(rules).toMatchObject([
      { source: '/', destination: `${NEW_ORIGIN}/`, statusCode: 301 },
      { source: '/:path*', destination: `${NEW_ORIGIN}/:path*`, statusCode: 301 },
    ]);
  });

  it('limits every redirect to one host, never the new address or preview deployments', () => {
    const kept = [new URL(NEW_ORIGIN).host, 'orbital-congestion-simulator-premium-git-main-x.vercel.app'];
    const patterns = redirects.map(hostPattern);
    expect(patterns.every((p) => p !== undefined)).toBe(true);
    const redirected = kept.filter((host) => patterns.some((p) => p !== undefined && matches(p, host)));
    expect(redirected).toEqual([]);
  });
});

describe('showMovedNotice', () => {
  let app: HTMLElement;
  const replace = vi.fn();

  beforeEach(() => {
    setLang('en');
    vi.useFakeTimers();
    app = document.createElement('div');
  });
  afterEach(() => {
    vi.useRealTimers();
    replace.mockReset();
  });

  it('shows the notice with the new link, then opens the same page on the new address', () => {
    expect(showMovedNotice(app, at(OLD, '/', '?object=25544'), replace)).toBe(true);
    expect(app.textContent).toContain('We have moved');
    expect(app.querySelector<HTMLAnchorElement>('.moved-link')?.href).toBe('https://orbital-congestion.vercel.app/?object=25544');
    expect(app.querySelector('.moved-link')?.textContent).toBe('orbital-congestion.vercel.app');

    vi.advanceTimersByTime(MOVED_REDIRECT_MS - 1);
    expect(replace).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(replace).toHaveBeenCalledWith('https://orbital-congestion.vercel.app/?object=25544');
  });

  it('leaves the app alone on the new address', () => {
    expect(showMovedNotice(app, at('orbital-congestion.vercel.app'), replace)).toBe(false);
    expect(app.innerHTML).toBe('');
  });
});
