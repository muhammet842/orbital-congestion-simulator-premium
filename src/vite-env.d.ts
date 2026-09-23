/// <reference types="vite/client" />

/** World Magnetic Model declination (degrees, east-positive). */
declare module 'magvar' {
  export function magvar(latitudeDeg: number, longitudeDeg: number, altitudeKm?: number): number;
}
