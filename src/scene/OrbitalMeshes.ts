import {
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  Object3D,
  PerspectiveCamera,
  Raycaster,
  Vector2,
  Vector3,
} from 'three';
import { eciToScene, eciVectorToScene } from '../orbital/coordinates';
import {
  getCategoryColor,
  getCategoryPulse,
  getCategoryScale,
  getFunctionGroupColor,
  getFunctionGroupPulse,
} from '../orbital/classify';
import { propagateObject, type PropagationResult } from '../orbital/propagator';
import type { TrackedObject, OrbitLayer, ObjectCategory } from '../types';
import { matchesSearchQuery } from '../state/appState';
import { InstancedOrbitalPoints } from './InstancedOrbitalPoints';
import { resolveModelKey } from './modelResolver';
import { satelliteModelLoader } from './SatelliteModelLoader';
import { conjunctionModelScale } from './conjunctionScale';
import { pickClosestScreenIndex, type ScreenPickCandidate } from './screenPick';
import { isVisibleFromCamera } from './earthOcclusion';

export { conjunctionModelScale };

const SELECTED_SCALE = 3;
const scratchVel = new Vector3();
const scratchDir = new Vector3();
const scratchUp = new Vector3();
const scratchMatrix = new Matrix4();
const scratchPick = new Vector3();
const tintColor = new Color();

function matchesSearch(obj: TrackedObject, searchQuery: string): boolean {
  return matchesSearchQuery(obj, searchQuery);
}

function usesGltfDetail(obj: TrackedObject, conjunctionFocus = false): boolean {
  if (conjunctionFocus) return true;
  return obj.category === 'active' || obj.category === 'stations';
}

export class OrbitalMeshes {
  readonly group: Group;
  private readonly count: number;
  private readonly spacecraftPoints: InstancedOrbitalPoints;
  private readonly debrisPoints: InstancedOrbitalPoints;
  private readonly detailWrappers = new Map<number, Group>();
  private visiblePickRoots: Object3D[] = [];

  private constructor(objects: TrackedObject[]) {
    this.group = new Group();
    this.group.name = 'orbital-objects';
    this.count = objects.length;
    this.debrisPoints = new InstancedOrbitalPoints(this.count, 'debris');
    this.spacecraftPoints = new InstancedOrbitalPoints(this.count, 'spacecraft');
    this.group.add(this.debrisPoints.mesh);
    this.group.add(this.spacecraftPoints.mesh);
  }

  static async create(objects: TrackedObject[]): Promise<OrbitalMeshes> {
    const meshes = new OrbitalMeshes(objects);
    meshes.updatePositions(objects, objects.map((obj) => propagateObject(obj.satrec, new Date())), null, null, {
      LEO: true,
      MEO: true,
      GEO: true,
      HEO: true,
    }, '', { x: 0, y: 0, z: 4.5 }, Date.now());

    // Instanced points (built above) are all the first frame needs — the
    // globe should render immediately instead of blocking on GLTF network
    // round-trips for detail models that only matter once something is
    // actually selected. Warm the most common ones in the background so
    // that first selection doesn't show a bare point while it loads.
    satelliteModelLoader.warmCache(['iss', 'sat_leo', 'cargo_capsule']);

    return meshes;
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
    options?: {
      skipPointsUpdate?: boolean;
      colorByFunction?: boolean;
      altitudeFilter?: { minKm: number; maxKm: number } | null;
      inclinationFilter?: { minDeg: number; maxDeg: number } | null;
      showOnlyRecentLaunches?: boolean;
      categoryFilter?: ObjectCategory | 'all';
      /** Real-world km between the two conjunction-highlighted objects right
       *  now — caps their model scale so it never visually dwarfs a genuine
       *  multi-km near-miss (see CONJUNCTION_SIZE_FRACTION_OF_SEPARATION). */
      conjunctionLiveDistanceKm?: number | null;
    },
  ): void {
    const colorByFunction = options?.colorByFunction ?? false;
    const altitudeFilter = options?.altitudeFilter ?? null;
    const inclinationFilter = options?.inclinationFilter ?? null;
    const showOnlyRecentLaunches = options?.showOnlyRecentLaunches ?? false;
    const categoryFilter = options?.categoryFilter ?? 'all';
    const conjunctionLiveDistanceKm = options?.conjunctionLiveDistanceKm ?? null;
    const highlightSet = new Set(conjunctionHighlight ?? []);
    const conjunctionFocus = highlightSet.size === 2;
    const gltfDetailIndices = this.resolveGltfDetailIndices(
      objects,
      selectedIndex,
      conjunctionFocus,
      highlightSet,
    );

    if (!options?.skipPointsUpdate || conjunctionFocus) {
      this.spacecraftPoints.updatePositions(
        objects, propagations, selectedIndex, conjunctionHighlight,
        layerFilters, searchQuery, cameraPosition, pulseTimeMs,
        gltfDetailIndices, colorByFunction, altitudeFilter, inclinationFilter,
        showOnlyRecentLaunches, categoryFilter, conjunctionLiveDistanceKm,
      );
      this.debrisPoints.updatePositions(
        objects, propagations, selectedIndex, conjunctionHighlight,
        layerFilters, searchQuery, cameraPosition, pulseTimeMs,
        gltfDetailIndices, colorByFunction, altitudeFilter, inclinationFilter,
        showOnlyRecentLaunches, categoryFilter, conjunctionLiveDistanceKm,
      );
    }

    this.syncDetailWrappers(
      objects, propagations, gltfDetailIndices, layerFilters, searchQuery,
      conjunctionFocus, highlightSet, selectedIndex, cameraPosition, pulseTimeMs,
      colorByFunction, conjunctionLiveDistanceKm, categoryFilter,
    );

    const nextVisible: Object3D[] = [];
    for (const wrapper of this.detailWrappers.values()) {
      if (wrapper.visible) nextVisible.push(wrapper);
    }
    this.visiblePickRoots = nextVisible;
  }

