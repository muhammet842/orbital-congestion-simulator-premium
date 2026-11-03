/**
 * A small SVG line chart with no libraries: median position difference per
 * TLE age, one line per orbit group, with a shaded band from the first to
 * the third quartile. The y axis is logarithmic because the differences range
 * from under a kilometre to thousands of kilometres.
 */

const W = 760;
const H = 460;
const PAD = { left: 70, right: 170, top: 56, bottom: 74 };

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * series: [{ label, color, points: [{ x, median, q1, q3 }] }], x in days.
 * Returns the SVG text.
 */
export function lineChart({ title, subtitle, note, xLabel, yLabel, xMax, series }) {
  const values = series.flatMap((s) => s.points.flatMap((p) => [p.q1, p.q3, p.median])).filter((v) => v > 0);
  const yMinExp = Math.floor(Math.log10(Math.min(...values)));
  const yMaxExp = Math.ceil(Math.log10(Math.max(...values)));
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (days) => PAD.left + (days / xMax) * plotW;
  const y = (km) => PAD.top + plotH - ((Math.log10(km) - yMinExp) / (yMaxExp - yMinExp)) * plotH;

  const parts = [];
  for (let e = yMinExp; e <= yMaxExp; e += 1) {
    const yy = y(10 ** e).toFixed(1);
    // Turkish number format, like the report: 10.000 and 0,1.
    const label = e >= 0 ? (10 ** e).toLocaleString('tr-TR') : String(10 ** e).replace('.', ',');
    parts.push(`<line x1="${PAD.left}" x2="${PAD.left + plotW}" y1="${yy}" y2="${yy}" stroke="#ddd"/>`);
    parts.push(`<text x="${PAD.left - 8}" y="${yy}" text-anchor="end" dominant-baseline="middle">${label}</text>`);
  }
  for (let d = 0; d <= xMax; d += 2) {
    const xx = x(d).toFixed(1);
    parts.push(`<line x1="${xx}" x2="${xx}" y1="${PAD.top + plotH}" y2="${PAD.top + plotH + 5}" stroke="#666"/>`);
    parts.push(`<text x="${xx}" y="${PAD.top + plotH + 20}" text-anchor="middle">${d}</text>`);
  }

  series.forEach((s, i) => {
    const pts = s.points.filter((p) => p.median > 0 && p.q1 > 0);
    if (pts.length === 0) return;
    const band = [...pts.map((p) => `${x(p.x).toFixed(1)},${y(p.q3).toFixed(1)}`), ...[...pts].reverse().map((p) => `${x(p.x).toFixed(1)},${y(p.q1).toFixed(1)}`)];
    parts.push(`<polygon points="${band.join(' ')}" fill="${s.color}" fill-opacity="0.15"/>`);
    parts.push(`<polyline points="${pts.map((p) => `${x(p.x).toFixed(1)},${y(p.median).toFixed(1)}`).join(' ')}" fill="none" stroke="${s.color}" stroke-width="2.2"/>`);
    for (const p of pts) parts.push(`<circle cx="${x(p.x).toFixed(1)}" cy="${y(p.median).toFixed(1)}" r="3" fill="${s.color}"/>`);
    const ly = PAD.top + 10 + i * 22;
    parts.push(`<line x1="${W - PAD.right + 16}" x2="${W - PAD.right + 40}" y1="${ly}" y2="${ly}" stroke="${s.color}" stroke-width="3"/>`);
    parts.push(`<text x="${W - PAD.right + 46}" y="${ly}" dominant-baseline="middle">${esc(s.label)}</text>`);
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Arial, sans-serif" font-size="12" fill="#222">
<rect width="${W}" height="${H}" fill="#fff"/>
<text x="${PAD.left}" y="24" font-size="16" font-weight="bold">${esc(title)}</text>
<text x="${PAD.left}" y="42" fill="#555">${esc(subtitle)}</text>
<rect x="${PAD.left}" y="${PAD.top}" width="${plotW}" height="${plotH}" fill="none" stroke="#999"/>
${parts.join('\n')}
<text x="${PAD.left + plotW / 2}" y="${H - 34}" text-anchor="middle">${esc(xLabel)}</text>
<text transform="translate(18 ${PAD.top + plotH / 2}) rotate(-90)" text-anchor="middle">${esc(yLabel)}</text>
<text x="${PAD.left}" y="${H - 10}" fill="#a33" font-size="11">${esc(note)}</text>
</svg>
`;
}
