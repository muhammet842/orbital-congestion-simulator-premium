import type { PerspectiveCamera, Vector3, WebGLRenderer } from 'three';
import type { EventType } from '../ui/EventCards';
import { escapeHtml } from '../ui/escapeHtml';
import { t } from '../i18n/i18n';

const GM = 398600;           // km³ s⁻²
const EARTH_RADIUS_KM = 6371;

/** Project a Three.js scene-space Vector3 to canvas pixel coordinates. */
function projectToScreen(
  pos: Vector3,
  camera: PerspectiveCamera,
  renderer: WebGLRenderer,
): { x: number; y: number; visible: boolean } {
  const ndc = pos.clone().project(camera);
  const w = renderer.domElement.clientWidth;
  const h = renderer.domElement.clientHeight;
  return {
    x: (ndc.x + 1) * 0.5 * w,
    y: (1 - ndc.y) * 0.5 * h,
    // z < 1 means in front of the far clip plane; z > 0 means in front of camera
    visible: ndc.z > 0 && ndc.z < 1,
  };
}

/** Altitude above Earth surface from a scene-space position (1 unit = 6371 km). */
function altKmFromScenePos(pos: Vector3): number {
  return Math.max(0, (pos.length() - 1) * EARTH_RADIUS_KM);
}

/** Circular orbital speed at given altitude. */
function orbitalVelocityKmS(altKm: number): number {
  return Math.sqrt(GM / (EARTH_RADIUS_KM + altKm));
}

const EVENT_TYPE_META: Record<EventType, { typeA: string; typeB: string; iconA: string; iconB: string }> = {
  // typeA / typeB are translation keys ('' = no second object).
  collision: { typeA: 'replay.kind.satellite',  typeB: 'replay.kind.satellite',   iconA: '🛰', iconB: '🛰' },
  asat:      { typeA: 'replay.kind.satellite',  typeB: 'replay.kind.interceptor', iconA: '🛰', iconB: '⚡' },
  docking:   { typeA: 'replay.kind.spacecraft', typeB: 'replay.kind.target',      iconA: '🚀', iconB: '🛰' },
  breakup:   { typeA: 'replay.kind.satellite',  typeB: '',                        iconA: '🛰', iconB: '' },
};

function buildPanelHTML(
  name: string,
  icon: string,
  type: string,
  altKm: number,
  velKmS: number,
): string {
  return `
    <div class="era-lp__header">
      <span class="era-lp__icon">${escapeHtml(icon)}</span>
      <span class="era-lp__name">${escapeHtml(name)}</span>
    </div>
    <div class="era-lp__row">
      <span class="era-lp__key">${escapeHtml(t('replay.type'))}</span>
      <span class="era-lp__val">${escapeHtml(type ? t(type) : '')}</span>
    </div>
    <div class="era-lp__row">
      <span class="era-lp__key">${escapeHtml(t('sat.altitude'))}</span>
      <span class="era-lp__val">${Math.round(altKm)} km</span>
    </div>
    <div class="era-lp__row">
      <span class="era-lp__key">${escapeHtml(t('sat.velocity'))}</span>
      <span class="era-lp__val">${velKmS.toFixed(1)} km/s</span>
    </div>
  `;
}

/**
 * Floating info panels that follow the two objects during an event replay.
 *
 * Each panel is an absolutely-positioned HTML element whose top-left corner
 * is computed by projecting the object's 3-D scene position onto the canvas
 * every frame. An SVG leader line connects the panel to the dot.
 *
 * Usage:
 *   const labels = new EventReplayLabels(canvasContainer);
 *   // each frame:
 *   labels.update(posA, posB, nameA, nameB, isAsat, camera, renderer, impactFlash);
 *   // when exiting replay:
 *   labels.hide();
 */
export class EventReplayLabels {
  readonly root: HTMLElement;
  private readonly svg: SVGSVGElement;
  private readonly lineA: SVGLineElement;
  private readonly lineB: SVGLineElement;
  private readonly panelA: HTMLDivElement;
  private readonly panelB: HTMLDivElement;

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'era-labels';
    this.root.hidden = true;

    // Full-viewport SVG overlay for the leader lines
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.classList.add('era-labels__svg');

    this.lineA = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    this.lineB = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    this.lineA.classList.add('era-labels__leader', 'era-labels__leader--a');
    this.lineB.classList.add('era-labels__leader', 'era-labels__leader--b');
    this.svg.append(this.lineA, this.lineB);

