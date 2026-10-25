/**
 * Phones and tablets get lighter graphics: 2048-px Earth textures (4× less
 * GPU memory and download than 4096 px) and at most 1.5× pixel density. On a
 * small screen the difference is not visible, but the GPU work and battery
 * use are.
 */
export function isLightGraphicsDevice(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(pointer: coarse)').matches || window.matchMedia('(max-width: 860px)').matches;
}

/** Device pixel ratio to render at (2× on desktops, 1.5× on light devices). */
export function renderPixelRatio(devicePixelRatio: number, light = isLightGraphicsDevice()): number {
  return Math.min(devicePixelRatio, light ? 1.5 : 2);
}

/** Day and night Earth textures for this device. */
export function earthTexturePaths(light = isLightGraphicsDevice()): { day: string; night: string } {
  return light
    ? { day: '/textures/earth-2k.jpg', night: '/textures/earth-night-2k.jpg' }
    : { day: '/textures/earth.jpg', night: '/textures/earth-night.jpg' };
}
