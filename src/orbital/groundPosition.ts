/** "41.2° N, 29.0° E" for a sub-satellite point (degrees, longitude -180..180). */
export function formatGroundPosition(latitudeDeg: number, longitudeDeg: number): string {
  if (!Number.isFinite(latitudeDeg) || !Number.isFinite(longitudeDeg)) return '—';
  const ns = latitudeDeg < 0 ? 'S' : 'N';
  const ew = longitudeDeg < 0 ? 'W' : 'E';
  return `${Math.abs(latitudeDeg).toFixed(1)}° ${ns}, ${Math.abs(longitudeDeg).toFixed(1)}° ${ew}`;
}

/** Geostationary satellites are described by longitude alone: "42.0° E". */
export function formatSlot(longitudeDeg: number): string {
  if (!Number.isFinite(longitudeDeg)) return '—';
  return `${Math.abs(longitudeDeg).toFixed(1)}° ${longitudeDeg < 0 ? 'W' : 'E'}`;
}

/** Wraps any longitude into -180..180. */
export function normalizeLongitudeDeg(deg: number): number {
  return ((((deg + 180) % 360) + 360) % 360) - 180;
}
