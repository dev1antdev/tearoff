import { beforeEach, describe, expect, it } from 'vitest';
import type { Session, Telemetry } from '@irdashies/types';
import type { SystemLoadSample } from '../services/systemLoadSampler';
import { SystemPerformanceProcessor } from './SystemPerformanceProcessor';

const GB = 1024 ** 3;
const KB_PER_MB = 1024;

/** A frame as iRacing publishes it: its own meters, as fractions. */
const iracingFrame = (
  values: { fps?: number; cpu?: number; gpu?: number } = {}
): Telemetry =>
  ({
    SessionNum: { value: [0] },
    FrameRate: { value: [values.fps ?? 118.4] },
    CpuUsageFG: { value: [values.cpu ?? 0.46] },
    CpuUsageBG: { value: [0.12] },
    GpuUsage: { value: [values.gpu ?? 0.71] },
  }) as unknown as Telemetry;

/** A frame from Le Mans Ultimate, which publishes none of them. */
const lmuFrame = (): Telemetry =>
  ({ SessionNum: { value: [0] } }) as unknown as Telemetry;

/** The sampler, as the processor sees it: whatever reading the spec sets. */
class StubSystemLoad {
  sample: SystemLoadSample | null = null;
  requests = 0;
  private seq = 0;

  latest = (): SystemLoadSample | null => {
    this.requests += 1;
    return this.sample;
  };

  /** A new reading, as the sampler takes one a second. */
  read(values: Partial<Omit<SystemLoadSample, 'seq'>> = {}): void {
    this.seq += 1;
    this.sample = {
      seq: this.seq,
      systemCpuPercent: 20,
      systemMemoryUsedBytes: 15.2 * GB,
      systemMemoryTotalBytes: 31.8 * GB,
      appCpuPercent: 1.2,
      appMemoryKb: 412 * KB_PER_MB,
      ...values,
    };
  }
}

