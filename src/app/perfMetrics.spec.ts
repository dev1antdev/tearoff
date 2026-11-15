import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  TelemetryPerfMetrics,
  sumCompletePrivateMemoryMB,
} from './perfMetrics';
import type { AppProcessReading } from './services/systemLoadSampler';

describe('performance process memory coverage', () => {
  it('sums private bytes only when every included process reports them', () => {
    expect(sumCompletePrivateMemoryMB([1024, 2048])).toBe(3);
    expect(sumCompletePrivateMemoryMB([1024, undefined])).toBeUndefined();
    expect(sumCompletePrivateMemoryMB([])).toBeUndefined();
  });
});

describe('process CPU in the performance report', () => {
  afterEach(() => vi.restoreAllMocks());

  const reading = (
    pid: number,
    cpuSeconds: number,
    values: Partial<AppProcessReading> = {}
  ): AppProcessReading => ({
    pid,
    creationTime: 1_000 + pid,
    type: 'Tab',
    cpuSeconds,
    workingSetKb: 100 * 1024,
    privateKb: 40 * 1024,
    ...values,
  });

  it('is each process over the report interval, as a share of the machine', () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    let processes = [reading(1, 10, { type: 'Browser' }), reading(2, 3)];
    // Four cores, read through the system load sampler's reader: Electron's
    // own percentage would be whatever the last caller left of its window.
    const metrics = new TelemetryPerfMetrics(
      true,
      undefined,
      () => processes,
      () => 4
    );
    metrics.startReporting(600_000);
    try {
      // Ten seconds on four cores is forty CPU seconds.
      now = 10_000;
      processes = [
        reading(1, 12, { type: 'Browser' }),
        reading(2, 3.4),
        // Opened during the interval: measured from the next report on.
        reading(3, 9),
      ];
      const first = metrics.report();

      expect(
        first.processes?.map(({ pid, cpuPercent }) => [pid, cpuPercent])
      ).toEqual([
        [1, 5],
        [2, expect.closeTo(1, 10)],
        [3, 0],
      ]);
      expect(first.totalAppCpuPercent).toBeCloseTo(6, 10);
      expect(first.totalAppMemoryMB).toBe(300);
      expect(first.totalAppPrivateMemoryMB).toBe(120);

      // The second renderer has closed; the third is now measured.
      now = 20_000;
      processes = [reading(1, 12.4, { type: 'Browser' }), reading(3, 9.8)];
      const second = metrics.report();

      expect(
        second.processes?.map(({ pid, cpuPercent }) => [pid, cpuPercent])
      ).toEqual([
        [3, expect.closeTo(2, 10)],
        [1, expect.closeTo(1, 10)],
      ]);
      expect(second.totalAppCpuPercent).toBeCloseTo(3, 10);
    } finally {
      metrics.stopReporting();
    }
  });

  it('reports no processes, and does not throw, when none can be read', () => {
    const metrics = new TelemetryPerfMetrics(
      true,
      undefined,
      () => [],
      () => 4
    );

    const report = metrics.report();

    expect(report.processes).toEqual([]);
    expect(report.totalAppCpuPercent).toBe(0);
    expect(report.totalAppMemoryMB).toBe(0);
    expect(report.totalAppPrivateMemoryMB).toBeUndefined();
  });
});
