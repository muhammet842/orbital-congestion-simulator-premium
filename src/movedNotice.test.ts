// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from './i18n/i18n';
import { MOVED_REDIRECT_MS, movedTarget, showMovedNotice } from './movedNotice';

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
