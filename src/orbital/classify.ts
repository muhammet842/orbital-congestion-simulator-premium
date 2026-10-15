import type { ObjectCategory, ObjectFunctionGroup, OrbitLayer } from '../types';

/** `hasAmateurRadio`: the satellite carries a channel the sources mark as amateur. */
export function inferFunctionGroup(name: string, category: ObjectCategory, hasAmateurRadio = false): ObjectFunctionGroup {
  if (category === 'debris') return 'debris';
  if (category === 'stations') return 'station';
  if (/STARLINK/i.test(name)) return 'starlink';
  if (hasAmateurRadio) return 'amateur';
  return 'active';
}

export function getFunctionGroupColor(group: ObjectFunctionGroup): [number, number, number] {
  switch (group) {
    // Okabe–Ito colours: told apart with red–green colour blindness too, and
    // also by brightness (blue / orange / yellow / pink / white).
    case 'starlink':
      return [0.34, 0.71, 0.91]; // sky blue  #56B4E9
    case 'debris':
      return [0.8, 0.47, 0.65]; // reddish purple  #CC79A7
    case 'station':
      return [0.94, 0.89, 0.26]; // yellow  #F0E442
    case 'active':
      return [0.9, 0.62, 0.0]; // orange  #E69F00
    case 'amateur':
      return [0.95, 0.97, 1.0]; // near-white, drawn larger (see AMATEUR_POINT_SCALE)
  }
}

export function getFunctionGroupPulse(group: ObjectFunctionGroup, timeMs: number): number {
  if (group === 'station') {
    return 0.84 + 0.16 * Math.sin(timeMs * 0.004);
  }
  if (group === 'starlink') {
    return 0.9 + 0.1 * Math.sin(timeMs * 0.003);
  }
  return 1;
}

export function classifyOrbit(altitudeKm: number, eccentricity: number): OrbitLayer {
  if (eccentricity > 0.25) return 'HEO';
  if (altitudeKm < 2000) return 'LEO';
  if (altitudeKm < 35786 * 0.9) return 'MEO';
  if (Math.abs(altitudeKm - 35786) < 500) return 'GEO';
  return 'HEO';
}

export function getLayerColor(layer: OrbitLayer): [number, number, number] {
  const colors: Record<OrbitLayer, [number, number, number]> = {
    LEO: [0.133, 0.827, 0.933],
    MEO: [0.98, 0.8, 0.082],
    GEO: [0.984, 0.573, 0.235],
    HEO: [0.655, 0.545, 0.98],
  };
  return colors[layer];
}

export function getCategoryColor(
  category: ObjectCategory,
  layer: OrbitLayer,
  _country = '',
): [number, number, number] {
  const [lr, lg, lb] = getLayerColor(layer);

  switch (category) {
    case 'stations':
      return [0.95, 0.98, 1.0];
    case 'active':
      return [0.38, 0.82, 1.0];
    case 'debris':
      if (layer === 'LEO') return [0.72, 0.48, 0.42];
      return [lr * 0.55 + 0.18, lg * 0.45 + 0.12, lb * 0.35 + 0.08];
    default:
      return [lr, lg, lb];
  }
}

export function getCategoryScale(category: ObjectCategory, _country = ''): number {
  switch (category) {
    case 'stations':
      return 2.4;
    case 'active':
      return 1.7;
    default:
      return 1;
  }
}

export function getCategoryPulse(category: ObjectCategory, timeMs: number, _country = ''): number {
  if (category === 'stations') {
    return 0.82 + 0.18 * Math.sin(timeMs * 0.004);
  }
  if (category === 'active') {
    return 0.92 + 0.08 * Math.sin(timeMs * 0.0025);
  }
  return 1;
}

/** Amateur-radio satellites are drawn larger in Color by Function, so they stand out by size as well as colour. */
export const AMATEUR_POINT_SCALE = 2.3;
