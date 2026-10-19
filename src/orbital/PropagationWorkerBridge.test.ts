import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackedObject } from '../types';

/**
 * Minimal fake Worker that mimics the browser Worker API surface used by
 * PropagationWorkerBridge: postMessage / onmessage / onerror / terminate.
 * We don't spin up a real thread — tests drive the "worker side" by
 * invoking `instance.onmessage(...)` directly to simulate replies.
 */
class MockWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onmessageerror: ((e: unknown) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
}

let lastWorkerInstance: MockWorker | null = null;
let workerInstances: MockWorker[] = [];

beforeEach(() => {
  lastWorkerInstance = null;
  workerInstances = [];
  vi.stubGlobal(
    'Worker',
    class extends MockWorker {
      constructor(..._args: unknown[]) {
        super();
        lastWorkerInstance = this;
        workerInstances.push(this);
      }
    },
  );
});

function makeObjects(n: number): TrackedObject[] {
  return Array.from({ length: n }, (_, i) => ({
    noradId: 10000 + i,
    name: `SAT-${i}`,
    line1: '1 25544U 98067A   24001.50000000  .00016717  00000-0  10270-3 0  9007',
    line2: '2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.49560856 12345',
  } as unknown as TrackedObject));
}

// STRIDE = 10 values per object, matching the worker's buffer layout.
function makeResultBuffer(count: number, fill: (i: number, base: number, buf: Float64Array) => void): Float64Array {
  const buf = new Float64Array(count * 10);
  for (let i = 0; i < count; i++) fill(i, i * 10, buf);
  return buf;
}

