import { inject } from '@vercel/analytics';

/**
 * Anonymous, cookieless visit counts (Vercel Web Analytics). The script and its
 * beacon are served from the site's own origin (/_vercel/insights/…), so the
 * CSP stays 'self'. Only production builds on a real host report: local dev,
 * `vite preview` and the e2e tests never load it.
 */
export function shouldEnableAnalytics(isProd: boolean, hostname: string): boolean {
  if (!isProd) return false;
  return !['localhost', '127.0.0.1', '[::1]', ''].includes(hostname);
}

export function initAnalytics(): void {
  if (!shouldEnableAnalytics(import.meta.env.PROD, window.location.hostname)) return;
  try {
    inject({ mode: 'production' });
  } catch {
    // Counting visits must never break the app.
  }
}
