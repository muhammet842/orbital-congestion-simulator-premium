import { afterEach, describe, expect, it, vi } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CameraFly, PULL_BACK_DURATION_MS, turnDurationMs } from './CameraFly';
import { EARTH_RADIUS_KM } from '../types';

/** The few OrbitControls members CameraFly touches. */
function fakeControls(maxDistance = 10): OrbitControls {
  return {
    target: new Vector3(),
    enabled: true,
    maxDistance,
    update: vi.fn(),
  } as unknown as OrbitControls;
}

function cameraAt(x: number, y: number, z: number): PerspectiveCamera {
  const camera = new PerspectiveCamera(45, 1, 0.01, 1000);
  camera.position.set(x, y, z);
  camera.lookAt(0, 0, 0);
  return camera;
}

/** Same formula as CameraFly: camera distance that frames an object at this altitude. */
function frameRadius(altitudeKm: number): number {
  return (1 + altitudeKm / EARTH_RADIUS_KM) * 1.35 + 1.55;
}

/** Start a framing at t = 0 (CameraFly reads performance.now() when it starts). */
function startFraming(
  fly: CameraFly,
  camera: PerspectiveCamera,
  controls: OrbitControls,
  nadir: { x: number; y: number; z: number },
  altitudeKm: number,
): void {
  vi.spyOn(performance, 'now').mockReturnValue(0);
  fly.frameSelectedOnGlobe(camera, controls, nadir, altitudeKm);
}

