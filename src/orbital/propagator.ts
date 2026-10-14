import {
  eciToGeodetic,
  gstime,
  propagate,
  type EciVec3,
  type SatRec,
} from 'satellite.js';
import { classifyOrbit } from './classify';
import type { ObjectSnapshot, OrbitLayer } from '../types';

export interface PropagationResult {
  positionEci: { x: number; y: number; z: number };
  velocityEci: { x: number; y: number; z: number };
  altitudeKm: number;
  velocityKmS: number;
  inclinationDeg: number;
  layer: OrbitLayer;
}

export type PropagationState = Pick<PropagationResult, 'positionEci' | 'velocityEci'>;

/**
 * Geocentric radius below which an object is treated as re-entered (equatorial
 * radius + 70 km; ~91 km geodetic over the poles). SGP4 only reports decay
 * once the orbit is inside the Earth, so a re-entering TLE keeps producing
 * 30–100 km "positions" for a day or two that would otherwise be drawn and
 * screened for close approaches. Nothing completes an orbit this low.
 */
export const REENTRY_RADIUS_KM = 6378.137 + 70;

function hasReentered(p: EciVec3<number>): boolean {
  return Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z) < REENTRY_RADIUS_KM;
}

/** ECI position/velocity only — skips the geodetic conversion, for hot loops
 *  (conjunction sweeps) that never need altitude or layer. */
export function propagateState(satrec: SatRec, date: Date): PropagationState | null {
  const result = propagate(satrec, date);
  if (!result || !result.position || !result.velocity) return null;
  const position = result.position as EciVec3<number>;
  const velocity = result.velocity as EciVec3<number>;
  if (hasReentered(position)) return null;
  return {
    positionEci: { x: position.x, y: position.y, z: position.z },
    velocityEci: { x: velocity.x, y: velocity.y, z: velocity.z },
  };
}

export function propagateObject(satrec: SatRec, date: Date): PropagationResult | null {
  const result = propagate(satrec, date);
  if (!result || !result.position || !result.velocity) {
    return null;
  }

  const position = result.position as EciVec3<number>;
  const velocity = result.velocity as EciVec3<number>;
  if (hasReentered(position)) return null;

  const gmst = gstime(date);
  const geodetic = eciToGeodetic(position, gmst);
  const altitudeKm = geodetic.height;
  const eccentricity = satrec.ecco ?? 0;
  const layer = classifyOrbit(altitudeKm, eccentricity);

  const vx = velocity.x;
  const vy = velocity.y;
  const vz = velocity.z;
  const velocityKmS = Math.sqrt(vx * vx + vy * vy + vz * vz);

  return {
    positionEci: { x: position.x, y: position.y, z: position.z },
    velocityEci: { x: vx, y: vy, z: vz },
    altitudeKm,
    velocityKmS,
    inclinationDeg: satrec.inclo != null ? (satrec.inclo * 180) / Math.PI : 0,
    layer,
  };
}

export function toObjectSnapshot(
  noradId: number,
  name: string,
  category: ObjectSnapshot['category'],
  country: string,
  owner: string,
  propagation: PropagationResult,
): ObjectSnapshot {
  return {
    noradId,
    name,
    altitudeKm: propagation.altitudeKm,
    velocityKmS: propagation.velocityKmS,
    layer: propagation.layer,
    category,
    country,
    owner,
    inclinationDeg: propagation.inclinationDeg,
    positionEci: propagation.positionEci,
  };
}
