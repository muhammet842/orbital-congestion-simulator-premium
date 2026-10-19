import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Two ISS-like objects: enough for a real (tiny) sweep.
const L1 = '1 25544U 98067A   24001.50000000  .00016717  00000-0  10270-3 0  9007';
const L2 = '2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.49560856 12345';
const OBJECTS = [
  { noradId: 1, name: 'A', line1: L1, line2: L2, category: 'active', layer: 'LEO' },
  { noradId: 2, name: 'B', line1: L1, line2: L2, category: 'active', layer: 'LEO' },
];

describe('conjunction worker: pause while the page is hidden', () => {
  const posted: { type: string; scanId?: number }[] = [];
  let send: (data: unknown) => void;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    posted.length = 0;
    const fakeSelf: { onmessage: ((e: MessageEvent) => void) | null; postMessage: (m: never) => void } = {
      onmessage: null,
      postMessage: (m) => posted.push(m),
    };
    vi.stubGlobal('self', fakeSelf);
    await import('./conjunction.worker');
    send = (data) => fakeSelf.onmessage!({ data } as MessageEvent);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const start = Date.UTC(2024, 0, 1, 12);

  it('does no work while paused and finishes after resuming', async () => {
    send({ type: 'pause' });
    send({ type: 'scan', scanId: 7, startMs: start, horizonMs: 6 * 3_600_000, sampleStepMs: 60_000, objects: OBJECTS });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(posted.filter((m) => m.type === 'done')).toHaveLength(0);

    send({ type: 'resume' });
    for (let i = 0; i < 200 && !posted.some((m) => m.type === 'done'); i++) await vi.advanceTimersByTimeAsync(100);
    expect(posted.find((m) => m.type === 'done')?.scanId).toBe(7);
  });

  it('runs straight through when never paused', async () => {
    send({ type: 'scan', scanId: 3, startMs: start, horizonMs: 6 * 3_600_000, sampleStepMs: 60_000, objects: OBJECTS });
    for (let i = 0; i < 200 && !posted.some((m) => m.type === 'done'); i++) await vi.advanceTimersByTimeAsync(100);
    expect(posted.find((m) => m.type === 'done')?.scanId).toBe(3);
  });
});
