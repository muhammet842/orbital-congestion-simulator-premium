/**
 * Prints the true direction of a landmark, to fill in before measuring.
 *
 * Usage: npm run research:spotter-direction -- --from <lat,lon,height_m> --to <lat,lon,height_m>
 * e.g.   npm run research:spotter-direction -- --from 40.88765,29.30012,35 --to 40.90510,29.33120,180
 *
 * Coordinates in decimal degrees (as Google Maps shows them), heights in
 * metres above sea level. Method: research/spotter/PROTOCOL.md, step 2.
 */
import { fileURLToPath } from 'node:url';
import { trueDirection } from './lib.mjs';

function point(name) {
  const i = process.argv.indexOf(`--${name}`);
  const [latDeg, lonDeg, heightM = 0] = (i >= 0 ? process.argv[i + 1] : '').split(',').map(Number);
  if (!Number.isFinite(latDeg) || !Number.isFinite(lonDeg) || !Number.isFinite(heightM)) {
    throw new Error(`--${name} must look like 40.88765,29.30012,35 (latitude, longitude, height in metres)`);
  }
  return { latDeg, lonDeg, heightM };
}

function main() {
  const d = trueDirection(point('from'), point('to'));
  // 359.999…° rounds to "360.00"; due north is written as 0.00.
  const azimuth = Number(d.azimuthDeg.toFixed(2)) % 360;
  console.log(`Gerçek azimut (coğrafi kuzeyden, saat yönünde): ${azimuth.toFixed(2)}°`);
  console.log(`Gerçek yükseklik açısı (ufkun üstü):            ${d.elevationDeg.toFixed(2)}°`);
  console.log(`Uzaklık:                                        ${d.distanceKm.toFixed(3)} km`);
  // A 10 m error in either position moves the direction by about this much.
  console.log(`10 m konum hatasının yön etkisi (yaklaşık):     ${((0.01 / d.distanceKm) * (180 / Math.PI)).toFixed(2)}°`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main();
  } catch (err) {
    console.error(`true-direction: ${err.message}`);
    process.exit(1);
  }
}