describe('PropagationWorkerBridge', () => {
  it('sends an init message with line1/line2 pairs when init() is called', async () => {
    const { PropagationWorkerBridge } = await import('./PropagationWorkerBridge');
    const bridge = new PropagationWorkerBridge();
    const objects = makeObjects(3);
    bridge.init(objects);

    expect(lastWorkerInstance!.postMessage).toHaveBeenCalledWith({
      type: 'init',
      generation: expect.any(Number),
      objects: objects.map((o) => ({ line1: o.line1, line2: o.line2 })),
    });
  });

  it('returns null from getLatestResults() before any worker reply', async () => {
    const { PropagationWorkerBridge } = await import('./PropagationWorkerBridge');
    const bridge = new PropagationWorkerBridge();
    bridge.init(makeObjects(2));
    expect(bridge.getLatestResults()).toBeNull();
  });

  it('does not dispatch a propagate message until the worker signals "ready"', async () => {
    const { PropagationWorkerBridge } = await import('./PropagationWorkerBridge');
    const bridge = new PropagationWorkerBridge();
    bridge.init(makeObjects(2));
    lastWorkerInstance!.postMessage.mockClear();

    bridge.request(Date.now(), 1);
    expect(lastWorkerInstance!.postMessage).not.toHaveBeenCalled();
  });

  it('dispatches a "propagate" message once ready, and decodes the returned buffer', async () => {
    const { PropagationWorkerBridge } = await import('./PropagationWorkerBridge');
    const bridge = new PropagationWorkerBridge();
    const objects = makeObjects(2);
    bridge.init(objects);

    // Simulate worker becoming ready
    lastWorkerInstance!.onmessage!({ data: { type: 'ready', count: 2 } } as MessageEvent);

    const tickMs = Date.UTC(2024, 0, 1, 12, 0, 0);
    bridge.request(tickMs, 1);

    const propagateCall = lastWorkerInstance!.postMessage.mock.calls.find(
      (c) => c[0].type === 'propagate',
    );
    expect(propagateCall).toBeDefined();
    const sentTickMs = propagateCall![0].tickMs;

    // Simulate the worker replying with decoded results for both objects.
    const buf = makeResultBuffer(2, (i, base, b) => {
      b[base + 0] = 1000 + i; // pos.x
      b[base + 1] = 2000 + i; // pos.y
      b[base + 2] = 3000 + i; // pos.z
      b[base + 3] = 1; // vel.x
      b[base + 4] = 2; // vel.y
      b[base + 5] = 3; // vel.z
      b[base + 6] = 400 + i; // altitudeKm
      b[base + 7] = 7.5; // velocityKmS
      b[base + 8] = 51.6; // inclinationDeg
      b[base + 9] = 0; // layerIndex = LEO
    });
    lastWorkerInstance!.onmessage!({
      data: { type: 'results', tickMs: sentTickMs, data: buf },
    } as MessageEvent);

    const results = bridge.getLatestResults();
    expect(results).not.toBeNull();
    expect(results).toHaveLength(2);
    expect(results![0]).toEqual({
      positionEci: { x: 1000, y: 2000, z: 3000 },
      velocityEci: { x: 1, y: 2, z: 3 },
      altitudeKm: 400,
      velocityKmS: 7.5,
      inclinationDeg: 51.6,
      layer: 'LEO',
    });
    expect(results![1]!.altitudeKm).toBe(401);
  });

  it('decodes a failed propagation slot (layerIndex = -1) as null', async () => {
    const { PropagationWorkerBridge } = await import('./PropagationWorkerBridge');
    const bridge = new PropagationWorkerBridge();
    bridge.init(makeObjects(1));
    lastWorkerInstance!.onmessage!({ data: { type: 'ready', count: 1 } } as MessageEvent);

    bridge.request(Date.now(), 1);
    const buf = new Float64Array(10);
    buf[9] = -1; // failed propagation marker
    lastWorkerInstance!.onmessage!({
      data: { type: 'results', tickMs: Date.now(), data: buf },
    } as MessageEvent);

    expect(bridge.getLatestResults()![0]).toBeNull();
  });

  it('queues the latest request while the worker is busy ("latest wins")', async () => {
    const { PropagationWorkerBridge } = await import('./PropagationWorkerBridge');
    const bridge = new PropagationWorkerBridge();
    bridge.init(makeObjects(1));
    lastWorkerInstance!.onmessage!({ data: { type: 'ready', count: 1 } } as MessageEvent);
    lastWorkerInstance!.postMessage.mockClear();

    const tickA = Date.UTC(2024, 0, 1, 0, 0, 0);
    const tickB = Date.UTC(2024, 0, 1, 0, 1, 0); // a minute later — should win
    bridge.request(tickA, 1); // dispatched immediately, worker becomes "pending"
    bridge.request(tickB, 1); // worker still busy — this should be queued, not dispatched

    const propagateCalls = lastWorkerInstance!.postMessage.mock.calls.filter(
      (c) => c[0].type === 'propagate',
    );
    expect(propagateCalls).toHaveLength(1); // only tickA was actually sent so far

    // Worker finishes tickA — bridge should immediately dispatch the queued tickB.
    const buf = new Float64Array(10);
    buf[9] = 0;
    lastWorkerInstance!.onmessage!({
      data: { type: 'results', tickMs: propagateCalls[0][0].tickMs, data: buf },
    } as MessageEvent);

    const propagateCallsAfter = lastWorkerInstance!.postMessage.mock.calls.filter(
      (c) => c[0].type === 'propagate',
    );
    expect(propagateCallsAfter).toHaveLength(2);
  });

  it('skips a request when the quantized tick matches the last processed tick', async () => {
    const { PropagationWorkerBridge } = await import('./PropagationWorkerBridge');
    const bridge = new PropagationWorkerBridge();
    bridge.init(makeObjects(1));
    lastWorkerInstance!.onmessage!({ data: { type: 'ready', count: 1 } } as MessageEvent);

    const tickMs = Date.UTC(2024, 0, 1, 0, 0, 0);
    bridge.request(tickMs, 1);
    const sentTickMs = lastWorkerInstance!.postMessage.mock.calls.find(
      (c) => c[0].type === 'propagate',
    )![0].tickMs;

    const buf = new Float64Array(10);
    buf[9] = 0;
    lastWorkerInstance!.onmessage!({
      data: { type: 'results', tickMs: sentTickMs, data: buf },
    } as MessageEvent);

    lastWorkerInstance!.postMessage.mockClear();
    bridge.request(tickMs, 1); // identical tick — should be a no-op
    expect(lastWorkerInstance!.postMessage).not.toHaveBeenCalled();
  });

  it('terminates the underlying worker on dispose()', async () => {
    const { PropagationWorkerBridge } = await import('./PropagationWorkerBridge');
    const bridge = new PropagationWorkerBridge();
    bridge.init(makeObjects(1));
    bridge.dispose();
    expect(lastWorkerInstance!.terminate).toHaveBeenCalledTimes(1);
  });
});