function viewDirection(camera: PerspectiveCamera): Vector3 {
  camera.updateMatrixWorld();
  return camera.getWorldDirection(new Vector3());
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CameraFly.frameSelectedOnGlobe', () => {
  it('first moves straight out from Earth without turning, then turns at a fixed distance', () => {
    const fly = new CameraFly();
    const controls = fakeControls();
    const camera = cameraAt(0, 0, 1.5); // zoomed in, looking at +z side
    const hold = frameRadius(500);
    startFraming(fly, camera, controls, { x: 1, y: 0, z: 0 }, 500);

    expect(fly.isActive()).toBe(true);
    expect(controls.enabled).toBe(false);

    // Halfway through the pull-back: same direction, farther out.
    fly.update(camera, controls, PULL_BACK_DURATION_MS / 2);
    const mid = camera.position.clone();
    expect(mid.clone().normalize().z).toBeCloseTo(1, 6);
    expect(mid.length()).toBeGreaterThan(1.5);
    expect(mid.length()).toBeLessThan(hold);

    // End of the pull-back: at the framing distance, still not turned.
    fly.update(camera, controls, PULL_BACK_DURATION_MS);
    expect(camera.position.length()).toBeCloseTo(hold, 6);
    expect(camera.position.clone().normalize().z).toBeCloseTo(1, 6);

    // During the turn the distance stays the same and the direction moves towards +x.
    const turnMs = turnDurationMs(Math.PI / 2);
    let lastAngle = Math.PI / 2;
    for (let i = 1; i <= 10; i += 1) {
      fly.update(camera, controls, PULL_BACK_DURATION_MS + (turnMs * i) / 10);
      expect(camera.position.length()).toBeCloseTo(hold, 6);
      const angleToTarget = camera.position.clone().normalize().angleTo(new Vector3(1, 0, 0));
      expect(angleToTarget).toBeLessThanOrEqual(lastAngle + 1e-9);
      lastAngle = angleToTarget;
    }

    expect(camera.position.x).toBeCloseTo(hold, 6);
    expect(camera.position.z).toBeCloseTo(0, 6);
    expect(fly.isActive()).toBe(false);
    expect(controls.enabled).toBe(true);
  });

  it('turns the shortest way, along the great circle between the two directions', () => {
    const fly = new CameraFly();
    const controls = fakeControls();
    const camera = cameraAt(0, 0, 4.5);
    // 120° away, in the x–z plane.
    const nadir = { x: Math.sin((2 * Math.PI) / 3), y: 0, z: Math.cos((2 * Math.PI) / 3) };
    startFraming(fly, camera, controls, nadir, 500);

    const turnMs = turnDurationMs((2 * Math.PI) / 3);
    for (let i = 1; i < 20; i += 1) {
      fly.update(camera, controls, (turnMs * i) / 20);
      const dir = camera.position.clone().normalize();
      expect(dir.y).toBeCloseTo(0, 9); // stays in the plane of the two directions
      expect(dir.x).toBeGreaterThanOrEqual(-1e-9); // never goes round the long way (through −x)
    }
  });

  it('keeps the camera looking at the centre of Earth during the whole move', () => {
    const fly = new CameraFly();
    const controls = fakeControls();
    const camera = cameraAt(0, 0, 1.6);
    startFraming(fly, camera, controls, { x: 0.6, y: 0.5, z: -0.62 }, 800);

    const total = PULL_BACK_DURATION_MS + turnDurationMs(Math.PI);
    for (let i = 1; i <= 12; i += 1) {
      fly.update(camera, controls, (total * i) / 12);
      const towardsCentre = camera.position.clone().negate().normalize();
      expect(viewDirection(camera).angleTo(towardsCentre)).toBeLessThan(1e-6);
      expect(controls.target.length()).toBe(0);
    }
  });

  it('only turns, without moving in or out, when the camera is already far enough', () => {
    const fly = new CameraFly();
    const controls = fakeControls();
    const camera = cameraAt(0, 0, 4.5); // default globe view, farther than a LEO framing (~3.0)
    startFraming(fly, camera, controls, { x: 0, y: 0, z: -1 }, 500);

    fly.update(camera, controls, 50);
    expect(camera.position.length()).toBeCloseTo(4.5, 9);
    expect(camera.position.clone().normalize().z).toBeLessThan(1); // already turning

    // Exactly opposite: it turns sideways around Earth's axis, not over a pole.
    for (let i = 1; i < 10; i += 1) {
      fly.update(camera, controls, (turnDurationMs(Math.PI) * i) / 10);
      expect(camera.position.y).toBeCloseTo(0, 9);
      expect(camera.position.length()).toBeCloseTo(4.5, 9);
    }

    fly.update(camera, controls, turnDurationMs(Math.PI));
    expect(camera.position.length()).toBeCloseTo(4.5, 9);
    expect(camera.position.z).toBeCloseTo(-4.5, 6);
    expect(fly.isActive()).toBe(false);
  });

  it('does nothing when the object already faces the camera and the camera is far enough', () => {
    const fly = new CameraFly();
    const controls = fakeControls();
    const camera = cameraAt(0, 0, 4.5);
    startFraming(fly, camera, controls, { x: 0.001, y: 0, z: 1 }, 500);

    expect(fly.isActive()).toBe(false);
    expect(controls.enabled).toBe(true);
    expect(camera.position.z).toBe(4.5);
  });

  it('never pulls back past the zoom-out limit (GEO objects)', () => {
    const fly = new CameraFly();
    const controls = fakeControls(10);
    const camera = cameraAt(0, 0, 3);
    startFraming(fly, camera, controls, { x: 0, y: 0, z: 1 }, 35_786);

    expect(frameRadius(35_786)).toBeGreaterThan(10);
    fly.update(camera, controls, PULL_BACK_DURATION_MS);
    expect(camera.position.length()).toBeCloseTo(10, 6);
  });
});

describe('turnDurationMs', () => {
  it('takes longer for a bigger turn, within fixed bounds', () => {
    expect(turnDurationMs(0)).toBe(550);
    expect(turnDurationMs(Math.PI / 2)).toBeCloseTo(1025, 6);
    expect(turnDurationMs(Math.PI)).toBe(1500);
    expect(turnDurationMs(10)).toBe(1500);
  });
});
