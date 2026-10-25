// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { setLang } from './i18n';
import { appLocale, formatDate, formatNumber } from './format';

describe('app-language formatting', () => {
  afterEach(() => setLang('en'));

  it('formats numbers and dates in the chosen language, not the browser one', () => {
    setLang('de');
    expect(appLocale()).toBe('de-DE');
    expect(formatNumber(28306)).toBe('28.306');
    expect(formatDate(new Date('2009-02-10T00:00:00Z'), { month: 'long', year: 'numeric' })).toBe('Februar 2009');

    setLang('en');
    expect(formatNumber(28306)).toBe('28,306');
    expect(formatDate(new Date('2009-02-10T00:00:00Z'), { month: 'long', year: 'numeric' })).toBe('February 2009');
  });

  it('tells the browser and screen readers which language the page is in', () => {
    setLang('tr');
    expect(document.documentElement.lang).toBe('tr');
    setLang('zh');
    expect(document.documentElement.lang).toBe('zh-Hans');
    setLang('en');
    expect(document.documentElement.lang).toBe('en');
  });
});
