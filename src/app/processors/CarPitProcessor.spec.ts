import { describe, expect, it } from 'vitest';
import type { Session, Telemetry } from '@irdashies/types';
import {
  CAR_PIT_IN_GARAGE,
  CAR_PIT_IN_LANE,
  CAR_PIT_ON_TRACK,
  TrackLocation,
} from '@irdashies/types';
import { CarPitProcessor } from './CarPitProcessor';

/** One car on one frame. Everything left out is a car out on the circuit. */
interface CarInput {
  surface?: TrackLocation;
  pitRoad?: boolean;
  lap?: number;
  /** LMU only: 0 none, 1 requested, 2 entering, 3 stopped, 4 exiting. */
  pitState?: number;
  /** LMU only: the stops the sim counts. */
  stops?: number;
  /** LMU only. */
  garage?: boolean;
  /** LMU only: what is left, 0..1, or -1. */
  left?: number;
  /** LMU only: the budget is virtual energy rather than fuel. */
  virtual?: boolean;
}

interface FrameInput {
  time: number;
  cars: CarInput[];
  sessionNum?: number;
  /** Publish LMU's own pit and energy keys beside iRacing's. */
  lmu?: boolean;
  playerCarIdx?: number;
  /** The player's speed, m/s. */
  speed?: number;
  isOnTrack?: boolean;
}

const frame = ({
  time,
  cars,
  sessionNum = 0,
  lmu = false,
  playerCarIdx = -1,
  speed,
  isOnTrack = false,
}: FrameInput): Telemetry => {
  const out: Record<string, { value: unknown[] }> = {
    SessionTime: { value: [time] },
    SessionNum: { value: [sessionNum] },
    PlayerCarIdx: { value: [playerCarIdx] },
    IsOnTrack: { value: [isOnTrack] },
    CarIdxTrackSurface: {
      value: cars.map((car) => car.surface ?? TrackLocation.OnTrack),
    },
    CarIdxOnPitRoad: { value: cars.map((car) => car.pitRoad ?? false) },
    CarIdxLapCompleted: { value: cars.map((car) => car.lap ?? 0) },
  };
  if (speed !== undefined) out.Speed = { value: [speed] };
  if (lmu) {
    out.LmuCarIdxPitState = { value: cars.map((car) => car.pitState ?? 0) };
    out.LmuCarIdxPitStops = { value: cars.map((car) => car.stops ?? 0) };
    out.LmuCarIdxInGarage = { value: cars.map((car) => car.garage ?? false) };
    out.LmuCarIdxEnergyRemaining = {
      value: cars.map((car) => car.left ?? -1),
    };
    out.LmuCarIdxEnergyIsVirtual = {
      value: cars.map((car) => car.virtual ?? false),
    };
  }
  return out as unknown as Telemetry;
};

const roster = (
  entries: { path: string; number: string; paceCar?: boolean }[]
): Session =>
  ({
    DriverInfo: {
      Drivers: entries.map((entry, CarIdx) => ({
        CarIdx,
        CarPath: entry.path,
        CarNumber: entry.number,
        CarIsPaceCar: entry.paceCar ? 1 : 0,
        IsSpectator: 0,
      })),
    },
  }) as unknown as Session;

const TWO_CARS = roster([
  { path: 'ferrari296gt3', number: '51' },
  { path: 'porsche992gt3', number: '92' },
]);

const start = (session: Session = TWO_CARS): CarPitProcessor => {
  const processor = new CarPitProcessor();
  processor.init(session);
  processor.onLifecycle({ type: 'enter', replay: false });
  return processor;
};

/** The processor's own rate: a frame every fifth of a second. */
const TICK = 0.2;

/**
 * Feeds frames from `from` up to, not including, `to`, with car 1 as given
 * and car 0 out on the circuit.
 */
const run = (
  processor: CarPitProcessor,
  from: number,
  to: number,
  car: CarInput,
  rest: Omit<FrameInput, 'time' | 'cars'> = {}
): void => {
  const ticks = Math.round((to - from) / TICK);
  for (let tick = 0; tick < ticks; tick += 1) {
    processor.onFrame(
      frame({ time: from + tick * TICK, cars: [{ lap: 5 }, car], ...rest })
    );
  }
};

