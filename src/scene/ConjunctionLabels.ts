import type { PerspectiveCamera, WebGLRenderer } from 'three';
import { getConjunctionLabelPositions } from './ConjunctionVerification';
import type { ConjunctionEvent, TrackedObject } from '../types';

/** "2.67 km", or metres once the pair is under a kilometre apart. */
export function formatGap(km: number): string {
  if (!Number.isFinite(km)) return '';
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(2)} km`;
}

export class ConjunctionLabels {
  readonly root: HTMLElement;
  private readonly svg: SVGSVGElement;
  private readonly lineA: SVGLineElement;
  private readonly lineB: SVGLineElement;
  private readonly labelA: HTMLDivElement;
  private readonly labelB: HTMLDivElement;
  private readonly gapLine: SVGLineElement;
  private readonly gapLabel: HTMLDivElement;

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'conjunction-labels';
    this.root.hidden = true;

    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.classList.add('conjunction-labels__svg');

    this.lineA = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    this.lineB = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    this.lineA.classList.add('conjunction-labels__leader', 'conjunction-labels__leader--a');
    this.lineB.classList.add('conjunction-labels__leader', 'conjunction-labels__leader--b');
    this.gapLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    this.gapLine.classList.add('conjunction-labels__gap');
    this.svg.append(this.gapLine, this.lineA, this.lineB);

    this.labelA = document.createElement('div');
    this.labelB = document.createElement('div');
    this.labelA.className = 'conjunction-label conjunction-label--a';
    this.labelB.className = 'conjunction-label conjunction-label--b';

    this.gapLabel = document.createElement('div');
    this.gapLabel.className = 'conjunction-gap-label';

    this.root.append(this.svg, this.labelA, this.labelB, this.gapLabel);
    container.appendChild(this.root);
  }

  update(
    conjunction: ConjunctionEvent | null,
    objects: TrackedObject[],
    date: Date,
    camera: PerspectiveCamera,
    renderer: WebGLRenderer,
  ): void {
    if (!conjunction) {
      this.reset();
      return;
    }

    const layout = getConjunctionLabelPositions(conjunction, objects, date, camera, renderer);
    if (!layout || !layout.screenA.visible || !layout.screenB.visible) {
      this.root.hidden = true;
      return;
    }

    this.root.hidden = false;
    this.labelA.textContent = layout.nameA;
    this.labelB.textContent = layout.nameB;

    this.labelA.style.left = `${layout.labelA.x}px`;
    this.labelA.style.top = `${layout.labelA.y}px`;
    this.labelB.style.left = `${layout.labelB.x}px`;
    this.labelB.style.top = `${layout.labelB.y}px`;

    const anchorA = { x: layout.labelA.x + this.labelA.offsetWidth * 0.85, y: layout.labelA.y + 28 };
    const anchorB = { x: layout.labelB.x + 8, y: layout.labelB.y + 28 };

    this.lineA.setAttribute('x1', String(anchorA.x));
    this.lineA.setAttribute('y1', String(anchorA.y));
    this.lineA.setAttribute('x2', String(layout.screenA.x));
    this.lineA.setAttribute('y2', String(layout.screenA.y));

    this.lineB.setAttribute('x1', String(anchorB.x));
    this.lineB.setAttribute('y1', String(anchorB.y));
    this.lineB.setAttribute('x2', String(layout.screenB.x));
    this.lineB.setAttribute('y2', String(layout.screenB.y));

    // The true gap, drawn between the two objects whatever the camera angle.
    this.gapLine.setAttribute('x1', String(layout.screenA.x));
    this.gapLine.setAttribute('y1', String(layout.screenA.y));
    this.gapLine.setAttribute('x2', String(layout.screenB.x));
    this.gapLine.setAttribute('y2', String(layout.screenB.y));
    this.gapLabel.textContent = formatGap(layout.distanceKm);
    this.gapLabel.style.left = `${(layout.screenA.x + layout.screenB.x) / 2}px`;
    this.gapLabel.style.top = `${(layout.screenA.y + layout.screenB.y) / 2}px`;
  }

  reset(): void {
    this.root.hidden = true;
    this.labelA.textContent = '';
    this.labelB.textContent = '';
    this.gapLabel.textContent = '';
    this.gapLine.setAttribute('x1', '0');
    this.gapLine.setAttribute('y1', '0');
    this.gapLine.setAttribute('x2', '0');
    this.gapLine.setAttribute('y2', '0');
    this.lineA.setAttribute('x1', '0');
    this.lineA.setAttribute('y1', '0');
    this.lineA.setAttribute('x2', '0');
    this.lineA.setAttribute('y2', '0');
    this.lineB.setAttribute('x1', '0');
    this.lineB.setAttribute('y1', '0');
    this.lineB.setAttribute('x2', '0');
    this.lineB.setAttribute('y2', '0');
  }
}
