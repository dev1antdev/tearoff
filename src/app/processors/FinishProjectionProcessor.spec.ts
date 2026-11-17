import { describe, expect, it } from 'vitest';
import type {
  CarPitSnapshot,
  FinishRival,
  FuelLapData,
  FuelProjectionSnapshot,
  FuelRaceInputs,
  LapTimesSnapshot,
  LmuPitService,
  PitLaneModel,
  PitStopParts,
  PitStopSnapshot,
  Session,
  StandingsSnapshot,
  Telemetry,
} from '@irdashies/types';
import {
  CAR_PIT_IN_GARAGE,
  CAR_PIT_IN_LANE,
  CAR_PIT_ON_TRACK,
  LMU_FINISH_STATUS,
  SessionState,
  TrackLocation,
} from '@irdashies/types';
import { FinishProjectionProcessor } from './FinishProjectionProcessor';

/**
 * The finish projection on hand-built snapshots. It measures nothing
 * itself, so every case is what it makes of what the five channels it reads
 * would have said; the recorded race is played through the real ones in the
 * tape spec beside this.
 */

const PLAYER = 0;
/** A prototype leading overall, a class of its own. */
const LEADER = 9;
const GT = 1;
const PROTOTYPE = 2;
/** Slots 0 to 7 are the player's class; 8 and 9 are prototypes. */
const CARS = 10;

const session = (pitService?: LmuPitService): Session =>
  ({
    DriverInfo: {
      DriverCarIdx: PLAYER,
      Drivers: Array.from({ length: CARS }, (_, carIdx) => ({
        CarIdx: carIdx,
        CarClassID: carIdx >= 8 ? PROTOTYPE : GT,
      })),
    },
    ...(pitService ? { LmuRest: { pitService } } : {}),
  }) as unknown as Session;

/** The recorded car's service rates. */
const SERVICE: LmuPitService = {
  fuelFillRate: 3.4,
  fuelInsert: 1,
  fuelRemove: 1,
  fuelTimeConcurrent: 1,
  virtualEnergyFillRate: 0.025,
  virtualEnergyInsert: 0,
  virtualEnergyRemove: 0,
  virtualEnergyTimeConcurrent: 1,
  driverConcurrent: 1,
  tireTimeConcurrent: 0,
  fixTimeConcurrent: 0,
  brakeTimeConcurrent: 0,
};

const lap = (fuelUsed: number): FuelLapData => ({
  lapNumber: 1,
  fuelUsed,
  lapTime: 100,
  isGreenFlag: true,
  isValidForCalc: true,
  isOutLap: false,
  timestamp: 0,
});

/**
 * A timed race with ten minutes on the clock: the leader a quarter of the
 * way round its eleventh lap at 90 s a lap, the player four fifths of the
 * way round its tenth at 100 s.
 */
const race = (values: Partial<FuelRaceInputs> = {}): FuelRaceInputs => ({
  leaderCarIdx: LEADER,
  playerCarIdx: PLAYER,
  leaderPaceS: 90,
  playerPaceS: 100,
  leaderProgress: 10.25,
  playerProgress: 9.8,
  timeRemainingS: 600,
  lapLimit: 0,
  ...values,
});

const fuel = (
  values: Partial<FuelProjectionSnapshot> = {},
  raceValues: Partial<FuelRaceInputs> | null = {}
): FuelProjectionSnapshot =>
  ({
    isReplay: false,
    fuelLevel: 9,
    sessionState: SessionState.Racing,
    sessionType: 'Race',
    estimatedLapsRemaining: 6.2,
    hasValidRaceEstimate: true,
    fuelTankCapacity: 100,
    budget: 'virtualEnergy',
    tank: { level: 8.5, perLap: 2.4 },
    completedLaps: [lap(2.2), lap(2.4)],
    ...(raceValues ? { race: race(raceValues) } : {}),
    ...values,
  }) as FuelProjectionSnapshot;

const lane = (values: Partial<PitLaneModel> = {}): PitLaneModel => ({
  entryPct: 0.95,
  exitPct: 0.03,
  lengthM: 287.2,
  speedLimitMs: 16.6,
  speedLimitSource: 'measured',
  driveAtLimitS: 17.3,
  driveMeasuredS: 24.1,
  trackTimeS: 6.9,
  ...values,
});

const parts = (values: Partial<PitStopParts> = {}): PitStopParts => ({
  fuel: 0,
  energy: 0,
  tyres: 0,
  damage: 0,
  driverSwap: 0,
  brakes: 0,
  brakeDucts: 0,
  penalties: 0,
  ...values,
});

const pitStop = (
  values: {
    lane?: Partial<PitLaneModel>;
    standingS?: number | null;
    parts?: Partial<PitStopParts> | null;
    penalty?: PitStopSnapshot['estimate']['penalty'];
  } = {}
): PitStopSnapshot =>
  ({
    lane: lane(values.lane),
    estimate: {
      source: 'sim',
      standingS: values.standingS === undefined ? 14.2 : values.standingS,
      parts: values.parts === null ? null : parts(values.parts),
      optionalRepairS: null,
      samples: 0,
      penalty: values.penalty ?? null,
    },
  }) as PitStopSnapshot;

const all = <T>(value: T): T[] => Array.from({ length: CARS }, () => value);

