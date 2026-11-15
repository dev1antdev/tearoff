import { describe, expect, it } from 'vitest';
import type {
  LapDeltaReference,
  ReferenceLap,
  ReferenceLapsSnapshot,
  Session,
  Telemetry,
} from '@irdashies/types';
import { LapDeltaProcessor } from './LapDeltaProcessor';

/**
 * The four references side by side -- session best, all-time, stint best and
 * last lap -- and the result of a lap at the line.
 */
const POINTS = 100;
const PLAYER = 0;

/** A lap driven at one speed: `lapTime` seconds, evenly. */
const steadyLap = (lapTime: number): ReferenceLap => {
  const pointPos = new Float32Array(POINTS);
  const times = new Float32Array(POINTS);
  for (let index = 0; index < POINTS; index += 1) {
    pointPos[index] = (index + 0.2) / POINTS;
    times[index] = pointPos[index] * lapTime;
  }
  return {
    pointPos,
    times,
    tangents: new Float32Array(POINTS).fill(lapTime),
    interval: 1 / POINTS,
    pointsCount: POINTS,
    startTime: 500,
    finishTime: 500 + lapTime,
    lastTrackedPct: 0.999,
    isCleanLap: true,
  };
};

const session = {
  WeekendInfo: { TrackLength: '5 km' },
  DriverInfo: { DriverCarIdx: PLAYER },
} as Session;

const frame = (sessionTime: number, pct: number, onPitRoad = false) =>
  ({
    SessionTime: { value: [sessionTime] },
    SessionNum: { value: [0] },
    CarIdxLapDistPct: { value: [pct] },
    CarIdxOnPitRoad: { value: [onPitRoad] },
  }) as unknown as Telemetry;

interface Laps {
  sessionBest?: ReferenceLap | null;
  allTime?: ReferenceLap | null;
  stintBest?: ReferenceLap | null;
  lastLap?: ReferenceLap | null;
  stintId?: number;
}

/** A reference recorder whose laps the test can swap. */
const references = (initial: Laps = {}) => {
  let laps = initial;
  let version = 1;
  return {
    snapshot: (): ReferenceLapsSnapshot => ({
      bestLaps: laps.sessionBest ? [[PLAYER, laps.sessionBest]] : [],
      persistedLaps: [],
      playerAllTimeLap: laps.allTime ?? null,
      playerStintBestLap: laps.stintBest ?? null,
      playerLastLap: laps.lastLap ?? null,
      playerStintId: laps.stintId ?? 0,
      sessionNum: 0,
      version,
    }),
    set(next: Laps) {
      laps = { ...laps, ...next };
      version += 1;
    },
  };
};

const start = (laps: Laps = {}) => {
  const source = references(laps);
  const processor = new LapDeltaProcessor(source);
  processor.init(session);
  processor.onLifecycle({ type: 'enter', replay: false });
  return { processor, source };
};

/** Over the line at exactly `at`, at the pace of a `lapTime` lap. */
const crossLine = (processor: LapDeltaProcessor, at: number, lapTime = 90) => {
  processor.onFrame(frame(at - 0.02, 1 - 0.02 / lapTime));
  processor.onFrame(frame(at + 0.02, 0.02 / lapTime));
};

/**
 * From `fromPct` to `toPct` at a steady pace of `lapTime` seconds a lap, at
 * 25 Hz, with the lap having begun at `lapStart`.
 */
const drive = (
  processor: LapDeltaProcessor,
  lapStart: number,
  lapTime: number,
  fromPct: number,
  toPct: number
) => {
  const step = 0.04 / lapTime;
  for (let pct = fromPct; pct <= toPct + 1e-9; pct += step) {
    processor.onFrame(frame(lapStart + pct * lapTime, pct));
  }
};

const none: LapDeltaReference = { lapTime: null, delta: null, trend: null };

