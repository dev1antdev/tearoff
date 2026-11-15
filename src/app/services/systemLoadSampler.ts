import os from 'node:os';
import { app } from 'electron';

/**
 * Reads what the machine and Tearoff itself are costing, once a second.
 *
 * Operating-system counters are not deterministic, so they are read here and
 * handed to SystemPerformanceProcessor through `latest()` rather than read
 * inside it. One reading is `os.cpus()`, the two memory figures and
 * `app.getAppMetrics()`: about 0.4 ms on a 24-thread machine, measured, so it
 * runs on the main thread and the telemetry loop never waits on it.
 *
 * It runs only while somebody asks. The first `latest()` starts the timer and
 * every later one keeps it going; ten seconds without one stops it and drops
 * what it held, so a dashboard without the widget costs nothing.
 *
 * This is the one place that calls `app.getAppMetrics()`. Electron's
 * `percentCPUUsage` is measured since the previous call by anyone, so two
 * callers shorten each other's window; the readings here carry each process's
 * cumulative CPU seconds instead, and every reader works out its own share
 * over its own interval.
 */

/** One logical core's cumulative times in milliseconds, as `os.cpus()` has them. */
export interface CpuCoreTimes {
  user: number;
  nice: number;
  sys: number;
  idle: number;
  irq: number;
}

/** One of Tearoff's processes: main, GPU, a renderer or a utility. */
export interface AppProcessReading {
  pid: number;
  /**
   * Milliseconds since the epoch. A pid can be reused once its process is
   * gone, so the two together name a process.
   */
  creationTime: number;
  /** Electron's process type: Browser, Tab, GPU, Utility and so on. */
  type: string;
  name?: string;
  /** CPU seconds used since the process started; null where the OS did not say. */
  cpuSeconds: number | null;
  /** Kilobytes held in physical memory, pages shared with other processes included. */
  workingSetKb: number;
  /** Kilobytes no other process shares. Windows only. */
  privateKb?: number;
}

export interface SystemLoadSample {
  /**
   * Counts readings for as long as the sampler lives, across stops and
   * starts, so a consumer can tell a reading it has already used.
   */
  seq: number;
  /**
   * Whole machine, 0..100: the share of all logical cores' time that was not
   * idle since the previous reading. Null on the first reading after a
   * start, and for one reading after the core count changes.
   */
  systemCpuPercent: number | null;
  systemMemoryUsedBytes: number;
  systemMemoryTotalBytes: number;
  /**
   * All of Tearoff's processes together since the previous reading, 0..100
   * of the whole machine. Null until a process has been read twice.
   */
  appCpuPercent: number | null;
  /**
   * All of Tearoff's processes together: private bytes where every process
   * reports them (Windows), since summing working sets counts the pages the
   * processes share once each; working sets otherwise. Null when no process
   * could be read.
   */
  appMemoryKb: number | null;
}

/** What a consumer of the readings sees; a spec stubs this. */
export interface SystemLoadSource {
  latest(): SystemLoadSample | null;
}

export interface SystemLoadReaders {
  cpuTimes(): readonly CpuCoreTimes[];
  totalMemoryBytes(): number;
  freeMemoryBytes(): number;
  appProcesses(): readonly AppProcessReading[];
}

