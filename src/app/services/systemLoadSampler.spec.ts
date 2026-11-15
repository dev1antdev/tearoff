import { beforeEach, describe, expect, it } from 'vitest';
import {
  SYSTEM_LOAD_IDLE_STOP_MS,
  SYSTEM_LOAD_SAMPLE_INTERVAL_MS,
  createSystemLoadSampler,
  cpuSecondsByProcess,
  cpuSecondsSince,
  readAppProcesses,
  type AppProcessReading,
  type CpuCoreTimes,
  type SystemLoadClock,
  type SystemLoadSampler,
} from './systemLoadSampler';

/** A clock that only moves when told to, with the intervals set on it. */
class FakeClock implements SystemLoadClock {
  private time = 0;
  private nextHandle = 1;
  private readonly intervals = new Map<
    number,
    { callback: () => void; ms: number; dueAt: number }
  >();

  now = (): number => this.time;

  setInterval = (callback: () => void, ms: number): unknown => {
    const handle = this.nextHandle;
    this.nextHandle += 1;
    this.intervals.set(handle, { callback, ms, dueAt: this.time + ms });
    return handle;
  };

  clearInterval = (handle: unknown): void => {
    this.intervals.delete(handle as number);
  };

  get intervalCount(): number {
    return this.intervals.size;
  }

  /**
   * Moves the clock on, firing every interval that falls due on the way.
   * `beforeEach` runs just before each firing, with the clock already at it:
   * where a spec lets the fake machine do a second's work.
   */
  advance(ms: number, beforeEach?: () => void): void {
    const end = this.time + ms;
    for (;;) {
      let next: { callback: () => void; ms: number; dueAt: number } | undefined;
      for (const interval of this.intervals.values()) {
        if (interval.dueAt > end) continue;
        if (!next || interval.dueAt < next.dueAt) next = interval;
      }
      if (!next) break;
      this.time = next.dueAt;
      next.dueAt += next.ms;
      beforeEach?.();
      next.callback();
    }
    this.time = end;
  }
}

const KB_PER_MB = 1024;
const GB = 1024 ** 3;

const idleCore = (): CpuCoreTimes => ({
  user: 0,
  nice: 0,
  sys: 0,
  idle: 0,
  irq: 0,
});

const appProcess = (
  pid: number,
  values: Partial<AppProcessReading> = {}
): AppProcessReading => ({
  pid,
  creationTime: 1_000 + pid,
  type: 'Tab',
  cpuSeconds: 0,
  workingSetKb: 0,
  privateKb: 0,
  ...values,
});

/** The machine the sampler reads: every counter is set by the spec. */
interface FakeMachine {
  cores: CpuCoreTimes[];
  totalMemory: number;
  freeMemory: number;
  processes: AppProcessReading[];
  reads: number;
}

