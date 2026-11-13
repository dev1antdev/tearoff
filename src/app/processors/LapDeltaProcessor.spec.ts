import { describe, expect, it } from 'vitest';
import type {
  ReferenceLap,
  ReferenceLapsSnapshot,
  Session,
  Telemetry,
} from '@irdashies/types';
import { LapDeltaProcessor } from './LapDeltaProcessor';

const POINTS = 100;
const PLAYER = 1;

/** A lap driven at one speed: `lapTime` seconds, evenly. */
const steadyLap = (lapTime: number): ReferenceLap => {
  const pointPos = new Float32Array(POINTS);
  const times = new Float32Array(POINTS);
  const tangents = new Float32Array(POINTS).fill(lapTime);
  for (let index = 0; index < POINTS; index += 1) {
    pointPos[index] = (index + 0.2) / POINTS;
    times[index] = pointPos[index] * lapTime;
  }
  return {
    pointPos,
    times,
    tangents,
    interval: 1 / POINTS,
    pointsCount: POINTS,
    startTime: 500,
    finishTime: 500 + lapTime,
    lastTrackedPct: 0.999,
    isCleanLap: true,
  };
};

const session = (playerCarIdx = PLAYER, trackLength = '5 km') =>
  ({
    WeekendInfo: { TrackLength: trackLength },
    DriverInfo: { DriverCarIdx: playerCarIdx },
  }) as Session;

const frame = (sessionTime: number, playerPct: number, sessionNum = 0) =>
  ({
    SessionTime: { value: [sessionTime] },
    SessionNum: { value: [sessionNum] },
    CarIdxLapDistPct: { value: [0.5, playerPct, 0.25] },
  }) as unknown as Telemetry;

/** A reference source whose laps the test can swap. */
const references = (
  sessionBest: ReferenceLap | null,
  allTime: ReferenceLap | null = null
) => {
  let snapshot: ReferenceLapsSnapshot = {
    bestLaps: sessionBest ? [[PLAYER, sessionBest]] : [],
    persistedLaps: [],
    playerAllTimeLap: allTime,
    sessionNum: 0,
    version: 1,
  };
  return {
    snapshot: () => snapshot,
    set(nextBest: ReferenceLap | null, nextAllTime: ReferenceLap | null) {
      snapshot = {
        ...snapshot,
        bestLaps: nextBest ? [[PLAYER, nextBest]] : [],
        playerAllTimeLap: nextAllTime,
        version: snapshot.version + 1,
      };
    },
  };
};

const start = (
  sessionBest: ReferenceLap | null,
  allTime: ReferenceLap | null = null
) => {
  const source = references(sessionBest, allTime);
  const processor = new LapDeltaProcessor(source);
  processor.init(session());
  processor.onLifecycle({ type: 'enter', replay: false });
  return { processor, source };
};

/**
 * Crosses the line at exactly `at`, between two frames 40 ms apart, at the
 * pace of a 100 s lap.
 */
const crossLine = (processor: LapDeltaProcessor, at: number) => {
  processor.onFrame(frame(at - 0.02, 0.9998));
  processor.onFrame(frame(at + 0.02, 0.0002));
};