describe('LapDeltaProcessor with four references', () => {
  it('measures against the stint best and the last lap as against the others', () => {
    const { processor } = start({
      sessionBest: steadyLap(88),
      allTime: steadyLap(86),
      stintBest: steadyLap(89),
      lastLap: steadyLap(90),
    });

    crossLine(processor, 1000);
    drive(processor, 1000, 90, 0.01, 0.5);

    // Half a lap at 90 s pace: level with the last lap, and half of each
    // difference down on the others.
    const snapshot = processor.snapshot();
    expect(snapshot.lastLap.lapTime).toBe(90);
    expect(snapshot.lastLap.delta).toBeCloseTo(0, 2);
    expect(snapshot.stintBest.lapTime).toBe(89);
    expect(snapshot.stintBest.delta).toBeCloseTo(0.5, 2);
    expect(snapshot.sessionBest.delta).toBeCloseTo(1, 2);
    expect(snapshot.allTime.delta).toBeCloseTo(2, 2);
    // Each with a trend of its own.
    expect(snapshot.lastLap.trend).toBeCloseTo(0, 2);
    expect(snapshot.stintBest.trend).toBeCloseTo(1 / 90, 2);
  });

  it('leaves a missing reference empty rather than borrowing another', () => {
    const { processor } = start({ lastLap: steadyLap(90) });

    crossLine(processor, 1000);
    drive(processor, 1000, 90, 0.01, 0.5);

    const snapshot = processor.snapshot();
    expect(snapshot.lastLap.delta).toBeCloseTo(0, 2);
    expect(snapshot.stintBest).toEqual(none);
    expect(snapshot.sessionBest).toEqual(none);
    expect(snapshot.allTime).toEqual(none);
  });

  it('publishes nothing with no reference at all', () => {
    const { processor } = start();
    processor.onFrame(frame(999, 0.99));
    const version = processor.snapshot().version;

    drive(processor, 910, 90, 0.991, 0.995);
    drive(processor, 1000, 90, 0.3, 0.6);

    const snapshot = processor.snapshot();
    expect(snapshot.sessionBest).toEqual(none);
    expect(snapshot.allTime).toEqual(none);
    expect(snapshot.stintBest).toEqual(none);
    expect(snapshot.lastLap).toEqual(none);
    expect(snapshot.lastLapFinal).toBeNull();
    expect(snapshot.version).toBe(version);
  });

  it('starts the trend afresh when the stint best or the last lap changes', () => {
    const { processor, source } = start({
      stintBest: steadyLap(90),
      lastLap: steadyLap(90),
    });
    crossLine(processor, 1000);
    drive(processor, 1000, 90, 0.01, 0.3);
    expect(processor.snapshot().stintBest.trend).toBeCloseTo(0, 2);

    // A new stint: the best of the last one is gone. The last lap stays.
    source.set({ stintBest: null, stintId: 2 });
    processor.onFrame(frame(1027.04, 0.3004));

    const snapshot = processor.snapshot();
    expect(snapshot.stintBest).toEqual(none);
    expect(snapshot.stintId).toBe(2);
    expect(snapshot.lastLap.delta).toBeCloseTo(0, 2);
    expect(snapshot.lastLap.trend).toBeCloseTo(0, 2);
  });

  it('says which stint the stint best belongs to, and when it moves', () => {
    const { processor, source } = start({ stintId: 1 });
    processor.onFrame(frame(10, 0.4));
    expect(processor.snapshot().stintId).toBe(1);
    const version = processor.snapshot().version;

    source.set({ stintId: 2 });
    processor.onFrame(frame(10.04, 0.4004));

    expect(processor.snapshot().stintId).toBe(2);
    expect(processor.snapshot().version).toBeGreaterThan(version);
  });
});

