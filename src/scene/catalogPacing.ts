/**
 * How often the whole catalogue (tens of thousands of instanced dots) is
 * re-propagated and re-uploaded. A full pass costs ~1-3 ms on a desktop but
 * tens of ms on a slow phone; doing it every animation frame there leaves no
 * time to draw. At globe zoom a satellite moves well under a pixel per frame,
 * so updating a few times per second looks the same.
 *
 * The interval adapts to the measured cost on this device: keep catalogue
 * work to roughly a quarter of the time, with a ceiling so motion never looks
 * frozen. Changes the user makes (selection, filters, search…) and zoomed-in
 * views bypass the pacing entirely.
 */

/** Catalogue work may take at most 1 / BUDGET_FACTOR of the time. */
export const CATALOG_BUDGET_FACTOR = 4;
/** Slowest update rate, even on very slow devices (5 per second). */
export const MAX_CATALOG_INTERVAL_MS = 200;
/** How fast the cost estimate follows new measurements (0..1). */
const COST_SMOOTHING = 0.2;

export class CatalogPacer {
  private costMs = 0;
  private lastUpdateAt = Number.NEGATIVE_INFINITY;
  private lastKey = '';

  /** Minimum time between catalogue updates for the current cost estimate. */
  intervalMs(): number {
    return Math.min(MAX_CATALOG_INTERVAL_MS, this.costMs * CATALOG_BUDGET_FACTOR);
  }

  /**
   * True when the catalogue should be updated this frame: something the user
   * changed (`key`), a zoomed-in view, or enough time since the last update.
   */
  isDue(now: number, key: string, zoomedIn: boolean): boolean {
    if (zoomedIn || key !== this.lastKey) return true;
    return now - this.lastUpdateAt >= this.intervalMs();
  }

  /** Record an update and how long it took. */
  done(now: number, key: string, costMs: number): void {
    this.lastUpdateAt = now;
    this.lastKey = key;
    if (Number.isFinite(costMs) && costMs >= 0) {
      this.costMs = this.costMs === 0 ? costMs : this.costMs + COST_SMOOTHING * (costMs - this.costMs);
    }
  }

  /** For tests and diagnostics. */
  get estimatedCostMs(): number {
    return this.costMs;
  }
}
