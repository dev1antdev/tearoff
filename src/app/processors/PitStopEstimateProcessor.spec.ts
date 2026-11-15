import { describe, expect, it } from 'vitest';
import type {
  FuelLapData,
  FuelProjectionSnapshot,
  LapTimesSnapshot,
  PitLaneTrackData,
  Session,
  Telemetry,
} from '@irdashies/types';
import { TrackLocation } from '@irdashies/types';
import {
  createMemoryPitLaneModelStore,
  PitStopEstimateProcessor,
  type PitLaneModelStore,
  type PitStopEstimateProcessorOptions,
} from './PitStopEstimateProcessor';

/**
 * The pit stop channel on hand-built frames: the timer and its edges, the
 * plan frozen at the entry line, the lane model and how it is learned, the
 * refuel figures, the estimate under each sim, and the cars around the pit
 * exit. What a real stop looks like is not in any recording; these frames
 * are how the rules are written, not how the sim behaves.
 */

const TRACK = '47';
const CAR = 'Ferrari 296 LMGT3';
const TICK = 0.2;
const GT3 = 3;
const LMP2 = 2;

interface CarInput {
  pct: number;
  onPitRoad?: boolean;
  surface?: number;
  position?: number;
  classPosition?: number;
  carClass?: number;
  /** Race time behind the leader, s. */
  f2?: number;
}

interface FrameInput {
  time: number;
  sessionNum?: number;
  sim?: 'lmu' | 'iracing';
  /** The player's car, slot 0. */
  onPitRoad?: boolean;
  /** m/s; null leaves the key off the frame. */
  speed?: number | null;
  isOnTrack?: boolean;
  inGarage?: boolean;
  pct?: number;
  lap?: number;
  /** Every car, the player's first. */
  cars?: CarInput[];
  extra?: Record<string, unknown[]>;
}

const frame = (input: FrameInput): Telemetry => {
  const cars = input.cars ?? [{ pct: input.pct ?? 0.5 }];
  const onPitRoad = input.onPitRoad ?? false;
  const values: Record<string, unknown[]> = {
    SessionTime: [input.time],
    SessionNum: [input.sessionNum ?? 0],
    PlayerCarIdx: [0],
    IsOnTrack: [input.isOnTrack ?? true],
    IsInGarage: [input.inGarage ?? false],
    OnPitRoad: [onPitRoad],
    LapCompleted: [input.lap ?? 3],
    LapDistPct: [input.pct ?? cars[0].pct],
    CarIdxLapDistPct: cars.map((car, index) =>
      index === 0 ? (input.pct ?? car.pct) : car.pct
    ),
    CarIdxOnPitRoad: cars.map((car, index) =>
      index === 0 ? onPitRoad : (car.onPitRoad ?? false)
    ),
    CarIdxTrackSurface: cars.map((car) => car.surface ?? TrackLocation.OnTrack),
    CarIdxPosition: cars.map((car, index) => car.position ?? index + 1),
    CarIdxClassPosition: cars.map(
      (car, index) => car.classPosition ?? index + 1
    ),
    CarIdxClass: cars.map((car) => car.carClass ?? GT3),
    CarIdxF2Time: cars.map((car) => car.f2 ?? 0),
  };
  if (input.speed !== null) values.Speed = [input.speed ?? 50];
  if ((input.sim ?? 'lmu') === 'lmu') {
    values.LmuGamePhase = [5];
    values.LmuWatching = [false];
  }
  Object.assign(values, input.extra);
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, { value }])
  ) as unknown as Telemetry;
};

const session = (cars = 1): Session =>
  ({
    WeekendInfo: {
      TrackID: Number(TRACK),
      TrackLength: '3.5904 km',
      TrackPitSpeedLimit: '60.00 kph',
    },
    SessionInfo: {
      Sessions: [
        { SessionNum: 0, SessionType: 'Race' },
        { SessionNum: 1, SessionType: 'Practice' },
      ],
    },
    DriverInfo: {
      DriverCarIdx: 0,
      Drivers: Array.from({ length: cars }, (_, carIdx) => ({
        CarIdx: carIdx,
        CarClassID: GT3,
        CarClassEstLapTime: 84.2,
        CarModel: carIdx === 0 ? CAR : `Car ${carIdx}`,
        CarPath: `car-${carIdx}`,
      })),
    },
  }) as unknown as Session;

const LINES: PitLaneTrackData = { pitEntryPct: 0.95, pitExitPct: 0.03 };

const start = (
  options: PitStopEstimateProcessorOptions = {},
  cars = 1
): PitStopEstimateProcessor => {
  const processor = new PitStopEstimateProcessor(options);
  processor.onLifecycle({ type: 'enter', replay: false });
  processor.init(session(cars));
  return processor;
};

/** Feeds frames from one time up to, and not including, another. */
const run = (
  processor: PitStopEstimateProcessor,
  from: number,
  to: number,
  input: Omit<FrameInput, 'time'>
): void => {
  for (let step = 0; ; step += 1) {
    const time = Math.round((from + step * TICK) * 1000) / 1000;
    if (time >= to) return;
    processor.onFrame(frame({ ...input, time }));
  }
};