describe('the result of a lap at the line', () => {
  /**
   * A lap half a second quicker than a 90 s one at every point from the
   * fifth percent on: the time was found out of the first corner.
   */
  const driveHalfASecondUp = (processor: LapDeltaProcessor, lapStart: number) =>
    drive(processor, lapStart - 0.5, 90, 0.05, 0.99);

  it('is the lap time and the gap to each reference as it stood', () => {
    const { processor, source } = start({
      sessionBest: steadyLap(89),
      allTime: steadyLap(88),
      stintBest: steadyLap(89.5),
      lastLap: steadyLap(90),
    });
    crossLine(processor, 1000);
    driveHalfASecondUp(processor, 1000);
    expect(processor.snapshot().lastLap.delta).toBeCloseTo(-0.5, 2);
    expect(processor.snapshot().lastLapFinal).toBeNull();

    // The line, 89.5 s after the last one. On that frame the recorder
    // already holds the lap just driven as the last lap.
    processor.onFrame(frame(1089.48, 1 - 0.02 / 90));
    source.set({ lastLap: steadyLap(89.5) });
    processor.onFrame(frame(1089.52, 0.02 / 90));

    expect(processor.snapshot().lastLapFinal).toEqual({
      lapTime: 89.5,
      completedAt: 1089.5,
      sessionBest: 0.5,
      allTime: 1.5,
      stintBest: 0,
      // Against the lap before, not against itself.
      lastLap: -0.5,
    });
    // And the lap now begun is measured against the one just finished.
    expect(processor.snapshot().lastLap.lapTime).toBe(89.5);
  });

  it('has no gap to a reference that did not exist before the line', () => {
    const { processor, source } = start();
    crossLine(processor, 1000);
    drive(processor, 1000, 90, 0.01, 0.99);

    // The first timed lap: it becomes every reference at the line.
    processor.onFrame(frame(1089.98, 1 - 0.02 / 90));
    const lap = steadyLap(90);
    source.set({ sessionBest: lap, stintBest: lap, lastLap: lap });
    processor.onFrame(frame(1090.02, 0.02 / 90));

    expect(processor.snapshot().lastLapFinal).toEqual({
      lapTime: 90,
      completedAt: 1090,
      sessionBest: null,
      allTime: null,
      stintBest: null,
      lastLap: null,
    });
  });

  it('moves the version when a lap ends, references or not', () => {
    const { processor } = start();
    crossLine(processor, 1000);
    drive(processor, 1000, 90, 0.01, 0.99);
    const version = processor.snapshot().version;

    crossLine(processor, 1090);

    expect(processor.snapshot().lastLapFinal?.lapTime).toBe(90);
    expect(processor.snapshot().version).toBeGreaterThan(version);
  });

  it('is not written for a lap that was not seen from its start', () => {
    const { processor } = start({ lastLap: steadyLap(90) });

    // Joined a third of the way round.
    drive(processor, 1000, 90, 0.3, 0.99);
    crossLine(processor, 1090);

    expect(processor.snapshot().lastLapFinal).toBeNull();
  });

  it('is not written for a lap that ends in the pit lane', () => {
    const { processor } = start({ lastLap: steadyLap(90) });
    crossLine(processor, 1000);
    drive(processor, 1000, 90, 0.01, 0.9);

    // Into the pit entry and over the line on the limiter.
    processor.onFrame(frame(1085, 0.93, true));
    processor.onFrame(frame(1099.98, 0.9998, true));
    processor.onFrame(frame(1100.02, 0.0002, true));

    expect(processor.snapshot().lastLapFinal).toBeNull();
  });

  it('keeps the last result through a lap that gives none', () => {
    const { processor } = start({ lastLap: steadyLap(90) });
    crossLine(processor, 1000);
    drive(processor, 1000, 90, 0.01, 0.99);
    crossLine(processor, 1090);
    const result = processor.snapshot().lastLapFinal;
    expect(result?.completedAt).toBe(1090);

    // The car is put back in its pit half-way round the next lap, and
    // crosses the line again on its way out.
    drive(processor, 1090, 90, 0.01, 0.5);
    processor.onFrame(frame(1140, 0.97));
    crossLine(processor, 1150);

    expect(processor.snapshot().lastLapFinal).toEqual(result);
  });

  it('is cleared with the session, on entering one and on disconnect', () => {
    const run = () => {
      const { processor } = start({ lastLap: steadyLap(90) });
      crossLine(processor, 1000);
      drive(processor, 1000, 90, 0.01, 0.99);
      crossLine(processor, 1090);
      expect(processor.snapshot().lastLapFinal).not.toBeNull();
      return processor;
    };

    const changed = run();
    changed.onLifecycle({ type: 'sessionNumChange' });
    expect(changed.snapshot().lastLapFinal).toBeNull();
    expect(changed.snapshot().stintId).toBe(0);

    const entered = run();
    entered.onLifecycle({ type: 'enter', replay: false });
    expect(entered.snapshot().lastLapFinal).toBeNull();

    const gone = run();
    gone.onLifecycle({ type: 'disconnect' });
    expect(gone.snapshot().lastLapFinal).toBeNull();
  });
});
