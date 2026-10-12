import { afterEach, describe, expect, it, vi } from 'vitest';

const blockedStorage = {
  getItem: () => {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  },
  setItem: () => {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  },
};

describe('i18n with blocked storage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('loads and switches language when localStorage throws (sandboxed iframe, blocked site data)', async () => {
    vi.stubGlobal('localStorage', blockedStorage);
    vi.resetModules();

    const i18n = await import('./i18n');

    expect(i18n.getLang()).toBeTruthy();
    expect(() => i18n.setLang(i18n.getLang() === 'de' ? 'tr' : 'de')).not.toThrow();
  });
});
