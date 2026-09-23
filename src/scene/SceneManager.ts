/**
 * Three.js scene owner: Earth, instanced sats/debris, trails, VERIFY overlays,
 * and historical event replay visuals.
 *
 * Drive loop (start): advance the active clock → pull propagation results →
 * update meshes → handle OrbitControls / camera fly-ins.
 * Propagation for the full catalog runs in `propagation.worker` via
 * PropagationWorkerBridge; do not SGP4 every object on the main thread.
 *
 * When Spotter is open, heavy globe work is paused (see isSpotterOpen).
 * Historical replays hide the live catalog and use EventReplayVisuals lerp
 * paths — not live TLE propagation of 2009-era elements.
 */
import {
  AmbientLight,
  Color,
  DirectionalLight,
  HemisphereLight,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector2,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { getUpcomingConjunctions, conjunctionSessionKey } from '../orbital/conjunction';
import { getDebrisUpdateStride, getPropagationResults } from '../orbital/propagationBatch';
import { PropagationWorkerBridge } from '../orbital/PropagationWorkerBridge';
import { eciToScene } from '../orbital/coordinates';
import { propagateObject } from '../orbital/propagator';
import { getVisualConjunctionLayout, PAIR_FOCUS_MAX_DISTANCE, PAIR_FOCUS_NEAR, PAIR_INSPECT_MIN_DISTANCE, GLOBE_CAMERA_NEAR } from '../orbital/visualConjunction';
import { CameraFly } from './CameraFly';
import { ConjunctionVerification } from './ConjunctionVerification';
import { ConjunctionLabels } from './ConjunctionLabels';
import { getDayNightState } from './dayNight';
import { Earth } from './Earth';
import { LeoShell } from './LeoShell';
import { OrbitalMeshes } from './OrbitalMeshes';
import { OrbitTrail } from './OrbitTrail';
import { SatelliteFootprint } from './SatelliteFootprint';
import { SatelliteGroundTrack } from './SatelliteGroundTrack';
import { getSubSatelliteScenePoints } from '../orbital/coordinates';
import { SelectionMarker } from './SelectionMarker';
import { EARTH_RADIUS_KM, type TrackedObject } from '../types';
import {
  getState,
  getSimulationTime,
  matchesSearchQuery,
  selectObject,
  clearObjectSelection,
  setConjunctions,
  advanceSimulationTime,
  advanceVerificationTime,
  advanceEventReplayTime,
  startEventReplay,
  stopEventReplay,
  setEventReplayPartial,
  subscribe,
} from '../state/appState';
import { EventReplayVisuals } from './EventReplayVisuals';
import { EventReplayLabels } from './EventReplayLabels';
import { getHistoricalEvent } from '../ui/EventCards';
import { isSpotterOpen } from '../ui/SpotterPanel';

export class SceneManager {
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly earth: Earth;
  readonly sunLight: DirectionalLight;
  private leoShell: LeoShell;
  private orbitalMeshes: OrbitalMeshes | null = null;
  private propWorker: PropagationWorkerBridge;
  private selectionMarker: SelectionMarker;
  private orbitTrail: OrbitTrail;
  private satelliteFootprint: SatelliteFootprint;
  private groundTrack: SatelliteGroundTrack;
  private conjunctionVerification: ConjunctionVerification;
  private conjunctionLabels: ConjunctionLabels;
  private cameraFly: CameraFly;
  private eventReplayVisuals: EventReplayVisuals;
  private eventReplayLabels!: EventReplayLabels;
  private lastEventReplayId: string | null = null;
  private _eventReplayStarted = false;
  private raycaster = new Raycaster();
  private pointer = new Vector2();
  private lastFrameTime = performance.now();
  private animationId = 0;
  private canvasContainer: HTMLElement;
  private debugMode: boolean;
  private fpsElement: HTMLElement | null = null;
  private fpsFrames = 0;
  private fpsLastUpdate = performance.now();
  private lastConjunctionSessionKey: string | null = null;
  private lastConjunctionRevision = -1;
  private debrisFrameCounter = 0;
  private lastFramedSelectionIndex: number | null = null;
  private clickAnchor: { x: number; y: number } | null = null;
  private pointerDragged = false;
  private readonly clickDragThresholdPx = 5;
  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    this.clickAnchor = { x: event.clientX, y: event.clientY };
    this.pointerDragged = false;
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
  };
  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.clickAnchor || this.pointerDragged) return;
    const dx = event.clientX - this.clickAnchor.x;
    const dy = event.clientY - this.clickAnchor.y;
    if (Math.hypot(dx, dy) > this.clickDragThresholdPx) {
      this.pointerDragged = true;
    }
  };
  private readonly onPointerUp = (): void => {
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
  };

  constructor(container: HTMLElement) {
    this.canvasContainer = container;
    this.debugMode = new URLSearchParams(window.location.search).has('debug');

    this.scene = new Scene();
    this.scene.background = new Color('#050510');

    this.camera = new PerspectiveCamera(45, 1, GLOBE_CAMERA_NEAR, 1000);
    this.camera.position.set(0, 0, 4.5);

    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.sortObjects = true;
    container.appendChild(this.renderer.domElement);

    if (this.debugMode) {
      this.fpsElement = document.createElement('div');
      this.fpsElement.className = 'fps-counter';
      this.fpsElement.textContent = 'FPS: —';
      container.appendChild(this.fpsElement);
    }

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    // Keep short mouse/touch drags precise. OrbitControls' defaults make a
    // small flick rotate the globe too far and let that motion coast for too
    // long after release, especially on high-resolution touch screens.
    this.controls.rotateSpeed = 0.30;
    this.controls.dampingFactor = 0.12;
    this.controls.target.set(0, 0, 0);
    // Pinch-zoom must not pan the orbit target — phones default to
    // two-finger DOLLY_PAN, which drifts Earth off-center. Disabling pan
    // keeps pinch as zoom-only while orbit stays locked on the origin.
    this.controls.enablePan = false;
    this.controls.screenSpacePanning = false;
    this.applyOrbitDistanceLimits(false);

    const ambientLight = new AmbientLight(0x1a2040, 0.28);
    this.scene.add(ambientLight);

    const fillLight = new HemisphereLight(0x3a5080, 0x0a0812, 0.14);
    this.scene.add(fillLight);

    this.sunLight = new DirectionalLight(0xfff4e8, 2.6);
    this.sunLight.target.position.set(0, 0, 0);
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    this.earth = new Earth();
    this.earth.mesh.renderOrder = 0;
    this.scene.add(this.earth.mesh);

    this.leoShell = new LeoShell();
    this.scene.add(this.leoShell.group);

    this.selectionMarker = new SelectionMarker();
    this.scene.add(this.selectionMarker.group);

    this.orbitTrail = new OrbitTrail();
    this.scene.add(this.orbitTrail.group);

    this.satelliteFootprint = new SatelliteFootprint();
    this.scene.add(this.satelliteFootprint.group);

    this.groundTrack = new SatelliteGroundTrack();
    this.groundTrack.attachToEarth(this.earth.mesh);

    this.conjunctionVerification = new ConjunctionVerification();
    this.scene.add(this.conjunctionVerification.group);

    this.conjunctionLabels = new ConjunctionLabels(container);

    this.cameraFly = new CameraFly();

    this.eventReplayVisuals = new EventReplayVisuals();
    this.scene.add(this.eventReplayVisuals.group);

    this.eventReplayLabels = new EventReplayLabels(container);

    this.propWorker = new PropagationWorkerBridge();

    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.addEventListener('click', (e) => this.onClick(e));
    window.addEventListener('resize', () => this.onResize());

    subscribe(() => this.onStateChange());

    this.onResize();
    this.applyDayNight(getSimulationTime());
  }

  async initOrbitalMeshes(objects: TrackedObject[]): Promise<void> {
    this.orbitalMeshes = await OrbitalMeshes.create(objects);
    this.scene.add(this.orbitalMeshes.group);
    this.propWorker.init(objects);
  }

  start(): void {
    const loop = (now: number) => {
      this.animationId = requestAnimationFrame(loop);
      this.tick(now);
    };
    this.animationId = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.animationId);
  }

  /**
   * Free navigation always orbits Earth (origin). Conjunction / event-replay
   * modes temporarily move the target; don't fight those.
   */
  private keepEarthCenteredOrbit(): void {
    const state = getState();
    if (state.selectedConjunction || state.eventReplay || state.verificationTime) return;
    if (this.cameraFly.isActive()) return;
    if (this.controls.target.lengthSq() > 1e-8) {
      this.controls.target.set(0, 0, 0);
    }
  }

  /**
   * Globe view clamps the camera outside Earth (radius ≈ 1). Close-pair
   * focus orbits the midpoint — never Earth origin — with a tight inspect
   * floor so the pair stays framed like the opening fly-in.
   */
  private applyOrbitDistanceLimits(conjunctionFocus: boolean): void {
    if (conjunctionFocus) {
      this.controls.minDistance = PAIR_INSPECT_MIN_DISTANCE;
      this.controls.maxDistance = PAIR_FOCUS_MAX_DISTANCE;
      if (this.camera.near !== PAIR_FOCUS_NEAR) {
        this.camera.near = PAIR_FOCUS_NEAR;
        this.camera.updateProjectionMatrix();
      }
      return;
    }
    this.controls.minDistance = 1.35;
    this.controls.maxDistance = 10;
    if (this.camera.near !== GLOBE_CAMERA_NEAR) {
      this.camera.near = GLOBE_CAMERA_NEAR;
      this.camera.updateProjectionMatrix();
    }
  }

  private onStateChange(): void {
    const { selectedConjunction, selectedIndex, selectedEventId, objects, conjunctionRevision } = getState();

    // --- Historical event replay ---
    if (selectedEventId && !selectedConjunction) {
      const event = getHistoricalEvent(selectedEventId);
      if (event && event.collisionTimeUtc && event.objectA) {
        const collisionTimeMs = new Date(event.collisionTimeUtc).getTime();

        if (this.lastEventReplayId !== selectedEventId) {
          const comingFromReplay = this.lastEventReplayId != null;
          this.lastEventReplayId = selectedEventId;
          startEventReplay(selectedEventId, collisionTimeMs);
          this.eventReplayVisuals.setup(event, collisionTimeMs);
          this._eventReplayStarted = comingFromReplay;

          if (!comingFromReplay) {
            this.cameraFly.captureGlobalView(this.camera, this.controls);
            // Same close-pair orbit limits as conjunction verification so the
            // fly-in can lock onto the colliding objects instead of the globe.
            this.applyOrbitDistanceLimits(true);
            this.canvasContainer.classList.add('scene-container--conjunction-focus');

            // Clear any satellite selection visuals immediately so the footprint
            // cone and orbit trail don't linger while the replay loads.
            this.satelliteFootprint.update(null, objects, new Date());
            this.selectionMarker.update(null, objects, new Date());
            this.orbitTrail.update(false, null, objects, new Date());
            this.groundTrack.clear();

            // Hide all catalog satellite dots so only the 2 historical objects
            // are visible. Modern TLEs extrapolated 15+ years backwards produce
            // garbage positions that scatter across the scene.
            if (this.orbitalMeshes) this.orbitalMeshes.group.visible = false;
            this.leoShell.setVisible(false);
          }
        } else if (!getState().eventReplay) {
          // Same card clicked again: selectHistoricalEvent cleared eventReplay
          // while lastEventReplayId still matched, which used to freeze the
          // scene with no clock. Rewind and play without tearing down the view.
          this._eventReplayStarted = true;
          startEventReplay(selectedEventId, collisionTimeMs);
        }

        this.applyOrbitDistanceLimits(true);
        this.canvasContainer.classList.add('scene-container--conjunction-focus');
        this.earth.mesh.visible = true;
        return;
      }
    }

    // Clear event replay when the card is deselected OR when stopEventReplay()
    // was called (e.g. from "Return to Global View"). Both paths clear
    // lastEventReplayId so this block only runs once.
    const { eventReplay } = getState();
    if (this.lastEventReplayId && (!selectedEventId || !eventReplay)) {
      this.lastEventReplayId = null;
      this._eventReplayStarted = false;
      this.eventReplayVisuals.dispose();
      this.eventReplayLabels.hide();
      // stopEventReplay() already cleared state; call only when still set.
      if (eventReplay) stopEventReplay();
      // Restore catalog satellites visibility
      if (this.orbitalMeshes) this.orbitalMeshes.group.visible = true;
      this.leoShell.setVisible(true);
      this.applyOrbitDistanceLimits(false);
      this.canvasContainer.classList.remove('scene-container--conjunction-focus');
      this.cameraFly.flyToGlobalView(this.camera, this.controls);
    }

    if (selectedConjunction) {
      const sessionKey = conjunctionSessionKey(selectedConjunction);
      const sessionChanged =
        sessionKey !== this.lastConjunctionSessionKey ||
        conjunctionRevision !== this.lastConjunctionRevision;

      if (sessionChanged) {
        this.conjunctionVerification.disposeVisuals();
        this.conjunctionLabels.reset();

        if (this.lastConjunctionSessionKey === null) {
          this.cameraFly.captureGlobalView(this.camera, this.controls);
        }

        this.lastConjunctionSessionKey = sessionKey;
        this.lastConjunctionRevision = conjunctionRevision;
        this.lastFrameTime = performance.now();
        this.conjunctionVerification.rebuildForEvent(selectedConjunction, objects);
        // Relax dolly limits *before* the fly-in so OrbitControls.update
        // does not clamp the close-pair pose back to globe minDistance.
        this.applyOrbitDistanceLimits(true);

        const flyTime = getSimulationTime();
        const propA = propagateObject(objects[selectedConjunction.indexA]?.satrec, flyTime);
        const propB = propagateObject(objects[selectedConjunction.indexB]?.satrec, flyTime);
        if (propA && propB) {
          const posA = eciToScene(propA.positionEci.x, propA.positionEci.y, propA.positionEci.z);
          const posB = eciToScene(propB.positionEci.x, propB.positionEci.y, propB.positionEci.z);
          const dx = propA.positionEci.x - propB.positionEci.x;
          const dy = propA.positionEci.y - propB.positionEci.y;
          const dz = propA.positionEci.z - propB.positionEci.z;
          const liveKm = Math.sqrt(dx * dx + dy * dy + dz * dz);
          const layout = getVisualConjunctionLayout(posA, posB, liveKm);

          this.conjunctionVerification.update(selectedConjunction, objects, flyTime);

          this.controls.target.copy(layout.visualMid);
          this.controls.update();
          this.cameraFly.flyToConjunctionPair(
            this.camera,
            this.controls,
            posA,
            posB,
            liveKm,
          );
        }
      }

      this.applyOrbitDistanceLimits(true);
      this.canvasContainer.classList.add('scene-container--conjunction-focus');
      this.leoShell.setVisible(false);
      this.earth.mesh.visible = true;
      return;
    }

    if (this.lastConjunctionSessionKey) {
      this.conjunctionVerification.disposeVisuals();
      this.conjunctionLabels.reset();
      this.applyOrbitDistanceLimits(false);
      this.cameraFly.flyToGlobalView(this.camera, this.controls);
    }

    this.earth.mesh.visible = true;

    this.lastConjunctionSessionKey = null;
    this.lastConjunctionRevision = -1;
    this.canvasContainer.classList.remove('scene-container--conjunction-focus');
    this.leoShell.setVisible(true);

    if (
      selectedIndex != null &&
      selectedIndex !== this.lastFramedSelectionIndex &&
      !this.cameraFly.isActive()
    ) {
      const obj = objects[selectedIndex];
      const propagation = obj ? propagateObject(obj.satrec, getSimulationTime()) : null;
      const subSat = propagation
        ? getSubSatelliteScenePoints(propagation.positionEci, propagation.altitudeKm)
        : null;

      if (propagation && subSat) {
        this.cameraFly.frameSelectedOnGlobe(
          this.camera,
          this.controls,
          subSat.nadirWorld,
          propagation.altitudeKm,
        );
      }

      this.lastFramedSelectionIndex = selectedIndex;
    } else if (selectedIndex == null) {
      this.lastFramedSelectionIndex = null;
    }
  }

  private applyDayNight(simTime: Date): void {
    const { sunPosition, sunDirection } = getDayNightState(simTime);
    this.sunLight.position.set(sunPosition.x, sunPosition.y, sunPosition.z);
    this.earth.update(simTime, sunDirection);
  }

  private updateFps(now: number): void {
    if (!this.fpsElement) return;

    this.fpsFrames++;
    if (now - this.fpsLastUpdate >= 1000) {
      const fps = Math.round((this.fpsFrames * 1000) / (now - this.fpsLastUpdate));
      this.fpsElement.textContent = `FPS: ${fps}`;
      this.fpsFrames = 0;
      this.fpsLastUpdate = now;
    }
  }

  private tick(now: number): void {
    // Spotter owns the screen on mobile — skip the heavy 3D/propagation loop
    // so compass aiming stays responsive.
    if (isSpotterOpen()) {
      this.lastFrameTime = now;
      return;
    }

    const state = getState();
    const deltaMs = now - this.lastFrameTime;
    this.lastFrameTime = now;

    if (state.verificationTime?.playing && !this.cameraFly.isActive()) {
      // Hold the verify clock during the opening fly-in so a high-speed
      // pair does not burn its short T− window while the camera is moving.
      advanceVerificationTime(deltaMs);
    } else if (state.eventReplay?.playing) {
      advanceEventReplayTime(deltaMs);
    } else if (state.time.mode === 'historical' && state.time.playing) {
      advanceSimulationTime(
        new Date(state.time.current.getTime() + deltaMs * state.time.speed),
      );
    }

    const currentState = getState();
    const simTime = getSimulationTime();

    // ── Event replay fast-path: skip bulk propagation of all catalog satellites
    //    (they have modern TLEs; propagating them to 2007/2009/2021 is extremely
    //    slow and produces garbage results). Only run the two historical satrecs.
    if (currentState.eventReplay) {
      // Keep Earth day/night shader in sync with the replay time
      this.applyDayNight(simTime);

      const flying = this.cameraFly.update(this.camera, this.controls, now);

      const replayResult = this.eventReplayVisuals.tick(
        simTime,
        currentState.eventReplay.collisionTimeMs,
      );

      // Pause exactly at T=0 — the collision moment is the natural end-point.
      // This prevents post-impact Earth rotation from drifting the dots over
      // wrong geographic regions while keeping the impact flash visible.
      if (replayResult && currentState.eventReplay.playing) {
        const msToImpact = currentState.eventReplay.collisionTimeMs - currentState.eventReplay.currentMs;
        if (msToImpact <= 0) {
          setEventReplayPartial({ playing: false });
        }
      }

      // One-time fly-in: lock onto the pair like close-approach verification
      // (midpoint target + close orbit), not a globe-facing frame.
      if (replayResult && !this._eventReplayStarted && !this.cameraFly.isActive()) {
        this._eventReplayStarted = true;
        const collisionScene = this.eventReplayVisuals.getCollisionScene();
        const posA = replayResult.posA;
        const posB = replayResult.posB ?? collisionScene;
        if (posB) {
          const sepKm = Math.max(
            this.eventReplayVisuals.getInitialSeparationKm(),
            posA.distanceTo(posB) * EARTH_RADIUS_KM,
            0.5,
          );
          const layout = getVisualConjunctionLayout(posA, posB, sepKm);
          this.controls.target.copy(layout.visualMid);
          this.controls.update();
          this.cameraFly.flyToConjunctionPair(
            this.camera,
            this.controls,
            posA,
            posB,
            sepKm,
          );
        }
      }

      // Keep the colliding pair framed after the fly-in completes.
      if (this._eventReplayStarted && !this.cameraFly.isActive() && replayResult) {
        const posA = replayResult.posA;
        const posB = replayResult.posB ?? this.eventReplayVisuals.getCollisionScene();
        if (posB) {
          const sepKm = Math.max(posA.distanceTo(posB) * EARTH_RADIUS_KM, 0.1);
          this.cameraFly.followConjunctionMidpoint(
            this.camera,
            this.controls,
            posA,
            posB,
            sepKm,
            deltaMs,
          );
        }
      }

      if (!flying && !this.cameraFly.isActive()) {
        this.controls.update();
      }
      this.camera.updateMatrixWorld();

      // Floating info panels over the two objects
      if (replayResult) {
        const event = getHistoricalEvent(currentState.eventReplay.eventId);
        const names = this.eventReplayVisuals.getNames();
        this.eventReplayLabels.update(
          replayResult.posA,
          replayResult.posB,
          names?.nameA ?? 'OBJECT A',
          names?.nameB ?? null,
          (event?.eventType ?? 'collision'),   // visual category drives label behaviour
          this.camera,
          this.renderer,
          replayResult.impactFlash,
        );
      } else {
        this.eventReplayLabels.hide();
      }

      this.renderer.render(this.scene, this.camera);
      this.updateFps(now);
      return; // skip all catalog propagation, conjunction scan, etc.
    }

    this.eventReplayLabels.hide();
    this._eventReplayStarted = false;

    // ── Normal tick ──────────────────────────────────────────────────────────
    const timeSpeed =
      currentState.verificationTime?.speed ??
      (currentState.time.mode === 'historical' ? currentState.time.speed : 1);
    const conjunctionHighlightIndices = currentState.selectedConjunction
      ? [currentState.selectedConjunction.indexA, currentState.selectedConjunction.indexB]
      : null;

    this.applyDayNight(simTime);

    // Fire async request to the Worker for the next frame's data.
    // The Worker result arrives via message handler and is buffered.
    // Falls back to synchronous propagation only on the very first frame
    // before the Worker has replied (null → synchronous).
    this.propWorker.request(simTime.getTime(), timeSpeed);
    const propagations =
      this.propWorker.getLatestResults() ??
      getPropagationResults(currentState.objects, simTime, timeSpeed);
    const debrisStride = getDebrisUpdateStride(timeSpeed);
    const skipPointsUpdate = this.debrisFrameCounter++ % debrisStride !== 0;

    // Real-world separation for the two verified objects, used to cap their
    // model size below (see conjunctionLiveDistanceKm in updatePositions) —
    // otherwise the ~25km-wide exaggerated satellite model dwarfs genuine
    // multi-km near-misses and makes them look like a physical collision.
    let conjunctionLiveDistanceKm: number | null = null;
    if (currentState.selectedConjunction) {
      const propA = propagations[currentState.selectedConjunction.indexA];
      const propB = propagations[currentState.selectedConjunction.indexB];
      if (propA && propB) {
        const dx = propA.positionEci.x - propB.positionEci.x;
        const dy = propA.positionEci.y - propB.positionEci.y;
        const dz = propA.positionEci.z - propB.positionEci.z;
        conjunctionLiveDistanceKm = Math.sqrt(dx * dx + dy * dy + dz * dz);
      }
    }

    if (this.orbitalMeshes) {
      this.orbitalMeshes.updatePositions(
        currentState.objects,
        propagations,
        currentState.selectedIndex,
        conjunctionHighlightIndices,
        currentState.layerFilters,
        currentState.searchQuery,
        this.camera.position,
        simTime.getTime(),
        {
          skipPointsUpdate,
          colorByFunction: currentState.colorByFunction,
          altitudeFilter: currentState.altitudeFilter,
          inclinationFilter: currentState.inclinationFilter,
          showOnlyRecentLaunches: currentState.showOnlyRecentLaunches,
          categoryFilter: currentState.categoryFilter,
          conjunctionLiveDistanceKm,
        },
      );
    }

    const footprintIndex =
      currentState.selectedConjunction || !this.earth.mesh.visible
        ? null
        : currentState.selectedIndex;

    this.satelliteFootprint.update(footprintIndex, currentState.objects, simTime);

    // Suppress the regular single-satellite selection marker and orbit trail
    // while verifying a close approach — otherwise a satellite selected
    // *before* opening the conjunction view lingers as an unrelated dot and
    // trail floating in the zoomed-in verification camera.
    const selectionIndexForOverlays = currentState.selectedConjunction ? null : currentState.selectedIndex;

    this.selectionMarker.update(
      selectionIndexForOverlays,
      currentState.objects,
      simTime,
    );

    this.orbitTrail.update(
      currentState.showOrbitTrail,
      selectionIndexForOverlays,
      currentState.objects,
      simTime,
    );

    // Ground track: show 1.5-orbit projection on Earth surface for selected satellite.
    // Hidden during event replay or conjunction verification views.
    this.groundTrack.update(
      !currentState.eventReplay && !currentState.selectedConjunction && currentState.showGroundTrack
        ? currentState.selectedIndex
        : null,
      currentState.objects,
      simTime,
    );

    const flying = this.cameraFly.update(this.camera, this.controls, now);

    if (currentState.selectedConjunction && !flying) {
      const conj = currentState.selectedConjunction;
      const objA = currentState.objects[conj.indexA];
      const objB = currentState.objects[conj.indexB];
      if (objA && objB) {
        const propA = propagateObject(objA.satrec, simTime);
        const propB = propagateObject(objB.satrec, simTime);
        if (propA && propB) {
          const posA = eciToScene(propA.positionEci.x, propA.positionEci.y, propA.positionEci.z);
          const posB = eciToScene(propB.positionEci.x, propB.positionEci.y, propB.positionEci.z);
          // Follow the *live* gap so the camera dollies in as the pair closes,
          // matching model-scale shrink during VERIFY playback.
          const liveKm = conjunctionLiveDistanceKm ?? conj.distanceKm;
          this.cameraFly.followConjunctionMidpoint(
            this.camera,
            this.controls,
            posA,
            posB,
            liveKm,
            deltaMs,
          );
        }
      }
    }

    if (!flying) {
      this.controls.update();
      this.keepEarthCenteredOrbit();
    }

    this.camera.updateMatrixWorld();

    this.conjunctionVerification.update(
      currentState.selectedConjunction,
      currentState.objects,
      simTime,
    );

    this.conjunctionLabels.update(
      currentState.selectedConjunction,
      currentState.objects,
      simTime,
      this.camera,
      this.renderer,
    );

    if (!currentState.selectedConjunction) {
      // Forward-looking: predicts the closest approaches over the next 24h
      // rather than only reporting what's happening at this exact instant.
      getUpcomingConjunctions(currentState.objects, simTime, (fresh) => {
        setConjunctions(fresh);
      });
    }

    this.renderer.render(this.scene, this.camera);
    this.updateFps(now);
  }

  private onClick(event: MouseEvent): void {
    if (!this.orbitalMeshes) return;

    if (this.pointerDragged) {
      this.pointerDragged = false;
      this.clickAnchor = null;
      return;
    }

    this.clickAnchor = null;

    const focusState = getState();
    if (
      focusState.eventReplay ||
      focusState.selectedEventId ||
      focusState.selectedConjunction ||
      focusState.verificationTime
    ) {
      // Catalog points stay raycastable even when the group is hidden for
      // historical replay. Picking one would call selectObject() and abort
      // the story (2009 collision, close-approach verify, …).
      return;
    }

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.pointer, this.camera);
    this.camera.updateMatrixWorld();
    const objectIndex = this.orbitalMeshes.pickObjectIndex(
      this.raycaster,
      this.camera,
      this.pointer,
      rect.width,
      rect.height,
    );

    if (objectIndex != null) {
      const state = getState();
      const obj = state.objects[objectIndex];
      if (!obj) return;

      const propagation = propagateObject(obj.satrec, getSimulationTime());
      if (
        propagation &&
        state.layerFilters[propagation.layer] &&
        (state.categoryFilter === 'all' || obj.category === state.categoryFilter) &&
        matchesSearchQuery(obj, state.searchQuery)
      ) {
        selectObject(objectIndex);
      }
      return;
    }

    clearObjectSelection();
  }

  private onResize(): void {
    const { clientWidth, clientHeight } = this.canvasContainer;
    this.camera.aspect = clientWidth / clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(clientWidth, clientHeight);
  }
}
