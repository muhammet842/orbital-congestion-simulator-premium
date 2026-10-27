import type { PerspectiveCamera } from 'three';
import { Vector3 } from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { getConjunctionCameraPose, getVisualConjunctionLayout } from '../orbital/visualConjunction';
import { EARTH_RADIUS_KM } from '../types';

const FLY_DURATION_MS = 1600;
const GLOBE_FRAME_DURATION_MS = 900;
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
  const sinOmega = Math.sin(omega);
  const a = Math.sin((1 - t) * omega) / sinOmega;
  const b = Math.sin(t * omega) / sinOmega;
  out.copy(from).multiplyScalar(a).addScaledVector(to, b);
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
   * Rotate around Earth at global zoom so the sub-satellite ground point faces
   * the camera — Earth stays centered like the default globe view.
   */
  frameSelectedOnGlobe(
    camera: PerspectiveCamera,
    controls: OrbitControls,
    nadirWorld: { x: number; y: number; z: number },
    altitudeKm: number,
  ): void {
    const nadir = new Vector3(nadirWorld.x, nadirWorld.y, nadirWorld.z).normalize();
    const cameraDir = camera.position.clone().normalize();
    const facing = nadir.dot(cameraDir);
    const targetRadius = globeCameraRadiusFromAltitude(altitudeKm);
    const currentRadius = camera.position.length();

    controls.target.set(0, 0, 0);

    if (facing > 0.88 && Math.abs(currentRadius - targetRadius) < 0.12) {
      controls.update();
      return;
    }

    this.motionMode = 'globe-orbit';
    this.fromDir.copy(cameraDir);
    this.toDir.copy(nadir);
    this.fromOrbitRadius = currentRadius;
    this.toOrbitRadius = targetRadius;
    this.fromTarget.copy(controls.target);
    this.toTarget.set(0, 0, 0);
    this.fromPos.copy(camera.position);
    this.toPos.copy(this.toDir).multiplyScalar(targetRadius);
    this.fromFov = camera.fov;
    this.toFov = camera.fov;
    this.trackingOnComplete = false;
    this.durationMs = GLOBE_FRAME_DURATION_MS;
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
      const dir = new Vector3();
      slerpDirection(this.fromDir, this.toDir, eased, dir);
      const radius =
        this.fromOrbitRadius + (this.toOrbitRadius - this.fromOrbitRadius) * eased;
      camera.position.copy(dir.multiplyScalar(radius));
      controls.target.lerpVectors(this.fromTarget, this.toTarget, eased);
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
