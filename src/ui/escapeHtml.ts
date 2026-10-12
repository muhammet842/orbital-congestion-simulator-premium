/**
 * Shared HTML escaping for every `innerHTML` template in the app.
 *
 * Catalog fields (object names, owners, countries) come from an external feed
 * (CelesTrak/SATCAT) that is committed and deployed automatically, so they must
 * never reach the DOM unescaped. Escapes both quote styles so the result is
 * safe in text and in single- or double-quoted attributes.
 */
export function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Returns `url` only when it is an absolute http(s) URL, else '#'.
 * Escaping alone does not stop `javascript:` URLs in an href.
 */
export function safeHttpUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : '#';
  } catch {
    return '#';
  }
}
