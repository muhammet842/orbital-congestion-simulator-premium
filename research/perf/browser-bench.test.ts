import { describe, expect, it } from 'vitest';
import { parseScanRepeatOverrides, runOrder, scanOrder, scanSummaryCsv } from './browser-bench.mjs';

describe('scan run order', () => {
  it('reads per-case repeat counts and refuses malformed ones', () => {
    expect([...parseScanRepeatOverrides('28000:off=1, 10000:on=5')]).toEqual([
      ['28000:off', 1],
      ['10000:on', 5],
    ]);
    expect(parseScanRepeatOverrides('').size).toBe(0);
    expect(() => parseScanRepeatOverrides('28000=1')).toThrow('bad --scan-repeats-for');
  });

  it('runs one case fewer times and keeps the others at the default', () => {
    const order = scanOrder(10, parseScanRepeatOverrides('28000:off=1'), [1000, 28000]);
    const count = (size: number, worker: boolean) => order.filter((c: { size: number; worker: boolean }) => c.size === size && c.worker === worker).length;
    expect([count(1000, true), count(1000, false), count(28000, true), count(28000, false)]).toEqual([10, 10, 10, 1]);
  });

  it('keeps the alternating order of runOrder', () => {
    expect(scanOrder(2, new Map(), [1000])).toEqual(runOrder(2, [1000], [1]));
  });
});

describe('scanSummaryCsv', () => {
  it('counts finished, capped and failed runs apart and summarizes only the finished ones', () => {
    const csv = scanSummaryCsv([
      { size: 1000, worker: true, finished: true, scan_s: '2.0', cap_s: '900', failure: '' },
      { size: 1000, worker: true, finished: true, scan_s: '4.0', cap_s: '900', failure: '' },
      { size: 1000, worker: false, finished: false, scan_s: '', cap_s: '900', failure: '' },
      { size: 1000, worker: false, finished: false, scan_s: '', cap_s: '900', failure: 'page never got ready' },
    ]);
    const [header, on, off] = csv.trim().split('\n');
    expect(header).toBe('size,worker,runs,finished,not_finished_in_cap,failed,scan_s_median,scan_s_std,cap_s');
    expect(on).toBe('1000,on,2,2,0,0,3.0,1.4,900');
    expect(off).toBe('1000,off,2,0,1,1,,,900');
  });
});
