import { t } from './i18n/i18n';
import { escapeHtml } from './ui/escapeHtml';

/** The site's address since v1.2.0. */
export const NEW_ORIGIN = 'https://orbital-congestion.vercel.app';
/** Earlier addresses that should send visitors to the new one. */
export const OLD_HOSTS = ['orbital-congestion-simulator-premiu.vercel.app'];
/** Long enough to read the notice, short enough not to annoy. */
export const MOVED_REDIRECT_MS = 6000;

interface LocationLike {
  hostname: string;
  pathname: string;
  search: string;
  hash: string;
}

/**
 * The same page on the new address (keeping ?object=…, ?radio=… and the
 * hash so old links still open what they pointed at), or null when this
 * page is not on an old address.
 */
export function movedTarget(loc: LocationLike): string | null {
  if (!OLD_HOSTS.includes(loc.hostname.toLowerCase())) return null;
  return `${NEW_ORIGIN}${loc.pathname}${loc.search}${loc.hash}`;
}

/**
 * On an old address: show "We've moved" with the new link, then go there.
 * Returns true when the notice was shown (the app should not start).
 */
export function showMovedNotice(
  app: HTMLElement,
  loc: LocationLike = window.location,
  navigate: (url: string) => void = (url) => window.location.replace(url),
): boolean {
  const target = movedTarget(loc);
  if (!target) return false;

  const host = new URL(NEW_ORIGIN).host;
  app.innerHTML = `
    <div class="error-screen moved-screen" role="alert">
      <h1>${escapeHtml(t('moved.title'))}</h1>
      <p>${escapeHtml(t('moved.body'))}</p>
      <p><a class="moved-link" href="${escapeHtml(target)}">${escapeHtml(host)}</a></p>
      <p class="muted">${escapeHtml(t('moved.redirecting'))}</p>
    </div>
  `;
  window.setTimeout(() => navigate(target), MOVED_REDIRECT_MS);
  return true;
}
