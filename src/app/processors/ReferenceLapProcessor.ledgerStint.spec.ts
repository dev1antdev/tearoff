import { describe, expect, it } from 'vitest';
import type { ReferenceLap, Session, Telemetry } from '@irdashies/types';
import { createMeterReading, LapCostMeter } from './LapCostMeter';
import {
  ReferenceLapProcessor,
  type PlayerStintSource,
} from './ReferenceLapProcessor';
import {
  createStintFrame,
  StintTracker,
  type StintFrame,
} from './StintTracker';

/**
 * The best lap of a stint with the ledger's own stint tracker saying where a
 * stint ends: at a stop that puts something in the car, and not at one that
 * does not.
 *
 * The tracker is fed its frames and the recorder its own, as in the app,
 * where the one is asked by the other on every frame. One kilometre of
 * track; the player is car 0.
 */
const session = {
  WeekendInfo: {
    SeriesID: 0,
    TrackID: 9,
    TrackLength: '1 km',
    SubSessionID: 1,
  },
  DriverInfo: {
    DriverCarIdx: 0,
    PaceCarIdx: -1,
    Drivers: [{ CarIdx: 0, CarClassID: 0, CarModel: 'Ferrari 296 LMGT3 Evo' }],
  },
} as unknown as Session;

const frame = (pct: number, sessionTime: number, onPitRoad = false) =>
  ({
    CarIdxLapDistPct: { value: [pct] },
    CarIdxOnPitRoad: { value: [onPitRoad] },
    SessionTime: { value: [sessionTime] },
    SessionNum: { value: [1] },
    Speed: { value: [onPitRoad ? 0 : 50] },
  }) as unknown as Telemetry;

const setup = () => {
  const meter = new LapCostMeter({ liveTread: true });
  const reading = createMeterReading();
  reading.fuel = 60;
  reading.tread = [1, 1, 1, 1];
  const tracker = new StintTracker(
    meter,
    {
      onStintOpened: () => undefined,
      onStintClosed: () => undefined,
      onStintDiscarded: () => undefined,
    },
    { sessionToken: () => 'run', compoundNames: () => [] }
  );
  const stintFrame = createStintFrame();
  stintFrame.hasCar = true;
  stintFrame.atWheel = true;
  stintFrame.speed = 50;
  stintFrame.driver = 'A';
  stintFrame.sessionNum = 1;
  /** Half a second of the car's life, as the ledger sees it. */
  const car = (change: Partial<StintFrame> = {}, fuel?: number) => {
    Object.assign(stintFrame, change);
    stintFrame.sessionTime += 0.5;
    if (fuel !== undefined) reading.fuel = fuel;
    reading.sessionTime = stintFrame.sessionTime;
    reading.speed = stintFrame.speed;
    reading.inPits = stintFrame.onPitRoad || stintFrame.inGarage;
    meter.update(reading);
    tracker.update(stintFrame);
  };

  // What the app hands the recorder: the ledger's open stint.
  const stints: PlayerStintSource = {
    stintId: () => tracker.openStintId(),
    stintOrdinal: () => tracker.openStintOrdinal(),
  };
  const processor = new ReferenceLapProcessor(
    { load: () => null, save: () => undefined },
    undefined,
    stints
  );
  processor.onLifecycle({ type: 'enter', replay: false });
  processor.init(session);

  /** One lap of `lapTime` seconds from a line crossed at `start`. */
  const driveLap = (start: number, lapTime: number) => {
    for (let point = 0; point < 100; point += 1) {
      const pct = (point + 0.5) / 100;
      processor.onFrame(frame(pct, start + pct * lapTime));
    }
    processor.onFrame(frame(1 - 0.06 / lapTime, start + lapTime - 0.06));
    processor.onFrame(frame(0.06 / lapTime, start + lapTime + 0.06));
  };
  return { tracker, car, processor, driveLap };
};

const lapTimeOf = (lap: ReferenceLap | null | undefined) =>
  lap ? lap.finishTime - lap.startTime : null;

const ON_TRACK = { onPitRoad: false, speed: 50 } as const;

describe("the best lap of a stint, by the ledger's stints", () => {
  it('is kept through a stop that services nothing, and dropped by one that does', () => {
    const { tracker, car, processor, driveLap } = setup();
    // Out on track: the ledger opens the first stint.
    car();
    processor.onFrame(frame(0.999, 9.94));
    processor.onFrame(frame(0.001, 10.06));
    driveLap(10, 90);
    expect(tracker.openStintOrdinal()).toBe(1);
    expect(processor.snapshot().playerStintId).toBe(1);
    expect(lapTimeOf(processor.snapshot().playerStintBestLap)).toBeCloseTo(
      90,
      5
    );

    // A stop-and-go penalty: into the lane, ten seconds standing, out again
    // with nothing put in. The ledger notes a pass and the stint goes on.
    car({ onPitRoad: true, speed: 20 });
    for (let tick = 0; tick < 20; tick += 1) car({ speed: 0 });
    car({ speed: 20 });
    car({ ...ON_TRACK });
    processor.onFrame(frame(0.2, 130));

    expect(tracker.openStintOrdinal()).toBe(1);
    expect(processor.snapshot().playerStintId).toBe(1);
    expect(lapTimeOf(processor.snapshot().playerStintBestLap)).toBeCloseTo(
      90,
      5
    );

    // A stop for fuel: forty litres go in, and as the car leaves the lane
    // the ledger closes the stint and opens the next.
    car({ onPitRoad: true, speed: 20 }, 12);
    car({ speed: 0 });
    for (let step = 1; step <= 20; step += 1) car({}, 12 + step * 2);
    car({ speed: 20 });
    car({ ...ON_TRACK });
    processor.onFrame(frame(0.2, 250));

    expect(tracker.openStintOrdinal()).toBe(2);
    const snapshot = processor.snapshot();
    expect(snapshot.playerStintId).toBe(2);
    expect(snapshot.playerStintBestLap).toBeNull();
    // What was last driven, and the best of the session, are not the stint's.
    expect(lapTimeOf(snapshot.playerLastLap)).toBeCloseTo(90, 5);
    expect(snapshot.bestLaps).toHaveLength(1);
  });

  it('keeps the best of a stint that ended in the garage until the next begins', () => {
    const { tracker, car, processor, driveLap } = setup();
    car();
    processor.onFrame(frame(0.999, 9.94));
    processor.onFrame(frame(0.001, 10.06));
    driveLap(10, 90);

    // Back to the garage: the stint is over, and no other has begun.
    car({ inGarage: true, speed: 0 });
    processor.onFrame(frame(0.02, 130, true));
    expect(tracker.openStintOrdinal()).toBe(0);
    expect(processor.snapshot().playerStintId).toBe(1);
    expect(lapTimeOf(processor.snapshot().playerStintBestLap)).toBeCloseTo(
      90,
      5
    );

    // Out again: the next stint, and its best is yet to be set.
    car({ inGarage: false, ...ON_TRACK });
    processor.onFrame(frame(0.05, 300));
    expect(processor.snapshot().playerStintId).toBe(2);
    expect(processor.snapshot().playerStintBestLap).toBeNull();
  });
});