const carPit = (values: Partial<CarPitSnapshot> = {}): CarPitSnapshot =>
  ({
    where: all(CAR_PIT_ON_TRACK),
    laneTimeS: all(0),
    standingS: all(0),
    stops: all(0),
    stintLaps: all(9),
    longestStintLaps: all(0),
    usedLastLap: all(-1),
    usedAverage: all(-1),
    lapsLeft: all(-1),
    ...values,
  }) as CarPitSnapshot;

/**
 * The class in the order of its slots: slot 0 leads it, the player unless
 * told otherwise, with each car two seconds behind the one before.
 */
const standings = (
  values: Partial<StandingsSnapshot> & { classOrder?: number[] } = {}
): StandingsSnapshot => {
  const { classOrder = [0, 1, 2, 3, 4, 5, 6, 7], ...rest } = values;
  const classPosition = all(0);
  const gaps = all(0);
  classOrder.forEach((carIdx, index) => {
    classPosition[carIdx] = index + 1;
    // Behind the two prototypes.
    gaps[carIdx] = 60 + index * 2;
  });
  classPosition[LEADER] = 1;
  classPosition[8] = 2;
  gaps[8] = 4;
  return {
    carIdxF2Time: gaps,
    carIdxClassPosition: classPosition,
    liveClassPosition: [],
    carIdxTrackSurface: all(TrackLocation.OnTrack),
    carIdxInGarage: [],
    carIdxFinishStatus: [],
    carIdxEnergyRemaining: all(-1),
    carIdxOnPitRoad: all(false),
    ...rest,
  } as StandingsSnapshot;
};

/** A pace for each car named, measured over `laps` laps. */
const lapTimes = (
  times: Record<number, number> = {},
  laps = 5
): LapTimesSnapshot => ({
  lapTimes: Array.from({ length: CARS }, (_, carIdx) => times[carIdx] ?? 0),
  lapTimeHistory: Array.from({ length: CARS }, (_, carIdx) =>
    times[carIdx] ? Array.from({ length: laps }, () => times[carIdx]) : []
  ),
  sessionNum: 0,
  version: 1,
});

const frame = (values: Record<string, unknown[]> = {}): Telemetry =>
  Object.fromEntries(
    Object.entries({
      SessionTime: [600],
      SessionNum: [0],
      PlayerCarIdx: [PLAYER],
      // The tank, read for the car the user is in.
      FuelLevel: [8.5],
      // Everybody on their tenth lap, level with the player unless told
      // otherwise.
      CarIdxLap: all(10),
      CarIdxLapCompleted: all(9),
      CarIdxLapDistPct: all(0.8),
      ...values,
    }).map(([key, value]) => [key, { value }])
  ) as unknown as Telemetry;

interface Scene {
  fuel?: FuelProjectionSnapshot | undefined;
  pitStop?: PitStopSnapshot | undefined;
  carPit?: CarPitSnapshot | undefined;
  standings?: StandingsSnapshot | undefined;
  lapTimes?: LapTimesSnapshot | undefined;
  session?: Session;
  frame?: Record<string, unknown[]>;
}

const make = (scene: Scene = {}) => {
  const state = {
    fuel: 'fuel' in scene ? scene.fuel : fuel(),
    pitStop: 'pitStop' in scene ? scene.pitStop : pitStop(),
    carPit: 'carPit' in scene ? scene.carPit : carPit(),
    standings: 'standings' in scene ? scene.standings : standings(),
    lapTimes: 'lapTimes' in scene ? scene.lapTimes : lapTimes(),
  };
  const processor = new FinishProjectionProcessor({
    fuel: () => state.fuel,
    pitStop: () => state.pitStop,
    carPit: () => state.carPit,
    standings: () => state.standings,
    lapTimes: () => state.lapTimes,
  });
  processor.init(scene.session ?? session(SERVICE));
  processor.onLifecycle({ type: 'enter', replay: false });
  return { processor, state };
};

const run = (scene: Scene = {}) => {
  const { processor } = make(scene);
  processor.onFrame(frame(scene.frame));
  return processor.snapshot();
};

const rivalOf = (
  snapshot: { rivals: readonly FinishRival[] },
  carIdx: number
): FinishRival => {
  const rival = snapshot.rivals.find((entry) => entry.carIdx === carIdx);
  if (!rival) throw new Error(`car ${carIdx} is not a rival`);
  return rival;
};