  pickObjectIndex(
    raycaster: Raycaster,
    camera: PerspectiveCamera,
    pointerNdc: Vector2,
    canvasWidth: number,
    canvasHeight: number,
  ): number | null {
    if (!this.group.visible) return null;

    if (this.visiblePickRoots.length > 0) {
      const hits = raycaster.intersectObjects(this.visiblePickRoots, true);
      for (const hit of hits) {
        let current: Object3D | null = hit.object;
        while (current) {
          if (typeof current.userData.objectIndex === 'number') {
            return current.userData.objectIndex;
          }
          current = current.parent;
        }
      }
    }

    const candidates: ScreenPickCandidate[] = [];
    this.collectScreenPickCandidates(this.spacecraftPoints.mesh, camera, candidates);
    this.collectScreenPickCandidates(this.debrisPoints.mesh, camera, candidates);
    for (const wrapper of this.visiblePickRoots) {
      if (!wrapper.visible) continue;
      const index = wrapper.userData.objectIndex;
      if (typeof index !== 'number') continue;
      wrapper.getWorldPosition(scratchPick);
      const radial = scratchPick.length();
      scratchPick.project(camera);
      candidates.push({
        index,
        ndcX: scratchPick.x,
        ndcY: scratchPick.y,
        ndcZ: scratchPick.z,
        radial,
      });
    }

    return pickClosestScreenIndex(
      candidates,
      pointerNdc.x,
      pointerNdc.y,
      canvasWidth,
      canvasHeight,
    );
  }

