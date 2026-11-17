import type { PerspectiveCamera } from 'three';
import { Vector3 } from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { getConjunctionCameraPose, getVisualConjunctionLayout } from '../orbital/visualConjunction';
import { EARTH_RADIUS_KM } from '../types';

const FLY_DURATION_MS = 1600;
/** Step 1 of framing a selection: moving straight out from Earth. */
export const PULL_BACK_DURATION_MS = 650;
/** Step 2: the turn takes this long for a tiny angle ... */
const TURN_MIN_DURATION_MS = 550;
/** ... plus up to this much more for a half turn (180°). */
const TURN_EXTRA_DURATION_MS = 950;
/** Below this (about 1°) the view does not turn at all. */
const TURN_MIN_ANGLE_RAD = 0.017;
/** |y| of the view direction above which "north up" is undefined (≈ 2.6° from a pole). */
const POLE_LOOK_LIMIT = 0.999;
const DEFAULT_FOV = 45;
const DEFAULT_POSITION = new Vector3(0, 0, 4.5);
const DEFAULT_TARGET = new Vector3(0, 0, 0);
const TRACKING_SMOOTHING = 10;

/** Camera distance from Earth center, scaled by orbital altitude. */
function globeCameraRadiusFromAltitude(altitudeKm: number): number {
  const orbitRadiusScene = 1 + Math.max(0, altitudeKm) / EARTH_RADIUS_KM;
  return orbitRadiusScene * 1.35 + 1.55;
}

type MotionMode = 'linear' | 'globe-orbit';

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
    // below divides by ~0. Turn sideways around Earth's axis (keeps north up);
    // straight over a pole, use the x axis instead.
    // The part of Earth's axis (y) perpendicular to `from`.
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
 * Where the camera is `elapsedMs` into framing a selection: first only the
 * distance changes (pull back), then only the direction (turn). Each step
 * eases in and out on its own.
 */