describe('FinishProjectionProcessor', () => {
  describe('when there is nothing to project', () => {
    it('says the session is not a race', () => {
      expect(run({ fuel: undefined })).toMatchObject({
        valid: false,
        reason: 'notRace',
        player: null,
        rivals: [],
      });
      // The fuel projection carries its race block in a race only.
      expect(run({ fuel: fuel({}, null) }).reason).toBe('notRace');
    });

    it('waits for the green flag', () => {
      const snapshot = run({
        fuel: fuel({ sessionState: SessionState.ParadeLaps }),
      });
      expect(snapshot).toMatchObject({ valid: false, reason: 'notStarted' });
    });

    it('stops at the chequered flag, and when the car is classified', () => {
      expect(
        run({ fuel: fuel({ sessionState: SessionState.Checkered }) }).reason
      ).toBe('finished');
      expect(
        run({ fuel: fuel({ sessionState: SessionState.CoolDown }) }).reason
      ).toBe('finished');

      const status = all<number>(LMU_FINISH_STATUS.none);
      status[PLAYER] = LMU_FINISH_STATUS.dnf;
      expect(
        run({ standings: standings({ carIdxFinishStatus: status }) }).reason
      ).toBe('finished');
    });

    it('says nothing of a car that is not the user’s own', () => {
      // The camera on the leader: the projection's "player" is that car.
      expect(run({ fuel: fuel({}, { playerCarIdx: LEADER }) })).toMatchObject({
        valid: false,
        reason: 'otherCar',
        player: null,
        energy: null,
      });
      // No car at all: a spectator.
      expect(
        run({
          frame: { PlayerCarIdx: [-1] },
          session: { DriverInfo: { DriverCarIdx: -1 } } as unknown as Session,
        }).reason
      ).toBe('noCar');
    });

    it('takes the session’s own car where the frame names none', () => {
      expect(run({ frame: { PlayerCarIdx: [-1] } })).toMatchObject({
        valid: true,
        player: { carIdx: PLAYER },
      });
    });

    it('waits for both paces', () => {
      expect(run({ fuel: fuel({}, { playerPaceS: 0 }) }).reason).toBe('noPace');
      expect(run({ fuel: fuel({}, { leaderPaceS: 0 }) }).reason).toBe('noPace');
    });
  });

  describe('the race', () => {
    it('carries the pace and progress the fuel projection projects from', () => {
      const snapshot = run({
        fuel: fuel({}, { leaderPaceS: 76.6234, playerProgress: 9.80049 }),
      });
      expect(snapshot).toMatchObject({
        valid: true,
        reason: null,
        raceType: 'time',
        timeLeftS: 600,
        lapLimit: null,
        leader: { carIdx: LEADER, paceS: 76.623, progress: 10.25 },
        player: { carIdx: PLAYER, paceS: 100, progress: 9.8 },
        // As published, with the hold it carries.
        lapsToGo: 6.2,
        sessionNum: 0,
      });
    });

    it('has no leader when the player leads, or the sim names none', () => {
      expect(
        run({ fuel: fuel({}, { leaderCarIdx: PLAYER }) }).leader
      ).toBeNull();
      const unnamed = run({
        fuel: fuel({}, { leaderCarIdx: -1, leaderPaceS: 0 }),
      });
      expect(unnamed.valid).toBe(true);
      expect(unnamed.leader).toBeNull();
    });

    it('leaves the published laps out where there is no valid estimate', () => {
      expect(
        run({ fuel: fuel({ hasValidRaceEstimate: false }) }).lapsToGo
      ).toBeNull();
    });

    it('reads a race run to laps, with no clock', () => {
      const snapshot = run({
        fuel: fuel({}, { timeRemainingS: 0, lapLimit: 30 }),
      });
      expect(snapshot).toMatchObject({
        raceType: 'laps',
        timeLeftS: null,
        lapLimit: 30,
      });
    });

    it('reads a race run to laps and time, and goes on doing so once the clock is out', () => {
      const { processor, state } = make({
        fuel: fuel({}, { timeRemainingS: 600, lapLimit: 30 }),
      });
      processor.onFrame(frame());
      expect(processor.snapshot()).toMatchObject({
        raceType: 'lapsAndTime',
        timeLeftS: 600,
        lapLimit: 30,
      });

      // The clock runs out with the distance not covered: the race ends at
      // the leader's next crossing, not ten laps on.
      state.fuel = fuel({}, { timeRemainingS: 0, lapLimit: 30 });
      processor.onFrame(frame({ SessionTime: [1200] }));
      expect(processor.snapshot()).toMatchObject({
        raceType: 'lapsAndTime',
        timeLeftS: 0,
        lapLimit: 30,
      });

      // Another session has not had that clock.
      processor.onFrame(frame({ SessionTime: [1201], SessionNum: [1] }));
      expect(processor.snapshot()).toMatchObject({
        raceType: 'laps',
        timeLeftS: null,
        sessionNum: 1,
      });
    });

    it('reads a timed race whose clock has run out as one still to finish', () => {
      expect(
        run({ fuel: fuel({}, { timeRemainingS: 0, lapLimit: 0 }) })
      ).toMatchObject({ valid: true, raceType: 'time', timeLeftS: 0 });
    });
  });

  describe('what the player has aboard', () => {
    it('counts in the fuel projection’s unit, over its valid laps', () => {
      expect(run().energy).toEqual({
        isVirtualEnergy: true,
        // 2.2 and 2.4 % a lap.
        perLap: 2.3,
        aboard: 9,
        capacity: 100,
      });
      expect(
        run({
          fuel: fuel({
            budget: undefined,
            fuelLevel: 41.567,
            fuelTankCapacity: 110,
          }),
        }).energy
      ).toEqual({
        isVirtualEnergy: false,
        perLap: 2.3,
        aboard: 41.57,
        capacity: 110,
      });
    });

    it('has nothing to count with before a lap has been measured', () => {
      const snapshot = run({ fuel: fuel({ completedLaps: [] }) });
      expect(snapshot.valid).toBe(true);
      expect(snapshot.energy).toBeNull();
      // Not known, which is not none.
      expect(snapshot.playerStopsOwed).toBeNull();
    });

    describe('while somebody else drives the car', () => {
      /** Le Mans Ultimate at the monitor, watching the team car. */
      const watching = { LmuWatching: [true], IsOnTrack: [false] };

      it('goes on counting where the sim goes on writing the budget', () => {
        const snapshot = run({
          fuel: fuel({ watched: true, isOnTrack: false }),
          frame: watching,
        });
        expect(snapshot.valid).toBe(true);
        expect(snapshot.energy).toMatchObject({ perLap: 2.3, aboard: 9 });
        expect(snapshot.playerStopsOwed).toBe(1);
      });

      it('has nothing aboard to count with where it does not', () => {
        // The level the projection holds is the last one read, a stint old.
        const snapshot = run({
          fuel: fuel({ isOnTrack: false }),
          frame: watching,
        });
        expect(snapshot.valid).toBe(true);
        expect(snapshot.lapsToGo).toBe(6.2);
        expect(snapshot.energy).toBeNull();
        expect(snapshot.playerStopsOwed).toBeNull();
      });

      it('costs no fuel hose without the tank read on the frame', () => {
        const energyCar = {
          fuel: fuel({ watched: true, isOnTrack: false }),
          frame: { ...watching, LmuRefuelRatio: [1.03] },
        };
        // The team car's block carries its fuel: the hoses are costed.
        expect(run(energyCar).refuelLines).toHaveLength(2);
        // It does not: the litres the projection holds are not this lap's.
        expect(
          run({
            ...energyCar,
            frame: { ...energyCar.frame, FuelLevel: [] },
          }).refuelLines
        ).toBeNull();
      });
    });

    it('owes the stops the laps to go need beyond what is aboard', () => {
      // 100 % at 2.3 a lap is a stint of 43.5 laps; 9 % is 3.9 laps.
      const owed = (lapsToGo: number, fuelLevel = 9) =>
        run({ fuel: fuel({ estimatedLapsRemaining: lapsToGo, fuelLevel }) })
          .playerStopsOwed;
      expect(owed(3.5)).toBe(0);
      expect(owed(6.2)).toBe(1);
      expect(owed(47)).toBe(1);
      expect(owed(48)).toBe(2);
      expect(owed(40, 96)).toBe(0);
    });
  });

  describe('the pit lane and the planned stop', () => {
    it('costs a visit as the player’s own stops were driven, less the track', () => {
      expect(run()).toMatchObject({
        // 24.1 s through the lane against 6.9 s on the racing line.
        laneLossS: 17.2,
        plannedStandingS: 14.2,
      });
    });

    it('falls back on the lane at its limit before a stop has been timed', () => {
      expect(
        run({ pitStop: pitStop({ lane: { driveMeasuredS: null } }) }).laneLossS
      ).toBe(10.4);
    });

    it('has no lane loss until the lane and a pace are known', () => {
      expect(
        run({
          pitStop: pitStop({
            lane: { driveMeasuredS: null, driveAtLimitS: null },
          }),
        }).laneLossS
      ).toBeNull();
      expect(
        run({ pitStop: pitStop({ lane: { trackTimeS: null } }) }).laneLossS
      ).toBeNull();
      expect(run({ pitStop: undefined })).toMatchObject({
        laneLossS: null,
        plannedStandingS: null,
      });
    });

    it('plans no standing for a drive-through', () => {
      expect(
        run({ pitStop: pitStop({ penalty: 'DT' }) }).plannedStandingS
      ).toBe(0);
      expect(
        run({ pitStop: pitStop({ standingS: null }) }).plannedStandingS
      ).toBeNull();
    });

    it('splits the stop’s other work by what may run alongside refuelling', () => {
      const work = {
        fuel: 14.2,
        energy: 9.6,
        tyres: 12,
        damage: 30,
        driverSwap: 25,
        brakes: 120,
        brakeDucts: 5,
        penalties: 10,
      };
      // The recorded car: only the driver change may overlap.
      expect(run({ pitStop: pitStop({ parts: work }) })).toMatchObject({
        separateS: 177,
        overlapS: 25,
      });

      // A car whose tyres may go on meanwhile: the longer of the two.
      expect(
        run({
          pitStop: pitStop({ parts: work }),
          session: session({ ...SERVICE, tireTimeConcurrent: 1 }),
        })
      ).toMatchObject({ separateS: 165, overlapS: 25 });
      expect(
        run({
          pitStop: pitStop({ parts: { ...work, driverSwap: 0 } }),
          session: session({ ...SERVICE, tireTimeConcurrent: 1 }),
        })
      ).toMatchObject({ separateS: 165, overlapS: 12 });

      // Where the session states nothing: a driver change may, the rest
      // may not.
      expect(
        run({ pitStop: pitStop({ parts: work }), session: session() })
      ).toMatchObject({ separateS: 177, overlapS: 25 });
      expect(run({ pitStop: pitStop({ parts: null }) })).toMatchObject({
        separateS: 0,
        overlapS: 0,
      });
    });
  });

  describe('the rates of a refuelling stop', () => {
    it('gives the two hoses of a car on virtual energy', () => {
      // 38.7 % aboard at 1.03 L to the percent calls for 39.86 L, and
      // 38.433 L are in the tank: 0.42 s of fuel before a percent is added.
      const snapshot = run({
        fuel: fuel({ fuelLevel: 38.7, tank: { level: 38.433, perLap: 2.4 } }),
        frame: { LmuRefuelRatio: [1.03] },
      });
      expect(snapshot.refuelLines).toEqual([
        // 2.5 % a second, nothing to connect.
        { fixedS: 0, perUnitS: 0.4 },
        // A second each to connect and take off, 3.4 L a second.
        { fixedS: 2.42, perUnitS: 0.3029 },
      ]);
    });

    it('gives the one hose of a car on fuel, by the litre', () => {
      expect(
        run({ fuel: fuel({ budget: undefined, tank: undefined }) }).refuelLines
      ).toEqual([{ fixedS: 2, perUnitS: 0.2941 }]);
    });

    it('gives none where a rate, the ratio or the tank is missing', () => {
      const energyCar = { frame: { LmuRefuelRatio: [1.03] } };
      expect(run(energyCar).refuelLines).toHaveLength(2);
      // iRacing: no service rates at all.
      expect(run({ ...energyCar, session: session() }).refuelLines).toBeNull();
      expect(run().refuelLines).toBeNull();
      expect(
        run({ ...energyCar, fuel: fuel({ tank: undefined }) }).refuelLines
      ).toBeNull();
      for (const missing of [
        'fuelFillRate',
        'fuelInsert',
        'fuelRemove',
        'virtualEnergyFillRate',
        'virtualEnergyInsert',
        'virtualEnergyRemove',
      ] as const) {
        expect(
          run({
            ...energyCar,
            session: session({ ...SERVICE, [missing]: undefined }),
          }).refuelLines,
          missing
        ).toBeNull();
      }
    });
  });

  describe('the last stop', () => {
    /** Both cars stopped on their twentieth lap and are out again. */
    const stopped = (values: Partial<CarPitSnapshot> = {}) => {
      const laneTimeS = all(0);
      laneTimeS[PLAYER] = 45.1;
      laneTimeS[LEADER] = 37.7;
      const lap = all(-1);
      lap[PLAYER] = 20;
      lap[LEADER] = 20;
      return carPit({
        laneTimeS,
        lastPitLap: [...lap],
        lastStopLap: [...lap],
        ...values,
      });
    };

    it('is the pit lane time less the same stretch on the racing line', () => {
      const snapshot = run({ carPit: stopped() });
      // 6.9 s of track at the player's pace; the leader covers it in nine
      // tenths of that.
      expect(snapshot.player?.lastStopLossS).toBe(38.2);
      expect(snapshot.leader?.lastStopLossS).toBe(31.5);
    });

    it('is nothing before the first visit, and for a brush with the line', () => {
      expect(run().player?.lastStopLossS).toBe(0);
      const laneTimeS = all(0);
      laneTimeS[PLAYER] = 1.4;
      expect(
        run({ carPit: stopped({ laneTimeS }) }).player?.lastStopLossS
      ).toBe(0);
      expect(run({ carPit: undefined }).player?.lastStopLossS).toBe(0);
    });

    it('is nothing for a pass down the lane that was not a stop', () => {
      // The lane time is the car's last pass, whatever it was. A penalty
      // served on lap 31 was costed as the car's last stop: 24.6 s in the
      // lane, 17.7 s lost.
      const laneTimeS = all(0);
      laneTimeS[PLAYER] = 24.6;
      const lastPitLap = all(-1);
      lastPitLap[PLAYER] = 31;
      expect(
        run({ carPit: stopped({ laneTimeS, lastPitLap }) }).player
          ?.lastStopLossS
      ).toBe(0);

      // Nor is a car that has only ever driven through one that has stopped.
      expect(
        run({ carPit: carPit({ laneTimeS, lastPitLap }) }).player?.lastStopLossS
      ).toBe(0);
    });

    it('is nothing while the car is in the lane, where the time is still growing', () => {
      const where = all(CAR_PIT_ON_TRACK);
      where[PLAYER] = CAR_PIT_IN_LANE;
      const snapshot = run({ carPit: stopped({ where }) });
      expect(snapshot.player?.lastStopLossS).toBe(0);
      // The leader's stop is over and stands.
      expect(snapshot.leader?.lastStopLossS).toBe(31.5);
    });
  });

  describe('the class rivals', () => {
    /** The player fifth of the eight in its class. */
    const FIFTH = [1, 2, 3, 4, PLAYER, 5, 6, 7];

    it('names the three nearest class cars on each side, nearest first', () => {
      const snapshot = run({ standings: standings({ classOrder: FIFTH }) });
      expect(snapshot.rivals.map((rival) => rival.carIdx)).toEqual([
        4, 3, 2, 5, 6, 7,
      ]);
      expect(snapshot.rivals.map((rival) => rival.classPosition)).toEqual([
        4, 3, 2, 6, 7, 8,
      ]);
      expect(snapshot.rivals.map((rival) => rival.ahead)).toEqual([
        true,
        true,
        true,
        false,
        false,
        false,
      ]);
      // Race time behind the player: two seconds a place.
      expect(snapshot.rivals.map((rival) => rival.gapS)).toEqual([
        -2, -4, -6, 2, 4, 6,
      ]);
    });

    it('goes by the live class order where the standings have one', () => {
      const live: (number | undefined)[] = all(undefined);
      // The player has just taken fourth from slot 4 on the road.
      [1, 2, 3, PLAYER, 4, 5, 6, 7].forEach((carIdx, index) => {
        live[carIdx] = index + 1;
      });
      const snapshot = run({
        standings: standings({ classOrder: FIFTH, liveClassPosition: live }),
      });
      expect(snapshot.rivals.map((rival) => rival.carIdx)).toEqual([
        3, 2, 1, 4, 5, 6,
      ]);
    });

    it('passes over a car that is not running, and never takes another class', () => {
      const surface = all(TrackLocation.OnTrack);
      surface[4] = TrackLocation.NotInWorld;
      const status = all<number>(LMU_FINISH_STATUS.none);
      status[5] = LMU_FINISH_STATUS.dnf;
      const inGarage = all(false);
      inGarage[6] = true;
      const snapshot = run({
        standings: standings({
          classOrder: FIFTH,
          carIdxTrackSurface: surface,
          carIdxFinishStatus: status,
          carIdxInGarage: inGarage,
        }),
      });
      expect(snapshot.rivals.map((rival) => rival.carIdx)).toEqual([
        3, 2, 1, 7,
      ]);
    });

    it('has none alone in its class, without standings or without a race gap', () => {
      expect(
        run({ standings: standings({ classOrder: [PLAYER] }) }).rivals
      ).toEqual([]);
      expect(run({ standings: undefined }).rivals).toEqual([]);
      const gaps = all(Number.NaN);
      expect(
        run({ standings: standings({ carIdxF2Time: gaps }) }).rivals
      ).toEqual([]);
    });

    it('counts each rival’s laps to its own finish', () => {
      // 607.5 s to the flag. Slot 1 laps in 98 s from 9.9 laps: 16.1, so
      // lap 17. Slot 2 has no pace of its own and is counted at the
      // player's: 9.7 + 6.075, lap 16.
      const snapshot = run({
        lapTimes: lapTimes({ 1: 98 }),
        frame: {
          CarIdxLapDistPct: [0.8, 0.9, 0.7, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8],
        },
      });
      expect(rivalOf(snapshot, 1).lapsLeft).toBe(7.1);
      expect(rivalOf(snapshot, 2).lapsLeft).toBe(6.3);
    });

    it('counts a rival at the class’s pace until it has three laps behind it', () => {
      const frameValues = {
        CarIdxLapDistPct: [0.8, 0.9, 0.7, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8],
      };
      // Two laps in, the measured figure is half the lap from the start:
      // 120 s here, which would flag slot 1 a lap down.
      const early = run({
        lapTimes: lapTimes({ [PLAYER]: 104, 1: 120 }, 2),
        frame: frameValues,
      });
      // At the class's 100 s: 9.9 + 6.075, lap 16.
      expect(rivalOf(early, 1).lapsLeft).toBe(6.1);
      expect(rivalOf(early, 1).paceDeltaS).toBe(0);

      // With three laps behind it the figure is the car's own.
      const later = run({
        lapTimes: lapTimes({ [PLAYER]: 104, 1: 120 }, 3),
        frame: frameValues,
      });
      // 9.9 + 607.5 / 120 = 14.96: lap 15, and sixteen seconds a lap over
      // the 5.1 laps it has left.
      expect(rivalOf(later, 1).lapsLeft).toBe(5.1);
      expect(rivalOf(later, 1).paceDeltaS).toBe(81.6);
    });

    it('finishes a rival that is the overall leader on the flag’s own lap', () => {
      // A single class: the car ahead of the player leads the race.
      const snapshot = run({
        fuel: fuel({}, { leaderCarIdx: 1 }),
        standings: standings({ classOrder: [1, PLAYER, 2] }),
        // A pace of its own that would carry it past the flag's lap.
        lapTimes: lapTimes({ 1: 88 }),
      });
      expect(rivalOf(snapshot, 1).lapsLeft).toBe(6.75);
    });

    describe('the stops a rival still owes', () => {
      /** A little over forty laps to the flag for everybody. */
      const long = (values: Partial<FuelProjectionSnapshot> = {}) =>
        fuel(
          { estimatedLapsRemaining: 40, fuelLevel: 96, ...values },
          { timeRemainingS: 4000, leaderProgress: 10.25 }
        );

      it('reckons from what the sim says it has left and what a lap costs it', () => {
        const remaining = all(-1);
        const usedAverage = all(-1);
        // 2.5 % a lap is a stint of forty; 30 % is twelve laps in hand.
        remaining[1] = 0.3;
        usedAverage[1] = 0.025;
        const snapshot = run({
          fuel: long(),
          standings: standings({ carIdxEnergyRemaining: remaining }),
          carPit: carPit({ usedAverage }),
        });
        const rival = rivalOf(snapshot, 1);
        expect(rival.basis).toBe('energy');
        expect(rival.lapsLeft).toBeGreaterThan(40);
        expect(rival.lapsLeft).toBeLessThan(42);
        expect(rival.stopsOwed).toBe(1);
      });

      it('falls back on the longest stint it has been seen to drive', () => {
        const longestStintLaps = all(0);
        const stintLaps = all(9);
        // Thirty laps at its longest and eighteen into this one.
        longestStintLaps[1] = 30;
        stintLaps[1] = 18;
        const withheld = run({
          fuel: long(),
          carPit: carPit({ longestStintLaps, stintLaps }),
        });
        expect(rivalOf(withheld, 1)).toMatchObject({
          basis: 'observed',
          stopsOwed: 1,
        });

        // A reading without a usage is no better than none.
        const remaining = all(-1);
        remaining[1] = 0.3;
        expect(
          rivalOf(
            run({
              fuel: long(),
              standings: standings({ carIdxEnergyRemaining: remaining }),
              carPit: carPit({ longestStintLaps, stintLaps }),
            }),
            1
          ).basis
        ).toBe('observed');
      });

      it('assumes the longest stint seen in its class, then the player’s own', () => {
        const longestStintLaps = all(0);
        // Slot 3 has shown a stint of twenty-six laps; slot 1 nothing.
        longestStintLaps[3] = 26;
        // A prototype's stint is not this class's.
        longestStintLaps[8] = 60;
        const classSeen = run({
          fuel: long(),
          carPit: carPit({ longestStintLaps }),
        });
        // Nine laps into an assumed twenty-six: seventeen in hand, and
        // 41.2 laps to cover.
        expect(rivalOf(classSeen, 1)).toMatchObject({
          basis: 'assumed',
          stopsOwed: 1,
        });
        expect(rivalOf(classSeen, 3).basis).toBe('observed');

        // Nothing seen anywhere: the player's own 43.5 laps to a stint,
        // which with nine done leaves 34.5 in hand.
        const nothingSeen = run({ fuel: long() });
        expect(rivalOf(nothingSeen, 1)).toMatchObject({
          basis: 'assumed',
          stopsOwed: 1,
        });
        // And with nothing to assume from, no stop is counted.
        const noUsage = run({ fuel: long({ completedLaps: [] }) });
        expect(rivalOf(noUsage, 1)).toMatchObject({
          basis: 'assumed',
          stopsOwed: 0,
        });
      });

      it('takes a stint it did not see begin as one just begun', () => {
        const stintLaps = all(9);
        // The sim says it has stopped, before anything was watching.
        stintLaps[1] = -1;
        const longestStintLaps = all(0);
        longestStintLaps[3] = 45;
        const snapshot = run({
          fuel: long(),
          carPit: carPit({ stintLaps, longestStintLaps }),
        });
        // Forty-five in hand covers the 41.2 laps left: the fewest stops.
        expect(rivalOf(snapshot, 1).stopsOwed).toBe(0);
        expect(rivalOf(snapshot, 2).stopsOwed).toBe(1);
      });
    });

    describe('what a stop costs a rival', () => {
      it('is the lane with its own last stop, then the class’s, then the player’s plan', () => {
        const standingS = all(0);
        standingS[1] = 42.3;
        standingS[2] = 38.1;
        standingS[3] = 40.1;
        // Under way, and not a stop yet.
        standingS[4] = 12;
        standingS[5] = 0.6;
        // A prototype's stop is not this class's.
        standingS[8] = 90;
        const where = all(CAR_PIT_ON_TRACK);
        where[4] = CAR_PIT_IN_LANE;
        const snapshot = run({
          standings: standings({ classOrder: [1, 2, 3, 4, PLAYER, 5, 6, 7] }),
          carPit: carPit({ standingS, where }),
        });
        // 17.2 s of lane with its own 40.1 s.
        expect(rivalOf(snapshot, 3).stopLossS).toBe(57.3);
        // Still standing, and never stopped: the class's median, 40.1 s.
        expect(rivalOf(snapshot, 4).stopLossS).toBe(57.3);
        expect(rivalOf(snapshot, 5).stopLossS).toBe(57.3);
        expect(rivalOf(snapshot, 4).inPit).toBe(true);
        expect(rivalOf(snapshot, 5).inPit).toBe(false);

        // Nobody in the class has stopped: the player's planned 14.2 s.
        expect(rivalOf(run(), 1).stopLossS).toBe(31.4);
      });

      it('is not known until the pit lane is', () => {
        const snapshot = run({
          pitStop: pitStop({ lane: { trackTimeS: null } }),
        });
        expect(rivalOf(snapshot, 1).stopLossS).toBeNull();
      });
    });

    describe('the gap once everyone has stopped', () => {
      /**
       * Seventy laps to the flag. The player, on fuel, owes two stops of
       * 58 s; slot 1, eight seconds behind, owes one of 62 s.
       */
      const scene = (): Scene => {
        const remaining = all(-1);
        const usedAverage = all(-1);
        const standingS = all(0);
        remaining[1] = 0.9;
        usedAverage[1] = 0.02;
        standingS[1] = 42;
        const gaps = all(0);
        gaps[PLAYER] = 100;
        gaps[1] = 108;
        return {
          fuel: fuel(
            {
              budget: undefined,
              tank: undefined,
              fuelLevel: 22,
              fuelTankCapacity: 60,
              completedLaps: [lap(2)],
              estimatedLapsRemaining: 70.5,
            },
            {
              leaderPaceS: 100,
              leaderProgress: 10,
              playerProgress: 9.5,
              timeRemainingS: 6990,
            }
          ),
          pitStop: pitStop({
            lane: { driveMeasuredS: 26.9, trackTimeS: 6.9 },
            standingS: 38,
          }),
          standings: standings({
            classOrder: [PLAYER, 1],
            carIdxF2Time: gaps,
            carIdxEnergyRemaining: remaining,
          }),
          carPit: carPit({ usedAverage, standingS }),
          lapTimes: lapTimes({ [PLAYER]: 100, 1: 100.2 }),
          frame: {
            CarIdxLapDistPct: [0.5, 0.4, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0],
          },
        };
      };

      it('adds each car’s stops to the gap between them', () => {
        const snapshot = run(scene());
        expect(snapshot.playerStopsOwed).toBe(2);
        expect(snapshot.laneLossS).toBe(20);
        expect(rivalOf(snapshot, 1)).toMatchObject({
          ahead: false,
          gapS: 8,
          basis: 'energy',
          stopsOwed: 1,
          stopLossS: 62,
          // 8 + 62 - 2 x 58.
          projectedGapS: -46,
        });
      });

      it('says how far the pace moves it over the laps left', () => {
        // Two tenths a lap over the 70.5 laps the player has left.
        expect(rivalOf(run(scene()), 1).paceDeltaS).toBe(14.1);
        // Not without both measured.
        expect(
          rivalOf(run({ ...scene(), lapTimes: lapTimes({ 1: 100.2 }) }), 1)
            .paceDeltaS
        ).toBe(0);
      });

      it('is not known where a stop is owed that cannot be costed', () => {
        const unknownLane = {
          ...scene(),
          pitStop: pitStop({ lane: { trackTimeS: null }, standingS: 38 }),
        };
        expect(rivalOf(run(unknownLane), 1).projectedGapS).toBeNull();

        // The player's own stop has no standing time to plan with.
        const unplanned = {
          ...scene(),
          pitStop: pitStop({
            lane: { driveMeasuredS: 26.9, trackTimeS: 6.9 },
            standingS: null,
          }),
        };
        expect(rivalOf(run(unplanned), 1).projectedGapS).toBeNull();
      });

      it('is not known while the stops the player owes are not', () => {
        // Before the first measured lap, or with a team-mate driving where
        // the sim stops writing the budget: nothing is read aboard. Counted
        // as owing no stop, the player was set one stop ahead of this rival:
        // 8 + 62 = +70 s.
        const read = scene();
        const snapshot = run({
          ...read,
          fuel: {
            ...(read.fuel as FuelProjectionSnapshot),
            completedLaps: [],
          },
        });

        expect(snapshot.energy).toBeNull();
        expect(snapshot.playerStopsOwed).toBeNull();
        expect(rivalOf(snapshot, 1)).toMatchObject({
          gapS: 8,
          // What is known of the rival still is.
          stopsOwed: 1,
          stopLossS: 62,
          projectedGapS: null,
        });
      });

      it('is the gap as it stands when nobody owes a stop', () => {
        const snapshot = run({
          fuel: fuel({ fuelLevel: 96 }),
          pitStop: undefined,
        });
        expect(snapshot.playerStopsOwed).toBe(0);
        expect(rivalOf(snapshot, 1)).toMatchObject({
          gapS: 2,
          stopsOwed: 0,
          stopLossS: null,
          projectedGapS: 2,
        });
      });
    });

    it('marks a rival in the pit lane', () => {
      const where = all(CAR_PIT_ON_TRACK);
      where[1] = CAR_PIT_IN_LANE;
      where[2] = CAR_PIT_IN_GARAGE;
      const onPitRoad = all(false);
      onPitRoad[3] = true;
      const snapshot = run({
        carPit: carPit({ where }),
        standings: standings({ carIdxOnPitRoad: onPitRoad }),
      });
      expect(rivalOf(snapshot, 1).inPit).toBe(true);
      expect(rivalOf(snapshot, 2).inPit).toBe(false);
      expect(rivalOf(snapshot, 3).inPit).toBe(true);
    });
  });

  describe('publishing', () => {
    it('moves its version only when a figure has moved', () => {
      const { processor, state } = make();
      processor.onFrame(frame());
      const version = processor.snapshot().version;
      const published = processor.snapshot();

      processor.onFrame(frame({ SessionTime: [601] }));
      expect(processor.snapshot().version).toBe(version);
      expect(processor.snapshot()).toBe(published);

      // A change below what is published is no change.
      state.fuel = fuel({}, { playerProgress: 9.80004 });
      processor.onFrame(frame({ SessionTime: [602] }));
      expect(processor.snapshot().version).toBe(version);

      state.fuel = fuel({}, { playerProgress: 9.812 });
      processor.onFrame(frame({ SessionTime: [603] }));
      expect(processor.snapshot().version).toBe(version + 1);
      expect(processor.snapshot().player?.progress).toBe(9.812);
    });

    it('ignores a frame with no clock', () => {
      const { processor } = make();
      const before = processor.snapshot();
      processor.onFrame({} as Telemetry);
      expect(processor.snapshot()).toBe(before);
    });

    it('clears on every lifecycle event', () => {
      for (const event of [
        { type: 'enter', replay: false },
        { type: 'sessionNumChange' },
        { type: 'disconnect' },
      ] as const) {
        const { processor } = make();
        processor.onFrame(frame());
        expect(processor.snapshot().valid).toBe(true);
        const version = processor.snapshot().version;

        processor.onLifecycle(event);
        expect(processor.snapshot(), event.type).toMatchObject({
          valid: false,
          reason: 'notRace',
          player: null,
          rivals: [],
          sessionNum: event.type === 'sessionNumChange' ? 0 : null,
        });
        expect(processor.snapshot().version).toBe(version + 1);
      }
    });

    it('forgets the session’s cars and rates on disconnect', () => {
      const { processor } = make({ frame: { LmuRefuelRatio: [1.03] } });
      processor.onLifecycle({ type: 'disconnect' });
      processor.onFrame(frame({ PlayerCarIdx: [-1], LmuRefuelRatio: [1.03] }));
      // No session: no car of the user's own to describe.
      expect(processor.snapshot().reason).toBe('noCar');

      processor.onFrame(frame({ LmuRefuelRatio: [1.03], SessionTime: [601] }));
      expect(processor.snapshot()).toMatchObject({
        valid: true,
        refuelLines: null,
        rivals: [],
      });
    });
  });
});
