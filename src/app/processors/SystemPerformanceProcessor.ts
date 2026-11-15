import type {
  Session,
  SessionLifecycleEvent,
  SystemPerformanceSnapshot,
  Telemetry,
} from '@irdashies/types';
import type {
  SystemLoadSample,
  SystemLoadSource,
} from '../services/systemLoadSampler';
import type { TelemetryProcessor } from './TelemetryProcessor';

/**
 * Weight of a new reading in the two smoothed CPU figures: an exponential
 * moving average over 20 readings, about ten seconds at the sampler's one a
 * second. A constant, since processors do not read widget settings.
 */
const CPU_SMOOTHING = 2 / 21;

const BYTES_PER_GB = 1024 ** 3;
const KB_PER_MB = 1024;

const round = (value: number, decimals: number): number => {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
};

const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/** A sim meter published as a fraction of the frame, as a percentage. */
const share = (value: unknown): number | null => {
  const fraction = finite(value);
  return fraction === null ? null : round(fraction * 100, 1);
};

/** The source for a host built without one: there is nothing to read. */
export const noSystemLoad: SystemLoadSource = { latest: () => null };

/**
 * Publishes the machine's load, Tearoff's own and the sim's meters.
 *
 * The machine and Tearoff come from the system load sampler, which reads the
 * operating system on its own timer; asking it for its latest reading is also
 * what keeps it running, so it stops by itself once no window subscribes and
 * the host drops this processor. The sim's figures are iRacing's own meters
 * in the frame. A sim that publishes none (Le Mans Ultimate) leaves them
 * null, which is how the widget knows not to draw that row.
 */
export class SystemPerformanceProcessor implements TelemetryProcessor<SystemPerformanceSnapshot> {
  readonly channel = 'system-performance.snapshot';
  // The sampler reads once a second; ticking faster would find nothing new.
  readonly tickRateHz = 1;

  /** The unrounded averages; the snapshot holds them rounded. */
  private systemCpu: number | null = null;
  private appCpu: number | null = null;
  /** The reading already folded into the averages; 0 before any. */
  private lastSeq = 0;
  private readonly latest: SystemPerformanceSnapshot = {
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
  };

  constructor(private readonly systemLoad: SystemLoadSource = noSystemLoad) {}

  /**
   * Deliberately does nothing: the host calls this on every session publish,
   * and nothing here depends on session data.
   */
  init(session: Session): void {
    void session;
  }

  onFrame(frame: Telemetry): void {
    let changed = this.readSystemLoad(this.systemLoad.latest());

    const fps = finite(frame.FrameRate?.value?.[0]);
    changed =
      this.set('simFps', fps === null ? null : Math.round(fps)) || changed;
    changed =
      this.set('simCpuPercent', share(frame.CpuUsageFG?.value?.[0])) || changed;
    changed =
      this.set('simGpuPercent', share(frame.GpuUsage?.value?.[0])) || changed;

    if (changed) this.latest.version += 1;
  }

  onLifecycle(event: SessionLifecycleEvent): void {
    // The machine does not change with the session, and a new one has the
    // same sim behind it.
    if (event.type !== 'disconnect') return;
    this.systemCpu = null;
    this.appCpu = null;
    // The sampler's current reading is still current: fold it in afresh when
    // frames come back.
    this.lastSeq = 0;
    let changed = false;
    for (const key of [
      'systemCpuPercent',
      'systemMemoryUsedGb',
      'systemMemoryTotalGb',
      'appCpuPercent',
      'appMemoryMb',
      'simFps',
      'simCpuPercent',
      'simGpuPercent',
    ] as const) {
      changed = this.set(key, null) || changed;
    }
    if (changed) this.latest.version += 1;
  }

  snapshot(): SystemPerformanceSnapshot {
    return this.latest;
  }

  /**
   * Folds a reading in once, however often the host ticks: a paused sim
   * freezes the frame clock and the host then runs every frame, which would
   * otherwise average the same reading in sixty times a second.
   */
  private readSystemLoad(sample: SystemLoadSample | null): boolean {
    if (sample === null) {
      this.systemCpu = null;
      this.appCpu = null;
      let changed = this.set('systemCpuPercent', null);
      changed = this.set('systemMemoryUsedGb', null) || changed;
      changed = this.set('systemMemoryTotalGb', null) || changed;
      changed = this.set('appCpuPercent', null) || changed;
      return this.set('appMemoryMb', null) || changed;
    }
    if (sample.seq === this.lastSeq) return false;
    this.lastSeq = sample.seq;

    this.systemCpu = this.smooth(this.systemCpu, sample.systemCpuPercent);
    this.appCpu = this.smooth(this.appCpu, sample.appCpuPercent);

    let changed = this.set(
      'systemCpuPercent',
      this.systemCpu === null ? null : round(this.systemCpu, 1)
    );
    changed =
      this.set(
        'systemMemoryUsedGb',
        round(sample.systemMemoryUsedBytes / BYTES_PER_GB, 1)
      ) || changed;
    changed =
      this.set(
        'systemMemoryTotalGb',
        round(sample.systemMemoryTotalBytes / BYTES_PER_GB, 1)
      ) || changed;
    changed =
      this.set(
        'appCpuPercent',
        this.appCpu === null ? null : round(this.appCpu, 1)
      ) || changed;
    return (
      this.set(
        'appMemoryMb',
        sample.appMemoryKb === null
          ? null
          : Math.round(sample.appMemoryKb / KB_PER_MB)
      ) || changed
    );
  }

  /**
   * The first reading is taken as it is. A reading without a figure (the
   * sampler has just started, or the core count changed) drops the average:
   * what came before it was measured on something else.
   */
  private smooth(
    average: number | null,
    reading: number | null
  ): number | null {
    if (reading === null) return null;
    if (average === null) return reading;
    return average + CPU_SMOOTHING * (reading - average);
  }

  private set(
    key: Exclude<keyof SystemPerformanceSnapshot, 'version' | 'gpuPercent'>,
    value: number | null
  ): boolean {
    if (this.latest[key] === value) return false;
    this.latest[key] = value;
    return true;
  }
}
