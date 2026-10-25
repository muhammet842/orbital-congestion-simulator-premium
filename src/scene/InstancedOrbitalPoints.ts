import {
  Color,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  SphereGeometry,
} from 'three';
import { eciToScene } from '../orbital/coordinates';
import {
  getCategoryColor,
  getCategoryPulse,
  getCategoryScale,
  AMATEUR_POINT_SCALE,
  getFunctionGroupColor,
  getFunctionGroupPulse,
} from '../orbital/classify';
import type { PropagationResult } from '../orbital/propagator';
import type { ObjectCategory, TrackedObject, OrbitLayer } from '../types';
import { matchesSearchQuery } from '../state/appState';
import { isRecentlyLaunched } from '../data/newLaunches';
import { conjunctionModelScale } from './conjunctionScale';
import { isVisibleFromCamera } from './earthOcclusion';

const scaleMatrix = new Matrix4();

export type OrbitalPointKind = 'spacecraft' | 'debris';

const SPHERE_RADIUS: Record<OrbitalPointKind, number> = {
  spacecraft: 0.002,
  debris: 0.0022,
};

function matchesSearch(obj: TrackedObject, searchQuery: string): boolean {
  return matchesSearchQuery(obj, searchQuery);
}

function includesKind(category: ObjectCategory, kind: OrbitalPointKind): boolean {
  if (kind === 'debris') return category === 'debris';
  return category === 'active' || category === 'stations';
}

/** Instanced spheres for spacecraft or debris — one draw call per kind. */
export class InstancedOrbitalPoints {
  readonly mesh: InstancedMesh;
  readonly kind: OrbitalPointKind;
  private readonly count: number;
  private readonly matrix = new Matrix4();
  private readonly instanceColor = new Color();
  private matrixDirty = false;
  /** Catalogue indices of this layer's kind; the other kind stays hidden. */
  private ownIndices: number[] = [];
  private indexedFor: TrackedObject[] | null = null;

  constructor(objectCount: number, kind: OrbitalPointKind) {
    this.count = objectCount;
    this.kind = kind;

    const geometry = new SphereGeometry(SPHERE_RADIUS[kind], 6, 6);
    const material = new MeshBasicMaterial({ toneMapped: false });

    this.mesh = new InstancedMesh(geometry, material, this.count);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = kind === 'debris' ? 1 : 2;
    this.mesh.name = `${kind}-points`;
  }

