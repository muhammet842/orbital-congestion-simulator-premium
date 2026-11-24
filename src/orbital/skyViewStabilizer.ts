/**
 * Stabilize Spotter sky-map look direction against DeviceOrientation noise/drift.
 *
 * The crosshair is fixed at canvas center; any “up/down bounce” the user sees is
 * the horizon and satellite dots moving because view pitch changed.
 *
 * Absolute |sensor − latch| unlock is wrong: a still phone’s fused orientation
 * often drifts several degrees over seconds, which falsely unlocks and ratchets
 * the sky. Unlock only on short-window *net* motion (intentional tip/turn).
 */

export interface SkyViewCenter {
  headingDeg: number;
  pitchDeg: number;
}

export interface SkyViewStabilizerOptions {
  /** Net pitch change over the motion window required to unlock (degrees). */
  unlockNetPitchDeg?: number;
  /** Net heading change over the motion window required to unlock (degrees). */
  unlockNetHeadingDeg?: number;
  /** Look-back window for net motion (ms). */
  motionWindowMs?: number;
  /** Consecutive qualifying samples before unlock. */
  unlockStreak?: number;
  /** Max |Δ| in the window to count as still (for re-freeze). */
  freezeNetDeg?: number;
  /** Consecutive still samples before re-freeze. */
  freezeStreak?: number;
  /** EMA toward sensor while unlocked (0..1). */
  followAlpha?: number;
  /**
   * When false, never hard-freeze the sky after the first sample — only EMA
   * follow. Aiming at a satellite often means holding still; auto-freeze then
   * feels like a sticky lock / stutter when the phone moves again.
   */
  autoFreeze?: boolean;
}

interface TimedSample {
  headingDeg: number;
  pitchDeg: number;
  timeMs: number;
}

export interface SkyViewStabilizer {
  /** Current display center (what the canvas should use). */
  getCenter(): SkyViewCenter | null;
  /** True when display is ignoring sensor chatter. */
  isFrozen(): boolean;
  /**
   * Ingest a sensor sample. Returns the display center to draw.
   * Pass null heading when compass is unreliable — pitch-only still stabilizes.
   */
  update(headingDeg: number | null, pitchDeg: number | null, timeMs: number): {
    headingDeg: number | null;
    pitchDeg: number;
  };
  /** Snap display to a sky direction (tests / diagnostics). */
  snapTo(headingDeg: number, pitchDeg: number, hold?: boolean): void;
  /** While true, ignore unlock motion (tests / diagnostics). */
  setHoldFrozen(hold: boolean): void;
  reset(): void;
}

function wrap360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