    this.panelA = document.createElement('div');
    this.panelB = document.createElement('div');
    this.panelA.className = 'era-lp era-lp--a';
    this.panelB.className = 'era-lp era-lp--b';

    this.root.append(this.svg, this.panelA, this.panelB);
    container.appendChild(this.root);
  }

  /**
   * Recompute screen positions and refresh panel content.
   *
   * @param posA      Current scene position of object A (satellite).
   * @param posB      Current scene position of object B (satellite or missile).
   * @param nameA     Display name for object A.
   * @param nameB     Display name for object B, or null for ASAT missiles.
   * @param eventType  Visual category of the event (collision | asat | docking | breakup).
   * @param impactFlash  0..1 flash intensity — panels are hidden at full flash.
   */
  update(
    posA: Vector3 | null,
    posB: Vector3 | null,
    nameA: string,
    nameB: string | null,
    eventType: EventType,
    camera: PerspectiveCamera,
    renderer: WebGLRenderer,
    impactFlash: number,
  ): void {
    if (!posA || impactFlash > 0.6) {
      this.root.hidden = true;
      return;
    }

    const screenA = projectToScreen(posA, camera, renderer);
    if (!screenA.visible) {
      this.root.hidden = true;
      return;
    }

    this.root.hidden = false;

    const meta = EVENT_TYPE_META[eventType] ?? EVENT_TYPE_META.collision;
    const altA = altKmFromScenePos(posA);
    const velA = orbitalVelocityKmS(altA);
    this.panelA.innerHTML = buildPanelHTML(nameA, meta.iconA, meta.typeA, altA, velA);
    this.panelA.hidden = false;

    // --- Position panel A to upper-left of its dot ---
    const W = this.panelA.offsetWidth  || 170;
    const H = this.panelA.offsetHeight || 90;
    const LEAD = 28; // px gap between panel edge and dot

    const pAX = screenA.x - W - LEAD;
    const pAY = screenA.y - H - LEAD;
    this.panelA.style.left = `${pAX}px`;
    this.panelA.style.top  = `${pAY}px`;

    // Leader line A: from panel bottom-right corner → dot
    const anchorAX = pAX + W;
    const anchorAY = pAY + H;
    this.setLine(this.lineA, anchorAX, anchorAY, screenA.x, screenA.y);

    // --- Panel B ---
    if (posB) {
      const screenB = projectToScreen(posB, camera, renderer);
      if (screenB.visible) {
        const altB = altKmFromScenePos(posB);
        const type   = meta.typeB;
        const icon   = meta.iconB;
        // ASAT interceptors travel faster than orbital speed (~9 km/s)
        const velB   = eventType === 'asat'
          ? Math.min(9.5, orbitalVelocityKmS(altB) * 1.2)
          : orbitalVelocityKmS(altB);
        const label  = nameB ?? (eventType === 'asat' ? t('replay.asat_missile') : t('replay.object_b'));

        this.panelB.innerHTML = buildPanelHTML(label, icon, type, altB, velB);
        this.panelB.hidden = false;

        const HB = this.panelB.offsetHeight || 90;

        // Panel B: upper-right of its dot
        const pBX = screenB.x + LEAD;
        const pBY = screenB.y - HB - LEAD;
        this.panelB.style.left = `${pBX}px`;
        this.panelB.style.top  = `${pBY}px`;

        // Leader line B: from panel bottom-left corner → dot
        const anchorBX = pBX;
        const anchorBY = pBY + HB;
        this.setLine(this.lineB, anchorBX, anchorBY, screenB.x, screenB.y);
      } else {
        this.hideB();
      }
    } else {
      this.hideB();
    }
  }

  hide(): void {
    this.root.hidden = true;
  }

  private hideB(): void {
    this.panelB.hidden = true;
    this.setLine(this.lineB, 0, 0, 0, 0);
  }

  private setLine(
    line: SVGLineElement,
    x1: number, y1: number,
    x2: number, y2: number,
  ): void {
    line.setAttribute('x1', String(Math.round(x1)));
    line.setAttribute('y1', String(Math.round(y1)));
    line.setAttribute('x2', String(Math.round(x2)));
    line.setAttribute('y2', String(Math.round(y2)));
  }
}