describe('PropagationWorkerBridge — failure handling', () => {
  function initGeneration(worker: MockWorker): number {
    const call = worker.postMessage.mock.calls.filter((c) => c[0].type === 'init').at(-1);
    return call![0].generation;
  }

  function reply(worker: MockWorker, generation: number, tickMs: number, count = 1): void {
    const buf = new Float64Array(count * 10);
    worker.onmessage!({ data: { type: 'results', generation, tickMs, data: buf } } as MessageEvent);
  }

  async function readyBridge() {
    const { PropagationWorkerBridge } = await import('./PropagationWorkerBridge');
    const bridge = new PropagationWorkerBridge();
    bridge.init(makeObjects(1));
    const worker = lastWorkerInstance!;
    const generation = initGeneration(worker);
    worker.onmessage!({ data: { type: 'ready', generation, count: 1 } } as MessageEvent);
    return { bridge, worker, generation };
  }

  it('restarts the worker after an error and drops stale results so the scene falls back', async () => {
    const { bridge, worker, generation } = await readyBridge();
    bridge.request(Date.UTC(2024, 0, 1), 1);
    reply(worker, generation, Date.UTC(2024, 0, 1));
    expect(bridge.getLatestResults()).not.toBeNull();

    worker.onerror!(new Error('boom'));

    expect(worker.terminate).toHaveBeenCalled();
    expect(bridge.getLatestResults()).toBeNull();
    expect(workerInstances).toHaveLength(2);
    // The replacement worker is re-initialised with the same catalog.
    expect(workerInstances[1].postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'init' }),
    );
    expect(bridge.isAvailable()).toBe(true);
  });

  it('reports "starting" only until the first result, so the scene waits instead of propagating on the main thread', async () => {
    const { bridge, worker, generation } = await readyBridge();
    expect(bridge.isStarting()).toBe(true);
    bridge.request(Date.UTC(2024, 0, 1), 1);
    reply(worker, generation, Date.UTC(2024, 0, 1));
    expect(bridge.isStarting()).toBe(false);
  });

  it('stops reporting "starting" after a failure, so the main-thread fallback takes over', async () => {
    const { bridge, worker } = await readyBridge();
    expect(bridge.isStarting()).toBe(true);
    worker.onerror!(new Error('boom before the first result'));
    expect(bridge.isStarting()).toBe(false);
  });

  it('treats an error message from the worker as a failure', async () => {
    const { bridge, worker, generation } = await readyBridge();
    worker.onmessage!({ data: { type: 'error', generation, message: 'bad TLE' } } as MessageEvent);
    expect(workerInstances).toHaveLength(2);
    expect(bridge.getLatestResults()).toBeNull();
  });

  it('ignores results tagged with an older init generation', async () => {
    const { PropagationWorkerBridge } = await import('./PropagationWorkerBridge');
    const bridge = new PropagationWorkerBridge();
    bridge.init(makeObjects(1));
    const worker = lastWorkerInstance!;
    const oldGeneration = initGeneration(worker);
    bridge.init(makeObjects(3));
    const newGeneration = initGeneration(worker);
    expect(newGeneration).not.toBe(oldGeneration);

    worker.onmessage!({ data: { type: 'ready', generation: oldGeneration, count: 1 } } as MessageEvent);
    reply(worker, oldGeneration, Date.UTC(2024, 0, 1));
    expect(bridge.getLatestResults()).toBeNull();
  });

  it('restarts a worker that stops responding (watchdog)', async () => {
    const { WORKER_WATCHDOG_MS } = await import('./PropagationWorkerBridge');
    const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(0);
    const { bridge, worker } = await readyBridge();
    bridge.request(Date.UTC(2024, 0, 1), 1); // dispatched, never answered

    nowSpy.mockReturnValue(WORKER_WATCHDOG_MS + 1);
    bridge.request(Date.UTC(2024, 0, 1, 0, 0, 5), 1);

    expect(worker.terminate).toHaveBeenCalled();
    expect(workerInstances).toHaveLength(2);
    nowSpy.mockRestore();
  });

  it('gives up after repeated failures and stays on the main-thread fallback', async () => {
    const { bridge } = await readyBridge();
    for (let i = 0; i < 5; i++) {
      lastWorkerInstance!.onerror?.(new Error(`crash ${i}`));
    }
    expect(bridge.isAvailable()).toBe(false);
    expect(bridge.getLatestResults()).toBeNull();
    // 1 original + 2 restarts, then no further spawns.
    expect(workerInstances).toHaveLength(3);
  });
});