function signedDeltaDeg(from: number, to: number): number {
  let d = wrap360(to) - wrap360(from);
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/**
 * Create a sky-view stabilizer. Pure enough to unit-test with synthetic streams.
 */
export function createSkyViewStabilizer(
  opts: SkyViewStabilizerOptions = {},
): SkyViewStabilizer {
  const unlockNetPitchDeg = opts.unlockNetPitchDeg ?? 3.5;
  const unlockNetHeadingDeg = opts.unlockNetHeadingDeg ?? 3.5;
  const motionWindowMs = opts.motionWindowMs ?? 400;
  const unlockStreakNeeded = opts.unlockStreak ?? 3;
  const freezeNetDeg = opts.freezeNetDeg ?? 1.2;
  const freezeStreakNeeded = opts.freezeStreak ?? 5;
  const followAlpha = clamp01(opts.followAlpha ?? 0.3);
  const autoFreeze = opts.autoFreeze !== false;

  let displayHeading: number | null = null;
  let displayPitch: number | null = null;
  let frozen = autoFreeze;
  let holdFrozen = false;
  let unlockStreak = 0;
  let freezeStreak = 0;
  /** Recent sensor samples (not display) for net-motion detection. */
  const history: TimedSample[] = [];

  function reset(): void {
    displayHeading = null;
    displayPitch = null;
    frozen = autoFreeze;
    holdFrozen = false;
    unlockStreak = 0;
    freezeStreak = 0;
    history.length = 0;
  }

  function snapTo(headingDeg: number, pitchDeg: number, hold = true): void {
    displayHeading = wrap360(headingDeg);
    displayPitch = pitchDeg;
    frozen = true;
    holdFrozen = hold;
    unlockStreak = 0;
    freezeStreak = 0;
  }

  function setHoldFrozen(hold: boolean): void {
    holdFrozen = hold;
    if (hold) {
      frozen = true;
      unlockStreak = 0;
    }
  }

  function pushHistory(headingDeg: number, pitchDeg: number, timeMs: number): void {
    history.push({ headingDeg, pitchDeg, timeMs });
    const cutoff = timeMs - motionWindowMs * 2;
    while (history.length > 1 && history[0].timeMs < cutoff) {
      history.shift();
    }
  }

  function sampleAtOrBefore(timeMs: number): TimedSample | null {
    let best: TimedSample | null = null;
    for (const s of history) {
      if (s.timeMs <= timeMs) best = s;
      else break;
    }
    return best;
  }

  /** Net sensor motion over the look-back window (oscillation cancels; drift is slow). */
  function netMotion(timeMs: number): { dPitch: number; dHeading: number } {
    const older = sampleAtOrBefore(timeMs - motionWindowMs);
    const newest = history[history.length - 1];
    if (!older || !newest || newest.timeMs - older.timeMs < motionWindowMs * 0.6) {
      return { dPitch: 0, dHeading: 0 };
    }
    return {
      dPitch: Math.abs(newest.pitchDeg - older.pitchDeg),
      dHeading: Math.abs(signedDeltaDeg(older.headingDeg, newest.headingDeg)),
    };
  }

  function getCenter(): SkyViewCenter | null {
    if (displayHeading == null || displayPitch == null) return null;
    return { headingDeg: displayHeading, pitchDeg: displayPitch };
  }

  function isFrozen(): boolean {
    return frozen;
  }

  function followSensors(headingDeg: number | null, pitch: number): void {
    displayPitch = displayPitch! + (pitch - displayPitch!) * followAlpha;
    if (headingDeg != null) {
      if (displayHeading == null) {
        displayHeading = headingDeg;
      } else {
        displayHeading = wrap360(
          displayHeading + signedDeltaDeg(displayHeading, headingDeg) * followAlpha,
        );
      }
    }
  }

  function update(
    headingDeg: number | null,
    pitchDeg: number | null,
    timeMs: number,
  ): { headingDeg: number | null; pitchDeg: number } {
    const pitch = pitchDeg ?? displayPitch ?? 45;

    // No compass: keep last display heading (if any) and still stabilize pitch.
    const headingForHistory = headingDeg ?? displayHeading ?? 0;
    pushHistory(headingForHistory, pitch, timeMs);

    if (displayPitch == null) {
      displayPitch = pitch;
      displayHeading = headingDeg;
      frozen = autoFreeze;
      unlockStreak = 0;
      freezeStreak = 0;
      return { headingDeg: displayHeading, pitchDeg: displayPitch };
    }

    if (displayHeading == null && headingDeg != null) {
      displayHeading = headingDeg;
    }

    // Hard hold: never follow sensors (tests / diagnostics).
    if (holdFrozen) {
      frozen = true;
      unlockStreak = 0;
      return { headingDeg: displayHeading, pitchDeg: displayPitch };
    }

    // Continuous follow — no sticky freeze when the phone pauses on a target.
    if (!autoFreeze) {
      frozen = false;
      followSensors(headingDeg, pitch);
      return { headingDeg: displayHeading, pitchDeg: displayPitch };
    }

    const { dPitch, dHeading } = netMotion(timeMs);
    const unlockSignal =
      dPitch >= unlockNetPitchDeg || (headingDeg != null && dHeading >= unlockNetHeadingDeg);
    const stillSignal = dPitch < freezeNetDeg && dHeading < freezeNetDeg;

    if (frozen) {
      if (unlockSignal) {
        unlockStreak += 1;
        if (unlockStreak >= unlockStreakNeeded) {
          frozen = false;
          unlockStreak = 0;
          freezeStreak = 0;
          // Snap once so aiming catches up after a long freeze + sensor drift.
          displayPitch = pitch;
          if (headingDeg != null) displayHeading = headingDeg;
        }
      } else {
        unlockStreak = 0;
      }
      return { headingDeg: displayHeading, pitchDeg: displayPitch };
    }

    // Unlocked: follow sensors.
    followSensors(headingDeg, pitch);

    if (stillSignal) {
      freezeStreak += 1;
      if (freezeStreak >= freezeStreakNeeded) {
        frozen = true;
        unlockStreak = 0;
        freezeStreak = 0;
      }
    } else {
      freezeStreak = 0;
    }

    return { headingDeg: displayHeading, pitchDeg: displayPitch };
  }

  return { getCenter, isFrozen, update, snapTo, setHoldFrozen, reset };
}