/**
 * Drives from `fromPct` to `toPct` at a steady pace of `lapTime` seconds a
 * lap, at 25 Hz, with the lap having begun at `lapStart`.
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

describe('LapDeltaProcessor', () => {
  it('shows the reference lap time before any lap has been timed', () => {
    const { processor } = start(steadyLap(100));

    processor.onFrame(frame(10, 0.4));

    expect(processor.snapshot().sessionBest).toEqual({
      lapTime: 100,
      delta: null,
      trend: null,
    });
  });

  it('gives no delta on a lap it did not see start', () => {
    // Joined mid-lap, or on the out-lap: there is no clock to measure with.
    const { processor } = start(steadyLap(100));

    drive(processor, 0, 100, 0.4, 0.6);

    expect(processor.snapshot().sessionBest.delta).toBeNull();
  });

  it('reads level when the lap matches the reference', () => {
    const { processor } = start(steadyLap(100));

    crossLine(processor, 1000);
    drive(processor, 1000, 100, 0.01, 0.5);

    expect(processor.snapshot().sessionBest.delta).toBeCloseTo(0, 2);
  });

  it('reads positive when slower and negative when faster', () => {
    const slower = start(steadyLap(100));
    crossLine(slower.processor, 1000);
    drive(slower.processor, 1000, 104, 0.01, 0.5);
    // Half a lap at 104 s pace against 100 s: two seconds down.
    expect(slower.processor.snapshot().sessionBest.delta).toBeCloseTo(2, 1);

    const faster = start(steadyLap(100));
    crossLine(faster.processor, 1000);
    drive(faster.processor, 1000, 98, 0.01, 0.5);
    expect(faster.processor.snapshot().sessionBest.delta).toBeCloseTo(-1, 1);
  });

  it('places the line crossing between the two frames either side of it', () => {
    // The frame after the line is 20 ms past it. Timed from that frame the
    // lap would start late and every delta on it would read 0.02 s fast.
    const { processor } = start(steadyLap(100));

    processor.onFrame(frame(999.98, 0.9998));
    processor.onFrame(frame(1000.02, 0.0002));
    processor.onFrame(frame(1010, 0.1));

    expect(processor.snapshot().sessionBest.delta).toBeCloseTo(0, 3);
  });

  it('weights the crossing by distance when the frames straddle it unevenly', () => {
    const { processor } = start(steadyLap(100));

    // 30 ms before the line and 10 ms after it, at steady speed.
    processor.onFrame(frame(999.97, 0.9997));
    processor.onFrame(frame(1000.01, 0.0001));
    processor.onFrame(frame(1010, 0.1));

    expect(processor.snapshot().sessionBest.delta).toBeCloseTo(0, 3);
  });

  it('takes the later frame when the two are too far apart to be neighbours', () => {
    const { processor } = start(steadyLap(100));

    processor.onFrame(frame(990, 0.99));
    // Two seconds later: nothing says where in that gap the line was.
    processor.onFrame(frame(992, 0.01));
    processor.onFrame(frame(1001, 0.1));

    // Timed from 992, nine seconds for a tenth of a 100 s lap: one down.
    expect(processor.snapshot().sessionBest.delta).toBeCloseTo(-1, 2);
  });

  it('reports how the delta is moving', () => {
    const { processor } = start(steadyLap(100));
    crossLine(processor, 1000);

    // No trend from a single reading.
    processor.onFrame(frame(1000.5, 0.005));
    expect(processor.snapshot().sessionBest.trend).toBeNull();

    // 96 s pace against 100 s: gaining 0.04 s every second.
    drive(processor, 1000, 96, 0.01, 0.2);
    expect(processor.snapshot().sessionBest.trend).toBeCloseTo(-0.042, 2);

    // Then losing: the car all but stops, and each second costs a second.
    const stoppedAt = 1000 + 0.2 * 96;
    for (let tick = 1; tick <= 50; tick += 1) {
      processor.onFrame(frame(stoppedAt + tick * 0.04, 0.2 + tick * 1e-6));
    }
    expect(processor.snapshot().sessionBest.trend).toBeCloseTo(1, 1);
  });

  it('restarts the trend at the line, where the delta steps to zero', () => {
    const { processor } = start(steadyLap(100));
    crossLine(processor, 1000);
    drive(processor, 1000, 104, 0.01, 0.99);
    expect(processor.snapshot().sessionBest.trend).toBeCloseTo(0.038, 2);

    // Four seconds down at the line, level a moment later. A slope across
    // that would read as four seconds gained in an instant.
    crossLine(processor, 1104);

    expect(processor.snapshot().sessionBest.trend).toBeNull();
    expect(processor.snapshot().sessionBest.delta).toBeCloseTo(0, 2);
  });

  it('measures against both references at once', () => {
    const { processor } = start(steadyLap(100), steadyLap(96));

    crossLine(processor, 1000);
    drive(processor, 1000, 100, 0.01, 0.5);

    const snapshot = processor.snapshot();
    expect(snapshot.sessionBest.lapTime).toBe(100);
    expect(snapshot.sessionBest.delta).toBeCloseTo(0, 2);
    expect(snapshot.allTime.lapTime).toBe(96);
    expect(snapshot.allTime.delta).toBeCloseTo(2, 2);
  });

  it('leaves a missing reference empty rather than borrowing the other', () => {
    const noAllTime = start(steadyLap(100), null);
    crossLine(noAllTime.processor, 1000);
    drive(noAllTime.processor, 1000, 100, 0.01, 0.5);
    expect(noAllTime.processor.snapshot().allTime).toEqual({
      lapTime: null,
      delta: null,
      trend: null,
    });
    expect(noAllTime.processor.snapshot().sessionBest.delta).not.toBeNull();

    const noSessionBest = start(null, steadyLap(96));
    crossLine(noSessionBest.processor, 1000);
    drive(noSessionBest.processor, 1000, 96, 0.01, 0.5);
    expect(noSessionBest.processor.snapshot().sessionBest).toEqual({
      lapTime: null,
      delta: null,
      trend: null,
    });
    expect(noSessionBest.processor.snapshot().allTime.delta).toBeCloseTo(0, 2);
  });

  it("uses the player's own session best, not another car's", () => {
    const source = {
      snapshot: (): ReferenceLapsSnapshot => ({
        bestLaps: [
          [0, steadyLap(80)],
          [2, steadyLap(85)],
        ],
        persistedLaps: [],
        sessionNum: 0,
        version: 1,
      }),
    };
    const processor = new LapDeltaProcessor(source);
    processor.init(session());
    processor.onLifecycle({ type: 'enter', replay: false });

    crossLine(processor, 1000);
    drive(processor, 1000, 100, 0.01, 0.3);

    expect(processor.snapshot().sessionBest.lapTime).toBeNull();
    expect(processor.snapshot().sessionBest.delta).toBeNull();
  });

  it('picks up a reference set while the lap is under way', () => {
    const { processor, source } = start(null);
    crossLine(processor, 1000);
    drive(processor, 1000, 100, 0.01, 0.3);
    expect(processor.snapshot().sessionBest.delta).toBeNull();

    source.set(steadyLap(100), null);
    drive(processor, 1000, 100, 0.3, 0.4);

    expect(processor.snapshot().sessionBest.lapTime).toBe(100);
    expect(processor.snapshot().sessionBest.delta).toBeCloseTo(0, 2);
  });

  it('starts the trend afresh when the reference changes', () => {
    const { processor, source } = start(steadyLap(100));
    crossLine(processor, 1000);
    drive(processor, 1000, 100, 0.01, 0.3);
    expect(processor.snapshot().sessionBest.trend).toBeCloseTo(0, 2);

    // Against a quicker lap the delta steps up by a second at once. That is
    // a different curve, not a second lost on track.
    source.set(steadyLap(96), null);
    processor.onFrame(frame(1030.04, 0.3004));

    expect(processor.snapshot().sessionBest.trend).toBeNull();
  });

  it('stops timing when the car is put back in its pit', () => {
    const { processor } = start(steadyLap(100));
    crossLine(processor, 1000);
    drive(processor, 1000, 100, 0.01, 0.5);
    expect(processor.snapshot().sessionBest.delta).not.toBeNull();

    // Half a lap backwards in one frame is not driving.
    processor.onFrame(frame(1050.04, 0.05));
    drive(processor, 1045, 100, 0.06, 0.2);

    expect(processor.snapshot().sessionBest.delta).toBeNull();
    // The reference is still there to be shown.
    expect(processor.snapshot().sessionBest.lapTime).toBe(100);
  });

  it('keeps timing through a spin that rolls the car back a little', () => {
    const { processor } = start(steadyLap(100));
    crossLine(processor, 1000);
    drive(processor, 1000, 100, 0.01, 0.5);

    // Twenty metres back on a five-kilometre lap.
    processor.onFrame(frame(1053, 0.496));
    processor.onFrame(frame(1056, 0.5));

    expect(processor.snapshot().sessionBest.delta).toBeCloseTo(6, 1);
  });

  it('stops timing when the car jumps forward', () => {
    const { processor } = start(steadyLap(100));
    crossLine(processor, 1000);
    drive(processor, 1000, 100, 0.01, 0.2);

    processor.onFrame(frame(1020.04, 0.6));

    expect(processor.snapshot().sessionBest.delta).toBeNull();
  });

  it('stops timing when the sim has no position for the player', () => {
    const { processor } = start(steadyLap(100));
    crossLine(processor, 1000);
    drive(processor, 1000, 100, 0.01, 0.2);

    processor.onFrame(frame(1020.04, -1));
    expect(processor.snapshot().sessionBest.delta).toBeNull();

    // Back on track mid-lap: still no clock until the line.
    drive(processor, 1000, 100, 0.21, 0.4);
    expect(processor.snapshot().sessionBest.delta).toBeNull();
  });

  it('does not time a lap from a car held at the line', () => {
    // Le Mans Ultimate reports exactly 0 for a car that has not reached the
    // line: on the grid through the countdown, or rolling up to the start.
    // Timed from there the lap would include the wait.
    const { processor } = start(null, steadyLap(100));

    processor.onFrame(frame(990, 0.99));
    for (let tick = 0; tick < 100; tick += 1) {
      processor.onFrame(frame(990.04 + tick * 0.3, 0));
    }
    drive(processor, 1020, 100, 0.001, 0.3);

    expect(processor.snapshot().allTime.delta).toBeNull();

    // The next crossing is a real one.
    drive(processor, 1020, 100, 0.3, 0.999);
    crossLine(processor, 1120);
    drive(processor, 1120, 100, 0.01, 0.2);
    expect(processor.snapshot().allTime.delta).toBeCloseTo(0, 2);
  });

  it('stops timing when the session clock runs backwards', () => {
    const { processor } = start(steadyLap(100));
    crossLine(processor, 1000);
    drive(processor, 1000, 100, 0.01, 0.2);

    processor.onFrame(frame(400, 0.2004));

    expect(processor.snapshot().sessionBest.delta).toBeNull();
  });

  it('publishes nothing while nothing it shows has moved', () => {
    const { processor } = start(steadyLap(100));
    crossLine(processor, 1000);
    drive(processor, 1000, 100, 0.01, 0.2);

    // A paused sim repeats the same frame.
    const paused = frame(1020.04, 0.2004);
    processor.onFrame(paused);
    const version = processor.snapshot().version;
    for (let tick = 0; tick < 20; tick += 1) processor.onFrame(paused);

    expect(processor.snapshot().version).toBe(version);
  });

  it('publishes each time the delta moves', () => {
    const { processor } = start(steadyLap(100));
    crossLine(processor, 1000);
    drive(processor, 1000, 104, 0.01, 0.1);
    const version = processor.snapshot().version;

    drive(processor, 1000, 104, 0.1, 0.11);

    expect(processor.snapshot().version).toBeGreaterThan(version);
  });

  it('drops everything when the session changes', () => {
    const { processor } = start(steadyLap(100));
    crossLine(processor, 1000);
    drive(processor, 1000, 100, 0.01, 0.2);
    expect(processor.snapshot().sessionNum).toBe(0);

    processor.onFrame(frame(5, 0.21, 1));

    expect(processor.snapshot().sessionNum).toBe(1);
    expect(processor.snapshot().sessionBest.delta).toBeNull();
  });

  it('starts over when the player is in a different car', () => {
    const { processor } = start(steadyLap(100));
    crossLine(processor, 1000);
    drive(processor, 1000, 100, 0.01, 0.2);

    processor.init(session(2));
    processor.onFrame(frame(1020.04, 0.2004));

    // Car 2 has no session best, and its lap was not seen from the start.
    expect(processor.snapshot().sessionBest.lapTime).toBeNull();
    expect(processor.snapshot().sessionBest.delta).toBeNull();
  });

  it('is silent with no player car', () => {
    const processor = new LapDeltaProcessor(references(steadyLap(100)));
    processor.init(session(-1));
    processor.onLifecycle({ type: 'enter', replay: false });

    crossLine(processor, 1000);
    drive(processor, 1000, 100, 0.01, 0.2);

    expect(processor.snapshot().sessionBest.delta).toBeNull();
  });

  it('does not measure a replay', () => {
    const source = references(steadyLap(100));
    const processor = new LapDeltaProcessor(source);
    processor.init(session());
    processor.onLifecycle({ type: 'enter', replay: true });

    crossLine(processor, 1000);
    drive(processor, 1000, 100, 0.01, 0.2);

    expect(processor.snapshot().sessionBest).toEqual({
      lapTime: null,
      delta: null,
      trend: null,
    });
  });

  it('clears on disconnect and measures again on the next session', () => {
    const { processor } = start(steadyLap(100));
    crossLine(processor, 1000);
    drive(processor, 1000, 100, 0.01, 0.2);

    processor.onLifecycle({ type: 'disconnect' });
    expect(processor.snapshot().sessionBest.delta).toBeNull();
    processor.onFrame(frame(1021, 0.21));
    expect(processor.snapshot().sessionBest.lapTime).toBeNull();

    processor.onLifecycle({ type: 'enter', replay: false });
    crossLine(processor, 2000);
    drive(processor, 2000, 100, 0.01, 0.2);
    expect(processor.snapshot().sessionBest.delta).toBeCloseTo(0, 2);
  });

  it('sizes the step-back it tolerates by the length of the track', () => {
    // Fifty metres: 5% of a one-kilometre lap would be far too generous on
    // a long circuit, and 0.4% of Le Mans far too strict on a short oval.
    const source = references(steadyLap(100));
    const processor = new LapDeltaProcessor(source);
    processor.init(session(PLAYER, '13.6 km'));
    processor.onLifecycle({ type: 'enter', replay: false });
    crossLine(processor, 1000);
    drive(processor, 1000, 100, 0.01, 0.5);

    // 136 metres back: a reset to the pits just behind, not a spin.
    processor.onFrame(frame(1050.04, 0.49));

    expect(processor.snapshot().sessionBest.delta).toBeNull();
  });
});
