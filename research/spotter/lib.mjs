/**
 * Spotter accuracy: the calculations for research/spotter/PROTOCOL.md.
 * The true direction of a landmark from two map coordinates, and the error of
 * the direction the phone showed, using the app's own angle functions.
 */
import { headingDelta, skyAngularSeparationDeg } from '../../src/orbital/lookAngles.ts';

// WGS-84 ellipsoid, the shape GPS and online maps use.
const A_KM = 6378.137;
const F = 1 / 298.257223563;
const E2 = F * (2 - F);
const RAD = Math.PI / 180;

/** Earth-centred x, y, z (km) of a point: latitude and longitude in degrees, height above sea level in metres. */
function toEcef(latDeg, lonDeg, heightM) {
  const lat = latDeg * RAD;
  const lon = lonDeg * RAD;
  const n = A_KM / Math.sqrt(1 - E2 * Math.sin(lat) ** 2);
  const h = heightM / 1000;
  return [
    (n + h) * Math.cos(lat) * Math.cos(lon),
    (n + h) * Math.cos(lat) * Math.sin(lon),
    (n * (1 - E2) + h) * Math.sin(lat),
  ];
}

/**
 * True direction from an observer to a target, both { latDeg, lonDeg, heightM }:
 * azimuth from true (geographic) north, clockwise, 0–360°; elevation above the
 * horizon; and the distance. The line between the two points is turned into
 * the observer's own east / north / up directions, so the Earth's curvature
 * is included. (Light bending in the air is not; over a few km it is below 0.05°.)
 */
export function trueDirection(observer, target) {
  const o = toEcef(observer.latDeg, observer.lonDeg, observer.heightM ?? 0);
  const t = toEcef(target.latDeg, target.lonDeg, target.heightM ?? 0);
  const d = [t[0] - o[0], t[1] - o[1], t[2] - o[2]];
  const lat = observer.latDeg * RAD;
  const lon = observer.lonDeg * RAD;
  const east = -Math.sin(lon) * d[0] + Math.cos(lon) * d[1];
  const north = -Math.sin(lat) * Math.cos(lon) * d[0] - Math.sin(lat) * Math.sin(lon) * d[1] + Math.cos(lat) * d[2];
  const up = Math.cos(lat) * Math.cos(lon) * d[0] + Math.cos(lat) * Math.sin(lon) * d[1] + Math.sin(lat) * d[2];
  const az = Math.atan2(east, north) / RAD;
  return {
    azimuthDeg: (az + 360) % 360,
    elevationDeg: Math.atan2(up, Math.hypot(east, north)) / RAD,
    distanceKm: Math.hypot(...d),
  };
}

/**
 * How far off the phone was (degrees). Positive azimuth error: the phone
 * showed a direction clockwise of (to the right of) the true one. Positive
 * elevation error: it showed higher. `total` is the angle on the sky between
 * the two directions, the number a person would notice.
 */
export function pointingError(trueAzDeg, trueElDeg, phoneAzDeg, phoneElDeg) {
  return {
    azimuth: headingDelta(trueAzDeg, phoneAzDeg),
    elevation: phoneElDeg - trueElDeg,
    total: skyAngularSeparationDeg(trueAzDeg, trueElDeg, phoneAzDeg, phoneElDeg),
  };
}

/**
 * Rows of a CSV file as objects keyed by the header; quoted fields may contain
 * the separator. The separator is a comma, or a semicolon when the header line
 * uses semicolons: Excel set to Turkish saves CSV files that way, with decimal
 * commas in the numbers.
 */
export function parseCsv(text) {
  const lines = text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '' && !l.startsWith('#'));
  const sep = lines[0]?.includes(';') ? ';' : ',';
  const rows = [];
  for (const line of lines) {
    const fields = [];
    let field = '';
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') {
          field += '"';
          i += 1;
        } else if (ch === '"') quoted = false;
        else field += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === sep) {
        fields.push(field);
        field = '';
      } else field += ch;
    }
    fields.push(field);
    rows.push(fields.map((f) => f.trim()));
  }
  const [header, ...body] = rows;
  return body.map((fields) => Object.fromEntries(header.map((h, i) => [h, fields[i] ?? ''])));
}

/** A number written with a dot or a decimal comma (Excel in Turkish writes "12,5"); NaN when empty. */
export function readNumber(text) {
  const s = String(text ?? '').trim().replace(',', '.');
  return s === '' ? Number.NaN : Number(s);
}