export function globeFramePose(
  fromDir: Vector3,
  toDir: Vector3,
  fromRadius: number,
  holdRadius: number,
  pullMs: number,
  turnMs: number,
  elapsedMs: number,
): { direction: Vector3; radius: number } {
  const pullT = pullMs > 0 ? Math.min(1, Math.max(0, elapsedMs / pullMs)) : 1;
  const turnT = turnMs > 0 ? Math.min(1, Math.max(0, (elapsedMs - pullMs) / turnMs)) : 1;
  const radius = fromRadius + (holdRadius - fromRadius) * easeInOutCubic(pullT);
  const direction = new Vector3();
  slerpDirection(fromDir, toDir, easeInOutCubic(turnT), direction);
  return { direction: direction.normalize(), radius };
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
  private motionMode: MotionMode = 'linear';
  private startTime = 0;
  private fromPos = new Vector3();
  private toPos = new Vector3();
  private fromTarget = new Vector3();
  private toTarget = new Vector3();
  private fromDir = new Vector3();
  private toDir = new Vector3();
  private fromOrbitRadius = DEFAULT_POSITION.length();
  private toOrbitRadius = DEFAULT_POSITION.length();
  private fromFov = DEFAULT_FOV;
  private toFov = DEFAULT_FOV;
  private globalSnapshot: CameraSnapshot | null = null;
  private trackedMid = new Vector3();
  private trackingInitialized = false;
  private trackingOnComplete = false;
  private durationMs = FLY_DURATION_MS;
  private pullMs = 0;
  private turnMs = 0;

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

  /** One-time smooth zoom when a conjunction card is first selected. */
  flyToConjunctionPair(
    camera: PerspectiveCamera,
    controls: OrbitControls,
    posA: { x: number; y: number; z: number },
    posB: { x: number; y: number; z: number },
    separationKm: number,
  ): void {
    const pose = getConjunctionCameraPose(posA, posB, separationKm);
    this.beginLinearMotion(
      camera,
      controls,
      pose.cameraPos,
      pose.target,
      pose.fov,
      FLY_DURATION_MS,
      true,
    );
    this.restoringGlobal = false;
    this.conjunctionTracking = false;
    this.trackingInitialized = false;
  }

  /**
   * Bring a selected object (or launch pad) to the middle of the globe view,
   * in two steps:
   *
   *  1. **Pull back:** if the camera is closer than the distance that frames
   *     the object, it first moves straight out from Earth, without turning.
   *  2. **Turn:** at that fixed distance the view then turns the shortest way
   *     (along a great circle) until the point under the object faces the
   *     camera. The camera always looks at Earth's centre and keeps north up,
   *     so on screen it looks as if Earth turns towards you.
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
    const cameraDir = camera.position.clone().normalize();
    const currentRadius = camera.position.length();
    const frameRadius = Math.min(
      globeCameraRadiusFromAltitude(altitudeKm),
      controls.maxDistance ?? Number.POSITIVE_INFINITY,
    );
    const holdRadius = Math.max(currentRadius, frameRadius);
    const turnAngle = Math.acos(Math.min(1, Math.max(-1, nadir.dot(cameraDir))));

    controls.target.set(0, 0, 0);

    const pullNeeded = holdRadius - currentRadius > 1e-3;
    const turnNeeded = turnAngle > TURN_MIN_ANGLE_RAD;
    if (!pullNeeded && !turnNeeded) {
      controls.update();
      return;
    }

    this.motionMode = 'globe-orbit';
    this.fromDir.copy(cameraDir);
    this.toDir.copy(nadir);
    this.fromOrbitRadius = currentRadius;
    this.toOrbitRadius = holdRadius;
    this.fromTarget.set(0, 0, 0);
    this.toTarget.set(0, 0, 0);
    this.fromFov = camera.fov;
    this.toFov = camera.fov;
    this.trackingOnComplete = false;
    this.pullMs = pullNeeded ? PULL_BACK_DURATION_MS : 0;
    this.turnMs = turnNeeded ? turnDurationMs(turnAngle) : 0;
    this.durationMs = this.pullMs + this.turnMs;
    this.restoringGlobal = false;
    this.conjunctionTracking = false;
    this.trackingInitialized = false;

    this.startTime = performance.now();
    this.active = true;
    controls.enabled = false;
  }

  flyToGlobalView(camera: PerspectiveCamera, controls: OrbitControls): void {
    const snap = this.globalSnapshot ?? {
      position: DEFAULT_POSITION.clone(),
      target: DEFAULT_TARGET.clone(),
      fov: DEFAULT_FOV,
    };

    this.beginLinearMotion(
      camera,
      controls,
      snap.position,
      snap.target,
      snap.fov,
      FLY_DURATION_MS,
      false,
    );
    this.restoringGlobal = true;
    this.conjunctionTracking = false;
    this.trackingInitialized = false;
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
    if (!this.active) return false;

    const elapsed = now - this.startTime;
    const progress = Math.min(1, elapsed / this.durationMs);
    const eased = easeInOutCubic(progress);

    if (this.motionMode === 'globe-orbit') {
      const pose = globeFramePose(
        this.fromDir,
        this.toDir,
        this.fromOrbitRadius,
        this.toOrbitRadius,
        this.pullMs,
        this.turnMs,
        elapsed,
      );
      camera.position.copy(pose.direction).multiplyScalar(pose.radius);
      controls.target.set(0, 0, 0);
      // OrbitControls is paused during the flight, so aim the camera here;
      // otherwise it keeps its old heading and snaps at the end. Right above
      // a pole "north up" is undefined, so keep the last heading there.
      if (Math.abs(pose.direction.y) < POLE_LOOK_LIMIT) camera.lookAt(controls.target);
    } else {
      camera.position.lerpVectors(this.fromPos, this.toPos, eased);
      controls.target.lerpVectors(this.fromTarget, this.toTarget, eased);
    }

    camera.fov = this.fromFov + (this.toFov - this.fromFov) * eased;
    camera.updateProjectionMatrix();

    if (progress >= 1) {
      this.active = false;
      this.motionMode = 'linear';
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

  private beginLinearMotion(
    camera: PerspectiveCamera,
    controls: OrbitControls,
    toPos: Vector3,
    toTarget: Vector3,
    toFov: number,
    durationMs: number,
    enableTrackingOnComplete: boolean,
  ): void {
    this.motionMode = 'linear';
    this.fromPos.copy(camera.position);
    this.toPos.copy(toPos);
    this.fromTarget.copy(controls.target);
    this.toTarget.copy(toTarget);
    this.fromFov = camera.fov;
    this.toFov = toFov;
    this.trackingOnComplete = enableTrackingOnComplete;
    this.durationMs = durationMs;

    this.startTime = performance.now();
    this.active = true;
    controls.enabled = false;
  }
}