const lapTimes = (...paces: number[]): (() => LapTimesSnapshot) => {
  const snapshot: LapTimesSnapshot = {
    lapTimes: paces,
    lapTimeHistory: [],
    sessionNum: 0,
    version: 1,
  };
  return () => snapshot;
};

const fuelLap = (fuelUsed: number): FuelLapData => ({
  lapNumber: 1,
  fuelUsed,
  lapTime: 86.7,
  isGreenFlag: true,
  isValidForCalc: true,
  isOutLap: false,
  timestamp: 0,
});

const fuel = (
  values: Partial<FuelProjectionSnapshot>
): (() => FuelProjectionSnapshot) => {
  const snapshot = {
    isReplay: false,
    fuelLevel: 0,
    completedLaps: [],
    estimatedLapsRemaining: 0,
    hasValidRaceEstimate: false,
    ...values,
  } as FuelProjectionSnapshot;
  return () => snapshot;
};

const withLines = (timing?: PitLaneTrackData['timing']): PitLaneModelStore =>
  createMemoryPitLaneModelStore({
    [TRACK]: { ...LINES, ...(timing ? { timing } : {}) },
  });

/** A whole stop: in at 100, at rest from 112 to 130, out at 142. */
const makeStop = (
  processor: PitStopEstimateProcessor,
  input: Omit<FrameInput, 'time' | 'onPitRoad' | 'speed'> = {}
): void => {
  run(processor, 95, 100, { ...input, speed: 20, pct: 0.94 });
  run(processor, 100, 112, { ...input, onPitRoad: true, speed: 20, pct: 0.97 });
  run(processor, 112, 130, { ...input, onPitRoad: true, speed: 0, pct: 0.99 });
  run(processor, 130, 142, { ...input, onPitRoad: true, speed: 20, pct: 0.01 });
  run(processor, 142, 143, { ...input, speed: 30, pct: 0.04 });
};