describe('system load sampler', () => {
  let clock: FakeClock;
  let machine: FakeMachine;
  let sampler: SystemLoadSampler;

  /** One sampling interval, during which `work` happens on the machine. */
  const second = (work?: () => void): void =>
    clock.advance(SYSTEM_LOAD_SAMPLE_INTERVAL_MS, work);

  const latest = () => {
    const sample = sampler.latest();
    if (!sample) throw new Error('The sampler holds no reading');
    return sample;
  };

  beforeEach(() => {
    clock = new FakeClock();
    machine = {
      cores: [idleCore(), idleCore(), idleCore(), idleCore()],
      totalMemory: 32 * GB,
      freeMemory: 20 * GB,
      processes: [],
      reads: 0,
    };
    sampler = createSystemLoadSampler(
      {
        cpuTimes: () => {
          machine.reads += 1;
          return machine.cores.map((core) => ({ ...core }));
        },
        totalMemoryBytes: () => machine.totalMemory,
        freeMemoryBytes: () => machine.freeMemory,
        appProcesses: () => machine.processes.map((entry) => ({ ...entry })),
      },
      clock
    );
  });

  it('reads nothing and holds no timer until it is asked', () => {
    clock.advance(60_000);

    expect(sampler.running).toBe(false);
    expect(clock.intervalCount).toBe(0);
    expect(machine.reads).toBe(0);
  });

  it('gives memory on the first reading and no CPU figure yet', () => {
    machine.processes = [appProcess(1, { privateKb: 80 * KB_PER_MB })];

    expect(latest()).toEqual({
      seq: 1,
      systemCpuPercent: null,
      systemMemoryUsedBytes: 12 * GB,
      systemMemoryTotalBytes: 32 * GB,
      appCpuPercent: null,
      appMemoryKb: 80 * KB_PER_MB,
    });
    expect(sampler.running).toBe(true);
    expect(clock.intervalCount).toBe(1);
  });

  it('reads 25% when the cores add 250 ms busy and 750 ms idle between two readings', () => {
    sampler.latest();
    second(() => {
      // Busy time of every kind counts, on whichever core it fell.
      machine.cores[0].user += 100;
      machine.cores[1].sys += 100;
      machine.cores[2].irq += 30;
      machine.cores[3].nice += 20;
      machine.cores[0].idle += 150;
      machine.cores[1].idle += 150;
      machine.cores[2].idle += 220;
      machine.cores[3].idle += 230;
    });

    expect(latest().systemCpuPercent).toBe(25);
    expect(latest().seq).toBe(2);
  });

  it('measures each reading against the one before it, not against the start', () => {
    sampler.latest();
    second(() => {
      machine.cores[0].user += 900;
      machine.cores[0].idle += 100;
    });
    expect(latest().systemCpuPercent).toBe(90);

    second(() => {
      machine.cores[0].user += 100;
      machine.cores[0].idle += 900;
    });
    expect(latest().systemCpuPercent).toBe(10);
  });

  it('adds 0.4, 0.3 and 0.5% with 150, 200 and 62 MB to 1.2% and 412 MB', () => {
    machine.processes = [
      appProcess(1, { type: 'Browser', privateKb: 150 * KB_PER_MB }),
      appProcess(2, { type: 'GPU', privateKb: 200 * KB_PER_MB }),
      appProcess(3, { privateKb: 62 * KB_PER_MB }),
    ];
    sampler.latest();
    second(() => {
      // Four cores for one second is four CPU seconds: 0.4% of that is 16 ms.
      machine.processes[0].cpuSeconds = 0.016;
      machine.processes[1].cpuSeconds = 0.012;
      machine.processes[2].cpuSeconds = 0.02;
    });

    const sample = latest();
    expect(sample.appCpuPercent).toBeCloseTo(1.2, 10);
    expect(sample.appMemoryKb).toBe(412 * KB_PER_MB);
  });

  it('counts a process running one core flat out as that core of the machine', () => {
    machine.processes = [appProcess(1, { cpuSeconds: 40 })];
    sampler.latest();
    second(() => {
      machine.processes[0].cpuSeconds = 41;
    });

    expect(latest().appCpuPercent).toBe(25);
  });

  it('sums working sets when a process reports no private bytes', () => {
    machine.processes = [
      appProcess(1, { workingSetKb: 300, privateKb: 100 }),
      appProcess(2, { workingSetKb: 200, privateKb: undefined }),
    ];

    expect(latest().appMemoryKb).toBe(500);
  });

  it('has no Tearoff figures when no process can be read', () => {
    sampler.latest();
    second();

    expect(latest().appCpuPercent).toBeNull();
    expect(latest().appMemoryKb).toBeNull();
    // The machine can still be read.
    expect(latest().systemMemoryUsedBytes).toBe(12 * GB);
  });

  it('starts the machine figure over when the core count changes', () => {
    machine.processes = [appProcess(1)];
    sampler.latest();
    second(() => {
      machine.cores[0].user += 500;
      machine.cores[0].idle += 500;
    });
    expect(latest().systemCpuPercent).toBe(50);

    // Two more cores appear, with a lifetime of counters of their own.
    second(() => {
      machine.cores.push(
        { ...idleCore(), user: 90_000, idle: 10_000 },
        { ...idleCore(), user: 90_000, idle: 10_000 }
      );
      machine.processes[0].cpuSeconds = 0.6;
    });
    const changed = latest();
    expect(changed.systemCpuPercent).toBeNull();
    // Tearoff's own time is still known, and is a share of six cores now.
    expect(changed.appCpuPercent).toBeCloseTo(10, 10);

    second(() => {
      for (const core of machine.cores) {
        core.user += 200;
        core.idle += 800;
      }
    });
    expect(latest().systemCpuPercent).toBe(20);
  });

  it('drops a process that exits and keeps measuring the rest', () => {
    machine.processes = [
      appProcess(1, { cpuSeconds: 5, privateKb: 100 }),
      appProcess(2, { cpuSeconds: 9, privateKb: 300 }),
    ];
    sampler.latest();
    second(() => {
      machine.processes[0].cpuSeconds = 5.04;
      machine.processes[1].cpuSeconds = 9.04;
    });
    expect(latest().appCpuPercent).toBeCloseTo(2, 10);

    second(() => {
      // The second renderer is closed part of the way through the second.
      machine.processes = [appProcess(1, { cpuSeconds: 5.08, privateKb: 100 })];
    });
    const sample = latest();
    expect(sample.appCpuPercent).toBeCloseTo(1, 10);
    expect(sample.appMemoryKb).toBe(100);
  });

  it('measures a new process from its first reading, even on a reused pid', () => {
    machine.processes = [
      appProcess(1, { cpuSeconds: 30 }),
      appProcess(7, { cpuSeconds: 0.2 }),
    ];
    sampler.latest();
    second(() => {
      machine.processes[0].cpuSeconds = 30.04;
    });
    expect(latest().appCpuPercent).toBeCloseTo(1, 10);

    second(() => {
      machine.processes = [
        { ...machine.processes[0], cpuSeconds: 30.08 },
        // Process 7 has gone and another has been given its pid, already
        // three seconds into its start-up: not 2.8 s used by the old one.
        appProcess(7, { creationTime: 9_000, cpuSeconds: 3 }),
        // A renderer that has just opened, with start-up time of its own.
        appProcess(8, { cpuSeconds: 2 }),
      ];
    });
    expect(latest().appCpuPercent).toBeCloseTo(1, 10);

    second(() => {
      machine.processes[0].cpuSeconds = 30.12;
      machine.processes[1].cpuSeconds = 3.04;
      machine.processes[2].cpuSeconds = 2.04;
    });
    expect(latest().appCpuPercent).toBeCloseTo(3, 10);
  });

  it('leaves out a process whose CPU time the OS did not give', () => {
    machine.processes = [
      appProcess(1, { cpuSeconds: 1 }),
      appProcess(2, { cpuSeconds: null }),
    ];
    sampler.latest();
    second(() => {
      machine.processes[0].cpuSeconds = 1.04;
    });

    expect(latest().appCpuPercent).toBeCloseTo(1, 10);
  });

  it('never reads below 0 or above 100', () => {
    machine.processes = [appProcess(1, { cpuSeconds: 10 })];
    sampler.latest();
    second(() => {
      // A counter that went backwards, and more CPU time than there was.
      machine.cores[0].idle += 1_000;
      machine.cores[0].user -= 400;
      machine.processes[0].cpuSeconds = 100;
    });

    expect(latest().systemCpuPercent).toBe(0);
    expect(latest().appCpuPercent).toBe(100);
  });

  it('keeps reading once a second for as long as it is asked', () => {
    sampler.latest();
    for (let tick = 0; tick < 30; tick += 1) {
      second();
      sampler.latest();
    }

    expect(sampler.running).toBe(true);
    // The first reading and one for each second since.
    expect(machine.reads).toBe(31);
    expect(latest().seq).toBe(31);
  });

  it('stops ten seconds after the last request and holds nothing', () => {
    sampler.latest();
    clock.advance(SYSTEM_LOAD_IDLE_STOP_MS - SYSTEM_LOAD_SAMPLE_INTERVAL_MS);
    expect(sampler.running).toBe(true);

    clock.advance(SYSTEM_LOAD_SAMPLE_INTERVAL_MS);
    expect(sampler.running).toBe(false);
    expect(clock.intervalCount).toBe(0);

    const reads = machine.reads;
    clock.advance(60_000);
    expect(machine.reads).toBe(reads);
  });

  it('starts over when asked again: no CPU figure from before the stop', () => {
    sampler.latest();
    second(() => {
      machine.cores[0].user += 1_000;
    });
    expect(latest().systemCpuPercent).toBe(100);
    const lastSeq = latest().seq;

    clock.advance(SYSTEM_LOAD_IDLE_STOP_MS + SYSTEM_LOAD_SAMPLE_INTERVAL_MS);
    expect(sampler.running).toBe(false);

    const restarted = latest();
    expect(sampler.running).toBe(true);
    expect(restarted.systemCpuPercent).toBeNull();
    // A reading a consumer has not seen, never a number it has.
    expect(restarted.seq).toBeGreaterThan(lastSeq);

    second(() => {
      machine.cores[0].user += 300;
      machine.cores[0].idle += 700;
    });
    expect(latest().systemCpuPercent).toBe(30);
  });

  it('stops at once when told to', () => {
    sampler.latest();
    sampler.stop();

    expect(sampler.running).toBe(false);
    expect(clock.intervalCount).toBe(0);
  });
});

describe('process CPU time between two readings', () => {
  it('gives each process the seconds it used, by pid', () => {
    const before = cpuSecondsByProcess([
      appProcess(1, { cpuSeconds: 2 }),
      appProcess(2, { cpuSeconds: 7 }),
    ]);
    const used = cpuSecondsSince(before, [
      appProcess(1, { cpuSeconds: 2.5 }),
      appProcess(2, { cpuSeconds: 7 }),
      appProcess(3, { cpuSeconds: 4 }),
    ]);

    expect([...used]).toEqual([
      [1, 0.5],
      [2, 0],
    ]);
  });

  it('reads no processes outside Electron rather than throwing', () => {
    expect(readAppProcesses()).toEqual([]);
  });
});