  /**
   * Once per catalogue: remember which instances belong to this layer and hide
   * the rest for good (an object's category never changes), so every later
   * update only walks this layer's objects instead of the whole catalogue.
   */
  private indexKinds(objects: TrackedObject[]): void {
    if (this.indexedFor === objects) return;
    this.indexedFor = objects;
    this.ownIndices = [];
    this.matrix.makeScale(0, 0, 0);
    for (let i = 0; i < this.count; i++) {
      if (objects[i] && includesKind(objects[i].category, this.kind)) this.ownIndices.push(i);
      else this.mesh.setMatrixAt(i, this.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  updatePositions(
    objects: TrackedObject[],
    propagations: (PropagationResult | null)[],
    selectedIndex: number | null,
    conjunctionHighlight: number[] | null,
    layerFilters: Record<OrbitLayer, boolean>,
    searchQuery: string,
    cameraPosition: { x: number; y: number; z: number },
    pulseTimeMs: number,
    gltfDetailIndices: ReadonlySet<number>,
    colorByFunction: boolean,
    altitudeFilter: { minKm: number; maxKm: number } | null = null,
    inclinationFilter: { minDeg: number; maxDeg: number } | null = null,
    showOnlyRecentLaunches = false,
    categoryFilter: ObjectCategory | 'all' = 'all',
    conjunctionLiveDistanceKm: number | null = null,
  ): void {
    const highlightSet = new Set(conjunctionHighlight ?? []);
    const conjunctionFocus = highlightSet.size === 2;
    this.matrixDirty = false;
    const nowMs = Date.now();

    this.indexKinds(objects);
    for (const i of this.ownIndices) {
      const obj = objects[i];
      const isSelected = i === selectedIndex;
      const isConjunction = highlightSet.has(i);

      if (gltfDetailIndices.has(i)) {
        this.matrix.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, this.matrix);
        this.matrixDirty = true;
        continue;
      }

      if (conjunctionFocus && !isConjunction) {
        this.matrix.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, this.matrix);
        this.matrixDirty = true;
        continue;
      }

      // Debris has no GLTF stand-in — keep the instanced sphere so sat-vs-debris
      // close approaches show both objects, not only the satellite model.

      if (
        !isSelected &&
        !isConjunction &&
        (
          !layerFilters[obj.layer] ||
          (categoryFilter !== 'all' && obj.category !== categoryFilter) ||
          !matchesSearch(obj, searchQuery) ||
          (altitudeFilter && (obj.meanAltitudeKm < altitudeFilter.minKm || obj.meanAltitudeKm > altitudeFilter.maxKm)) ||
          (inclinationFilter && (obj.inclinationDeg < inclinationFilter.minDeg || obj.inclinationDeg > inclinationFilter.maxDeg)) ||
          (showOnlyRecentLaunches && !isRecentlyLaunched(obj, nowMs))
        )
      ) {
        this.matrix.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, this.matrix);
        this.matrixDirty = true;
        continue;
      }

      const result = propagations[i];
      if (!result) {
        this.matrix.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, this.matrix);
        this.matrixDirty = true;
        continue;
      }

      if (
        !isSelected &&
        !isConjunction &&
        !isVisibleFromCamera(result, cameraPosition)
      ) {
        this.matrix.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, this.matrix);
        this.matrixDirty = true;
        continue;
      }

      const scenePos = eciToScene(
        result.positionEci.x,
        result.positionEci.y,
        result.positionEci.z,
      );

      let scale = isSelected ? 3 : getCategoryScale(obj.category, obj.country);
      if (!isSelected && colorByFunction && obj.functionGroup === 'amateur') scale = AMATEUR_POINT_SCALE;
      if (isConjunction) scale = conjunctionModelScale(conjunctionLiveDistanceKm);
      scale *= isConjunction ? 1 : getCategoryPulse(obj.category, pulseTimeMs, obj.country);

      this.matrix.makeTranslation(scenePos.x, scenePos.y, scenePos.z);
      if (scale !== 1) {
        scaleMatrix.makeScale(scale, scale, scale);
        this.matrix.multiply(scaleMatrix);
      }
      this.mesh.setMatrixAt(i, this.matrix);
      this.matrixDirty = true;

      if (isSelected) {
        this.mesh.setColorAt(i, this.instanceColor.setRGB(1, 1, 1));
      } else if (isConjunction) {
        const pulse = 0.88 + 0.12 * Math.sin(pulseTimeMs * 0.005);
        this.mesh.setColorAt(i, this.instanceColor.setRGB(1 * pulse, 0.9 * pulse, 0.2 * pulse));
      } else if (colorByFunction) {
        const [r, g, b] = getFunctionGroupColor(obj.functionGroup);
        const pulse = getFunctionGroupPulse(obj.functionGroup, pulseTimeMs);
        this.mesh.setColorAt(
          i,
          this.instanceColor.setRGB(r * pulse, g * pulse, b * pulse),
        );
      } else {
        const [r, g, b] = getCategoryColor(obj.category, result.layer, obj.country);
        const pulse = getCategoryPulse(obj.category, pulseTimeMs, obj.country);
        this.mesh.setColorAt(
          i,
          this.instanceColor.setRGB(r * pulse, g * pulse, b * pulse),
        );
      }
    }

    if (this.matrixDirty) {
      this.mesh.instanceMatrix.needsUpdate = true;
    }
    if (this.mesh.instanceColor) {
      this.mesh.instanceColor.needsUpdate = true;
    }
  }
}

