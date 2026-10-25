import { describe, expect, it } from 'vitest';
import { earthTexturePaths, renderPixelRatio } from './deviceProfile';

describe('deviceProfile', () => {
  it('caps the pixel density lower on light (touch / small-screen) devices', () => {
    expect(renderPixelRatio(3, true)).toBe(1.5);
    expect(renderPixelRatio(3, false)).toBe(2);
    expect(renderPixelRatio(1, true)).toBe(1);
  });

  it('serves the 2048-px Earth textures to light devices only', () => {
    expect(earthTexturePaths(true)).toEqual({ day: '/textures/earth-2k.jpg', night: '/textures/earth-night-2k.jpg' });
    expect(earthTexturePaths(false)).toEqual({ day: '/textures/earth.jpg', night: '/textures/earth-night.jpg' });
  });
});