const ON_TRACK: CarInput = { lap: 5 };
const IN_LANE: CarInput = {
  lap: 5,
  surface: TrackLocation.ApproachingPits,
  pitRoad: true,
};
const AT_BOX: CarInput = {
  lap: 5,
  surface: TrackLocation.InPitStall,
  pitRoad: true,
};

describe('CarPitProcessor', () => {
  it('starts with nothing', () => {
    const snapshot = new CarPitProcessor().snapshot();

    expect(snapshot.where).toEqual([]);
    expect(snapshot.stops).toEqual([]);
    expect(snapshot.usedLastLap).toEqual([]);
    expect(snapshot.sessionNum).toBeNull();
    expect(snapshot.version).toBe(0);
  });

  it('declares the channel and a sortable rate', () => {
    const processor = new CarPitProcessor();

    expect(processor.channel).toBe('car-pit.snapshot');
    expect(processor.tickRateHz).toBe(5);
  });

  describe('a stop, as iRacing shows it', () => {
    it('times the visit, counts the stop and restarts the stint', () => {
      const processor = start();
      run(processor, 100, 110, ON_TRACK);
      run(processor, 110, 120, IN_LANE);

      let snapshot = processor.snapshot();
      expect(snapshot.where).toEqual([CAR_PIT_ON_TRACK, CAR_PIT_IN_LANE]);
      expect(snapshot.laneTimeS[1]).toBeCloseTo(9.8, 5);
      expect(snapshot.standingS[1]).toBe(0);
      expect(snapshot.stops[1]).toBe(0);
      // Past two seconds in the lane, the lap is a pit lap.
      expect(snapshot.lastPitLap[1]).toBe(5);
      expect(snapshot.stintLaps[1]).toBe(5);
      expect(snapshot.counts).toMatchObject({
        onTrack: 1,
        inLane: 1,
        standingInLane: 0,
      });

      run(processor, 120, 150, AT_BOX);
      snapshot = processor.snapshot();
      expect(snapshot.counts.standingInLane).toBe(1);
      expect(snapshot.stops[1]).toBe(1);
      expect(snapshot.lastStopLap[1]).toBe(5);
      expect(snapshot.stintLaps[1]).toBe(0);
      expect(snapshot.longestStintLaps[1]).toBe(5);

      run(processor, 150, 160, IN_LANE);
      run(processor, 160, 170, ON_TRACK);
      snapshot = processor.snapshot();
      expect(snapshot.where[1]).toBe(CAR_PIT_ON_TRACK);
      // The visit just made stays up: 50 s in the lane, 30 of them standing.
      expect(snapshot.laneTimeS[1]).toBeCloseTo(50, 5);
      expect(snapshot.standingS[1]).toBeCloseTo(30, 5);
      expect(snapshot.stops[1]).toBe(1);

      run(processor, 170, 180, { lap: 8 });
      snapshot = processor.snapshot();
      expect(snapshot.stintLaps[1]).toBe(3);
      expect(snapshot.lastStopLap[1]).toBe(5);
      // The car that never came in is untouched.
      expect(snapshot.stops[0]).toBe(0);
      expect(snapshot.lastStopLap[0]).toBe(-1);
      expect(snapshot.stintLaps[0]).toBe(5);
    });

    it('counts a stop once however long the car stands', () => {
      const processor = start();
      run(processor, 100, 101, IN_LANE);
      run(processor, 101, 400, AT_BOX);

      expect(processor.snapshot().stops[1]).toBe(1);
    });

    it('keeps the longest of several stints', () => {
      const processor = start();
      run(processor, 100, 101, { lap: 12 });
      run(processor, 101, 110, { ...AT_BOX, lap: 12 });
      run(processor, 110, 111, { lap: 12 });
      run(processor, 111, 120, { ...AT_BOX, lap: 20 });
      run(processor, 120, 121, { lap: 20 });
      run(processor, 121, 130, { ...AT_BOX, lap: 23 });

      const snapshot = processor.snapshot();
      expect(snapshot.stops[1]).toBe(3);
      expect(snapshot.longestStintLaps[1]).toBe(12);
      expect(snapshot.lastStopLap[1]).toBe(23);
    });
  });

  describe('a drive-through', () => {
    it('is a pit lap and not a stop', () => {
      const processor = start();
      run(processor, 100, 110, ON_TRACK);
      run(processor, 110, 130, IN_LANE);
      run(processor, 130, 140, { lap: 6 });

      const snapshot = processor.snapshot();
      expect(snapshot.laneTimeS[1]).toBeCloseTo(20, 5);
      expect(snapshot.standingS[1]).toBe(0);
      expect(snapshot.stops[1]).toBe(0);
      expect(snapshot.lastPitLap[1]).toBe(5);
      expect(snapshot.lastStopLap[1]).toBe(-1);
      // The stint goes on through it.
      expect(snapshot.stintLaps[1]).toBe(6);
      expect(snapshot.longestStintLaps[1]).toBe(0);
    });

    it('does not take a moment at rest for a stop', () => {
      const processor = start();
      run(processor, 100, 110, IN_LANE);
      // Under the second it takes to be one.
      run(processor, 110, 110.8, AT_BOX);
      run(processor, 110.8, 120, IN_LANE);

      const snapshot = processor.snapshot();
      expect(snapshot.standingS[1]).toBeCloseTo(0.8, 5);
      expect(snapshot.stops[1]).toBe(0);
      expect(snapshot.stintLaps[1]).toBe(5);
    });

    it('does not take a brush with the pit lane for a pit lap', () => {
      const processor = start();
      run(processor, 100, 110, ON_TRACK);
      run(processor, 110, 111.6, IN_LANE);
      run(processor, 111.6, 120, ON_TRACK);

      const snapshot = processor.snapshot();
      expect(snapshot.lastPitLap[1]).toBe(-1);
      expect(snapshot.laneTimeS[1]).toBeCloseTo(1.6, 5);
    });
  });

  describe('under Le Mans Ultimate', () => {
    const lmu = { lmu: true };

    it("takes the sim's stop count and its word for a car standing", () => {
      const processor = start();
      run(processor, 100, 105, { lap: 5, pitState: 1 }, lmu);

      let snapshot = processor.snapshot();
      expect(snapshot.requested).toEqual([false, true]);
      expect(snapshot.counts.requested).toBe(1);

      run(processor, 105, 115, { ...IN_LANE, pitState: 2 }, lmu);
      // The surface is the pit stall for the garage too, so it is the pit
      // state that says the car has stopped.
      run(processor, 115, 145, { ...AT_BOX, pitState: 3 }, lmu);
      snapshot = processor.snapshot();
      expect(snapshot.requested).toEqual([false, false]);
      expect(snapshot.lastStopLap[1]).toBe(5);
      expect(snapshot.stintLaps[1]).toBe(0);
      // Seen, and not counted by the sim yet: its count is the one shown.
      expect(snapshot.stops[1]).toBe(0);

      run(processor, 145, 155, { ...IN_LANE, pitState: 4, stops: 1 }, lmu);
      run(processor, 155, 160, { lap: 5, stops: 1 }, lmu);
      snapshot = processor.snapshot();
      expect(snapshot.stops[1]).toBe(1);
      expect(snapshot.laneTimeS[1]).toBeCloseTo(50, 5);
      expect(snapshot.standingS[1]).toBeCloseTo(30, 5);
    });

    it('does not read a car rolling through its box as standing', () => {
      const processor = start();
      // The pit-stall surface without the stopped state.
      run(processor, 100, 130, { ...AT_BOX, pitState: 2 }, lmu);

      const snapshot = processor.snapshot();
      expect(snapshot.standingS[1]).toBe(0);
      expect(snapshot.lastStopLap[1]).toBe(-1);
    });

    it('holds a car in its garage at zero and starts its stint there', () => {
      const processor = start();
      run(processor, 100, 110, { lap: 7 }, lmu);
      run(processor, 110, 120, { ...IN_LANE, lap: 7 }, lmu);
      const garaged = { ...AT_BOX, lap: 7, garage: true };
      run(processor, 120, 200, garaged, lmu);

      let snapshot = processor.snapshot();
      expect(snapshot.where[1]).toBe(CAR_PIT_IN_GARAGE);
      expect(snapshot.laneTimeS[1]).toBe(0);
      expect(snapshot.standingS[1]).toBe(0);
      expect(snapshot.stintLaps[1]).toBe(0);
      expect(snapshot.longestStintLaps[1]).toBe(7);
      // A garage visit is not a stop the tracker counts: the sim's count
      // stands, and it has counted none.
      expect(snapshot.stops[1]).toBe(0);
      expect(snapshot.lastStopLap[1]).toBe(-1);
      expect(snapshot.counts).toMatchObject({ onTrack: 1, inGarage: 1 });

      // Out of the garage: the lane clock starts from the garage door.
      run(processor, 200, 205, { ...IN_LANE, lap: 7 }, lmu);
      run(processor, 205, 210, { lap: 9 }, lmu);
      snapshot = processor.snapshot();
      expect(snapshot.laneTimeS[1]).toBeCloseTo(5, 5);
      expect(snapshot.stintLaps[1]).toBe(2);
    });

    it('does not guess the stint of a car that stopped before it watched', () => {
      const processor = start();
      run(processor, 900, 910, { lap: 31, stops: 2 }, lmu);

      let snapshot = processor.snapshot();
      expect(snapshot.stops[1]).toBe(2);
      expect(snapshot.stintLaps[1]).toBe(-1);
      // The car beside it has not stopped: its stint is the race so far.
      expect(snapshot.stintLaps[0]).toBe(5);

      const stopping = { ...AT_BOX, lap: 33, pitState: 3, stops: 2 };
      run(processor, 910, 920, stopping, lmu);
      run(processor, 920, 930, { lap: 36, stops: 3 }, lmu);
      snapshot = processor.snapshot();
      expect(snapshot.stops[1]).toBe(3);
      expect(snapshot.stintLaps[1]).toBe(3);
      // The stint it was on when first seen was never measured.
      expect(snapshot.longestStintLaps[1]).toBe(0);
    });
  });

  describe("the player's own car", () => {
    const player = { playerCarIdx: 1, isOnTrack: true };

    it('stands by its own speed, whatever the surface says', () => {
      const processor = start();
      // Rolling through its own stall on the way down the lane.
      run(processor, 100, 110, AT_BOX, { ...player, speed: 16 });
      expect(processor.snapshot().standingS[1]).toBe(0);
      expect(processor.snapshot().stops[1]).toBe(0);

      // Stopped short of it, on the lane, and away again.
      run(processor, 110, 115, IN_LANE, { ...player, speed: 0.05 });
      run(processor, 115, 116, IN_LANE, { ...player, speed: 12 });
      expect(processor.snapshot().standingS[1]).toBeCloseTo(5, 5);
      expect(processor.snapshot().stops[1]).toBe(1);
    });

    it("falls back to the sim's word while the player is out of the car", () => {
      const processor = start();
      // A team-mate at the wheel: the speed on the frame is not the car's.
      run(processor, 100, 120, IN_LANE, {
        playerCarIdx: 1,
        isOnTrack: false,
        speed: 0,
      });

      expect(processor.snapshot().standingS[1]).toBe(0);
      expect(processor.snapshot().stops[1]).toBe(0);
    });
  });

  describe('a car that is not in the world', () => {
    const GONE: CarInput = { surface: TrackLocation.NotInWorld, lap: -1 };

    it('makes one stop of a driver change', () => {
      const processor = start();
      run(processor, 100, 110, IN_LANE);
      run(processor, 110, 120, AT_BOX);
      // The car leaves the world while the drivers swap, and comes back.
      run(processor, 120, 150, GONE);
      expect(processor.snapshot().where[1]).toBe(CAR_PIT_IN_GARAGE);
      expect(processor.snapshot().counts.inGarage).toBe(1);
      run(processor, 150, 160, AT_BOX);
      run(processor, 160, 170, IN_LANE);
      run(processor, 170, 180, ON_TRACK);

      const snapshot = processor.snapshot();
      expect(snapshot.stops[1]).toBe(1);
      expect(snapshot.lastStopLap[1]).toBe(5);
      // One visit, from the first entry to the exit.
      expect(snapshot.laneTimeS[1]).toBeCloseTo(70, 5);
    });

    it('takes a car that joins late from where it joins', () => {
      const processor = start();
      run(processor, 100, 300, GONE);

      let snapshot = processor.snapshot();
      expect(snapshot.where).toEqual([CAR_PIT_ON_TRACK, CAR_PIT_IN_GARAGE]);
      expect(snapshot.stops[1]).toBe(0);
      expect(snapshot.stintLaps[1]).toBe(0);
      expect(snapshot.counts).toMatchObject({ onTrack: 1, inGarage: 1 });

      run(processor, 300, 310, { ...IN_LANE, lap: 0 });
      run(processor, 310, 320, { lap: 2 });
      snapshot = processor.snapshot();
      expect(snapshot.where[1]).toBe(CAR_PIT_ON_TRACK);
      expect(snapshot.laneTimeS[1]).toBeCloseTo(10, 5);
      expect(snapshot.stops[1]).toBe(0);
      expect(snapshot.stintLaps[1]).toBe(2);
      expect(snapshot.counts).toMatchObject({ onTrack: 2, inGarage: 0 });
    });

    it('does not count a slot the session names nobody for', () => {
      const processor = start();
      processor.onFrame(
        frame({ time: 100, cars: [ON_TRACK, ON_TRACK, GONE, GONE] })
      );

      expect(processor.snapshot().where).toEqual([
        CAR_PIT_ON_TRACK,
        CAR_PIT_ON_TRACK,
        CAR_PIT_IN_GARAGE,
        CAR_PIT_IN_GARAGE,
      ]);
      expect(processor.snapshot().counts.inGarage).toBe(0);
    });
  });

  describe('a slot reused by another car', () => {
    it('forgets the car that left when the session names another', () => {
      const processor = start();
      run(processor, 100, 101, IN_LANE);
      run(processor, 101, 110, AT_BOX);
      run(processor, 110, 120, { lap: 9 });
      expect(processor.snapshot().stops[1]).toBe(1);
      expect(processor.snapshot().stintLaps[1]).toBe(4);
      const before = processor.snapshot().version;

      processor.init(
        roster([
          { path: 'ferrari296gt3', number: '51' },
          { path: 'bmwm4gt3', number: '46' },
        ])
      );
      // At once, before the new car has been seen on a frame.
      expect(processor.snapshot().stops[1]).toBe(0);
      expect(processor.snapshot().longestStintLaps[1]).toBe(0);
      expect(processor.snapshot().version).toBeGreaterThan(before);
      run(processor, 120, 130, { lap: 9 });

      const snapshot = processor.snapshot();
      expect(snapshot.stops[1]).toBe(0);
      expect(snapshot.lastStopLap[1]).toBe(-1);
      expect(snapshot.longestStintLaps[1]).toBe(0);
      expect(snapshot.stintLaps[1]).toBe(9);
    });

    it('keeps the car through a session republished unchanged', () => {
      const processor = start();
      run(processor, 100, 101, IN_LANE);
      run(processor, 101, 110, AT_BOX);
      processor.init(TWO_CARS);
      run(processor, 110, 120, { lap: 9 });

      expect(processor.snapshot().stops[1]).toBe(1);
      expect(processor.snapshot().stintLaps[1]).toBe(4);
    });

    it('forgets a car whose lap count falls', () => {
      const processor = start();
      run(processor, 100, 101, IN_LANE);
      run(processor, 101, 110, AT_BOX);
      run(processor, 110, 120, { lap: 9 });
      // Before the session has said who it is: fewer laps than the slot had.
      run(processor, 120, 130, { lap: 1 });

      const snapshot = processor.snapshot();
      expect(snapshot.stops[1]).toBe(0);
      expect(snapshot.lastStopLap[1]).toBe(-1);
      expect(snapshot.stintLaps[1]).toBe(1);
    });
  });

  describe('a session change', () => {
    const stopped = (): CarPitProcessor => {
      const processor = start();
      run(processor, 100, 101, IN_LANE);
      run(processor, 101, 110, AT_BOX);
      run(processor, 110, 120, { lap: 9 });
      expect(processor.snapshot().stops[1]).toBe(1);
      return processor;
    };

    it('forgets everything when the session number moves', () => {
      const processor = stopped();
      run(processor, 120, 130, { lap: 9 }, { sessionNum: 1 });

      const snapshot = processor.snapshot();
      expect(snapshot.sessionNum).toBe(1);
      expect(snapshot.stops).toEqual([0, 0]);
      expect(snapshot.lastStopLap).toEqual([-1, -1]);
      expect(snapshot.longestStintLaps).toEqual([0, 0]);
      expect(snapshot.laneTimeS).toEqual([0, 0]);
    });

    it('forgets everything on the lifecycle event, before any frame', () => {
      const processor = stopped();
      const before = processor.snapshot().version;
      processor.onLifecycle({ type: 'sessionNumChange' });

      const snapshot = processor.snapshot();
      expect(snapshot.version).toBeGreaterThan(before);
      expect(snapshot.where).toEqual([]);
      expect(snapshot.stops).toEqual([]);
      expect(snapshot.sessionNum).toBeNull();
    });

    it('forgets everything when the clock runs backwards', () => {
      const processor = stopped();
      run(processor, 20, 30, { lap: 0 });

      const snapshot = processor.snapshot();
      expect(snapshot.stops).toEqual([0, 0]);
      expect(snapshot.lastStopLap).toEqual([-1, -1]);
      expect(snapshot.stintLaps).toEqual([5, 0]);
    });

    it('empties on disconnect, and forgets who held which slot', () => {
      const processor = stopped();
      processor.onLifecycle({ type: 'disconnect' });

      expect(processor.snapshot().where).toEqual([]);
      expect(processor.snapshot().sessionNum).toBeNull();
      expect(processor.snapshot().counts).toEqual({
        onTrack: 0,
        inLane: 0,
        standingInLane: 0,
        requested: 0,
        inGarage: 0,
      });

      // Another session, with no roster yet: an empty slot is nobody's.
      processor.onLifecycle({ type: 'enter', replay: false });
      processor.onFrame(
        frame({
          time: 5,
          cars: [ON_TRACK, { surface: TrackLocation.NotInWorld }],
        })
      );
      expect(processor.snapshot().counts.inGarage).toBe(0);
    });
  });

  it('takes nothing from a replay', () => {
    const processor = start();
    processor.onLifecycle({ type: 'enter', replay: true });
    const before = processor.snapshot().version;
    run(processor, 100, 101, IN_LANE);
    run(processor, 101, 110, AT_BOX);

    expect(processor.snapshot().version).toBe(before);
    expect(processor.snapshot().where).toEqual([]);

    processor.onLifecycle({ type: 'enter', replay: false });
    run(processor, 110, 120, AT_BOX);
    expect(processor.snapshot().stops[1]).toBe(1);
  });

  it('leaves the pace car out', () => {
    const processor = start(
      roster([
        { path: 'safety pcporsche911cup', number: '0', paceCar: true },
        { path: 'porsche992gt3', number: '92' },
      ])
    );
    processor.onFrame(frame({ time: 100, cars: [AT_BOX, ON_TRACK] }));
    processor.onFrame(frame({ time: 105, cars: [AT_BOX, ON_TRACK] }));

    const snapshot = processor.snapshot();
    expect(snapshot.where).toEqual([CAR_PIT_IN_GARAGE, CAR_PIT_ON_TRACK]);
    expect(snapshot.stops[0]).toBe(0);
    expect(snapshot.counts).toMatchObject({
      onTrack: 1,
      inLane: 0,
      inGarage: 0,
    });
  });

  it('does not add to a standing time across a gap in the frames', () => {
    const processor = start();
    run(processor, 100, 100.6, AT_BOX);
    // Paused, or the sim stopped writing: the next frame is a minute on.
    run(processor, 160, 160.2, AT_BOX);

    const snapshot = processor.snapshot();
    expect(snapshot.standingS[1]).toBeCloseTo(0.4, 5);
    expect(snapshot.stops[1]).toBe(0);
  });

  it('publishes only when something moved', () => {
    const processor = start();
    run(processor, 100, 110, ON_TRACK);
    const settled = processor.snapshot().version;
    run(processor, 110, 200, ON_TRACK);
    expect(processor.snapshot().version).toBe(settled);

    // A car in the lane moves its timer on every tick.
    run(processor, 200, 201, IN_LANE);
    expect(processor.snapshot().version).toBe(settled + 5);
  });

  describe('energy per lap', () => {
    const lmu = { lmu: true };
    const reading = (
      processor: CarPitProcessor,
      time: number,
      lap: number,
      left: number,
      virtual = true
    ): void =>
      processor.onFrame(
        frame({
          time,
          lmu: true,
          cars: [{ lap: 5 }, { lap, left, virtual }],
        })
      );

    /**
     * Car 1 completing a lap with what it has left at the completion. The
     * reading that goes with a completion is taken a second after it, so
     * this is two frames: the line, and a second on.
     */
    const complete = (
      processor: CarPitProcessor,
      time: number,
      lap: number,
      left: number,
      virtual = true
    ): void => {
      reading(processor, time, lap, left, virtual);
      reading(processor, time + 1, lap, left, virtual);
    };

    it('samples from one completion to the next', () => {
      const processor = start();
      complete(processor, 100, 3, 0.52);
      // No baseline from the first sight: only from a completion.
      complete(processor, 180, 4, 0.5);
      expect(processor.snapshot().usedLastLap[1]).toBe(-1);
      expect(processor.snapshot().lapsLeft[1]).toBe(-1);

      complete(processor, 270, 5, 0.47);
      let snapshot = processor.snapshot();
      expect(snapshot.usedLastLap[1]).toBe(0.03);
      expect(snapshot.usedAverage[1]).toBe(0.03);
      expect(snapshot.lapsLeft[1]).toBe(15.7);

      complete(processor, 360, 6, 0.45);
      snapshot = processor.snapshot();
      expect(snapshot.usedLastLap[1]).toBe(0.02);
      // The first sample, then a third of the way to the next.
      expect(snapshot.usedAverage[1]).toBe(0.0267);
      expect(snapshot.lapsLeft[1]).toBe(22.5);
    });

    it('does not take the reading at the line itself', () => {
      // As on the recorded race: LMU's fuel byte reads a full tank for one
      // scoring update while the car crosses the line.
      const processor = start();
      reading(processor, 100, 3, 0.52, false);
      for (const [line, lap, left] of [
        [180, 4, 0.5],
        [270, 5, 0.47],
      ]) {
        reading(processor, line, lap, 1, false);
        reading(processor, line + 0.2, lap, left, false);
        reading(processor, line + 1, lap, left, false);
      }

      const snapshot = processor.snapshot();
      expect(snapshot.usedLastLap[1]).toBe(0.03);
      expect(snapshot.lapsLeft[1]).toBe(15.7);
    });

    it('waits the second out before it takes a reading', () => {
      const processor = start();
      complete(processor, 100, 3, 0.52);
      complete(processor, 180, 4, 0.5);
      reading(processor, 270, 5, 0.47);
      reading(processor, 270.8, 5, 0.47);
      expect(processor.snapshot().usedLastLap[1]).toBe(-1);

      reading(processor, 271, 5, 0.47);
      expect(processor.snapshot().usedLastLap[1]).toBe(0.03);
    });

    it('keeps the usage through a refuel', () => {
      const processor = start();
      complete(processor, 100, 3, 0.52);
      complete(processor, 180, 4, 0.5);
      complete(processor, 270, 5, 0.47);
      complete(processor, 360, 6, 0.45);
      complete(processor, 480, 7, 0.95);

      const snapshot = processor.snapshot();
      expect(snapshot.usedLastLap[1]).toBe(0.02);
      expect(snapshot.usedAverage[1]).toBe(0.0267);
      expect(snapshot.lapsLeft[1]).toBe(47.5);
    });

    it('takes a new baseline, and no sample, when the count jumps', () => {
      const processor = start();
      complete(processor, 100, 3, 0.52);
      complete(processor, 180, 4, 0.5);
      complete(processor, 270, 5, 0.47);
      complete(processor, 450, 7, 0.41);

      let snapshot = processor.snapshot();
      expect(snapshot.usedLastLap[1]).toBe(0.03);
      expect(snapshot.usedAverage[1]).toBe(0.03);
      expect(snapshot.lapsLeft[1]).toBe(13.7);

      // And samples again from there.
      complete(processor, 540, 8, 0.385);
      snapshot = processor.snapshot();
      expect(snapshot.usedLastLap[1]).toBe(0.025);
    });

    it('clears the car on a reading of -1', () => {
      const processor = start();
      complete(processor, 100, 3, 0.52);
      complete(processor, 180, 4, 0.5);
      complete(processor, 270, 5, 0.47);
      reading(processor, 275, 5, -1);

      const snapshot = processor.snapshot();
      expect(snapshot.usedLastLap[1]).toBe(-1);
      expect(snapshot.usedAverage[1]).toBe(-1);
      expect(snapshot.lapsLeft[1]).toBe(-1);

      // Back again: a baseline has to be taken afresh.
      reading(processor, 276, 5, 0.47);
      complete(processor, 360, 6, 0.44);
      expect(processor.snapshot().usedLastLap[1]).toBe(-1);
      complete(processor, 450, 7, 0.41);
      expect(processor.snapshot().usedLastLap[1]).toBe(0.03);
    });

    it('clears the car when its budget changes', () => {
      const processor = start();
      complete(processor, 100, 3, 0.52);
      complete(processor, 180, 4, 0.5);
      complete(processor, 270, 5, 0.47);
      // Fuel now, where it was virtual energy.
      reading(processor, 275, 5, 0.6, false);

      expect(processor.snapshot().usedLastLap[1]).toBe(-1);
      expect(processor.snapshot().usedAverage[1]).toBe(-1);
    });

    it('clears the car when its lap count falls', () => {
      const processor = start();
      complete(processor, 100, 3, 0.52);
      complete(processor, 180, 4, 0.5);
      complete(processor, 270, 5, 0.47);
      complete(processor, 280, 0, 0.9);

      expect(processor.snapshot().usedLastLap[1]).toBe(-1);
      expect(processor.snapshot().lapsLeft[1]).toBe(-1);
    });

    it('clears every car on a session change', () => {
      const processor = start();
      complete(processor, 100, 3, 0.52);
      complete(processor, 180, 4, 0.5);
      complete(processor, 270, 5, 0.47);
      processor.onLifecycle({ type: 'sessionNumChange' });
      expect(processor.snapshot().usedLastLap).toEqual([]);

      complete(processor, 10, 0, 0.9);
      expect(processor.snapshot().usedLastLap).toEqual([-1, -1]);
    });

    it('moves only when a car completes a lap', () => {
      const processor = start();
      complete(processor, 100, 3, 0.52);
      complete(processor, 180, 4, 0.5);
      complete(processor, 270, 5, 0.47);
      const version = processor.snapshot().version;
      // The energy falls all the way round the lap; nothing is published.
      for (let tick = 1; tick <= 50; tick += 1) {
        reading(processor, 271 + tick, 5, 0.47 - tick * 0.0005);
      }

      expect(processor.snapshot().version).toBe(version);
    });

    it('leaves the arrays empty where the sim states no budget', () => {
      const processor = start();
      run(processor, 100, 110, ON_TRACK);

      const snapshot = processor.snapshot();
      expect(snapshot.usedLastLap).toEqual([]);
      expect(snapshot.usedAverage).toEqual([]);
      expect(snapshot.lapsLeft).toEqual([]);
      expect(snapshot.requested).toEqual([]);

      run(processor, 110, 120, { lap: 5, left: 0.5 }, lmu);
      expect(processor.snapshot().usedLastLap).toEqual([-1, -1]);
      expect(processor.snapshot().requested).toEqual([false, false]);
    });
  });
});
