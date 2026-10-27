/**
 * The Spotter's sky chart: the patch of sky the phone points at, with the
 * horizon, a compass scale and the satellites above the horizon.
 */
import { getFunctionGroupColor } from '../../orbital/classify';
import { CARDINAL_AZIMUTHS, horizonYForPitch, projectAzElToCanvas } from '../../orbital/skyProjection';
import type { SkyScanHit } from '../../orbital/skyScan';
import { t } from '../../i18n/i18n';
import type { ObjectFunctionGroup } from '../../types';

export const SKY_CSS_W = 320;
export const SKY_CSS_H = 280;

export interface SkyChartView {
  headingDeg: number | null;
  pitchDeg: number;
  selectedNoradId: number | null;
  compassOk: boolean;
  fovDeg: number;
  hits: SkyScanHit[];
}

function groupCssColor(group: ObjectFunctionGroup, alpha = 0.9): string {
  const [r, g, b] = getFunctionGroupColor(group);
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${alpha})`;
}

/** Draws the chart; returns the caption ("3 of 12 shown"), empty without a compass. */
export function drawSkyChart(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, chart: SkyChartView): string {
  const { headingDeg, pitchDeg, selectedNoradId, compassOk, fovDeg, hits } = chart;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = SKY_CSS_W;
  const cssH = SKY_CSS_H;
  const bw = Math.round(cssW * dpr);
  const bh = Math.round(cssH * dpr);
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  // Night sky background
  const grad = ctx.createLinearGradient(0, 0, 0, cssH);
  grad.addColorStop(0, '#070b18');
  grad.addColorStop(1, '#12182a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, cssW, cssH);

  if (!compassOk || headingDeg == null) {
    ctx.fillStyle = 'rgba(248, 250, 252, 0.75)';
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(t('spotter.sky_no_compass'), cssW / 2, cssH / 2);
    return '';
  }

  const view = { headingDeg, pitchDeg };
  const fov = fovDeg;

  // Horizon
  const hy = horizonYForPitch(pitchDeg, cssH, fov);
  if (hy >= 0 && hy <= cssH) {
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(201, 184, 150, 0.55)';
    ctx.lineWidth = 1.25;
    ctx.moveTo(0, hy);
    ctx.lineTo(cssW, hy);
    ctx.stroke();
    ctx.fillStyle = 'rgba(201, 184, 150, 0.7)';
    ctx.font = '600 10px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(t('spotter.sky_horizon'), 8, Math.min(cssH - 6, hy - 4));
  }

  // Cardinals
  ctx.font = '700 11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const c of CARDINAL_AZIMUTHS) {
    const p = projectAzElToCanvas(
      view,
      { azimuthDeg: c.az, elevationDeg: Math.max(2, pitchDeg) },
      cssW,
      cssH,
      fov,
    );
    if (!p.inView) continue;
    ctx.fillStyle = 'rgba(248, 250, 252, 0.55)';
    ctx.fillText(c.key, p.x, Math.max(12, Math.min(cssH - 12, p.y)));
  }

  const cx = cssW / 2;
  const cy = cssH / 2;
  /** Angular radius under the crosshair that shows a name label. */
  const aimLabelMaxDeg = Math.max(2.2, fov * 0.055);

  let drawn = 0;
  let aimed: { hit: SkyScanHit; distDeg: number } | null = null;
  let selectedLabel: { name: string; x: number; y: number } | null = null;

  for (const hit of hits) {
    const p = projectAzElToCanvas(
      view,
      { azimuthDeg: hit.look.azimuthDeg, elevationDeg: hit.look.elevationDeg },
      cssW,
      cssH,
      fov,
    );
    if (!p.inView) continue;
    drawn++;
    const distDeg = Math.hypot(p.dAzDeg, p.dElDeg);
    if (distDeg <= aimLabelMaxDeg && (!aimed || distDeg < aimed.distDeg)) {
      aimed = { hit, distDeg };
    }

    const isSel = hit.noradId === selectedNoradId;
    const isStation = hit.functionGroup === 'station';
    const fill = groupCssColor(hit.functionGroup, isSel ? 0.98 : 0.88);
    const radius = isSel ? 3.5 : isStation ? 3.1 : 2.2;

    if (isSel) {
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(232, 164, 90, 0.95)';
      ctx.lineWidth = 2;
      ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
      ctx.stroke();
      selectedLabel = { name: hit.name, x: p.x, y: p.y };
    }

    ctx.beginPath();
    ctx.fillStyle = fill;
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  // Crosshair (look center)
  ctx.strokeStyle = 'rgba(248, 250, 252, 0.45)';
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  ctx.moveTo(cx - 10, cy);
  ctx.lineTo(cx + 10, cy);
  ctx.moveTo(cx, cy - 10);
  ctx.lineTo(cx, cy + 10);
  ctx.stroke();

  // Side label for selected target when it is not under the crosshair.
  if (selectedLabel && aimed?.hit.noradId !== selectedNoradId) {
    ctx.fillStyle = 'rgba(248, 250, 252, 0.88)';
    ctx.font = '600 10px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(selectedLabel.name.slice(0, 18), selectedLabel.x + 12, selectedLabel.y);
  }

  // Name of object under the crosshair
  if (aimed) {
    const label = aimed.hit.name.slice(0, 22);
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const ty = Math.max(18, cy - 14);
    const tw = ctx.measureText(label).width;
    const padX = 6;
    const padY = 3;
    ctx.fillStyle = 'rgba(7, 11, 24, 0.72)';
    ctx.fillRect(cx - tw / 2 - padX, ty - 11 - padY, tw + padX * 2, 14 + padY * 2);
    ctx.fillStyle = groupCssColor(aimed.hit.functionGroup, 1);
    ctx.fillText(label, cx, ty);
  }

  return t('spotter.sky_count')
    .replace('{n}', String(drawn))
    .replace('{total}', String(hits.length));
}
