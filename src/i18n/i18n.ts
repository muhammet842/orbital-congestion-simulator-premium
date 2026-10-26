import { translations, type Lang } from './translations';

export type { Lang };
export { SUPPORTED_LANGS } from './translations';

const LS_KEY = 'orbital-lang';

/** Storage access throws (SecurityError) in sandboxed iframes and when site
 *  data is blocked. This runs at module load, so it must never throw. */
function readStoredLang(): Lang | null {
  try {
    return localStorage.getItem(LS_KEY) as Lang | null;
  } catch {
    return null;
  }
}

function writeStoredLang(lang: Lang): void {
  try {
    localStorage.setItem(LS_KEY, lang);
  } catch {
    // The language still applies for this session.
  }
}

function detectInitialLang(): Lang {
  const stored = readStoredLang();
  if (stored && stored in translations) return stored;
  // Try to match browser language
  const browser = navigator.language?.slice(0, 2).toLowerCase();
  if (browser && browser in translations) return browser as Lang;
  return 'en';
}

let _lang: Lang = detectInitialLang();
const _subscribers = new Set<() => void>();

/** Each language in its own words, so people can find theirs whatever the page is in. */
export const LANG_NAMES: Record<Lang, string> = {
  en: 'English',
  tr: 'Türkçe',
  de: 'Deutsch',
  ru: 'Русский',
  zh: '中文',
};

/** BCP 47 tags for <html lang>: screen readers pick their voice from it. */
const DOCUMENT_LANG: Record<Lang, string> = { en: 'en', tr: 'tr', de: 'de', ru: 'ru', zh: 'zh-Hans' };

/** Tell the browser (and screen readers, translation, hyphenation) which language the page is in. */
function applyDocumentLang(lang: Lang): void {
  if (typeof document !== 'undefined') document.documentElement.lang = DOCUMENT_LANG[lang];
}
applyDocumentLang(_lang);

export function getLang(): Lang {
  return _lang;
}

export function setLang(lang: Lang): void {
  if (lang === _lang) return;
  _lang = lang;
  writeStoredLang(lang);
  applyDocumentLang(lang);
  _subscribers.forEach((fn) => fn());
}

/** Subscribe to language changes. Returns an unsubscribe function. */
export function onLangChange(fn: () => void): () => void {
  _subscribers.add(fn);
  return () => _subscribers.delete(fn);
}

/**
 * Translate a key. Falls back to English, then to the key itself.
 * Optionally pass a `fallback` string used when the key is missing in all languages.
 */
export function t(key: string, fallback?: string): string {
  const dict = translations[_lang];
  if (dict && key in dict) return dict[key];
  const enDict = translations.en;
  if (enDict && key in enDict) return enDict[key];
  return fallback ?? key;
}

/**
 * Apply translations to all `[data-i18n]` elements inside `root`.
 * Elements with `data-i18n-ph` have their `placeholder` attribute updated.
 */
export function applyTranslations(root: Element | Document = document): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const key = el.dataset.i18n!;
    el.textContent = t(key);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-ph]').forEach((el) => {
    const key = el.dataset.i18nPh!;
    (el as HTMLInputElement).placeholder = t(key);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-aria]').forEach((el) => {
    const key = el.dataset.i18nAria!;
    el.setAttribute('aria-label', t(key));
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => {
    const key = el.dataset.i18nTitle!;
    el.setAttribute('title', t(key));
  });
}
