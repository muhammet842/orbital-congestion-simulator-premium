import type { PerspectiveCamera } from 'three';
import { Vector3 } from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { getConjunctionCameraPose, getVisualConjunctionLayout } from '../orbital/visualConjunction';
import { EARTH_RADIUS_KM } from '../types';

/** Step 1 of every camera move: moving straight out from Earth. */
export const PULL_BACK_DURATION_MS = 650;
/** Step 2: the turn takes this long for a tiny angle ... */
const TURN_MIN_DURATION_MS = 550;
/** ... plus up to this much more for a half turn (180°). */
const TURN_EXTRA_DURATION_MS = 950;
/** Step 3 (close-pair views only): moving in from the globe view to the pair. */
export const APPROACH_DURATION_MS = 1100;
/** Below this (about 1°) the view does not turn at all. */
const TURN_MIN_ANGLE_RAD = 0.017;
/** |y| of the view direction above which "north up" is undefined (≈ 2.6° from a pole). */
const POLE_LOOK_LIMIT = 0.999;
const DEFAULT_FOV = 45;
const DEFAULT_POSITION = new Vector3(0, 0, 4.5);
const TRACKING_SMOOTHING = 10;
const ORIGIN = new Vector3(0, 0, 0);

/** Camera distance from Earth center, scaled by orbital altitude. */
function globeCameraRadiusFromAltitude(altitudeKm: number): number {
  const orbitRadiusScene = 1 + Math.max(0, altitudeKm) / EARTH_RADIUS_KM;
  return orbitRadiusScene * 1.35 + 1.55;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function slerpDirection(from: Vector3, to: Vector3, t: number, out: Vector3): void {
  const dot = Math.min(1, Math.max(-1, from.dot(to)));
  const omega = Math.acos(dot);
  if (omega < 1e-5) {
    out.copy(from);
    return;
  }
  if (Math.PI - omega < 1e-4) {
    // Exactly opposite: every great circle is equally short, and the formula
    // below divides by ~0. Turn sideways around Earth's axis (keeps north up):
    // rotate about the part of Earth's axis (y) perpendicular to `from`.
    // Straight over a pole, use the x axis instead.
    const axis = new Vector3(0, 1, 0).addScaledVector(from, -from.y);
    if (axis.lengthSq() < 1e-8) axis.set(1, 0, 0).addScaledVector(from, -from.x);
    out.copy(from).applyAxisAngle(axis.normalize(), t * omega);
    return;
  }
  const sinOmega = Math.sin(omega);
  const a = Math.sin((1 - t) * omega) / sinOmega;
  const b = Math.sin(t * omega) / sinOmega;
  out.copy(from).multiplyScalar(a).addScaledVector(to, b);
}

/** A longer turn takes longer, so the speed stays about the same. */
export function turnDurationMs(angleRad: number): number {
  const share = Math.min(1, Math.max(0, angleRad / Math.PI));
  return TURN_MIN_DURATION_MS + TURN_EXTRA_DURATION_MS * share;
}

/**
 * One camera move, in up to three steps. Every camera move in the app uses it:
 * selecting an object or launch pad, opening a close approach or a historical
 * event, and going back to the globe view.
 *
 *  1. **Pull back:** the camera moves straight out from Earth's centre to
 *     `holdRadius`, without turning, while the point it looks at slides back
 *     to Earth's centre.
 *  2. **Turn:** looking at Earth's centre, the view turns the shortest way
 *     (along a great circle) to `turnDir`, so on screen Earth turns towards
 *     the viewer. The distance can change to `turnEndRadius` at the same time.
 *  3. **Approach** (only for close-pair views): the camera moves in to
 *     `finalPos`, looking at `finalTarget`.
 *
 * A step that has nothing to do takes no time.
 */
export interface GlobePath {
  fromDir: Vector3;
  fromRadius: number;
  fromTarget: Vector3;
  holdRadius: number;
  turnDir: Vector3;
  turnEndRadius: number;
  /** Where step 3 ends; null when there is no step 3. */
  finalPos: Vector3 | null;
  finalTarget: Vector3;
  fromFov: number;
  toFov: number;
  pullMs: number;
  turnMs: number;
  approachMs: number;
}

function phase(elapsedMs: number, startMs: number, lengthMs: number): number {
  if (lengthMs <= 0) return elapsedMs >= startMs ? 1 : 0;
  return easeInOutCubic(Math.min(1, Math.max(0, (elapsedMs - startMs) / lengthMs)));
}

/** Where the camera is, and what it looks at, `elapsedMs` into a move. */
export function globePathPose(
  path: GlobePath,
  elapsedMs: number,
): { position: Vector3; target: Vector3; fov: number } {
  const pull = phase(elapsedMs, 0, path.pullMs);
  const turn = phase(elapsedMs, path.pullMs, path.turnMs);
  const approach = phase(elapsedMs, path.pullMs + path.turnMs, path.approachMs);
  const totalMs = path.pullMs + path.turnMs + path.approachMs;

  const direction = new Vector3();
  slerpDirection(path.fromDir, path.turnDir, turn, direction);
  direction.normalize();
  const radius =
    path.fromRadius +
    (path.holdRadius - path.fromRadius) * pull +
    (path.turnEndRadius - path.holdRadius) * turn;
  const position = direction.multiplyScalar(radius);
  const target = new Vector3().lerpVectors(path.fromTarget, ORIGIN, pull);

  if (path.finalPos && approach > 0) {
    position.lerp(path.finalPos, approach);
    target.lerp(path.finalTarget, approach);
  }

  const fov = path.fromFov + (path.toFov - path.fromFov) * phase(elapsedMs, 0, totalMs);
  return { position, target, fov };
}

interface CameraSnapshot {
  position: Vector3;
  target: Vector3;
  fov: number;
}

export class CameraFly {
  private active = false;
  private restoringGlobal = false;
  private conjunctionTracking = false;
  private startTime = 0;
  private path: GlobePath | null = null;
  private durationMs = 0;
  private globalSnapshot: CameraSnapshot | null = null;
  private trackedMid = new Vector3();
  private trackingInitialized = false;
  private trackingOnComplete = false;

  captureGlobalView(camera: PerspectiveCamera, controls: OrbitControls): void {
    if (this.globalSnapshot) return;
    this.globalSnapshot = {
      position: camera.position.clone(),
      target: controls.target.clone(),
      fov: camera.fov,
    };
  }

  clearGlobalSnapshot(): void {
    this.globalSnapshot = null;
  }

  /**
   * Fly to a close pair (a close approach or a historical event): pull back,
   * turn the pair towards the viewer, then move in to the side-on view of the
   * pair. After that the camera follows the pair (`followConjunctionMidpoint`).
   */
  flyToConjunctionPair(
    camera: PerspectiveCamera,
    controls: OrbitControls,
    posA: { x: number; y: number; z: number },
    posB: { x: number; y: number; z: number },
    separationKm: number,
    options: { frameWholePair?: boolean } = {},
  ): void {
    const pose = getConjunctionCameraPose(posA, posB, separationKm, options);
    const altitudeKm = (pose.target.length() - 1) * EARTH_RADIUS_KM;
    this.begin(camera, controls, {
      turnDir: pose.target.clone().normalize(),
      frameRadius: globeCameraRadiusFromAltitude(altitudeKm),
      endRadius: null,
      finalPos: pose.cameraPos,
      finalTarget: pose.target,
      toFov: pose.fov,
    });
    this.trackingOnComplete = true;
    this.restoringGlobal = false;
  }

  /**
   * Bring a selected object (or launch pad) to the middle of the globe view:
   * pull back if the camera is closer than the distance that frames it, then
   * turn the shortest way until the point under it faces the camera.
   *
   * Earth itself is never rotated: its orientation is tied to real time
   * (positions, day/night, ground track), so the camera circles it instead,
   * which looks the same.
   */
  frameSelectedOnGlobe(
    camera: PerspectiveCamera,
    controls: OrbitControls,
    nadirWorld: { x: number; y: number; z: number },
    altitudeKm: number,
  ): void {
    const nadir = new Vector3(nadirWorld.x, nadirWorld.y, nadirWorld.z).normalize();
    this.begin(camera, controls, {
      turnDir: nadir,
      frameRadius: globeCameraRadiusFromAltitude(altitudeKm),
      endRadius: null,
      finalPos: null,
      finalTarget: ORIGIN,
      toFov: camera.fov,
    });
    this.trackingOnComplete = false;
    this.restoringGlobal = false;
  }

  /**
   * Back to the globe view saved before a close pair was opened (or the
   * default view): pull back to it, then turn to the saved direction.
   */
  flyToGlobalView(camera: PerspectiveCamera, controls: OrbitControls): void {
    const snap = this.globalSnapshot ?? {
      position: DEFAULT_POSITION.clone(),
      target: ORIGIN.clone(),
      fov: DEFAULT_FOV,
    };
    const snapRadius = snap.position.length();
    this.begin(camera, controls, {
      turnDir: snap.position.clone().normalize(),
      frameRadius: snapRadius,
      endRadius: snapRadius,
      finalPos: null,
      finalTarget: ORIGIN,
      toFov: snap.fov,
    });
    this.trackingOnComplete = false;
    this.restoringGlobal = true;
  }

  /**
   * Pan target + camera together so the pair stays centered while preserving
   * the user's zoom and orbit angle. Dolly is intentional left to the user
   * (scroll / pinch) for precise close-approach inspection.
   */
  followConjunctionMidpoint(
    camera: PerspectiveCamera,
    controls: OrbitControls,
    posA: { x: number; y: number; z: number },
    posB: { x: number; y: number; z: number },
    separationKm: number,
    deltaMs: number,
  ): void {
    if (!this.conjunctionTracking || this.active) return;

    const desiredMid = getVisualConjunctionLayout(posA, posB, separationKm).visualMid;

    if (!this.trackingInitialized) {
      this.trackedMid.copy(desiredMid);
      this.trackingInitialized = true;
      return;
    }

    const alpha = 1 - Math.exp(-(deltaMs / 1000) * TRACKING_SMOOTHING);
    const nextMid = this.trackedMid.clone().lerp(desiredMid, alpha);
    const delta = nextMid.sub(this.trackedMid);
    this.trackedMid.add(delta);

    controls.target.add(delta);
    camera.position.add(delta);
  }

  update(camera: PerspectiveCamera, controls: OrbitControls, now: number): boolean {
    if (!this.active || !this.path) return false;

    const elapsed = now - this.startTime;
    const pose = globePathPose(this.path, elapsed);
    camera.position.copy(pose.position);
    controls.target.copy(pose.target);
    // OrbitControls is paused during the flight, so aim the camera here;
    // otherwise it keeps its old heading and snaps at the end. Looking
    // straight down at a pole "north up" is undefined, so keep the last
    // heading there.
    const view = pose.target.clone().sub(pose.position);
    if (Math.abs(view.y) < POLE_LOOK_LIMIT * view.length()) camera.lookAt(pose.target);
    camera.fov = pose.fov;
    camera.updateProjectionMatrix();

    if (elapsed >= this.durationMs) {
      this.active = false;
      this.path = null;
      controls.enabled = true;
      controls.update();

      if (this.restoringGlobal) {
        this.globalSnapshot = null;
        this.restoringGlobal = false;
        this.conjunctionTracking = false;
        this.trackingInitialized = false;
      } else if (this.trackingOnComplete) {
        this.conjunctionTracking = true;
        this.trackedMid.copy(controls.target);
        this.trackingInitialized = true;
      }
    }

    return this.active;
  }

  resetFov(camera: PerspectiveCamera): void {
    const fov = this.globalSnapshot?.fov ?? DEFAULT_FOV;
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }

  isActive(): boolean {
    return this.active;
  }

  /**
   * Plan and start a move. `frameRadius` is how far out the turn happens
   * (never closer than the camera already is, never past the zoom-out limit);
   * `endRadius`, when given, is where the turn ends (the saved globe view).
   */
  private begin(
    camera: PerspectiveCamera,
    controls: OrbitControls,
    plan: {
      turnDir: Vector3;
      frameRadius: number;
      endRadius: number | null;
      finalPos: Vector3 | null;
      finalTarget: Vector3;
      toFov: number;
    },
  ): void {
    const fromRadius = camera.position.length();
    const fromDir = camera.position.clone().normalize();
    const fromTarget = controls.target.clone();
    // A move that ends on the globe must stay inside the zoom-out limit, or
    // OrbitControls clamps it with a jump when it takes over. A close-pair move
    // ends near the pair, so the limit (measured from the pair) does not apply.
    const maxDistance = plan.finalPos ? Number.POSITIVE_INFINITY : (controls.maxDistance ?? Number.POSITIVE_INFINITY);
    const holdRadius = Math.min(Math.max(fromRadius, plan.frameRadius), Math.max(fromRadius, maxDistance));
    const turnEndRadius = plan.endRadius ?? holdRadius;
    const turnAngle = Math.acos(Math.min(1, Math.max(-1, fromDir.dot(plan.turnDir))));

    const pullNeeded = holdRadius - fromRadius > 1e-3 || fromTarget.length() > 1e-3;
    const turnNeeded = turnAngle > TURN_MIN_ANGLE_RAD || Math.abs(turnEndRadius - holdRadius) > 1e-3;
    const approachNeeded = plan.finalPos != null;

    this.conjunctionTracking = false;
    this.trackingInitialized = false;

    if (!pullNeeded && !turnNeeded && !approachNeeded && Math.abs(plan.toFov - camera.fov) < 1e-6) {
      controls.target.set(0, 0, 0);
      controls.update();
      this.active = false;
      this.path = null;
      return;
    }

    this.path = {
      fromDir,
      fromRadius,
      fromTarget,
      holdRadius,
      turnDir: plan.turnDir.clone(),
      turnEndRadius,
      finalPos: plan.finalPos ? plan.finalPos.clone() : null,
      finalTarget: plan.finalTarget.clone(),
      fromFov: camera.fov,
      toFov: plan.toFov,
      pullMs: pullNeeded ? PULL_BACK_DURATION_MS : 0,
      turnMs: turnNeeded ? turnDurationMs(turnAngle) : 0,
      approachMs: approachNeeded ? APPROACH_DURATION_MS : 0,
    };
    this.durationMs = this.path.pullMs + this.path.turnMs + this.path.approachMs;
    this.startTime = performance.now();
    this.active = true;
    controls.enabled = false;
  }
}
