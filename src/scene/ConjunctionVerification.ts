import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Line,
  LineDashedMaterial,
  PerspectiveCamera,
  Vector3,
  WebGLRenderer,
} from 'three';
import {
  VERIFY_TRAIL_BACK_MS,
  VERIFY_TRAIL_FORWARD_MS,
  VERIFY_TRAIL_STEP_MS,
  conjunctionSessionKey,
} from '../orbital/conjunction';
import { eciToScene } from '../orbital/coordinates';
import { propagateObject } from '../orbital/propagator';
import type { ConjunctionEvent, TrackedObject } from '../types';

export class ConjunctionVerification {
  readonly group: Group;
  private readonly trailA: Line;
  private readonly trailB: Line;
  private cachedKey: string | null = null;

  constructor() {
    this.group = new Group();
    this.group.renderOrder = 2;

    this.trailA = new Line(
      new BufferGeometry(),
      new LineDashedMaterial({
        color: 0x66ccff,
        transparent: true,
        opacity: 0.85,
        dashSize: 0.0004,
        gapSize: 0.00025,
        toneMapped: false,
        depthTest: true,
        depthWrite: false,
      }),
    );

    this.trailB = new Line(
      new BufferGeometry(),
      new LineDashedMaterial({
        color: 0xffcc44,
        transparent: true,
        opacity: 0.85,
        dashSize: 0.0004,
        gapSize: 0.00025,
        toneMapped: false,
        depthTest: true,
        depthWrite: false,
      }),
    );

    this.group.add(this.trailA, this.trailB);
    this.group.visible = false;
  }

  update(
    conjunction: ConjunctionEvent | null,
    objects: TrackedObject[],
    _simTime: Date,
  ): void {
    if (!conjunction) {
      this.disposeVisuals();
      return;
    }

    const key = conjunctionSessionKey(conjunction);
    if (key !== this.cachedKey) {
      this.disposeVisuals();
      this.rebuildGeometry(conjunction, objects);
      this.cachedKey = key;
    }

    const objA = objects[conjunction.indexA];
    const objB = objects[conjunction.indexB];
    if (!objA || !objB) {
      this.disposeVisuals();
      return;
    }

    this.group.visible = true;
  }

  disposeVisuals(): void {
    this.cachedKey = null;
    this.clearLineGeometry(this.trailA);
    this.clearLineGeometry(this.trailB);
    this.group.visible = false;
  }

  rebuildForEvent(conjunction: ConjunctionEvent, objects: TrackedObject[]): void {
    this.disposeVisuals();
    this.rebuildGeometry(conjunction, objects);
    this.cachedKey = conjunctionSessionKey(conjunction);
  }

  reset(): void {
    this.disposeVisuals();
  }

  private clearLineGeometry(line: Line): void {
    line.geometry.dispose();
    line.geometry = new BufferGeometry();
  }

  private rebuildGeometry(conjunction: ConjunctionEvent, objects: TrackedObject[]): void {
    const objA = objects[conjunction.indexA];
    const objB = objects[conjunction.indexB];
    if (!objA || !objB) return;

    const cpaTimeMs = conjunction.time.getTime();
    const startMs = cpaTimeMs - VERIFY_TRAIL_BACK_MS;
    const endMs = cpaTimeMs + VERIFY_TRAIL_FORWARD_MS;

    const pointsA: number[] = [];
    const pointsB: number[] = [];

    for (let t = startMs; t <= endMs; t += VERIFY_TRAIL_STEP_MS) {
      const date = new Date(t);
      const propA = propagateObject(objA.satrec, date);
      const propB = propagateObject(objB.satrec, date);
      if (!propA || !propB) continue;

      const sceneA = eciToScene(propA.positionEci.x, propA.positionEci.y, propA.positionEci.z);
      const sceneB = eciToScene(propB.positionEci.x, propB.positionEci.y, propB.positionEci.z);
      pointsA.push(sceneA.x, sceneA.y, sceneA.z);
      pointsB.push(sceneB.x, sceneB.y, sceneB.z);
    }

    this.setLinePoints(this.trailA, pointsA);
    this.setLinePoints(this.trailB, pointsB);
  }

  private setLinePoints(line: Line, flatPoints: number[]): void {
    this.clearLineGeometry(line);
    if (flatPoints.length < 6) return;
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(flatPoints), 3));
    line.geometry = geometry;
    line.computeLineDistances();
  }
}

export function getConjunctionLabelPositions(
  conjunction: ConjunctionEvent,
  objects: TrackedObject[],
  date: Date,
  camera: PerspectiveCamera,
  renderer: WebGLRenderer,
): {
  nameA: string;
  nameB: string;
  screenA: { x: number; y: number; visible: boolean };
  screenB: { x: number; y: number; visible: boolean };
  labelA: { x: number; y: number };
  labelB: { x: number; y: number };
  /** True 3D distance between the two objects right now, in km. */
  distanceKm: number;
} | null {
  const objA = objects[conjunction.indexA];
  const objB = objects[conjunction.indexB];
  if (!objA || !objB) return null;

  const propA = propagateObject(objA.satrec, date);
  const propB = propagateObject(objB.satrec, date);
  if (!propA || !propB) return null;

  const dx = propA.positionEci.x - propB.positionEci.x;
  const dy = propA.positionEci.y - propB.positionEci.y;
  const dz = propA.positionEci.z - propB.positionEci.z;
  const posA = eciToScene(propA.positionEci.x, propA.positionEci.y, propA.positionEci.z);
  const posB = eciToScene(propB.positionEci.x, propB.positionEci.y, propB.positionEci.z);

  camera.updateMatrixWorld();

  const canvas = renderer.domElement;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;

  const project = (v: { x: number; y: number; z: number }) => {
    const p = new Vector3(v.x, v.y, v.z).project(camera);
    return {
      x: (p.x * 0.5 + 0.5) * w,
      y: (-p.y * 0.5 + 0.5) * h,
      visible: p.z > -1 && p.z < 1 && Number.isFinite(p.x) && Number.isFinite(p.y),
    };
  };

  const screenA = project(posA);
  const screenB = project(posB);

  return {
    nameA: objA.name,
    nameB: objB.name,
    screenA,
    screenB,
    labelA: { x: screenA.x - 90, y: screenA.y - 52 },
    labelB: { x: screenB.x + 24, y: screenB.y - 52 },
    distanceKm: Math.sqrt(dx * dx + dy * dy + dz * dz),
  };
}