export interface SystemLoadClock {
  /** Milliseconds on a clock that never runs backwards. */
  now(): number;
  setInterval(callback: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface SystemLoadSampler extends SystemLoadSource {
  /** Whether the timer is running. */
  readonly running: boolean;
  /** Stops the timer and drops the readings; the next `latest()` starts over. */
  stop(): void;
}

export const SYSTEM_LOAD_SAMPLE_INTERVAL_MS = 1000;
/** Without a `latest()` call for this long, the sampler stops. */
export const SYSTEM_LOAD_IDLE_STOP_MS = 10_000;

const processKey = (process: AppProcessReading): string =>
  `${process.pid}:${process.creationTime}`;

/** Cumulative CPU seconds per process, for the next reading to measure from. */
export const cpuSecondsByProcess = (
  processes: readonly AppProcessReading[]
): Map<string, number> => {
  const seconds = new Map<string, number>();
  for (const process of processes) {
    if (process.cpuSeconds !== null) {
      seconds.set(processKey(process), process.cpuSeconds);
    }
  }
  return seconds;
};

/**
 * CPU seconds each process used since `previous` was taken, by pid.
 *
 * A process that was not in `previous` has no entry: it started since, and
 * this reading is where it is measured from. One that has exited is simply
 * not in `processes` any more, so the time it used after its last reading is
 * not counted anywhere.
 */
export const cpuSecondsSince = (
  previous: ReadonlyMap<string, number>,
  processes: readonly AppProcessReading[]
): Map<number, number> => {
  const used = new Map<number, number>();
  for (const process of processes) {
    if (process.cpuSeconds === null) continue;
    const before = previous.get(processKey(process));
    if (before === undefined) continue;
    used.set(process.pid, Math.max(0, process.cpuSeconds - before));
  }
  return used;
};

/** Private bytes when every process reports them, working sets otherwise. */
const appMemoryKb = (
  processes: readonly AppProcessReading[]
): number | null => {
  if (processes.length === 0) return null;
  let privateKb = 0;
  let workingSetKb = 0;
  let allPrivate = true;
  for (const process of processes) {
    workingSetKb += process.workingSetKb;
    if (typeof process.privateKb === 'number') privateKb += process.privateKb;
    else allPrivate = false;
  }
  return allPrivate ? privateKb : workingSetKb;
};

const clampPercent = (value: number): number =>
  Math.min(100, Math.max(0, value));

interface Baseline {
  at: number;
  coreCount: number;
  busyMs: number;
  totalMs: number;
  processCpuSeconds: Map<string, number>;
}

export const createSystemLoadSampler = (
  readers: SystemLoadReaders,
  clock: SystemLoadClock
): SystemLoadSampler => {
  let timer: unknown;
  let running = false;
  let lastRequestAt = 0;
  let seq = 0;
  let baseline: Baseline | null = null;
  let sample: SystemLoadSample | null = null;

  const take = (): void => {
    const now = clock.now();
    const cores = readers.cpuTimes();
    let busyMs = 0;
    let totalMs = 0;
    for (const core of cores) {
      const active = core.user + core.nice + core.sys + core.irq;
      busyMs += active;
      totalMs += active + core.idle;
    }

    let systemCpuPercent: number | null = null;
    // Cores that came or went make the two sums incomparable.
    if (baseline && baseline.coreCount === cores.length) {
      const total = totalMs - baseline.totalMs;
      if (total > 0) {
        systemCpuPercent = clampPercent(
          ((busyMs - baseline.busyMs) / total) * 100
        );
      }
    }

    const processes = readers.appProcesses();
    let appCpuPercent: number | null = null;
    if (baseline && cores.length > 0 && now > baseline.at) {
      const used = cpuSecondsSince(baseline.processCpuSeconds, processes);
      if (used.size > 0) {
        let seconds = 0;
        for (const value of used.values()) seconds += value;
        const available = ((now - baseline.at) / 1000) * cores.length;
        appCpuPercent = clampPercent((seconds / available) * 100);
      }
    }

    const totalMemory = readers.totalMemoryBytes();
    baseline = {
      at: now,
      coreCount: cores.length,
      busyMs,
      totalMs,
      processCpuSeconds: cpuSecondsByProcess(processes),
    };
    seq += 1;
    sample = {
      seq,
      systemCpuPercent,
      systemMemoryUsedBytes: Math.max(
        0,
        totalMemory - readers.freeMemoryBytes()
      ),
      systemMemoryTotalBytes: totalMemory,
      appCpuPercent,
      appMemoryKb: appMemoryKb(processes),
    };
  };

  const stop = (): void => {
    if (!running) return;
    running = false;
    clock.clearInterval(timer);
    timer = undefined;
    // A reading from before the stop is not a reading of anything now.
    baseline = null;
    sample = null;
  };

  const start = (): void => {
    running = true;
    // Memory is known at once; the two CPU figures need a second reading.
    take();
    timer = clock.setInterval(() => {
      if (clock.now() - lastRequestAt >= SYSTEM_LOAD_IDLE_STOP_MS) {
        stop();
        return;
      }
      take();
    }, SYSTEM_LOAD_SAMPLE_INTERVAL_MS);
  };

  return {
    get running() {
      return running;
    },
    latest: () => {
      lastRequestAt = clock.now();
      if (!running) start();
      return sample;
    },
    stop,
  };
};

/**
 * Tearoff's processes as Electron reports them. Empty when Electron cannot
 * say, which is also what a spec running outside Electron gets.
 */
export const readAppProcesses = (): AppProcessReading[] => {
  try {
    return app.getAppMetrics().map((metric) => ({
      pid: metric.pid,
      creationTime: metric.creationTime,
      type: metric.type,
      name: metric.name || undefined,
      cpuSeconds: metric.cpu.cumulativeCPUUsage ?? null,
      workingSetKb: metric.memory.workingSetSize,
      privateKb: metric.memory.privateBytes,
    }));
  } catch {
    return [];
  }
};

const osReaders: SystemLoadReaders = {
  cpuTimes: () => os.cpus().map((core) => core.times),
  totalMemoryBytes: () => os.totalmem(),
  freeMemoryBytes: () => os.freemem(),
  appProcesses: readAppProcesses,
};

const wallClock: SystemLoadClock = {
  now: () => performance.now(),
  setInterval: (callback, ms) => {
    const handle = setInterval(callback, ms);
    // Never the reason the app stays open.
    handle.unref();
    return handle;
  },
  clearInterval: (handle) => clearInterval(handle as NodeJS.Timeout),
};

let shared: SystemLoadSampler | undefined;

/** The process-wide sampler over the real machine, created on first use. */
export const getSystemLoadSampler = (): SystemLoadSampler => {
  shared ??= createSystemLoadSampler(osReaders, wallClock);
  return shared;
};
