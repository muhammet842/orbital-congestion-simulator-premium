/**
 * Numbers and dates in the app's language, not the browser's: a Turkish page
 * shows "28.306" and "25 Eki 2026" everywhere, instead of a mix of browser
 * and English formats.
 */
import { getLang, type Lang } from './i18n';

const LOCALES: Record<Lang, string> = { en: 'en-GB', tr: 'tr-TR', de: 'de-DE', ru: 'ru-RU', zh: 'zh-CN' };

/** BCP 47 locale for the current app language. */
export function appLocale(): string {
  return LOCALES[getLang()] ?? 'en-GB';
}

/** Whole numbers with the language's thousands separator. */
export function formatNumber(n: number): string {
  return n.toLocaleString(appLocale());
}

/** A date in the app language (UTC unless the options say otherwise). */
export function formatDate(date: Date, options: Intl.DateTimeFormatOptions): string {
  return date.toLocaleDateString(appLocale(), { timeZone: 'UTC', ...options });
}
