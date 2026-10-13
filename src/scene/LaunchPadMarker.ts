import {
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  SphereGeometry,
  Vector3,
} from 'three';
import { degreesToRadians, ecfToEci, geodeticToEcf, gstime } from 'satellite.js';
import { SURFACE_LIFT, eciToScene } from '../orbital/coordinates';
import type { SelectedLaunch } from '../state/appState';

const DOT_RADIUS = 0.011;
const RING_INNER = 0.02;
const RING_OUTER = 0.026;
const PULSE_PERIOD_MS = 1600;
const COLOR = 0xff6b4a;

/**
 * Scene position (Earth radius = 1, lifted just off the surface) of a point on
 * the ground at `date`. Uses the same inertial frame as the satellites, so the
 * marker rides the rotating Earth exactly like the textures do.
 */
export function padScenePosition(
  latitudeDeg: number,
  longitudeDeg: number,
  date: Date,
): { x: number; y: number; z: number } {
  const ecf = geodeticToEcf({
    latitude: degreesToRadians(latitudeDeg),
    longitude: degreesToRadians(longitudeDeg),
    height: 0,
  });
  const eci = ecfToEci(ecf, gstime(date));
  const scene = eciToScene(eci.x, eci.y, eci.z);
  const length = Math.hypot(scene.x, scene.y, scene.z) || 1;
  const scale = SURFACE_LIFT / length;
  return { x: scene.x * scale, y: scene.y * scale, z: scene.z * scale };
}

/** Pulsing marker on the selected launch pad. */
export class LaunchPadMarker {
  readonly group: Group;
  private readonly dot: Mesh;
  private readonly staticRing: Mesh;
  private readonly pulseRing: Mesh;
  private readonly position = new Vector3();
  private readonly outward = new Vector3();

  constructor() {
    this.group = new Group();
    this.group.renderOrder = 3;
    this.group.visible = false;

    const material = (opacity: number): MeshBasicMaterial =>
      new MeshBasicMaterial({
        color: COLOR,
        transparent: true,
        opacity,
        side: DoubleSide,
        toneMapped: false,
        depthTest: true,
      });

    this.dot = new Mesh(new SphereGeometry(DOT_RADIUS, 16, 16), material(1));
    this.staticRing = new Mesh(new RingGeometry(RING_INNER, RING_OUTER, 48), material(0.9));
    this.pulseRing = new Mesh(new RingGeometry(RING_INNER, RING_OUTER, 48), material(0.6));
    this.group.add(this.dot, this.staticRing, this.pulseRing);
  }

  /** Call every frame. `launch` null (or no coordinates) hides the marker. */
  update(launch: SelectedLaunch | null, date: Date, nowMs: number): void {
    if (!launch) {
      this.group.visible = false;
      return;
    }
    const p = padScenePosition(launch.latitudeDeg, launch.longitudeDeg, date);
    this.position.set(p.x, p.y, p.z);
    this.group.visible = true;
    this.group.position.copy(this.position);

    // Rings lie flat on the surface: face them straight away from Earth's centre.
    this.outward.copy(this.position).multiplyScalar(2);
    this.staticRing.lookAt(this.outward);
    this.pulseRing.lookAt(this.outward);

    const phase = (nowMs % PULSE_PERIOD_MS) / PULSE_PERIOD_MS;
    this.pulseRing.scale.setScalar(1 + phase * 2.2);
    (this.pulseRing.material as MeshBasicMaterial).opacity = 0.6 * (1 - phase);
  }
}
