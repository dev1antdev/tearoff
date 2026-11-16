import { describe, expect, it } from 'vitest';
import type {
  CarPitSnapshot,
  FuelLapData,
  FuelProjectionSnapshot,
  FuelRaceInputs,
  LapTimesSnapshot,
  PitLaneModel,
  PitStopSnapshot,
  RaceForecastCar,
  RaceForecastSnapshot,
  Session,
  StandingsSnapshot,
  Telemetry,
} from '@irdashies/types';
import {
  CAR_PIT_IN_LANE,
  CAR_PIT_ON_TRACK,
  RACE_FORECAST_MAX_CARS,
  SessionState,
  TrackLocation,
} from '@irdashies/types';
import { FinishProjectionProcessor } from './FinishProjectionProcessor';
import { RaceForecastProcessor } from './RaceForecastProcessor';

/**
 * The race forecast on hand-built snapshots. Every case is STAGED: no
 * recording holds a pit stop, a second stint or a race long enough to need
 * either, so the cars, their energy, their stops and the gaps between them
 * are written out here, and what is checked is what the forecast makes of
 * them. The recorded race is played through the real processors in the tape
 * spec beside this.
 *
 * The scene is a timed race with two hours on the clock, lapped at 100 s:
 * twelve cars of the player's class ten seconds apart with the player
 * sixth, each with 40 % of its energy at 2.5 % a lap, so sixteen laps in
 * hand, stints of forty and two stops owed over the 73.2 laps left; and a
 * prototype leading overall at 90 s a lap. A stop costs every car the same
 * 31.4 s: 17.2 s of pit lane and 14.2 s standing.
 */

const PLAYER = 0;
const GT = 1;
const PROTOTYPE = 2;
/** Slots 0 to 11 are the player's class; 12 and 13 are prototypes. */
const CLASS_CARS = 12;
const CARS = CLASS_CARS + 2;
const LEADER = CARS - 1;
/** The class in the order of its places: the player sixth. */
const CLASS_ORDER = [1, 2, 3, 4, 5, PLAYER, 6, 7, 8, 9, 10, 11];
/** The pit lane's 24.1 s less 6.9 s on the racing line, and 14.2 s standing. */
const STOP_LOSS_S = 31.4;
/** The player's race gap in the scene. */
const PLAYER_GAP_S = 110;

const all = <T>(value: T, length = CARS): T[] =>
  Array.from({ length }, () => value);

const session = (classCars = CLASS_CARS): Session =>
  ({
    DriverInfo: {
      DriverCarIdx: PLAYER,
      Drivers: Array.from({ length: classCars + 2 }, (_, carIdx) => ({
        CarIdx: carIdx,
        CarClassID: carIdx >= classCars ? PROTOTYPE : GT,
      })),
    },
  }) as unknown as Session;

const lap = (fuelUsed: number): FuelLapData => ({
  lapNumber: 1,
  fuelUsed,
  lapTime: 100,
  isGreenFlag: true,
  isValidForCalc: true,
  isOutLap: false,
  timestamp: 0,
});

const race = (values: Partial<FuelRaceInputs> = {}): FuelRaceInputs => ({
  leaderCarIdx: LEADER,
  playerCarIdx: PLAYER,
  leaderPaceS: 90,
  playerPaceS: 100,
  leaderProgress: 10.25,
  playerProgress: 9.8,
  timeRemainingS: 7200,
  lapLimit: 0,
  ...values,
});