describe('PitStopEstimateProcessor', () => {
  describe('the phase', () => {
    it('follows the car from the circuit to its box and back', () => {
      const processor = start();
      run(processor, 10, 11, { speed: 50 });
      expect(processor.snapshot().phase).toBe('planning');

      run(processor, 11, 12, { onPitRoad: true, speed: 16 });
      expect(processor.snapshot().phase).toBe('lane');

      run(processor, 12, 13, { onPitRoad: true, speed: 0 });
      expect(processor.snapshot().phase).toBe('service');

      // Creeping in the box is still standing: below 1 m/s again.
      run(processor, 13, 14, { onPitRoad: true, speed: 0.8 });
      expect(processor.snapshot().phase).toBe('service');

      run(processor, 14, 15, { onPitRoad: true, speed: 12 });
      expect(processor.snapshot().phase).toBe('lane');
    });

    it('is idle in the garage, out of the car and on a stale frame', () => {
      const processor = start();
      run(processor, 10, 11, { inGarage: true, onPitRoad: true, speed: 0 });
      expect(processor.snapshot().phase).toBe('idle');

      run(processor, 11, 12, { isOnTrack: false });
      expect(processor.snapshot().phase).toBe('idle');

      run(processor, 12, 13, { extra: { LmuDataStale: [true] } });
      expect(processor.snapshot().phase).toBe('idle');

      run(processor, 13, 14, {});
      expect(processor.snapshot().phase).toBe('planning');
    });

    it('says when the sim has a stop requested', () => {
      const processor = start();
      run(processor, 10, 11, { extra: { LmuCarIdxPitState: [1] } });
      expect(processor.snapshot().requested).toBe(true);
      run(processor, 11, 12, { extra: { LmuCarIdxPitState: [0] } });
      expect(processor.snapshot().requested).toBe(false);
      // iRacing has no such state.
      run(processor, 12, 13, { sim: 'iracing' });
      expect(processor.snapshot().requested).toBe(false);
    });
  });

  describe('the timer', () => {
    it('times a stop from line to line and files what it measured', () => {
      const store = withLines();
      const processor = start({ store });
      const estimate = { LmuPitStopTime: [17.4] };

      run(processor, 95, 100, { speed: 20, pct: 0.94, extra: estimate });
      expect(processor.snapshot().timer.enteredAt).toBeNull();
      expect(processor.snapshot().planned).toBeNull();

      run(processor, 100, 112, {
        onPitRoad: true,
        speed: 20,
        pct: 0.97,
        extra: estimate,
      });
      expect(processor.snapshot().timer).toEqual({
        enteredAt: 100,
        stoppedAt: null,
        standingS: 0,
        exitedAt: null,
      });
      // The lane is at the limit until a stop has been measured.
      expect(processor.snapshot().planned).toEqual({
        standingS: 17.4,
        driveS: 17.2,
      });

      run(processor, 112, 130, {
        onPitRoad: true,
        speed: 0,
        pct: 0.99,
        extra: estimate,
      });
      expect(processor.snapshot().timer).toMatchObject({
        stoppedAt: 112,
        standingS: 0,
      });

      run(processor, 130, 142, {
        onPitRoad: true,
        speed: 20,
        pct: 0.01,
        extra: estimate,
      });
      expect(processor.snapshot().timer).toMatchObject({
        stoppedAt: null,
        standingS: 18,
        exitedAt: null,
      });
      expect(processor.snapshot().last).toBeNull();

      run(processor, 142, 143, { speed: 30, pct: 0.04, extra: estimate });
      const snapshot = processor.snapshot();
      expect(snapshot.timer).toEqual({
        enteredAt: 100,
        stoppedAt: null,
        standingS: 18,
        exitedAt: 142,
      });
      expect(snapshot.last).toEqual({
        laneS: 42,
        standingS: 18,
        plannedStandingS: 17.4,
        lap: 3,
      });
      expect(snapshot.planned).toBeNull();
      expect(snapshot.phase).toBe('planning');

      // One drive sample of 24 s and one standing time, under the car.
      expect(store.get(TRACK)?.timing).toEqual({
        speedLimitMs: null,
        driveS: [24],
        standingS: { [CAR]: [18] },
      });
      // Which the model now drives a stop by.
      run(processor, 143, 144, { speed: 30, pct: 0.05, extra: estimate });
      expect(processor.snapshot().lane.driveMeasuredS).toBe(24);
    });

    it('publishes nothing while the car stands', () => {
      const processor = start({ store: withLines() });
      run(processor, 95, 100, { speed: 20, pct: 0.94 });
      run(processor, 100, 112, { onPitRoad: true, speed: 20, pct: 0.99 });
      run(processor, 112, 113, { onPitRoad: true, speed: 0, pct: 0.99 });
      const version = processor.snapshot().version;

      run(processor, 113, 130, { onPitRoad: true, speed: 0, pct: 0.99 });
      expect(processor.snapshot().version).toBe(version);
      expect(processor.snapshot().timer.stoppedAt).toBe(112);
    });

    it('sets no anchor for a car put in the lane at a standstill', () => {
      const store = withLines();
      const processor = start({ store });
      run(processor, 95, 100, { speed: 20 });
      // A teleport to the pits: onto pit road at no speed.
      run(processor, 100, 120, { onPitRoad: true, speed: 0 });
      run(processor, 120, 130, { onPitRoad: true, speed: 15 });
      run(processor, 130, 131, { speed: 30 });

      const snapshot = processor.snapshot();
      expect(snapshot.timer.enteredAt).toBeNull();
      expect(snapshot.timer.exitedAt).toBeNull();
      expect(snapshot.planned).toBeNull();
      expect(snapshot.last).toBeNull();
      expect(store.get(TRACK)?.timing).toBeUndefined();
    });

    it('sets no anchor for a car first seen in the lane', () => {
      const processor = start({ store: withLines() });
      run(processor, 100, 110, { onPitRoad: true, speed: 15 });
      run(processor, 110, 111, { speed: 30 });
      expect(processor.snapshot().timer.enteredAt).toBeNull();
      expect(processor.snapshot().last).toBeNull();
    });

    it('is cleared by the garage', () => {
      const processor = start({ store: withLines() });
      run(processor, 95, 100, { speed: 20 });
      run(processor, 100, 110, { onPitRoad: true, speed: 20 });
      run(processor, 110, 115, { onPitRoad: true, speed: 0 });
      expect(processor.snapshot().timer.enteredAt).toBe(100);
      expect(processor.snapshot().planned).not.toBeNull();

      // Back to the garage from the box.
      run(processor, 115, 116, { onPitRoad: true, speed: 0, inGarage: true });
      const snapshot = processor.snapshot();
      expect(snapshot.timer).toEqual({
        enteredAt: null,
        stoppedAt: null,
        standingS: 0,
        exitedAt: null,
      });
      expect(snapshot.planned).toBeNull();
      expect(snapshot.last).toBeNull();

      // And out of it again there is no entry edge to time from.
      run(processor, 116, 120, { onPitRoad: true, speed: 15 });
      run(processor, 120, 121, { speed: 30 });
      expect(processor.snapshot().last).toBeNull();
    });

    it('keeps its anchors through frames the sim has stopped writing', () => {
      const processor = start({ store: withLines() });
      run(processor, 95, 100, { speed: 20 });
      run(processor, 100, 110, { onPitRoad: true, speed: 20 });
      run(processor, 110, 112, {
        onPitRoad: true,
        speed: 0,
        extra: { LmuDataStale: [true] },
      });
      expect(processor.snapshot().phase).toBe('idle');
      run(processor, 112, 120, { onPitRoad: true, speed: 20 });
      run(processor, 120, 121, { speed: 30 });
      expect(processor.snapshot().last).toMatchObject({ laneS: 20 });
    });

    it('drops a visit whose exit it did not see', () => {
      const processor = start({ store: withLines() });
      run(processor, 95, 100, { speed: 20 });
      run(processor, 100, 110, { onPitRoad: true, speed: 20 });
      run(processor, 110, 112, { isOnTrack: false });
      // Back at the wheel, out on the circuit.
      run(processor, 112, 113, { speed: 40 });
      expect(processor.snapshot().timer.enteredAt).toBeNull();
      expect(processor.snapshot().last).toBeNull();
    });

    it('does not call a brush with the pit lane a visit', () => {
      const processor = start({ store: withLines() });
      run(processor, 95, 100, { speed: 60 });
      run(processor, 100, 101, { onPitRoad: true, speed: 60 });
      run(processor, 101, 102, { speed: 60 });
      expect(processor.snapshot().last).toBeNull();
      expect(processor.snapshot().timer.enteredAt).toBeNull();
    });

    it('records a drive-through as a visit and files no stop', () => {
      const store = withLines();
      const processor = start({ store });
      run(processor, 95, 100, { speed: 20 });
      run(processor, 100, 118, { onPitRoad: true, speed: 16.6 });
      run(processor, 118, 119, { speed: 30 });
      expect(processor.snapshot().last).toMatchObject({
        laneS: 18,
        standingS: 0,
      });
      expect(store.get(TRACK)?.timing).toBeUndefined();
    });

    it('forgets the last visit when the session changes', () => {
      const processor = start({ store: withLines() });
      makeStop(processor);
      expect(processor.snapshot().last).not.toBeNull();
      const lane = { ...processor.snapshot().lane };

      processor.onLifecycle({ type: 'sessionNumChange' });
      const snapshot = processor.snapshot();
      expect(snapshot.last).toBeNull();
      expect(snapshot.timer.enteredAt).toBeNull();
      expect(snapshot.estimate.standingS).toBeNull();
      expect(snapshot.rejoin).toBeNull();
      // The lane is the track's, not the session's.
      expect(snapshot.lane).toEqual(lane);
    });

    it('forgets it on a new session number and on a clock that runs back', () => {
      const processor = start({ store: withLines() });
      makeStop(processor);
      run(processor, 143, 144, { sessionNum: 1 });
      expect(processor.snapshot().last).toBeNull();
      expect(processor.snapshot().sessionNum).toBe(1);

      makeStop(processor, { sessionNum: 1 });
      expect(processor.snapshot().last).not.toBeNull();
      run(processor, 20, 21, { sessionNum: 1 });
      expect(processor.snapshot().last).toBeNull();
    });
  });

  describe('the plan', () => {
    it("is frozen at the entry line, whatever the sim's figure does in the lane", () => {
      const processor = start({ store: withLines() });
      run(processor, 95, 100, {
        speed: 20,
        extra: { LmuPitStopTime: [31.26] },
      });
      // In the lane the sim's figure drops to nothing.
      run(processor, 100, 110, {
        onPitRoad: true,
        speed: 20,
        extra: { LmuPitStopTime: [0] },
      });
      run(processor, 110, 120, {
        onPitRoad: true,
        speed: 0,
        extra: { LmuPitStopTime: [0] },
      });

      const snapshot = processor.snapshot();
      expect(snapshot.estimate.standingS).toBe(0);
      expect(snapshot.planned?.standingS).toBe(31.3);
    });

    it('plans the lane at the limit for a visit with nothing to stand for', () => {
      const store = withLines({
        speedLimitMs: null,
        driveS: [24, 26, 25],
        standingS: {},
      });
      const processor = start({ store });
      run(processor, 95, 100, { speed: 20, extra: { LmuPitStopTime: [0] } });
      run(processor, 100, 101, {
        onPitRoad: true,
        speed: 20,
        extra: { LmuPitStopTime: [0] },
      });
      expect(processor.snapshot().planned).toEqual({
        standingS: 0,
        driveS: 17.2,
      });
    });

    it('plans it at the measured time for a stop that stands', () => {
      const store = withLines({
        speedLimitMs: null,
        driveS: [24, 26, 25],
        standingS: {},
      });
      const processor = start({ store });
      run(processor, 95, 100, { speed: 20, extra: { LmuPitStopTime: [12] } });
      run(processor, 100, 101, {
        onPitRoad: true,
        speed: 20,
        extra: { LmuPitStopTime: [12] },
      });
      expect(processor.snapshot().planned).toEqual({
        standingS: 12,
        driveS: 25,
      });
    });
  });

  describe('the lane model', () => {
    it('measures the stored lane and drives it at the session limit', () => {
      const processor = start({ store: withLines(), lapTimes: lapTimes(86.7) });
      run(processor, 10, 11, {});
      expect(processor.snapshot().lane).toEqual({
        entryPct: 0.95,
        exitPct: 0.03,
        lengthM: 287.2,
        speedLimitMs: 16.67,
        // No session of Le Mans Ultimate states its limit.
        speedLimitSource: 'assumed',
        driveAtLimitS: 17.2,
        driveMeasuredS: null,
        // 8 % of a lap at 86.7 s.
        trackTimeS: 6.9,
      });
    });

    it("takes iRacing's limit as the sim's own", () => {
      const processor = start({ store: withLines() });
      run(processor, 10, 11, { sim: 'iracing' });
      expect(processor.snapshot().lane.speedLimitSource).toBe('sim');
    });

    it('has nothing to give while a line is missing', () => {
      const store = createMemoryPitLaneModelStore({
        [TRACK]: { pitEntryPct: 0.95, pitExitPct: null },
      });
      const processor = start({ store });
      run(processor, 10, 11, {});
      expect(processor.snapshot().lane).toMatchObject({
        entryPct: 0.95,
        exitPct: null,
        lengthM: null,
        driveAtLimitS: null,
        trackTimeS: null,
      });
      expect(processor.snapshot().rejoin?.driveToExitS).toBeNull();
      expect(processor.snapshot().rejoin?.passes).toEqual([]);
    });

    it('falls back to the class estimate for a pace before a lap is timed', () => {
      const processor = start({ store: withLines() });
      run(processor, 10, 11, {});
      // 8 % of 84.2 s.
      expect(processor.snapshot().lane.trackTimeS).toBe(6.7);
    });

    it('learns the two lines from any car and keeps them', () => {
      const store = createMemoryPitLaneModelStore();
      const processor = start({ store }, 2);
      const other = (pct: number, onPitRoad: boolean): CarInput[] => [
        { pct: 0.5 },
        { pct, onPitRoad },
      ];
      processor.onFrame(frame({ time: 10, cars: other(0.948, false) }));
      processor.onFrame(frame({ time: 10.2, cars: other(0.952, true) }));
      expect(processor.snapshot().lane.entryPct).toBe(0.95);
      expect(processor.snapshot().lane.exitPct).toBeNull();

      processor.onFrame(frame({ time: 40, cars: other(0.028, true) }));
      processor.onFrame(frame({ time: 40.2, cars: other(0.032, false) }));
      expect(processor.snapshot().lane).toMatchObject({
        entryPct: 0.95,
        exitPct: 0.03,
        lengthM: 287.2,
      });
      expect(store.get(TRACK)).toEqual({ pitEntryPct: 0.95, pitExitPct: 0.03 });
    });

    it('reads no line off a car leaving its stall, or one that was moved', () => {
      const processor = start({}, 2);
      const other = (
        pct: number,
        onPitRoad: boolean,
        surface: number = TrackLocation.OnTrack
      ): CarInput[] => [{ pct: 0.5 }, { pct, onPitRoad, surface }];
      // Out of its stall onto the lane.
      processor.onFrame(
        frame({ time: 10, cars: other(0.98, false, TrackLocation.InPitStall) })
      );
      processor.onFrame(frame({ time: 10.2, cars: other(0.981, true) }));
      expect(processor.snapshot().lane.entryPct).toBeNull();

      // Stopped out on the circuit and put back in its box.
      processor.onFrame(frame({ time: 20, cars: other(0.4, false) }));
      processor.onFrame(frame({ time: 20.2, cars: other(0.985, true) }));
      expect(processor.snapshot().lane.entryPct).toBeNull();

      // And frames that are not neighbours say nothing either.
      processor.onFrame(frame({ time: 30, cars: other(0.948, false) }));
      processor.onFrame(frame({ time: 35, cars: other(0.952, true) }));
      expect(processor.snapshot().lane.entryPct).toBeNull();
    });

    it('shows a line learned from a recorded source and keeps none of it', () => {
      const store = createMemoryPitLaneModelStore();
      const processor = start({ store, sourceReplay: true }, 2);
      processor.onFrame(
        frame({ time: 10, cars: [{ pct: 0.5 }, { pct: 0.948 }] })
      );
      processor.onFrame(
        frame({
          time: 10.2,
          cars: [{ pct: 0.5 }, { pct: 0.952, onPitRoad: true }],
        })
      );
      expect(processor.snapshot().lane.entryPct).toBe(0.95);
      expect(store.get(TRACK)).toBeNull();

      // Nor a stop made on it.
      const lines = withLines();
      const replayed = start({ store: lines, sourceReplay: true });
      makeStop(replayed);
      expect(replayed.snapshot().last).not.toBeNull();
      expect(lines.get(TRACK)?.timing).toBeUndefined();
    });

    it('measures the limit on the limiter and prefers it to the assumed one', () => {
      const store = withLines();
      const processor = start({ store });
      const limiter = {
        dcPitSpeedLimiterToggle: [true],
        ThrottleRaw: [1],
        BrakeRaw: [0],
      };
      run(processor, 95, 100, { speed: 20 });
      run(processor, 100, 100.8, {
        onPitRoad: true,
        speed: 16.6,
        extra: limiter,
      });
      expect(store.get(TRACK)?.timing).toBeUndefined();

      // The fifth sample settles it, and the frame after reads it back.
      run(processor, 100.8, 101.2, {
        onPitRoad: true,
        speed: 16.6,
        extra: limiter,
      });
      expect(store.get(TRACK)?.timing?.speedLimitMs).toBe(16.6);
      expect(processor.snapshot().lane).toMatchObject({
        speedLimitMs: 16.6,
        speedLimitSource: 'measured',
        driveAtLimitS: 17.3,
      });
    });

    it.each([
      ['with the brake on', { BrakeRaw: [0.05] }],
      ['short of full throttle', { ThrottleRaw: [0.9] }],
      ['with the limiter off', { dcPitSpeedLimiterToggle: [false] }],
    ])('measures no limit %s', (_, override) => {
      const store = withLines();
      const processor = start({ store });
      run(processor, 95, 100, { speed: 20 });
      run(processor, 100, 104, {
        onPitRoad: true,
        speed: 16.6,
        extra: {
          dcPitSpeedLimiterToggle: [true],
          ThrottleRaw: [1],
          BrakeRaw: [0],
          ...override,
        },
      });
      expect(store.get(TRACK)?.timing).toBeUndefined();
      expect(processor.snapshot().lane.speedLimitSource).toBe('assumed');
    });

    it('reads the store again when it says it has changed', () => {
      const store = createMemoryPitLaneModelStore();
      const processor = start({ store });
      run(processor, 10, 11, {});
      expect(processor.snapshot().lane.entryPct).toBeNull();

      // The calibration arrives: a file read finishing, or the helper's.
      store.save(TRACK, LINES);
      run(processor, 11, 12, {});
      expect(processor.snapshot().lane.lengthM).toBe(287.2);
    });

    it('is forgotten with the track on a disconnect', () => {
      const processor = start({ store: withLines() });
      run(processor, 10, 11, {});
      expect(processor.snapshot().lane.lengthM).toBe(287.2);

      processor.onLifecycle({ type: 'disconnect' });
      const snapshot = processor.snapshot();
      expect(snapshot.lane).toEqual({
        entryPct: null,
        exitPct: null,
        lengthM: null,
        speedLimitMs: null,
        speedLimitSource: null,
        driveAtLimitS: null,
        driveMeasuredS: null,
        trackTimeS: null,
      });
      expect(snapshot.sessionNum).toBeNull();
      expect(snapshot.phase).toBe('idle');
    });
  });

  describe('the estimate', () => {
    it("is the sim's own under Le Mans Ultimate, with its eight parts", () => {
      const processor = start();
      run(processor, 10, 11, {
        extra: {
          LmuPitStopTime: [42.27],
          // fuel, ve, tires, damage, driverSwap, brakes, brakeDucts, penalties
          LmuPitStopParts: [12.31, 6.02, 12, 30.04, 0, 0, 0, 0],
        },
      });
      expect(processor.snapshot().estimate).toEqual({
        source: 'sim',
        standingS: 42.3,
        parts: {
          fuel: 12.3,
          energy: 6,
          tyres: 12,
          damage: 30,
          driverSwap: 0,
          brakes: 0,
          brakeDucts: 0,
          penalties: 0,
        },
        optionalRepairS: null,
        samples: 0,
        penalty: null,
      });
    });

    it('has none before the sim has answered', () => {
      const processor = start();
      run(processor, 10, 11, {});
      expect(processor.snapshot().estimate).toEqual({
        source: null,
        standingS: null,
        parts: null,
        optionalRepairS: null,
        samples: 0,
        penalty: null,
      });
    });

    it('names the penalty the car has to serve', () => {
      const processor = start();
      // A drive-through: one outstanding, and the stop holds the car for
      // nothing.
      run(processor, 10, 11, {
        extra: {
          LmuCarIdxPenalties: [1],
          LmuPenaltySeconds: [0],
          LmuPitStopTime: [0],
        },
      });
      expect(processor.snapshot().estimate.penalty).toBe('DT');

      // A stop-and-go holds it.
      run(processor, 11, 12, {
        extra: { LmuCarIdxPenalties: [1], LmuPenaltySeconds: [10] },
      });
      expect(processor.snapshot().estimate.penalty).toBe('SG');

      // Where the sim's own feed names the kind, that is the kind.
      run(processor, 12, 13, {
        extra: {
          LmuCarIdxPenalties: [1],
          LmuPenaltySeconds: [10],
          LmuCarIdxPenaltyKind: [3],
        },
      });
      expect(processor.snapshot().estimate.penalty).toBe('TIME');

      run(processor, 13, 14, { extra: { LmuCarIdxPenalties: [0] } });
      expect(processor.snapshot().estimate.penalty).toBeNull();
    });

    it("is learned from the player's own stops under iRacing", () => {
      const store = withLines({
        speedLimitMs: null,
        driveS: [],
        standingS: { [CAR]: [31, 40, 33], 'Some other car': [12] },
      });
      const processor = start({ store });
      run(processor, 10, 11, { sim: 'iracing' });
      expect(processor.snapshot().estimate).toMatchObject({
        source: 'learned',
        standingS: 33,
        samples: 3,
        optionalRepairS: 0,
      });

      // Never less than the repair the car is waiting for.
      run(processor, 11, 12, {
        sim: 'iracing',
        extra: { PitRepairLeft: [50], PitOptRepairLeft: [20] },
      });
      const { estimate } = processor.snapshot();
      expect(estimate.standingS).toBe(50);
      expect(estimate.optionalRepairS).toBe(20);
      expect(estimate.parts).toMatchObject({ damage: 50, fuel: 0, tyres: 0 });
    });

    it('has only the repair to go on before the first stop under iRacing', () => {
      const processor = start({ store: withLines() });
      run(processor, 10, 11, { sim: 'iracing' });
      expect(processor.snapshot().estimate).toMatchObject({
        source: null,
        standingS: null,
        samples: 0,
      });

      run(processor, 11, 12, {
        sim: 'iracing',
        extra: { PitRepairLeft: [14] },
      });
      expect(processor.snapshot().estimate).toMatchObject({
        source: 'learned',
        standingS: 14,
        samples: 0,
      });
    });
  });

  describe('the refuel', () => {
    it('says what the stop adds and how far the level set goes', () => {
      const processor = start({
        fuel: fuel({
          budget: 'virtualEnergy',
          fuelLevel: 43.6,
          completedLaps: [fuelLap(2.3), fuelLap(2.3)],
          hasValidRaceEstimate: true,
          estimatedLapsRemaining: 30,
        }),
        lapTimes: lapTimes(86.7),
      });
      run(processor, 10, 11, {
        extra: {
          LmuRefuelTarget: [45],
          LmuRefuelTargetIsVirtualEnergy: [true],
        },
      });
      expect(processor.snapshot().refuel).toEqual({
        isVirtualEnergy: true,
        target: 45,
        aboard: 43.6,
        toAdd: 1.4,
        // 30 laps at 2.3 % is 69 %, and 43.6 % is aboard.
        toFinish: 25.4,
        runLaps: 19.6,
        runMinutes: 28.3,
      });
    });

    it('adds nothing when the level set is below what is aboard', () => {
      const processor = start({
        fuel: fuel({ budget: 'virtualEnergy', fuelLevel: 60 }),
      });
      run(processor, 10, 11, {
        extra: {
          LmuRefuelTarget: [45],
          LmuRefuelTargetIsVirtualEnergy: [true],
        },
      });
      expect(processor.snapshot().refuel).toMatchObject({
        toAdd: 0,
        toFinish: null,
        runLaps: null,
        runMinutes: null,
      });
    });

    it('reads a litres level against the tank of a car on virtual energy', () => {
      const processor = start({
        fuel: fuel({
          budget: 'virtualEnergy',
          fuelLevel: 43.6,
          tank: { level: 50.2, perLap: 2.4 },
          completedLaps: [fuelLap(2.3)],
        }),
      });
      run(processor, 10, 11, {
        extra: {
          LmuRefuelTarget: [60],
          LmuRefuelTargetIsVirtualEnergy: [false],
        },
      });
      expect(processor.snapshot().refuel).toMatchObject({
        isVirtualEnergy: false,
        target: 60,
        aboard: 50.2,
        toAdd: 9.8,
        runLaps: 25,
      });
    });

    it("shows iRacing's amount to add as it is, and only when fuel is ticked", () => {
      const processor = start({
        fuel: fuel({ fuelLevel: 20, completedLaps: [fuelLap(2.5)] }),
        lapTimes: lapTimes(90),
      });
      run(processor, 10, 11, {
        sim: 'iracing',
        extra: { PitSvFuel: [30], PitSvFlags: [0x10] },
      });
      expect(processor.snapshot().refuel).toMatchObject({
        isVirtualEnergy: false,
        target: null,
        aboard: 20,
        toAdd: 30,
        runLaps: 20,
        runMinutes: 30,
      });

      run(processor, 11, 12, {
        sim: 'iracing',
        extra: { PitSvFuel: [30], PitSvFlags: [0x0f] },
      });
      expect(processor.snapshot().refuel).toMatchObject({
        toAdd: 0,
        runLaps: 8,
      });
    });

    it('has nothing to say without a fuel projection', () => {
      const processor = start();
      run(processor, 10, 11, {});
      expect(processor.snapshot().refuel).toBeNull();
    });
  });

  describe('the rejoin', () => {
    /** The player fifth in class and six cars around, by race gap. */
    const field = (
      overrides: Partial<Record<number, Partial<CarInput>>> = {}
    ) =>
      [
        { pct: 0.5, position: 6, classPosition: 5, f2: 100 },
        { pct: 0.6, position: 5, classPosition: 4, f2: 92.4 },
        { pct: 0.7, position: 3, classPosition: 2, carClass: LMP2, f2: 96.9 },
        { pct: 0.45, position: 7, classPosition: 6, f2: 105 },
        { pct: 0.4, position: 8, classPosition: 7, f2: 120 },
        { pct: 0.3, position: 9, classPosition: 3, carClass: LMP2, f2: 138 },
        { pct: 0.1, position: 10, classPosition: 8, f2: 170 },
        { pct: 0.9, position: 11, classPosition: 9, f2: 400 },
      ].map((car, index) => ({ ...car, ...overrides[index] }));

    it('lists the nearest car ahead overall and in class, then those behind', () => {
      const processor = start({}, 8);
      run(processor, 10, 11, { cars: field() });
      const rejoin = processor.snapshot().rejoin;

      expect(rejoin?.position).toBe(6);
      expect(rejoin?.classPosition).toBe(5);
      expect(rejoin?.ladder).toEqual([
        { carIdx: 1, gapS: -7.6, sameClass: true, inPit: false },
        { carIdx: 2, gapS: -3.1, sameClass: false, inPit: false },
        { carIdx: 3, gapS: 5, sameClass: true, inPit: false },
        { carIdx: 4, gapS: 20, sameClass: true, inPit: false },
        { carIdx: 5, gapS: 38, sameClass: false, inPit: false },
        { carIdx: 6, gapS: 70, sameClass: true, inPit: false },
        // Car 7 is five minutes back: beyond what a stop can lose.
      ]);
    });

    it('lists one car ahead when the nearest is of the same class', () => {
      const processor = start({}, 8);
      run(processor, 10, 11, { cars: field({ 2: { carClass: GT3 } }) });
      expect(processor.snapshot().rejoin?.ladder.slice(0, 2)).toEqual([
        { carIdx: 2, gapS: -3.1, sameClass: true, inPit: false },
        { carIdx: 3, gapS: 5, sameClass: true, inPit: false },
      ]);
    });

    it('marks a car in the pits and leaves out one that is not in the world', () => {
      const processor = start({}, 8);
      run(processor, 10, 11, {
        cars: field({
          3: { onPitRoad: true },
          4: { surface: TrackLocation.NotInWorld },
        }),
      });
      const ladder = processor.snapshot().rejoin?.ladder ?? [];
      expect(ladder.find((rival) => rival.carIdx === 3)?.inPit).toBe(true);
      expect(ladder.some((rival) => rival.carIdx === 4)).toBe(false);
    });

    it('has no ladder outside a race', () => {
      const processor = start({}, 8);
      run(processor, 10, 11, { sessionNum: 1, cars: field() });
      expect(processor.snapshot().rejoin).toMatchObject({
        position: 6,
        classPosition: 5,
        ladder: [],
      });
    });

    it('carries at most thirty rivals', () => {
      const cars: CarInput[] = Array.from({ length: 50 }, (_, carIdx) => ({
        pct: 0.5,
        position: carIdx === 0 ? 3 : carIdx < 3 ? carIdx : carIdx + 1,
        f2: carIdx === 0 ? 100 : carIdx < 3 ? 90 + carIdx : 100 + carIdx,
      }));
      const processor = start({}, 50);
      run(processor, 10, 11, { cars });
      const ladder = processor.snapshot().rejoin?.ladder ?? [];
      expect(ladder).toHaveLength(30);
      // The nearest ahead, then the twenty-nine nearest behind.
      expect(ladder[0]).toMatchObject({ carIdx: 2, gapS: -8 });
      expect(ladder[1]).toMatchObject({ carIdx: 3, gapS: 3 });
      expect(ladder[29]).toMatchObject({ carIdx: 31, gapS: 31 });
    });

    it('says when every car out on the circuit next passes the pit exit', () => {
      const processor = start(
        { store: withLines(), lapTimes: lapTimes(86.7, 90, 0, 100) },
        4
      );
      processor.onFrame(
        frame({
          time: 200,
          cars: [
            { pct: 0.5 },
            // 53 % of a lap from the exit line at 90 s a lap.
            { pct: 0.5 },
            // No lap yet: the class estimate, 84.2 s; 13 % to go.
            { pct: 0.9 },
            // In the pit lane: not coming past.
            { pct: 0.99, onPitRoad: true },
          ],
        })
      );
      expect(processor.snapshot().rejoin?.passes).toEqual([
        { carIdx: 2, passAt: 210.9, lapTimeS: 84.2, sameClass: true },
        { carIdx: 1, passAt: 247.7, lapTimeS: 90, sameClass: true },
      ]);
    });

    it('gives the drive to the exit line from the circuit and from the lane', () => {
      const processor = start({
        store: withLines(),
        lapTimes: lapTimes(86.7),
      });
      // 45 % of a lap to the entry line at 86.7 s, then the lane at the limit.
      run(processor, 10, 11, { pct: 0.5 });
      expect(processor.snapshot().rejoin?.driveToExitS).toBe(56.2);

      // Half way down the lane: 4 % of 3590.4 m at 16.67 m/s.
      run(processor, 11, 12, { pct: 0.99, onPitRoad: true, speed: 16 });
      expect(processor.snapshot().rejoin?.driveToExitS).toBe(8.6);
    });

    it('has none for a player without a car', () => {
      const processor = start({}, 8);
      run(processor, 10, 11, {
        cars: field({ 0: { surface: TrackLocation.NotInWorld } }),
        isOnTrack: false,
      });
      expect(processor.snapshot().rejoin).toBeNull();
      expect(processor.snapshot().phase).toBe('idle');
    });
  });

  describe('a team-mate at the wheel', () => {
    /** At the monitor with the camera on the team car, which has no speed. */
    const watched = { isOnTrack: false, speed: null } as const;
    const watching = (pitState: number) => ({
      LmuWatching: [true],
      LmuCarIdxPitState: [pitState],
    });

    it('goes on timing the team car by what the sim says of it', () => {
      const store = withLines();
      const processor = start({ store });
      run(processor, 95, 100, { ...watched, extra: watching(1) });
      expect(processor.snapshot().phase).toBe('planning');
      expect(processor.snapshot().requested).toBe(true);

      run(processor, 100, 112, {
        ...watched,
        onPitRoad: true,
        extra: watching(2),
      });
      expect(processor.snapshot().phase).toBe('lane');
      run(processor, 112, 130, {
        ...watched,
        onPitRoad: true,
        extra: watching(3),
      });
      expect(processor.snapshot().phase).toBe('service');
      run(processor, 130, 142, {
        ...watched,
        onPitRoad: true,
        extra: watching(4),
      });
      run(processor, 142, 143, { ...watched, extra: watching(0) });

      expect(processor.snapshot().last).toMatchObject({
        laneS: 42,
        standingS: 18,
      });
      // Not the user's own driving: nothing is filed from it.
      expect(store.get(TRACK)?.timing).toBeUndefined();
    });

    it('is idle at the monitor with nothing being watched', () => {
      const processor = start();
      run(processor, 10, 11, { ...watched });
      expect(processor.snapshot().phase).toBe('idle');
    });
  });

  it('moves its version only when something it publishes has changed', () => {
    const processor = start({ store: withLines(), lapTimes: lapTimes(86.7) });
    run(processor, 10, 11, { pct: 0.5 });
    const version = processor.snapshot().version;
    // The same frame again, a tick later: nothing rounded has moved.
    run(processor, 11, 12, { pct: 0.5 });
    expect(processor.snapshot().version).toBe(version);
  });
});
