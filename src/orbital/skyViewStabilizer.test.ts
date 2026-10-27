import { describe, expect, it } from 'vitest';
import {
  createSkyViewStabilizer,
  pitchDeltaToPixels,
} from './skyViewStabilizer';

describe('createSkyViewStabilizer', () => {
  it('keeps display pitch fixed under ±2° oscillation (still phone noise)', () => {
    const stab = createSkyViewStabilizer();
    let t = 0;
    const first = stab.update(90, 30, t);
    expect(first.pitchDeg).toBe(30);
    expect(stab.isFrozen()).toBe(true);

    // 60 samples over 3s: oscillatory noise around 30°
    for (let i = 0; i < 60; i++) {
      t += 50;
      const noise = Math.sin(i * 0.9) * 2.0;
      const out = stab.update(90 + Math.sin(i * 0.4) * 1.5, 30 + noise, t);
      expect(out.pitchDeg).toBe(30);
      expect(stab.isFrozen()).toBe(true);
    }
  });

  it('does not ratchet when sensor slowly drifts while phone is still', () => {
    const stab = createSkyViewStabilizer();
    let t = 0;
    stab.update(100, 20, t);
    // Drift +6° over 12 seconds (~0.5°/s) — classic fusion drift, not a tip.
    for (let i = 1; i <= 120; i++) {
      t += 100;
      const drifted = 20 + (6 * i) / 120;
      const out = stab.update(100, drifted, t);
      expect(out.pitchDeg).toBe(20);
      expect(stab.isFrozen()).toBe(true);
    }
  });

  it('unlocks on a real tip (~40°/s) within ~0.5s', () => {
    const stab = createSkyViewStabilizer();
    let t = 0;
    stab.update(0, 10, t);
    // Tip from 10° → 30° over 500ms
    let unlockedPitch: number | null = null;
    for (let i = 1; i <= 10; i++) {
      t += 50;
      const pitch = 10 + 2 * i; // +20° in 0.5s
      const out = stab.update(0, pitch, t);
      if (!stab.isFrozen()) {
        unlockedPitch = out.pitchDeg;
        break;
      }
    }
    expect(unlockedPitch).not.toBeNull();
    expect(unlockedPitch).toBeGreaterThan(10);
  });

  it('re-freezes after motion stops and then ignores new drift', () => {
    const stab = createSkyViewStabilizer();
    let t = 0;
    stab.update(0, 15, t);

    // Unlock with a fast tip
    for (let i = 1; i <= 12; i++) {
      t += 50;
      stab.update(0, 15 + i * 2.5, t);
    }
    expect(stab.isFrozen()).toBe(false);
    const afterTip = stab.getCenter()!.pitchDeg;

    // Hold nearly still at the new angle
    for (let i = 0; i < 20; i++) {
      t += 50;
      stab.update(0, afterTip + Math.sin(i) * 0.3, t);
    }
    expect(stab.isFrozen()).toBe(true);
    const frozenAt = stab.getCenter()!.pitchDeg;

    // Drift again — must not move display
    for (let i = 1; i <= 40; i++) {
      t += 100;
      const out = stab.update(0, frozenAt + i * 0.15, t);
      expect(out.pitchDeg).toBeCloseTo(frozenAt, 5);
      expect(stab.isFrozen()).toBe(true);
    }
  });

  it('hold-freeze after snap ignores sensor motion (aim lock)', () => {
    const stab = createSkyViewStabilizer();
    let t = 0;
    stab.update(10, 20, t);
    stab.snapTo(100, 45, true);
    expect(stab.isFrozen()).toBe(true);
    expect(stab.getCenter()).toEqual({ headingDeg: 100, pitchDeg: 45 });

    // Violent sensor motion must not move the display while hold is on.
    for (let i = 1; i <= 20; i++) {
      t += 50;
      const out = stab.update(100 + i * 5, 45 + i * 3, t);
      expect(out.headingDeg).toBe(100);
      expect(out.pitchDeg).toBe(45);
    }

    stab.setHoldFrozen(false);
    // After release, a real tip can unlock again.
    for (let i = 1; i <= 12; i++) {
      t += 50;
      stab.update(100, 45 + i * 3, t);
    }
    expect(stab.isFrozen()).toBe(false);
  });

  it('with autoFreeze off, never sticky-locks while the phone pauses', () => {
    const stab = createSkyViewStabilizer({ autoFreeze: false, followAlpha: 0.5 });
    let t = 0;
    stab.update(0, 20, t);
    expect(stab.isFrozen()).toBe(false);

    // Hold still (as when aiming at a satellite) — must stay unlocked.
    for (let i = 0; i < 30; i++) {
      t += 50;
      stab.update(0, 20 + Math.sin(i) * 0.4, t);
      expect(stab.isFrozen()).toBe(false);
    }

    // Then tip — display should follow without an unlock delay.
    for (let i = 1; i <= 8; i++) {
      t += 50;
      const out = stab.update(0, 20 + i * 3, t);
      expect(stab.isFrozen()).toBe(false);
      expect(out.pitchDeg).toBeGreaterThan(20);
    }
  });

  it('pitchDeltaToPixels matches sky projection scale', () => {
    expect(pitchDeltaToPixels(1, 280, 60)).toBeCloseTo(280 / 60, 5);
    expect(Math.abs(pitchDeltaToPixels(2, 280, 60))).toBeGreaterThan(8);
  });
});