const fuel = (
  values: Partial<FuelProjectionSnapshot> = {},
  raceValues: Partial<FuelRaceInputs> | null = {}
): FuelProjectionSnapshot =>
  ({
    isReplay: false,
    fuelLevel: 40,
    sessionState: SessionState.Racing,
    sessionType: 'Race',
    estimatedLapsRemaining: 73.2,
    hasValidRaceEstimate: true,
    fuelTankCapacity: 100,
    budget: 'virtualEnergy',
    tank: { level: 60, perLap: 3 },
    completedLaps: [lap(2.5), lap(2.5)],
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

type Ladder = NonNullable<PitStopSnapshot['rejoin']>['ladder'];

/** The class cars behind the player, as the pit stop's ladder lists them. */
const LADDER: Ladder = [
  { carIdx: 5, gapS: -10, sameClass: true, inPit: false },
  { carIdx: LEADER, gapS: 6, sameClass: false, inPit: false },
  { carIdx: 6, gapS: 12, sameClass: true, inPit: false },
  { carIdx: 7, gapS: 27.3, sameClass: true, inPit: false },
  { carIdx: 8, gapS: 35.5, sameClass: true, inPit: false },
  { carIdx: 9, gapS: 48, sameClass: true, inPit: false },
];

const pitStop = (
  values: {
    lane?: Partial<PitLaneModel>;
    standingS?: number | null;
    phase?: PitStopSnapshot['phase'];
    ladder?: Ladder;
    planned?: PitStopSnapshot['planned'];
    timer?: Partial<PitStopSnapshot['timer']>;
    driveToExitS?: number | null;
  } = {}
): PitStopSnapshot => ({
  phase: values.phase ?? 'planning',
  requested: false,
  lane: lane(values.lane),
  estimate: {
    source: 'sim',
    standingS: values.standingS === undefined ? 14.2 : values.standingS,
    parts: null,
    optionalRepairS: null,
    samples: 0,
    penalty: null,
  },
  planned: values.planned ?? null,
  timer: {
    enteredAt: null,
    stoppedAt: null,
    standingS: 0,
    exitedAt: null,
    ...values.timer,
  },
  last: null,
  refuel: null,
  rejoin: {
    position: 8,
    classPosition: 6,
    ladder: values.ladder ?? LADDER,
    driveToExitS: values.driveToExitS ?? null,
    passes: [],
  },
  sessionNum: 0,
  version: 1,
});

/** Every car on track, nine laps into a stint, using 2.5 % a lap. */
const carPit = (
  values: Partial<CarPitSnapshot> = {},
  cars = CARS
): CarPitSnapshot =>
  ({
    where: all(CAR_PIT_ON_TRACK, cars),
    laneTimeS: all(0, cars),
    standingS: all(0, cars),
    stops: all(0, cars),
    lastPitLap: all(-1, cars),
    lastStopLap: all(-1, cars),
    stintLaps: all(9, cars),
    longestStintLaps: all(0, cars),
    usedLastLap: all(-1, cars),
    usedAverage: all(0.025, cars),
    lapsLeft: all(-1, cars),
    ...values,
  }) as CarPitSnapshot;

/** A copy of a per-car list with some cars' values replaced. */
const withCars = <T>(values: T[], changes: Record<number, T>): T[] => {
  const next = [...values];
  for (const [carIdx, value] of Object.entries(changes)) {
    next[Number(carIdx)] = value;
  }
  return next;
};

/**
 * The class ten seconds apart in the order given, behind the two
 * prototypes; `gaps` overrides a car's race gap to the player.
 */
const standings = (
  values: Partial<StandingsSnapshot> & {
    classOrder?: number[];
    gaps?: Record<number, number>;
  } = {},
  cars = CARS
): StandingsSnapshot => {
  const { classOrder = CLASS_ORDER, gaps = {}, ...rest } = values;
  const classPosition = all(0, cars);
  const f2 = all(0, cars);
  const ownIndex = classOrder.indexOf(PLAYER);
  classOrder.forEach((carIdx, index) => {
    classPosition[carIdx] = index + 1;
    f2[carIdx] = PLAYER_GAP_S + (index - ownIndex) * 10;
  });
  for (const [carIdx, gap] of Object.entries(gaps)) {
    f2[Number(carIdx)] = PLAYER_GAP_S + gap;
  }
  classPosition[cars - 1] = 1;
  classPosition[cars - 2] = 2;
  f2[cars - 2] = 4;
  return {
    carIdxF2Time: f2,
    carIdxClassPosition: classPosition,
    liveClassPosition: [],
    carIdxTrackSurface: all(TrackLocation.OnTrack, cars),
    carIdxInGarage: [],
    carIdxFinishStatus: [],
    carIdxEnergyRemaining: all(0.4, cars),
    carIdxOnPitRoad: all(false, cars),
    carIdxLastLapTime: all(100.4, cars),
    carIdxBestLapTime: all(99.6, cars),
    ...rest,
  } as StandingsSnapshot;
};

/** A measured pace for each car named, over five laps. */
const lapTimes = (
  times: Record<number, number> = {},
  clean: Record<number, number[]> = {}
): LapTimesSnapshot => ({
  lapTimes: Array.from({ length: CARS }, (_, carIdx) => times[carIdx] ?? 0),
  lapTimeHistory: Array.from({ length: CARS }, (_, carIdx) =>
    times[carIdx] ? all(times[carIdx], 5) : []
  ),
  cleanLapTimeHistory: Array.from(
    { length: CARS },
    (_, carIdx) => clean[carIdx] ?? []
  ),
  sessionNum: 0,
  version: 1,
});

const frame = (
  values: Record<string, unknown[]> = {},
  cars = CARS
): Telemetry =>
  Object.fromEntries(
    Object.entries({
      SessionTime: [600],
      SessionNum: [0],
      PlayerCarIdx: [PLAYER],
      // The tank, read for the car the user is in.
      FuelLevel: [60],
      // Everybody four fifths of the way round their tenth lap.
      CarIdxLap: all(10, cars),
      CarIdxLapCompleted: all(9, cars),
      CarIdxLapDistPct: all(0.8, cars),
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
  const dependencies = {
    fuel: () => state.fuel,
    pitStop: () => state.pitStop,
    carPit: () => state.carPit,
    standings: () => state.standings,
    lapTimes: () => state.lapTimes,
  };
  const processor = new RaceForecastProcessor(dependencies);
  processor.init(scene.session ?? session());
  processor.onLifecycle({ type: 'enter', replay: false });
  return { processor, state, dependencies };
};

const run = (scene: Scene = {}): RaceForecastSnapshot => {
  const { processor } = make(scene);
  processor.onFrame(frame(scene.frame));
  return processor.snapshot();
};

const carOf = (
  snapshot: RaceForecastSnapshot,
  carIdx: number
): RaceForecastCar => {
  const car = snapshot.cars.find((entry) => entry.carIdx === carIdx);
  if (!car) throw new Error(`car ${carIdx} is not in the forecast`);
  return car;
};

/** The cars in the order they are forecast to finish. */
const finishOrder = (snapshot: RaceForecastSnapshot): number[] =>
  [...snapshot.cars]
    .sort((a, b) => a.finishPosition - b.finishPosition)
    .map((car) => car.carIdx);

/** A rival with one stop fewer to make: 90 % aboard is 36 laps in hand. */
const ONE_STOP_FEWER = 0.9;
/**
 * A rival that owes a stop more: 3 % a lap is a stint of 33.3 laps, and
 * 10 % aboard is 3.3 of them.
 */
const thirsty = (carIdx: number) => ({
  carPit: carPit({
    usedAverage: withCars(all(0.025), { [carIdx]: 0.03 }),
  }),
  energy: withCars(all(0.4), { [carIdx]: 0.1 }),
});

describe('RaceForecastProcessor (staged)', () => {
  describe('when there is nothing to forecast', () => {
    it('says why, as the finish projection does', () => {
      expect(run({ fuel: undefined })).toMatchObject({
        valid: false,
        reason: 'notRace',
        ownCarIdx: null,
        cars: [],
        place: null,
        stint: null,
        rejoin: null,
      });
      expect(
        run({ fuel: fuel({ sessionState: SessionState.ParadeLaps }) }).reason
      ).toBe('notStarted');
      expect(
        run({ fuel: fuel({ sessionState: SessionState.Checkered }) }).reason
      ).toBe('finished');
      expect(run({ fuel: fuel({}, { playerCarIdx: LEADER }) }).reason).toBe(
        'otherCar'
      );
      expect(run({ fuel: fuel({}, { playerPaceS: 0 }) }).reason).toBe('noPace');
    });

    it('reads a race run to a lap count', () => {
      expect(
        run({ fuel: fuel({}, { timeRemainingS: 0, lapLimit: 30 }) })
      ).toMatchObject({
        valid: true,
        raceType: 'laps',
        timeLeftS: null,
        lapLimit: 30,
      });
    });
  });

  describe('the class', () => {
    it('carries every running class car in the order of their places, the own entry among them', () => {
      const snapshot = run();
      expect(snapshot).toMatchObject({
        valid: true,
        reason: null,
        raceType: 'time',
        timeLeftS: 7200,
        lapLimit: null,
        sessionTimeS: 600,
        // The leader's 80.75 laps to its finishing line at 90 s.
        flagInS: 7267.5,
        ownCarIdx: PLAYER,
        ownLap: 10,
        ownLastLapS: 100.4,
        ownBestLapS: 99.6,
      });
      expect(snapshot.cars.map((car) => car.carIdx)).toEqual(CLASS_ORDER);
      expect(snapshot.cars.map((car) => car.classPosition)).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
      ]);
      expect(snapshot.cars.filter((car) => car.own)).toHaveLength(1);
      expect(carOf(snapshot, PLAYER)).toMatchObject({
        own: true,
        gapS: 0,
        paceS: 100,
        progress: 9.8,
        lapsLeft: 73.2,
        stopsOwed: 2,
        basis: 'energy',
        stintLaps: 40,
        stopLossS: STOP_LOSS_S,
        netGapS: 0,
        finishGapS: 0,
        finishPosition: 6,
      });
      expect(carOf(snapshot, 1)).toMatchObject({
        own: false,
        gapS: -50,
        lapsLeft: 73.2,
        stopsOwed: 2,
        basis: 'energy',
        stintLaps: 40,
        stopLossS: STOP_LOSS_S,
        netGapS: -50,
        finishGapS: -50,
        finishPosition: 1,
      });
    });

    it('agrees car for car with what the finish projection publishes', () => {
      const scene = {
        ...thirsty(5),
        lapTimes: lapTimes({ [PLAYER]: 100, 5: 99.8, 7: 100.6 }),
      };
      const { processor, dependencies } = make({
        carPit: scene.carPit,
        standings: standings({ carIdxEnergyRemaining: scene.energy }),
        lapTimes: scene.lapTimes,
      });
      const finish = new FinishProjectionProcessor(dependencies);
      finish.init(session());
      finish.onLifecycle({ type: 'enter', replay: false });
      processor.onFrame(frame());
      finish.onFrame(frame());

      const forecast = processor.snapshot();
      const published = finish.snapshot();
      // Three a side there, the whole class here.
      expect(published.rivals).toHaveLength(6);
      expect(forecast.cars).toHaveLength(CLASS_CARS);
      for (const rival of published.rivals) {
        expect(carOf(forecast, rival.carIdx)).toMatchObject({
          classPosition: rival.classPosition,
          gapS: rival.gapS,
          lapsLeft: rival.lapsLeft,
          stopsOwed: rival.stopsOwed,
          stopLossS: rival.stopLossS,
          basis: rival.basis,
          netGapS: rival.projectedGapS,
          inPit: rival.inPit,
        });
      }
      expect(carOf(forecast, PLAYER).stopsOwed).toBe(published.playerStopsOwed);
      expect(forecast.timeLeftS).toBe(published.timeLeftS);
    });

    it('leaves out a car that is not running', () => {
      const surface = withCars(all(TrackLocation.OnTrack), {
        4: TrackLocation.NotInWorld,
      });
      const snapshot = run({
        standings: standings({ carIdxTrackSurface: surface }),
      });
      expect(snapshot.cars.map((car) => car.carIdx)).not.toContain(4);
      expect(snapshot.cars).toHaveLength(CLASS_CARS - 1);
      // Five ahead on the road, four of them running.
      expect(snapshot.place).toMatchObject({ now: 6, finish: 5 });
    });

    it('carries no more than the list holds, keeping the cars nearest the own entry', () => {
      const classCars = 80;
      const cars = classCars + 2;
      // The player 61st of 80.
      const classOrder = [
        ...Array.from({ length: 60 }, (_, index) => index + 1),
        PLAYER,
        ...Array.from({ length: 19 }, (_, index) => index + 61),
      ];
      const { processor } = make({
        session: session(classCars),
        fuel: fuel({}, { leaderCarIdx: cars - 1 }),
        carPit: carPit({}, cars),
        standings: standings({ classOrder }, cars),
      });
      processor.onFrame(frame({}, cars));
      const snapshot = processor.snapshot();
      expect(snapshot.cars).toHaveLength(RACE_FORECAST_MAX_CARS);
      const places = snapshot.cars.map((car) => car.classPosition);
      // All nineteen behind, and the forty-four nearest ahead.
      expect(places[0]).toBe(17);
      expect(places[places.length - 1]).toBe(80);
      expect(carOf(snapshot, PLAYER).classPosition).toBe(61);
    });
  });

  describe('the finishing order', () => {
    it('is the order of the places while everybody owes the same stops', () => {
      const snapshot = run();
      expect(finishOrder(snapshot)).toEqual(CLASS_ORDER);
      expect(snapshot.place).toEqual({
        now: 6,
        finish: 6,
        uncertain: false,
        was: null,
        ahead: { carIdx: 5, gapS: 10 },
        behind: { carIdx: 6, gapS: 10 },
      });
    });

    it('puts a faster car that owes one more stop behind', () => {
      // Car 5 is ten seconds up the road and 0.2 s a lap quicker, which is
      // worth 14.6 s over the 73.2 laps left; it owes three stops to the
      // player's two, which costs it 31.4 s.
      const { carPit: pits, energy } = thirsty(5);
      const snapshot = run({
        carPit: pits,
        standings: standings({ carIdxEnergyRemaining: energy }),
        lapTimes: lapTimes({ [PLAYER]: 100, 5: 99.8 }),
      });
      expect(carOf(snapshot, 5)).toMatchObject({
        gapS: -10,
        paceS: 99.8,
        stopsOwed: 3,
        netGapS: 21.4,
        finishGapS: 6.8,
        finishPosition: 6,
      });
      expect(finishOrder(snapshot)).toEqual([
        1,
        2,
        3,
        4,
        PLAYER,
        5,
        6,
        7,
        8,
        9,
        10,
        11,
      ]);
      expect(snapshot.place).toMatchObject({
        now: 6,
        finish: 5,
        uncertain: false,
        ahead: { carIdx: 4, gapS: 20 },
        behind: { carIdx: 5, gapS: 6.8 },
      });
    });

    it('puts a car with a stop fewer to make ahead, from behind', () => {
      const snapshot = run({
        standings: standings({
          carIdxEnergyRemaining: withCars(all(0.4), { 6: ONE_STOP_FEWER }),
        }),
      });
      // 21.4 s ahead once the stops are made: past the player, and past
      // the cars ten and twenty seconds up the road from it as well.
      expect(carOf(snapshot, 6)).toMatchObject({
        gapS: 10,
        stopsOwed: 1,
        netGapS: -21.4,
        finishPosition: 4,
      });
      expect(snapshot.place).toMatchObject({ now: 6, finish: 7 });
    });

    it('keeps cars that end level in the order they are in now', () => {
      const snapshot = run({
        standings: standings({
          carIdxEnergyRemaining: withCars(all(0.4), {
            5: 0.4,
            6: ONE_STOP_FEWER,
            8: ONE_STOP_FEWER,
          }),
          gaps: {
            // A stop fewer brings each of these level: car 6 with the
            // player, car 8 with car 7.
            6: STOP_LOSS_S,
            8: 20 + STOP_LOSS_S,
          },
        }),
      });
      expect(carOf(snapshot, 6).finishGapS).toBe(0);
      expect(carOf(snapshot, 8).finishGapS).toBe(carOf(snapshot, 7).finishGapS);
      expect(finishOrder(snapshot)).toEqual([
        1,
        2,
        3,
        4,
        5,
        PLAYER,
        6,
        7,
        8,
        9,
        10,
        11,
      ]);
      expect(snapshot.place).toMatchObject({ now: 6, finish: 6 });
    });

    it('leaves a car that ends level with the own one ahead of it when it is ahead now', () => {
      const { carPit: pits, energy } = thirsty(5);
      const snapshot = run({
        carPit: pits,
        standings: standings({
          carIdxEnergyRemaining: energy,
          gaps: { 5: -STOP_LOSS_S },
        }),
      });
      expect(carOf(snapshot, 5)).toMatchObject({
        stopsOwed: 3,
        finishGapS: 0,
        finishPosition: 5,
      });
      expect(snapshot.place).toMatchObject({ now: 6, finish: 6 });
    });

    describe('how sure it is', () => {
      it('is unsure while a car that decides the place is in the pit lane', () => {
        const inLane = (carIdx: number) =>
          run({
            carPit: carPit({
              where: withCars(all(CAR_PIT_ON_TRACK), {
                [carIdx]: CAR_PIT_IN_LANE,
              }),
            }),
          });
        // The car directly ahead: its gap is still growing.
        const beside = inLane(5);
        expect(carOf(beside, 5).inPit).toBe(true);
        expect(beside.place?.uncertain).toBe(true);
        // A car five places back decides nothing.
        const far = inLane(11);
        expect(carOf(far, 11).inPit).toBe(true);
        expect(far.place?.uncertain).toBe(false);
      });

      it('is unsure while a car that decides the place has its stops assumed', () => {
        const unread = (carIdx: number) =>
          run({
            standings: standings({
              carIdxEnergyRemaining: withCars(all(0.4), { [carIdx]: -1 }),
            }),
          });
        const beside = unread(6);
        expect(carOf(beside, 6).basis).toBe('assumed');
        expect(beside.place?.uncertain).toBe(true);

        const far = unread(11);
        expect(carOf(far, 11).basis).toBe('assumed');
        expect(far.place?.uncertain).toBe(false);
      });

      it('is unsure of a car it changes places with on the way, wherever that car ends', () => {
        // Car 2's stops are assumed from the thirty laps the class has
        // shown. Nine laps into its stint it owes two, like everybody, and
        // ends where it is, forty seconds up the road: it decides nothing.
        const scene = (stintLaps: number, gapS: number) =>
          run({
            standings: standings({
              carIdxEnergyRemaining: withCars(all(0.4), { 2: -1 }),
              gaps: { 2: gapS },
            }),
            carPit: carPit({
              longestStintLaps: withCars(all(0), { 11: 30 }),
              stintLaps: withCars(all(9), { 2: stintLaps }),
            }),
          });
        const settled = scene(9, -40);
        expect(carOf(settled, 2)).toMatchObject({
          basis: 'assumed',
          stopsOwed: 2,
          finishPosition: 2,
        });
        expect(settled.place).toMatchObject({ finish: 6, uncertain: false });

        // Twenty-eight laps into it the car owes three. From fifteen
        // seconds ahead that puts it behind the player, with car 6 between
        // the two at the flag: not a neighbour, and still what the place
        // gained rests on.
        const passed = scene(28, -15);
        expect(carOf(passed, 2)).toMatchObject({
          basis: 'assumed',
          stopsOwed: 3,
          netGapS: 16.4,
          finishPosition: 7,
        });
        expect(carOf(passed, 6).finishPosition).toBe(6);
        expect(passed.place).toMatchObject({ finish: 5, uncertain: true });
      });

      it('is unsure where a stop cannot be costed, and orders by the gaps as they are', () => {
        // No pit lane known for the track yet.
        const snapshot = run({
          pitStop: pitStop({
            lane: { driveMeasuredS: null, driveAtLimitS: null },
          }),
          standings: standings({
            carIdxEnergyRemaining: withCars(all(0.4), { 6: ONE_STOP_FEWER }),
          }),
        });
        expect(carOf(snapshot, PLAYER).stopLossS).toBeNull();
        expect(carOf(snapshot, 6)).toMatchObject({
          stopsOwed: 1,
          stopLossS: null,
          netGapS: null,
          finishGapS: null,
          // Where it is: nothing says how far the missing stop moves it.
          finishPosition: 7,
        });
        expect(snapshot.place).toMatchObject({
          finish: 6,
          uncertain: true,
          ahead: null,
          behind: null,
        });
      });

      it('names no place at all while what the own entry has aboard is not read', () => {
        // Before a lap has been measured the projection counts the player
        // as owing no stop. Taken at its word that would put every rival a
        // stop or two behind, and the player first.
        const snapshot = run({ fuel: fuel({ completedLaps: [] }) });
        expect(carOf(snapshot, PLAYER)).toMatchObject({
          stopsOwed: null,
          basis: null,
          nextStopLap: null,
          finishPosition: 0,
        });
        expect(snapshot.stint).toBeNull();
        expect(snapshot.place).toBeNull();
        for (const car of snapshot.cars.filter((entry) => !entry.own)) {
          // What a rival owes is still its own.
          expect(car.stopsOwed, `car ${car.carIdx}`).toBe(2);
          expect(car.netGapS, `car ${car.carIdx}`).toBeNull();
          expect(car.finishGapS, `car ${car.carIdx}`).toBeNull();
          expect(car.finishPosition, `car ${car.carIdx}`).toBe(0);
        }
      });
    });
  });

  describe('the place some laps ago', () => {
    /** One frame a lap, with the player `laps` laps further on. */
    const drive = (
      processor: RaceForecastProcessor,
      state: ReturnType<typeof make>['state'],
      laps: number,
      values: Record<string, unknown[]> = {}
    ): RaceForecastSnapshot => {
      state.fuel = fuel({}, { playerProgress: 9.8 + laps });
      processor.onFrame(frame({ SessionTime: [600 + laps * 100], ...values }));
      return processor.snapshot();
    };

    it('is the forecast as it stood ten laps ago, once five laps are held', () => {
      const { processor, state } = make();
      for (let laps = 0; laps < 5; laps += 1) {
        expect(drive(processor, state, laps).place?.was).toBeNull();
      }
      expect(drive(processor, state, 5).place).toMatchObject({
        finish: 6,
        was: { finish: 6, lapsAgo: 5 },
      });

      // From the sixth lap car 6 has a stop fewer to make, and the forecast
      // drops a place: what it was stays what it was.
      state.standings = standings({
        carIdxEnergyRemaining: withCars(all(0.4), { 6: ONE_STOP_FEWER }),
      });
      for (let laps = 6; laps <= 10; laps += 1) {
        expect(drive(processor, state, laps).place).toMatchObject({
          finish: 7,
          was: { finish: 6, lapsAgo: laps },
        });
      }
      // Ten laps after the change the memory has caught up with it.
      expect(drive(processor, state, 15).place?.was).toEqual({
        finish: 6,
        lapsAgo: 10,
      });
      expect(drive(processor, state, 16).place?.was).toEqual({
        finish: 7,
        lapsAgo: 10,
      });
    });

    it('holds the forecast made as the lap was completed, not a later one', () => {
      const { processor, state } = make();
      drive(processor, state, 0);
      // Later the same lap the forecast moves.
      state.standings = standings({
        carIdxEnergyRemaining: withCars(all(0.4), { 6: ONE_STOP_FEWER }),
      });
      state.fuel = fuel({}, { playerProgress: 9.95 });
      processor.onFrame(frame({ SessionTime: [615] }));
      expect(processor.snapshot().place?.finish).toBe(7);
      for (let laps = 1; laps < 6; laps += 1) drive(processor, state, laps);
      expect(drive(processor, state, 6).place?.was).toEqual({
        finish: 6,
        lapsAgo: 6,
      });
    });

    it('is forgotten with the session', () => {
      const { processor, state } = make();
      for (let laps = 0; laps <= 6; laps += 1) drive(processor, state, laps);
      expect(processor.snapshot().place?.was).not.toBeNull();

      // Another session of the event.
      expect(
        drive(processor, state, 7, { SessionNum: [1] }).place?.was
      ).toBeNull();

      // And a session started again: the clock runs backwards.
      for (let laps = 8; laps <= 14; laps += 1) {
        drive(processor, state, laps, { SessionNum: [1] });
      }
      expect(processor.snapshot().place?.was).not.toBeNull();
      processor.onFrame(frame({ SessionTime: [30], SessionNum: [1] }));
      expect(processor.snapshot().place?.was).toBeNull();
    });

    it('is forgotten when the sim goes away', () => {
      const { processor, state } = make();
      for (let laps = 0; laps <= 6; laps += 1) drive(processor, state, laps);
      processor.onLifecycle({ type: 'disconnect' });
      expect(processor.snapshot()).toMatchObject({
        valid: false,
        reason: 'notRace',
        cars: [],
        sessionNum: null,
      });
      processor.init(session());
      processor.onLifecycle({ type: 'enter', replay: false });
      expect(drive(processor, state, 7).place?.was).toBeNull();
    });
  });

  describe('the lap the next stop is due', () => {
    it('is the last lap the energy aboard completes, where the sim gives it', () => {
      // Sixteen laps in hand, four fifths of the way round lap 10.
      expect(carOf(run(), 1)).toMatchObject({
        basis: 'energy',
        stintLaps: 40,
        nextStopLap: 25,
      });
      // 10 % at 2.5 % a lap is four laps: the end of lap 13.
      const low = run({
        standings: standings({
          carIdxEnergyRemaining: withCars(all(0.4), { 1: 0.1 }),
        }),
      });
      expect(carOf(low, 1).nextStopLap).toBe(13);
    });

    it('is the end of the longest stint the car has been seen to drive, failing that', () => {
      const snapshot = run({
        standings: standings({
          carIdxEnergyRemaining: withCars(all(0.4), { 2: -1 }),
        }),
        carPit: carPit({
          longestStintLaps: withCars(all(0), { 2: 30 }),
          stintLaps: withCars(all(9), { 2: 9 }),
        }),
      });
      // Nine laps into a stint of thirty that began at the start.
      expect(carOf(snapshot, 2)).toMatchObject({
        basis: 'observed',
        stintLaps: 30,
        nextStopLap: 30,
      });
    });

    it('is the end of a stint as long as the class has shown, or the own car’s, failing that too', () => {
      const energy = withCars(all(0.4), { 2: -1, 3: -1 });
      const fromClass = run({
        standings: standings({ carIdxEnergyRemaining: energy }),
        carPit: carPit({ longestStintLaps: withCars(all(0), { 2: 30 }) }),
      });
      expect(carOf(fromClass, 3)).toMatchObject({
        basis: 'assumed',
        stintLaps: 30,
        nextStopLap: 30,
      });

      // Nobody in the class has finished a stint: the player's forty laps.
      const fromOwn = run({
        standings: standings({ carIdxEnergyRemaining: energy }),
      });
      expect(carOf(fromOwn, 3)).toMatchObject({
        basis: 'assumed',
        stintLaps: 40,
        nextStopLap: 40,
      });
    });

    it('is not named for a stint whose start was not seen', () => {
      // Le Mans Ultimate says the car has stopped, before this was watching.
      const snapshot = run({
        standings: standings({
          carIdxEnergyRemaining: withCars(all(0.4), { 4: -1 }),
        }),
        carPit: carPit({ stintLaps: withCars(all(9), { 4: -1 }) }),
      });
      expect(carOf(snapshot, 4)).toMatchObject({
        basis: 'assumed',
        stopsOwed: 1,
        nextStopLap: null,
        sinceStopLaps: null,
      });
    });

    it('is not named for a car that owes no stop', () => {
      // Ten minutes left: six laps, and sixteen in hand.
      const snapshot = run({
        fuel: fuel({ estimatedLapsRemaining: 6.2 }, { timeRemainingS: 600 }),
      });
      for (const car of snapshot.cars) {
        expect(car.stopsOwed, `car ${car.carIdx}`).toBe(0);
        expect(car.nextStopLap, `car ${car.carIdx}`).toBeNull();
      }
      expect(snapshot.stint?.window).toBeNull();
    });
  });

  describe('the own entry’s stint', () => {
    it('counts the laps aboard, and opens the window at the next line while any lap will do', () => {
      const snapshot = run();
      expect(snapshot.stint).toEqual({
        isVirtualEnergy: true,
        aboard: 40,
        capacity: 100,
        perLap: 2.5,
        lapsLeft: 16,
        limit: 'energy',
        // 60 l at 3 l a lap.
        tankLapsLeft: 20,
        window: { openLap: 10, closeLap: 25 },
      });
      expect(carOf(snapshot, PLAYER).nextStopLap).toBe(25);
    });

    it('opens the window where the stops owed begin to cover the distance', () => {
      // 93 laps to go on two stops of forty laps: a stop before the end of
      // lap 23 leaves more than eighty to drive.
      const snapshot = run({ fuel: fuel({ estimatedLapsRemaining: 93 }) });
      expect(carOf(snapshot, PLAYER).stopsOwed).toBe(2);
      expect(snapshot.stint?.window).toEqual({ openLap: 23, closeLap: 25 });
    });

    it('ends on the tank where that is empty first', () => {
      const snapshot = run({
        fuel: fuel({ tank: { level: 30, perLap: 3 } }),
      });
      expect(snapshot.stint).toMatchObject({
        limit: 'fuel',
        lapsLeft: 10,
        tankLapsLeft: 10,
        window: { openLap: 10, closeLap: 19 },
      });
    });

    it('is a fuel car’s tank, with no second budget beside it', () => {
      const snapshot = run({
        fuel: fuel({ budget: 'fuel', tank: undefined }),
      });
      expect(snapshot.stint).toMatchObject({
        isVirtualEnergy: false,
        limit: 'fuel',
        lapsLeft: 16,
        tankLapsLeft: null,
      });
    });

    it('has no tank to count before a lap of it has been measured', () => {
      const snapshot = run({
        fuel: fuel({ tank: { level: 60, perLap: 0 } }),
      });
      expect(snapshot.stint).toMatchObject({
        limit: 'energy',
        tankLapsLeft: null,
      });
    });

    describe('while a team-mate drives', () => {
      /** Le Mans Ultimate at the monitor, watching the team car. */
      const watching = {
        LmuWatching: [true],
        IsOnTrack: [false],
        // The sim sends no litres for a car the user is not in.
        FuelLevel: [],
      };

      it('goes on counting the energy the sim goes on writing, and says nothing of the tank', () => {
        const snapshot = run({
          fuel: fuel({ watched: true, isOnTrack: false }),
          frame: watching,
        });
        expect(snapshot.stint).toMatchObject({
          isVirtualEnergy: true,
          aboard: 40,
          lapsLeft: 16,
          limit: 'energy',
          // The projection still holds 60 l, a stint old: not counted.
          tankLapsLeft: null,
          window: { openLap: 10, closeLap: 25 },
        });
        expect(carOf(snapshot, PLAYER)).toMatchObject({
          stopsOwed: 2,
          basis: 'energy',
        });
        expect(snapshot.place?.uncertain).toBe(false);
      });

      it('has no stint to state where the sim writes nothing for the car', () => {
        // A car on fuel: the level held is the last one read.
        const snapshot = run({
          fuel: fuel({ budget: 'fuel', tank: undefined, isOnTrack: false }),
          frame: watching,
        });
        expect(snapshot.valid).toBe(true);
        expect(snapshot.stint).toBeNull();
        expect(carOf(snapshot, PLAYER)).toMatchObject({
          stopsOwed: null,
          basis: null,
          nextStopLap: null,
          // What the rivals owe is still theirs.
          lapsLeft: 73.2,
        });
        expect(carOf(snapshot, 1)).toMatchObject({
          stopsOwed: 2,
          netGapS: null,
        });
        expect(snapshot.place).toBeNull();
      });
    });
  });

  describe('after the stop', () => {
    it('names the class car the stop puts the own one behind, and the gap to the car behind it', () => {
      // 31.4 s lost: cars 6 and 7 come past, car 8 does not.
      expect(run().rejoin).toEqual({
        position: 8,
        ahead: { carIdx: 7, gapS: 4.1 },
        behind: { carIdx: 8, gapS: 4.1 },
        inPits: 0,
        closeCall: false,
      });
    });

    it('counts class cars only', () => {
      // The prototype six seconds back comes past as well, and is nobody's
      // place in this class.
      const rejoin = run().rejoin;
      expect(rejoin?.position).toBe(8);
      expect(rejoin?.ahead?.carIdx).not.toBe(LEADER);
    });

    it('calls it close when a car rejoins within the margin', () => {
      const snapshot = run({
        pitStop: pitStop({
          ladder: LADDER.map((rival) =>
            rival.carIdx === 8 ? { ...rival, gapS: 32.6 } : rival
          ),
        }),
      });
      expect(snapshot.rejoin).toMatchObject({
        position: 8,
        behind: { carIdx: 8, gapS: 1.2 },
        closeCall: true,
      });
    });

    it('does not place a car that is in the pits itself', () => {
      const snapshot = run({
        pitStop: pitStop({
          ladder: LADDER.map((rival) =>
            rival.carIdx === 7 ? { ...rival, inPit: true } : rival
          ),
        }),
      });
      expect(snapshot.rejoin).toMatchObject({
        position: 7,
        ahead: { carIdx: 6, gapS: 19.4 },
        inPits: 1,
      });
    });

    it('counts what is left of a stop under way', () => {
      // Four seconds into 14.2 s of standing, nine seconds of lane to the
      // exit: 10.2 s and 9 s, less the 3.6 s that much of the lane takes
      // on the racing line.
      const snapshot = run({
        pitStop: pitStop({
          phase: 'service',
          planned: { standingS: 14.2, driveS: 24.1 },
          timer: { enteredAt: 590, stoppedAt: 596 },
          driveToExitS: 9,
        }),
      });
      expect(snapshot.rejoin).toMatchObject({
        position: 7,
        ahead: { carIdx: 6, gapS: 3.6 },
        behind: { carIdx: 7, gapS: 11.7 },
      });
    });

    it('says nothing without a stop to cost, or a race to place it in', () => {
      expect(run({ pitStop: pitStop({ standingS: null }) }).rejoin).toBeNull();
      expect(run({ pitStop: pitStop({ phase: 'idle' }) }).rejoin).toBeNull();
      expect(run({ pitStop: pitStop({ ladder: [] }) }).rejoin).toBeNull();
      expect(
        run({
          pitStop: pitStop({
            lane: { driveMeasuredS: null, driveAtLimitS: null },
          }),
        }).rejoin
      ).toBeNull();
    });
  });

  describe('what each car has done in the pits', () => {
    it('carries the stops made, the last one and the laps since', () => {
      const snapshot = run({
        carPit: carPit({
          where: withCars(all(CAR_PIT_ON_TRACK), { 3: CAR_PIT_IN_LANE }),
          stops: withCars(all(0), { 1: 2, 2: 1, 3: 3, 4: 1 }),
          lastStopLap: withCars(all(-1), { 1: 5, 2: 3, 3: 9 }),
          lastPitLap: withCars(all(-1), { 1: 5, 2: 7, 3: 9 }),
          laneTimeS: withCars(all(0), { 1: 61.24, 2: 25.1, 3: 12 }),
          stintLaps: withCars(all(9), { 1: 4, 2: 6, 3: 0, 4: -1 }),
        }),
      });
      // A stop four laps ago, 61.2 s in the lane.
      expect(carOf(snapshot, 1)).toMatchObject({
        stops: 2,
        lastStopLap: 5,
        lastStopLaneS: 61.2,
        sinceStopLaps: 4,
        inPit: false,
      });
      // A pass down the lane since: the time is that visit's, not the
      // stop's.
      expect(carOf(snapshot, 2)).toMatchObject({
        stops: 1,
        lastStopLap: 3,
        lastStopLaneS: null,
        sinceStopLaps: 6,
      });
      // In the lane now: its time is still running.
      expect(carOf(snapshot, 3)).toMatchObject({
        stops: 3,
        lastStopLap: 9,
        lastStopLaneS: null,
        sinceStopLaps: 0,
        inPit: true,
      });
      // The sim's count of a stop made before this was watching.
      expect(carOf(snapshot, 4)).toMatchObject({
        stops: 1,
        lastStopLap: null,
        lastStopLaneS: null,
        sinceStopLaps: null,
      });
      // Nothing yet.
      expect(carOf(snapshot, PLAYER)).toMatchObject({
        stops: 0,
        lastStopLap: null,
        lastStopLaneS: null,
        sinceStopLaps: 9,
      });
    });

    it('takes a stop made a lap after the pit entry as that visit', () => {
      // The boxes are past the line: the lap count moved in the lane.
      const snapshot = run({
        carPit: carPit({
          stops: withCars(all(0), { 1: 1 }),
          lastPitLap: withCars(all(-1), { 1: 5 }),
          lastStopLap: withCars(all(-1), { 1: 6 }),
          laneTimeS: withCars(all(0), { 1: 58.4 }),
        }),
      });
      expect(carOf(snapshot, 1)).toMatchObject({
        lastStopLap: 6,
        lastStopLaneS: 58.4,
      });
    });
  });

  describe('the mean of five laps', () => {
    it('is the mean of a car’s last five clean laps, and nothing before it has five', () => {
      const snapshot = run({
        lapTimes: lapTimes(
          {},
          {
            [PLAYER]: [100, 100.2, 100.4, 100.1, 100.3],
            1: [100, 101, 102, 103, 104, 99],
            2: [100, 101, 102, 103],
          }
        ),
      });
      expect(carOf(snapshot, PLAYER).avg5S).toBe(100.2);
      expect(carOf(snapshot, 1).avg5S).toBe(101.8);
      expect(carOf(snapshot, 2).avg5S).toBeNull();
      expect(carOf(snapshot, 3).avg5S).toBeNull();
    });

    it('is nothing from a source with no clean laps', () => {
      const laps = lapTimes({ 1: 100 });
      delete laps.cleanLapTimeHistory;
      expect(carOf(run({ lapTimes: laps }), 1).avg5S).toBeNull();
    });
  });

  describe('what it publishes', () => {
    it('moves its version only when a figure has moved', () => {
      const { processor, state } = make();
      processor.onFrame(frame());
      const first = processor.snapshot();
      processor.onFrame(frame());
      expect(processor.snapshot()).toBe(first);

      state.standings = standings({ gaps: { 6: 11 } });
      processor.onFrame(frame());
      expect(processor.snapshot().version).toBe(first.version + 1);
    });

    it('skips a frame with no session clock', () => {
      const { processor } = make();
      processor.onFrame(frame());
      const first = processor.snapshot();
      processor.onFrame(frame({ SessionTime: [] }));
      expect(processor.snapshot()).toBe(first);
    });
  });
});
