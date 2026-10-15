/**
 * Shared domain types for the catalog and UI.
 *
 * TleRecord  — raw JSON from public/data/tle.json
 * TrackedObject — satrec + derived layer/color/altitude after tleLoader
 * firstSeenAt — when THIS app’s automated fetch first saw the NORAD id
 *               (not SATCAT launch date; drives “New to this catalog”)
 */
export type OrbitLayer = 'LEO' | 'MEO' | 'GEO' | 'HEO';
export type ObjectCategory = 'stations' | 'active' | 'debris';

/** A published amateur-satellite radio channel. Frequencies are in MHz. */
export interface RadioFrequency {
  /** User-facing service, for example "APRS digipeater" or "FM voice". */
  service: string;
  uplinkMHz?: string;
  downlinkMHz?: string;
  /** Receive-only / beacon frequency when an uplink is not published. */
  listenMHz?: string;
  mode: string;
  note?: string;
  /** Authoritative frequency/status page for a final on-air check. */
  sourceUrl: string;
  /** true = amateur-radio service, false = confirmed non-amateur (weather,
   *  navigation, broadband…), absent = not classified by the source. */
  amateur?: boolean;
}

/** Visual grouping for color-by-function mode (derived from TLE name + category). */
export type ObjectFunctionGroup = 'starlink' | 'debris' | 'station' | 'active';

export interface TleRecord {
  noradId: number;
  name: string;
  line1: string;
  line2: string;
  category: ObjectCategory;
  country?: string;
  owner?: string;
  /** Amateur-radio channels joined from AMSAT/SatNOGS or curated by NORAD ID. */
  radioFrequencies?: RadioFrequency[];
  /** ISO timestamp of the first automated fetch that observed this NORAD ID.
   *  Absent for objects that were already known before this field existed. */
  firstSeenAt?: string;
  /** Other catalog objects docked to this one (same published elements),
   *  merged into it by mergeDockedStacks. */
  dockedComponents?: DockedComponent[];
}

export interface DockedComponent {
  noradId: number;
  name: string;
}

export interface TleDataset {
  fetchedAt: string;
  source: string;
  count: number;
  objects: TleRecord[];
}

export interface TrackedObject extends TleRecord {
  country: string;
  owner: string;
  satrec: import('satellite.js').SatRec;
  layer: OrbitLayer;
  color: [number, number, number];
  functionGroup: ObjectFunctionGroup;
  /** Mean orbital altitude in km, derived from TLE mean motion (fast, no propagation). */
  meanAltitudeKm: number;
  /** Orbital inclination in degrees from TLE. */
  inclinationDeg: number;
  /** TLE epoch is more than STALE_TLE_AGE_DAYS from the catalog fetch time
   *  (either direction). Such objects are drawn but not screened for close
   *  approaches: their positions can be off by tens of km or more. */
  staleElements?: boolean;
}

export interface ObjectSnapshot {
  noradId: number;
  name: string;
  altitudeKm: number;
  latitudeDeg: number;
  longitudeDeg: number;
  velocityKmS: number;
  layer: OrbitLayer;
  category: ObjectCategory;
  country: string;
  owner: string;
  inclinationDeg: number;
  positionEci: { x: number; y: number; z: number };
}

export interface ConjunctionEvent {
  objectA: string;
  objectB: string;
  /** NORAD catalog IDs — the only reliable identity, since debris fields
   *  routinely contain many objects sharing the exact same display name
   *  (e.g. dozens of "FENGYUN 1C DEB" fragments). Never re-resolve a stored
   *  alert back to live indices by name alone. */
  noradIdA: number;
  noradIdB: number;
  indexA: number;
  indexB: number;
  distanceKm: number;
  relativeVelocityKmS: number;
  time: Date;
  midpointScene: { x: number; y: number; z: number };
}

export type TimeMode = 'live' | 'historical';

export interface TimeState {
  mode: TimeMode;
  current: Date;
  speed: number;
  playing: boolean;
}

export interface AppStats {
  total: number;
  leoPercent: number;
  avgAltitude: number;
  categoryCounts: Record<ObjectCategory, number>;
  fetchedAt: string;
}

export const LAYER_COLORS: Record<OrbitLayer, [number, number, number]> = {
  LEO: [0.133, 0.827, 0.933],
  MEO: [0.98, 0.8, 0.082],
  GEO: [0.984, 0.573, 0.235],
  HEO: [0.655, 0.545, 0.98],
};

export const LAYER_HEX: Record<OrbitLayer, string> = {
  LEO: '#22d3ee',
  MEO: '#facc15',
  GEO: '#fb923c',
  HEO: '#a78bfa',
};

export const EARTH_RADIUS_KM = 6371;
export const ORBIT_DISPLAY_SCALE = 1 / EARTH_RADIUS_KM;