describe('SystemPerformanceProcessor', () => {
  let systemLoad: StubSystemLoad;
  let processor: SystemPerformanceProcessor;

  beforeEach(() => {
    systemLoad = new StubSystemLoad();
    processor = new SystemPerformanceProcessor(systemLoad);
    processor.init({} as Session);
    processor.onLifecycle({ type: 'enter', replay: false });
  });

  it('declares its channel and a rate of once a second', () => {
    expect(processor.channel).toBe('system-performance.snapshot');
    expect(processor.tickRateHz).toBe(1);
  });

  it('starts with nothing to show and asks for nothing', () => {
    expect(processor.snapshot()).toEqual({
      systemCpuPercent: null,
      systemMemoryUsedGb: null,
      systemMemoryTotalGb: null,
      appCpuPercent: null,
      appMemoryMb: null,
      simFps: null,
      simCpuPercent: null,
      simGpuPercent: null,
      gpuPercent: null,
      version: 0,
    });
    // A processor nobody ticks must not be what keeps the sampler running.
    expect(systemLoad.requests).toBe(0);
  });

  it('publishes nothing while the sampler has no reading and the sim no meters', () => {
    processor.onFrame(lmuFrame());
    processor.onFrame(lmuFrame());

    const snapshot = processor.snapshot();
    expect(snapshot.systemCpuPercent).toBeNull();
    expect(snapshot.systemMemoryUsedGb).toBeNull();
    expect(snapshot.appCpuPercent).toBeNull();
    expect(snapshot.appMemoryMb).toBeNull();
    expect(snapshot.version).toBe(0);
  });

  it('is built without a sampler by a host that has none', () => {
    const bare = new SystemPerformanceProcessor();
    bare.onFrame(iracingFrame());

    expect(bare.snapshot().systemCpuPercent).toBeNull();
    expect(bare.snapshot().simFps).toBe(118);
  });

  describe('the sim', () => {
    it('reads the frame rate whole and the two meters as percentages', () => {
      processor.onFrame(iracingFrame({ fps: 118.4, cpu: 0.46, gpu: 0.71 }));

      const snapshot = processor.snapshot();
      expect(snapshot.simFps).toBe(118);
      expect(snapshot.simCpuPercent).toBe(46);
      expect(snapshot.simGpuPercent).toBe(71);
      expect(snapshot.version).toBe(1);
    });

    it('keeps one decimal of the meters', () => {
      processor.onFrame(iracingFrame({ cpu: 0.4567, gpu: 0.9949 }));

      expect(processor.snapshot().simCpuPercent).toBe(45.7);
      expect(processor.snapshot().simGpuPercent).toBe(99.5);
    });

    it('has no figures from a sim that publishes none', () => {
      processor.onFrame(lmuFrame());

      const snapshot = processor.snapshot();
      expect(snapshot.simFps).toBeNull();
      expect(snapshot.simCpuPercent).toBeNull();
      expect(snapshot.simGpuPercent).toBeNull();
    });

    it('drops the figures when the frames stop carrying them', () => {
      processor.onFrame(iracingFrame());
      const version = processor.snapshot().version;
      processor.onFrame(lmuFrame());

      expect(processor.snapshot().simFps).toBeNull();
      expect(processor.snapshot().version).toBe(version + 1);
    });

    it('takes a value that is not a number as no reading', () => {
      processor.onFrame({
        FrameRate: { value: [Number.NaN] },
        CpuUsageFG: { value: [] },
        GpuUsage: { value: [Number.POSITIVE_INFINITY] },
      } as unknown as Telemetry);

      expect(processor.snapshot().simFps).toBeNull();
      expect(processor.snapshot().simCpuPercent).toBeNull();
      expect(processor.snapshot().simGpuPercent).toBeNull();
      expect(processor.snapshot().version).toBe(0);
    });

    it('publishes only when a digit moves', () => {
      processor.onFrame(iracingFrame({ fps: 118.4, cpu: 0.46, gpu: 0.71 }));
      const version = processor.snapshot().version;
      // 117.6 fps is still 118, and 46.04% still 46.0.
      processor.onFrame(iracingFrame({ fps: 117.6, cpu: 0.4604, gpu: 0.71 }));

      expect(processor.snapshot().version).toBe(version);
    });
  });

  describe('the machine and Tearoff', () => {
    it('takes the first reading as it is', () => {
      systemLoad.read({ systemCpuPercent: 37.26, appCpuPercent: 1.24 });
      processor.onFrame(lmuFrame());

      expect(processor.snapshot()).toMatchObject({
        systemCpuPercent: 37.3,
        systemMemoryUsedGb: 15.2,
        systemMemoryTotalGb: 31.8,
        appCpuPercent: 1.2,
        appMemoryMb: 412,
        gpuPercent: null,
        version: 1,
      });
    });

    it('moves an average of 0 by 2/21 of a reading of 21, to 2.0', () => {
      systemLoad.read({ systemCpuPercent: 0, appCpuPercent: 0 });
      processor.onFrame(lmuFrame());
      systemLoad.read({ systemCpuPercent: 21, appCpuPercent: 21 });
      processor.onFrame(lmuFrame());

      expect(processor.snapshot().systemCpuPercent).toBe(2);
      expect(processor.snapshot().appCpuPercent).toBe(2);
    });

    it('settles on a steady load over about ten seconds', () => {
      systemLoad.read({ systemCpuPercent: 0 });
      processor.onFrame(lmuFrame());
      const seen: (number | null)[] = [];
      for (let second = 1; second <= 30; second += 1) {
        systemLoad.read({ systemCpuPercent: 80 });
        processor.onFrame(lmuFrame());
        seen.push(processor.snapshot().systemCpuPercent);
      }

      // 63% of the way after ten readings, and all but there after thirty.
      expect(seen[9]).toBeGreaterThan(48);
      expect(seen[9]).toBeLessThan(53);
      expect(seen[29]).toBeGreaterThan(75);
    });

    it('keeps the average unrounded between readings', () => {
      // Rounded at each step, a run of small readings would never move it.
      systemLoad.read({ systemCpuPercent: 10 });
      processor.onFrame(lmuFrame());
      for (let reading = 0; reading < 5; reading += 1) {
        systemLoad.read({ systemCpuPercent: 10.3 });
        processor.onFrame(lmuFrame());
      }

      expect(processor.snapshot().systemCpuPercent).toBe(10.1);
    });

    it('folds a reading in once, however often it is ticked', () => {
      systemLoad.read({ systemCpuPercent: 0 });
      processor.onFrame(lmuFrame());
      systemLoad.read({ systemCpuPercent: 21 });
      // A paused sim freezes the frame clock, and the host then runs every
      // frame: the same reading is offered again and again.
      for (let frame = 0; frame < 60; frame += 1) {
        processor.onFrame(lmuFrame());
      }

      expect(processor.snapshot().systemCpuPercent).toBe(2);
      expect(processor.snapshot().version).toBe(2);
    });

    it('does not publish a reading that moves no digit', () => {
      systemLoad.read({ systemCpuPercent: 20, appCpuPercent: 1.2 });
      processor.onFrame(lmuFrame());
      const version = processor.snapshot().version;
      // 20.2 moves the average to 20.02, and 300 bytes are not a megabyte.
      systemLoad.read({
        systemCpuPercent: 20.2,
        appCpuPercent: 1.21,
        systemMemoryUsedBytes: 15.2 * GB + 300,
      });
      processor.onFrame(lmuFrame());

      expect(processor.snapshot().version).toBe(version);
    });

    it('shows memory before there is a CPU figure', () => {
      systemLoad.read({ systemCpuPercent: null, appCpuPercent: null });
      processor.onFrame(lmuFrame());

      expect(processor.snapshot()).toMatchObject({
        systemCpuPercent: null,
        systemMemoryUsedGb: 15.2,
        appCpuPercent: null,
        appMemoryMb: 412,
      });
    });

    it('starts the average over after a reading without a figure', () => {
      systemLoad.read({ systemCpuPercent: 90 });
      processor.onFrame(lmuFrame());
      // The sampler stopped and started, or the core count changed.
      systemLoad.read({ systemCpuPercent: null });
      processor.onFrame(lmuFrame());
      expect(processor.snapshot().systemCpuPercent).toBeNull();

      systemLoad.read({ systemCpuPercent: 10 });
      processor.onFrame(lmuFrame());
      expect(processor.snapshot().systemCpuPercent).toBe(10);
    });

    it('has no Tearoff memory when its processes cannot be read', () => {
      systemLoad.read({ appCpuPercent: null, appMemoryKb: null });
      processor.onFrame(lmuFrame());

      expect(processor.snapshot().appMemoryMb).toBeNull();
      expect(processor.snapshot().systemMemoryUsedGb).toBe(15.2);
    });

    it('drops its figures when the sampler has none any more', () => {
      systemLoad.read();
      processor.onFrame(lmuFrame());
      const version = processor.snapshot().version;
      systemLoad.sample = null;
      processor.onFrame(lmuFrame());

      expect(processor.snapshot()).toMatchObject({
        systemCpuPercent: null,
        systemMemoryUsedGb: null,
        systemMemoryTotalGb: null,
        appCpuPercent: null,
        appMemoryMb: null,
        version: version + 1,
      });
    });

    it('asks the sampler on every tick, which is what keeps it running', () => {
      processor.onFrame(lmuFrame());
      processor.onFrame(lmuFrame());
      processor.onFrame(lmuFrame());

      expect(systemLoad.requests).toBe(3);
    });
  });

  describe('lifecycle', () => {
    it('clears everything on disconnect', () => {
      systemLoad.read();
      processor.onFrame(iracingFrame());
      const version = processor.snapshot().version;

      processor.onLifecycle({ type: 'disconnect' });

      expect(processor.snapshot()).toEqual({
        systemCpuPercent: null,
        systemMemoryUsedGb: null,
        systemMemoryTotalGb: null,
        appCpuPercent: null,
        appMemoryMb: null,
        simFps: null,
        simCpuPercent: null,
        simGpuPercent: null,
        gpuPercent: null,
        version: version + 1,
      });
    });

    it('takes the current reading afresh when frames come back', () => {
      systemLoad.read({ systemCpuPercent: 0 });
      processor.onFrame(lmuFrame());
      systemLoad.read({ systemCpuPercent: 42 });
      processor.onFrame(lmuFrame());
      expect(processor.snapshot().systemCpuPercent).toBe(4);

      processor.onLifecycle({ type: 'disconnect' });
      processor.onLifecycle({ type: 'enter', replay: false });
      processor.onFrame(lmuFrame());

      // The reading it had already used, now the first of a new average.
      expect(processor.snapshot().systemCpuPercent).toBe(42);
    });

    it('does not publish a disconnect that clears nothing', () => {
      processor.onLifecycle({ type: 'disconnect' });

      expect(processor.snapshot().version).toBe(0);
    });

    it('changes nothing when the session changes', () => {
      systemLoad.read({ systemCpuPercent: 0 });
      processor.onFrame(iracingFrame());
      const before = { ...processor.snapshot() };

      processor.onLifecycle({ type: 'sessionNumChange' });
      processor.onLifecycle({ type: 'enter', replay: true });
      expect(processor.snapshot()).toEqual(before);

      // And the average carries on from where it was.
      systemLoad.read({ systemCpuPercent: 21 });
      processor.onFrame(iracingFrame());
      expect(processor.snapshot().systemCpuPercent).toBe(2);
    });
  });
});