  private collectScreenPickCandidates(
    mesh: InstancedMesh,
    camera: PerspectiveCamera,
    out: ScreenPickCandidate[],
  ): void {
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, scratchMatrix);
      if (Math.abs(scratchMatrix.elements[0]) < 1e-12) continue;
      scratchPick.setFromMatrixPosition(scratchMatrix);
      mesh.localToWorld(scratchPick);
      const radial = scratchPick.length();
      scratchPick.project(camera);
      out.push({
        index: i,
        ndcX: scratchPick.x,
        ndcY: scratchPick.y,
        ndcZ: scratchPick.z,
        radial,
      });
    }
  }

  private resolveGltfDetailIndices(
    objects: TrackedObject[],
    selectedIndex: number | null,
    conjunctionFocus: boolean,
    highlightSet: Set<number>,
  ): Set<number> {
    const indices = new Set<number>();

    if (conjunctionFocus) {
      for (const index of highlightSet) {
        const obj = objects[index];
        if (obj) indices.add(index);
      }
      return indices;
    }

    if (selectedIndex != null) {
      const obj = objects[selectedIndex];
      if (obj && usesGltfDetail(obj)) indices.add(selectedIndex);
    }

    return indices;
  }

  private syncDetailWrappers(
    objects: TrackedObject[],
    propagations: (PropagationResult | null)[],
    gltfDetailIndices: Set<number>,
    layerFilters: Record<OrbitLayer, boolean>,
    searchQuery: string,
    conjunctionFocus: boolean,
    highlightSet: Set<number>,
    selectedIndex: number | null,
    cameraPosition: { x: number; y: number; z: number },
    pulseTimeMs: number,
    colorByFunction: boolean,
    conjunctionLiveDistanceKm: number | null,
    categoryFilter: ObjectCategory | 'all' = 'all',
  ): void {
    for (const [index, wrapper] of this.detailWrappers) {
      if (!gltfDetailIndices.has(index)) {
        this.group.remove(wrapper);
        this.detailWrappers.delete(index);
      }
    }

    for (const index of gltfDetailIndices) {
      const obj = objects[index];
      if (!obj || !usesGltfDetail(obj, conjunctionFocus)) continue;

      const isSelected = index === selectedIndex;
      const isConjunction = highlightSet.has(index);
      const hide =
        (conjunctionFocus && !isConjunction) ||
        (!isSelected &&
          !isConjunction &&
          (
            !layerFilters[obj.layer] ||
            (categoryFilter !== 'all' && obj.category !== categoryFilter) ||
            !matchesSearch(obj, searchQuery)
          ));

      let wrapper = this.detailWrappers.get(index);
      if (!wrapper) {
        const modelKey =
          conjunctionFocus && obj.category === 'debris' ? 'sat_leo' : resolveModelKey(obj);
        void satelliteModelLoader.ensureLoaded(modelKey).then(() => {
          if (this.detailWrappers.has(index)) return;
          const created = satelliteModelLoader.clone(modelKey);
          created.userData.objectIndex = index;
          created.visible = false;
          this.detailWrappers.set(index, created);
          this.group.add(created);
        });
        continue;
      }

      const result = propagations[index];
      if (hide || !result) {
        wrapper.visible = false;
        continue;
      }

      if (
        !isSelected &&
        !isConjunction &&
        (!layerFilters[result.layer] || !isVisibleFromCamera(result, cameraPosition))
      ) {
        wrapper.visible = false;
        continue;
      }

      const scenePos = eciToScene(
        result.positionEci.x,
        result.positionEci.y,
        result.positionEci.z,
      );
      const vel = eciVectorToScene(
        result.velocityEci.x,
        result.velocityEci.y,
        result.velocityEci.z,
      );
      scratchVel.set(vel.x, vel.y, vel.z);

      let scaleMul = isSelected ? SELECTED_SCALE : getCategoryScale(obj.category, obj.country);
      if (isConjunction) {
        scaleMul = conjunctionModelScale(conjunctionLiveDistanceKm);
      }
      scaleMul *= isConjunction ? 1 : getCategoryPulse(obj.category, pulseTimeMs, obj.country);

      const baseScale = (wrapper.userData.baseScale as number) ?? 1;
      wrapper.position.set(scenePos.x, scenePos.y, scenePos.z);
      orientAlongVelocity(wrapper, scratchVel);
      wrapper.scale.setScalar(baseScale * scaleMul);
      applyTint(wrapper, obj, result.layer, isSelected, isConjunction, pulseTimeMs, colorByFunction);
      wrapper.visible = true;
    }
  }
}

function orientAlongVelocity(wrapper: Group, velocityScene: Vector3): void {
  if (velocityScene.lengthSq() < 1e-12) return;

  scratchDir.copy(velocityScene).normalize();
  scratchUp.copy(wrapper.position).normalize();
  if (Math.abs(scratchUp.dot(scratchDir)) > 0.98) {
    scratchUp.set(0, 1, 0);
  }

  scratchMatrix.lookAt(new Vector3(0, 0, 0), scratchDir, scratchUp);
  wrapper.quaternion.setFromRotationMatrix(scratchMatrix);
}

function applyTint(
  wrapper: Group,
  obj: TrackedObject,
  layer: OrbitLayer,
  isSelected: boolean,
  isConjunction: boolean,
  pulseTimeMs: number,
  colorByFunction: boolean,
): void {
  const tintKey = `${colorByFunction ? 1 : 0}:${isSelected ? 1 : 0}:${isConjunction ? 1 : 0}:${Math.floor(pulseTimeMs / 120)}:${layer}:${obj.functionGroup}`;
  if (wrapper.userData.tintKey === tintKey) return;
  wrapper.userData.tintKey = tintKey;

  if (isSelected) {
    tintColor.setRGB(1, 1, 1);
  } else if (isConjunction) {
    const pulse = 0.88 + 0.12 * Math.sin(pulseTimeMs * 0.005);
    tintColor.setRGB(1 * pulse, 0.9 * pulse, 0.2 * pulse);
  } else if (colorByFunction) {
    const [r, g, b] = getFunctionGroupColor(obj.functionGroup);
    const pulse = getFunctionGroupPulse(obj.functionGroup, pulseTimeMs);
    tintColor.setRGB(r * pulse, g * pulse, b * pulse);
  } else {
    const [r, g, b] = getCategoryColor(obj.category, layer, obj.country);
    const pulse = getCategoryPulse(obj.category, pulseTimeMs, obj.country);
    tintColor.setRGB(r * pulse, g * pulse, b * pulse);
  }

  wrapper.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const mat of materials) {
      if ('emissive' in mat && mat.emissive) {
        mat.emissive.copy(tintColor).multiplyScalar(0.35);
      }
    }
  });
}

