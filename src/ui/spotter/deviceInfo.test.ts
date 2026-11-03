import { describe, expect, it } from 'vitest';
import { describeDevice } from './deviceInfo';

// Real User-Agent texts of the kinds of phones the protocol expects.
const UA = {
  pixelFull: 'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UQ1A.240205.004) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  chromeReduced: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  samsung: 'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
  windowsEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36 Edg/156.0.4314.58',
};

describe('describeDevice', () => {
  it('reads model, Android version and browser from a full Android User-Agent', () => {
    expect(describeDevice(UA.pixelFull)).toMatchObject({ platform: 'Android', os: 'Android 14', model: 'Pixel 7', browser: 'Chrome 130' });
    expect(describeDevice(UA.samsung)).toMatchObject({ platform: 'Android', os: 'Android 14', model: 'SM-S911B', browser: 'Samsung Internet 25' });
  });

  it('does not take Chrome’s hidden model "K" or its frozen "Android 10" as real', () => {
    expect(describeDevice(UA.chromeReduced)).toMatchObject({ platform: 'Android', os: 'Android 10', model: '' });
    // The browser's own hints, where offered, give the real values.
    expect(describeDevice(UA.chromeReduced, { platform: 'Android', platformVersion: '14.0.0', model: 'Pixel 7' }))
      .toMatchObject({ os: 'Android 14', model: 'Pixel 7' });
  });

  it('ignores hints that describe another system (a computer imitating a phone)', () => {
    expect(describeDevice(UA.pixelFull, { platform: 'Windows', platformVersion: '15.0.0', model: '' }))
      .toMatchObject({ os: 'Android 14', model: 'Pixel 7' });
  });

  it('reads iPhone and iPad, which never name the exact model', () => {
    expect(describeDevice(UA.iphoneSafari)).toMatchObject({ platform: 'iOS', os: 'iOS 17.5', model: 'iPhone', browser: 'Safari 17' });
    expect(describeDevice(UA.iphoneChrome)).toMatchObject({ platform: 'iOS', os: 'iOS 18.1', browser: 'Chrome 130' });
    expect(describeDevice(UA.ipad)).toMatchObject({ platform: 'iOS', os: 'iPadOS 16.6', model: 'iPad' });
  });

  it('calls anything else "diger"', () => {
    expect(describeDevice(UA.windowsEdge)).toMatchObject({ platform: 'diger', os: 'Windows', model: '', browser: 'Edge 156' });
    expect(describeDevice('')).toMatchObject({ platform: 'diger', os: '', browser: '' });
  });

  it('keeps the whole User-Agent text', () => {
    expect(describeDevice(UA.iphoneSafari).userAgent).toBe(UA.iphoneSafari);
  });
});
