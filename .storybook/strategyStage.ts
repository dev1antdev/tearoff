// Nothing here is imported through a path alias at run time, so a spec can
// load this file and check what a story is told with.
import {
  CAR_PIT_IN_LANE,
  CAR_PIT_ON_TRACK,
  EMPTY_WEAR,
  SessionState,
  type CarPitSnapshot,
  type ChannelPayloads,
  type DamageSnapshot,
  type FuelLapData,
  type FuelProjectionSnapshot,
  type LapTimesSnapshot,
  type PitStopSnapshot,
  type RaceForecastSnapshot,
  type RaceHistoryBridge,
  type RaceHistorySummarySnapshot,
  type RaceStint,
  type Session,
  type StandingsSnapshot,
  type Telemetry,
  type WearSnapshot,
  type WearWheelSnapshot,
} from '../src/types';
import { carFinish, flagTime } from '../src/shared';
import { RaceForecastProcessor } from '../src/app/processors/RaceForecastProcessor';
import {
  buildStoryGrid,
  LMU_STORY_CLASSES,
  type StoryGridCar,
} from './lmuEnduranceGrid';
import { trackStateStorySnapshot } from './trackStateSnapshot';

/**
 * A staged eight-hour race for the stories of the strategy panels: Our Car,
 * Class Rivals and the Stint Timeline.
 *
 * Twenty-two cars in three classes, four hours and thirty-three minutes in,
 * with our LMGT3 fourth of fourteen. The forecast the stories show is not
 * written out here: the cars, their energy, their stops and the gaps
 * between them are, and the real `RaceForecastProcessor` is run on them, so
 * a story shows what the app would. Every name and figure is invented, and
 * no recording stands behind any of it: no recorded race has a pit stop.
 */

type CarClass = keyof typeof LMU_STORY_CLASSES;

interface StrategyCar {
  number: string;
  driver: string;
  team: string;
  carClass: CarClass;
  /** Mean of its last five clean laps, and the pace it is forecast at, s. */
  pace: number;
  /**
   * Race time behind our car, s, for a car of our class; negative ahead.
   * For another class, laps completed plus the fraction of the lap.
   */
  place: number;
  /** Stops made. */
  stops: number;
  /** Laps since the last one. */
  since: number;
  /** What it has left to run on, 0..1. */
  energy: number;
  /** Share of a full budget a lap costs it. */
  usage: number;
  /** Seconds it stood on its last stop. */
  standingS: number;
  inPits?: boolean;
}

export const STRATEGY_OWN_CAR = '77';
/** Our car: on lap 141, at 1:54.4 a lap. */
const OWN_PROGRESS = 140.42;
const OWN_PACE = 114.402;
/** Session clock now, when the race went green, and the race's length. */
const SESSION_TIME = 16_584;
const GREEN_AT = 200;
const RACE_SECONDS = 8 * 3600;
const TIME_LEFT = RACE_SECONDS - (SESSION_TIME - GREEN_AT);
/** The pit lane of the staged track, and what it takes on the racing line. */
const LANE_DRIVE_S = 31.2;
const LANE_TRACK_S = 9.4;
/** Our planned stop's standing time: energy and four tyres. */
const OWN_STANDING_S = 36.2;
/** Litres in our car's tank: eighteen laps of them, more than its energy. */
const TANK_LITRES = 48.6;
/** The distance of the staged race to a lap count: the leader's, in laps. */
const LAP_RACE_LAPS = 306;
/** A GT3's budget lasts 32 laps; ours has 52 % of it. */
const GT_USAGE = 1 / 32;
const OWN_ENERGY = 0.52;

const gt = (
  number: string,
  driver: string,
  team: string,
  pace: number,
  place: number,
  since: number,
  energy: number,
  values: Partial<StrategyCar> = {}
): StrategyCar => ({
  number,
  driver,
  team,
  carClass: 'LMGT3',
  pace,
  place,
  stops: 4,
  since,
  energy,
  usage: GT_USAGE,
  standingS: 29,
  ...values,
});

const other = (
  carClass: CarClass,
  number: string,
  driver: string,
  team: string,
  pace: number,
  progress: number
): StrategyCar => ({
  number,
  driver,
  team,
  carClass,
  pace,
  place: progress,
  stops: 5,
  since: 10,
  energy: 0.6,
  usage: 1 / 30,
  standingS: 31,
});

const CARS: readonly StrategyCar[] = [
  other('Hypercar', '7', 'Kasper Brandt', 'Aurora Hypersport', 93.4, 172.9),
  other('Hypercar', '12', 'Julien Moreau', 'Equipe Lumiere', 93.6, 172.75),
  other('Hypercar', '50', 'Dario Ferraro', 'Rosso Corsa Lab', 93.5, 172.34),
  other('Hypercar', '94', 'Pavel Novak', 'Vertex Hybrid', 93.9, 172.08),
  other('LMP2', '22', 'Adam Whitcombe', 'Union Row Racing', 98.2, 164.6),
  other('LMP2', '37', 'Ion Dragan', 'Carpathia Motorsport', 98.4, 164.4),
  other('LMP2', '28', 'Musa Oyelaran', 'Harmattan Racing', 98.5, 163.98),
  other('LMP2', '65', 'Viktor Lindahl', 'Polar Line', 98.9, 163.3),
  gt('33', 'Lars Hartmann', 'Nordwind Racing', 114.122, -34.3, 12, 0.61, {
    standingS: 39.2,
  }),
  gt('46', 'Tunde Okafor', 'Blue Harbor Motorsport', 114.202, -25.9, 13, 0.57, {
    standingS: 37.2,
  }),
  // A thirstier car: a stint of under 28 laps, and a stop more to make.
  gt('91', 'Stefan Lindqvist', 'Atlas GT', 114.712, -12.4, 9, 0.7, {
    usage: 0.036,
    standingS: 28.2,
  }),
  gt(
    STRATEGY_OWN_CAR,
    'Mikhail Ivanov',
    'Tearoff Endurance',
    OWN_PACE,
    0,
    17,
    OWN_ENERGY,
    {
      standingS: 26.8,
    }
  ),
  gt('54', 'Rocco Castellano', 'Scuderia Meridiano', 114.522, 7.5, 16, 0.48, {
    standingS: 38.2,
  }),
  gt('23', 'Elena Vasquez', 'Cobalt Works', 114.752, 23.9, 0, 1, {
    stops: 5,
    inPits: true,
  }),
  gt('85', 'Hiro Tanaka', 'Kaze Racing', 114.742, 31.7, 15, 0.51, {
    standingS: 41.2,
  }),
  gt('31', 'Bastien Lefevre', 'Rive Gauche GT', 114.812, 45.1, 11, 0.64),
  gt('60', 'Chidi Adeyemi', 'Ironwood Competition', 114.922, 60.8, 20, 0.35),
  gt('27', 'Gustav Sorensen', 'Fjord Motorsport', 115.202, 75.4, 14, 0.55),
  gt('92', 'Fabio Romano', 'Monte Verde Racing', 115.302, 131.2, 4, 0.88, {
    stops: 5,
  }),
  gt('10', 'Willem Achterberg', 'Lowlands GT', 115.602, 164.5, 18, 0.12),
  gt('61', 'Oskar Kowalski', 'Baltic Speed', 115.902, 262.3, 7, 0.78, {
    stops: 5,
  }),
  gt('88', 'Yusuf Haddad', 'Cedar Racing', 116.202, 371.9, 2, 0.95, {
    stops: 6,
  }),
];

const OWN_SLOT = CARS.findIndex((car) => car.number === STRATEGY_OWN_CAR);
const LEADER_SLOT = 0;
const isOwnClass = (car: StrategyCar) =>
  car.carClass === CARS[OWN_SLOT].carClass;
const progressOf = (car: StrategyCar): number =>
  isOwnClass(car) ? OWN_PROGRESS - car.place / OWN_PACE : car.place;

/** The slot of a car, by its number. */
export const strategySlotOf = (carNumber: string): number =>
  CARS.findIndex((car) => car.number === carNumber);

export interface StrategyStage {
  /** A team-mate is driving and the user watches; names who is at the wheel. */
  teamMate?: string;
  /**
   * What the rivals' stops are reckoned from. `energy`: the sim gives each
   * car's (Le Mans Ultimate offline). `observed`: the longest stint each has
   * been seen to drive, which is all iRacing allows. `assumed`: neither,
   * for the cars that decide our place.
   */
  rivals?: 'energy' | 'observed' | 'assumed';
  /**
   * Our car on fuel, in litres, as under iRacing. With a team-mate at the
   * wheel the sim sends nothing of such a car's tank, so nothing is read.
   */
  fuelCar?: boolean;
  /** No tread, no damage, no virtual energy: what iRacing leaves out. */
  iracing?: boolean;
  /** A race to 306 laps, with no clock. */
  lapRace?: boolean;
  /** `grid`: before the green flag. `practice`: not a race at all. */
  session?: 'race' | 'grid' | 'practice';
  /** The car carries damage, with a repair set for the next stop. */
  damaged?: boolean;
}

/** A lap of our car as the fuel projection counts it. */
const usageLap = (fuelUsed: number): FuelLapData => ({
  lapNumber: 1,
  fuelUsed,
  lapTime: OWN_PACE,
  isGreenFlag: true,
  isValidForCalc: true,
  isOutLap: false,
  timestamp: 0,
});

const wearWheel = (treadPct: number): WearWheelSnapshot => ({
  treadPct,
  treadLapPct: 0.4,
  treadProjectedPct: 0.9,
  treadPerLapPct: 0.92,
  treadRateSource: 'tyre',
  treadLapsLeft: Math.round(treadPct / 1.38),
  treadEndOfStintPct: treadPct - 14,
  compound: 1,
  flat: false,
  brakeMm: 34.6,
  brakeLifePct: 76.7,
  brakeLapMm: 0.004,
  brakePerLapMm: 0.0098,
  brakeRateSource: 'stint',
  brakeLapsLeft: 469,
  brakeFailed: false,
});

const LAP_SPREAD = [-0.21, 0.12, -0.05, 0.3, -0.16];

/** Five clean laps around a pace, with the pace as their mean. */
const cleanLaps = (pace: number): number[] =>
  LAP_SPREAD.map((offset) => Math.round((pace + offset) * 1000) / 1000);

const TYRES = [
  { TireIndex: 0, TireCompoundType: 'Soft' },
  { TireIndex: 1, TireCompoundType: 'Medium' },
  { TireIndex: 2, TireCompoundType: 'Hard' },
];

/** Who drove each of our car's stints, the one under way last. */
const OWN_DRIVERS = [
  'Mikhail Ivanov',
  'Mikhail Ivanov',
  'Andrei Petrov',
  'Andrei Petrov',
  'Mikhail Ivanov',
];
/** The same with a team-mate in the stint under way, after the user's own. */
const driversWith = (teamMate: string): string[] => [
  'Mikhail Ivanov',
  'Mikhail Ivanov',
  teamMate,
  'Mikhail Ivanov',
  teamMate,
];

/**
 * The stints a car has driven, as the race history would hold them: as many
 * closed ones as it has made stops, of equal length from the green flag,
 * and the one under way.
 */
const stintsOf = (
  car: StrategyCar,
  carIdx: number,
  driverOf: (stint: number) => string
): RaceStint[] => {
  const openStart = SESSION_TIME - car.since * car.pace;
  const stopS = LANE_DRIVE_S + car.standingS;
  const length = (openStart - GREEN_AT - car.stops * stopS) / car.stops;
  const lapsEach = Math.round(length / car.pace);
  const stints: RaceStint[] = [];
  for (let index = 0; index <= car.stops; index += 1) {
    const open = index === car.stops;
    const startTime = open ? openStart : GREEN_AT + index * (length + stopS);
    const firstLap = index * lapsEach + 1;
    stints.push({
      carIdx,
      ordinal: index + 1,
      driver: driverOf(index),
      openedBy: index === 0 ? 'start' : 'stop',
      closedBy: open ? null : 'stop',
      firstLap,
      lastLap: open ? firstLap + car.since - 1 : firstLap + lapsEach - 1,
      startTime,
      endTime: open ? null : startTime + length,
      laps: open ? car.since : lapsEach,
      cleanLaps: open ? Math.max(0, car.since - 1) : lapsEach - 2,
      avgLap: car.pace + 0.1,
      bestLap: car.pace - 0.5,
      stop: open
        ? null
        : {
            laneTime: stopS,
            standingTime: car.standingS,
            driverChanged: false,
          },
    });
  }
  return stints;
};

const build = (stage: StrategyStage) => {
  const { rivals = stage.iracing ? 'observed' : 'energy' } = stage;
  const fuelCar = stage.fuelCar ?? stage.iracing ?? false;
  const sessionType = stage.session === 'practice' ? 'Practice' : 'Race';

  const gridCars: StoryGridCar[] = CARS.map((car) => ({
    number: car.number,
    driver:
      car.number === STRATEGY_OWN_CAR && stage.teamMate
        ? stage.teamMate
        : car.driver,
    team: car.team,
    carClass: car.carClass,
    progress: progressOf(car),
    lastLap: car.pace + 0.33,
    bestLap: car.pace - 0.53,
    inPits: car.inPits,
  }));
  const grid = buildStoryGrid(LMU_STORY_CLASSES, gridCars, {
    player: STRATEGY_OWN_CAR,
    sessionType,
  });
  const session = {
    ...grid.session,
    DriverInfo: { ...grid.session.DriverInfo, DriverTires: TYRES },
  } as Session;

  // The race gaps of our class as staged; the other classes are far ahead
  // on the road and are nobody's rival here.
  const ownGap = 2400;
  const all = <T>(value: (car: StrategyCar, slot: number) => T): T[] =>
    CARS.map(value);
  /** A rival whose stops the stage leaves to be assumed. */
  const isUnread = (car: StrategyCar): boolean =>
    rivals === 'assumed' && ['91', '54', '23'].includes(car.number);
  const hasEnergy = (car: StrategyCar): boolean =>
    rivals === 'energy' && !isUnread(car);

  const standings: StandingsSnapshot = {
    ...grid.standings,
    carIdxF2Time: all((car) =>
      isOwnClass(car) ? ownGap + car.place : (172.9 - car.place) * 93.4
    ),
    carIdxEnergyRemaining: all((car) => (hasEnergy(car) ? car.energy : -1)),
    carIdxEnergyIsVirtual: all((car) => hasEnergy(car)),
  };

  const laps = (car: StrategyCar) => Math.floor(progressOf(car));
  const carPit = (usageOf: (car: StrategyCar) => number): CarPitSnapshot => ({
    where: all((car) => (car.inPits ? CAR_PIT_IN_LANE : CAR_PIT_ON_TRACK)),
    laneTimeS: all((car) =>
      car.inPits ? 18.4 : Math.round((LANE_DRIVE_S + car.standingS) * 10) / 10
    ),
    standingS: all((car) => (car.inPits ? 6.1 : car.standingS)),
    stops: all((car) => car.stops),
    lastPitLap: all((car) => laps(car) - car.since),
    lastStopLap: all((car) => laps(car) - car.since),
    stintLaps: all((car) => car.since),
    // A stint as long as its budget, for every car that has finished one
    // and is not left to be assumed.
    longestStintLaps: all((car) =>
      isUnread(car) ? 0 : Math.floor(1 / car.usage)
    ),
    usedLastLap: all((car) => (hasEnergy(car) ? car.usage : -1)),
    usedAverage: all((car) => (hasEnergy(car) ? usageOf(car) : -1)),
    lapsLeft: all((car) => (hasEnergy(car) ? car.energy / car.usage : -1)),
    requested: all(() => false),
    counts: {
      onTrack: CARS.length - 1,
      inLane: 1,
      standingInLane: 1,
      requested: 0,
      inGarage: 0,
    },
    sessionNum: 0,
    version: 1,
  });

  const lapTimes: LapTimesSnapshot = {
    lapTimes: all((car) => car.pace),
    lapTimeHistory: all((car) => [
      ...cleanLaps(car.pace),
      ...cleanLaps(car.pace),
    ]),
    cleanLapTimeHistory: all((car) => cleanLaps(car.pace)),
    sessionNum: 0,
    version: 1,
  };

  // The class cars around us and the cars of other classes on the same
  // piece of road, as the pit stop's ladder lists them: by gap.
  const ladder = [
    ...CARS.map((car, carIdx) => ({ car, carIdx }))
      .filter(({ car, carIdx }) => isOwnClass(car) && carIdx !== OWN_SLOT)
      .filter(({ car }) => car.place > -13 && car.place < 240)
      .map(({ car, carIdx }) => ({
        carIdx,
        gapS: car.place,
        sameClass: true,
        inPit: !!car.inPits,
      })),
    {
      carIdx: strategySlotOf('65'),
      gapS: 18.2,
      sameClass: false,
      inPit: false,
    },
  ].sort((a, b) => a.gapS - b.gapS);

  const own = CARS[OWN_SLOT];
  const pitStop: PitStopSnapshot = {
    phase: 'planning',
    requested: false,
    lane: {
      entryPct: 0.95,
      exitPct: 0.03,
      lengthM: 410.5,
      speedLimitMs: 16.6,
      speedLimitSource: 'measured',
      driveAtLimitS: 24.7,
      driveMeasuredS: LANE_DRIVE_S,
      trackTimeS: LANE_TRACK_S,
    },
    estimate: {
      source: stage.iracing ? 'learned' : 'sim',
      standingS: OWN_STANDING_S,
      parts: null,
      optionalRepairS: null,
      samples: stage.iracing ? 4 : 0,
      penalty: null,
    },
    planned: null,
    timer: { enteredAt: null, stoppedAt: null, standingS: 0, exitedAt: null },
    last: null,
    refuel: null,
    rejoin: {
      position: 12,
      classPosition: 4,
      ladder,
      driveToExitS: null,
      passes: [],
    },
    sessionNum: 0,
    version: 1,
  };

  // The flag as the finish projection will reckon it, for the laps the
  // fuel projection would publish for our car.
  const leader = CARS[LEADER_SLOT];
  const end = stage.lapRace
    ? { timeLeftS: null, lapLimit: LAP_RACE_LAPS }
    : { timeLeftS: TIME_LEFT, lapLimit: null };
  const flag = flagTime({ paceS: leader.pace, progress: leader.place }, end);
  const lapsToGo = (progress: number): number =>
    (flag &&
      carFinish({ paceS: OWN_PACE, progress }, flag.tFlagS, 0, end.lapLimit)
        ?.lapsToGo) ||
    0;

  // A hundred percent of virtual energy, or a hundred litres of fuel.
  const capacity = 100;
  const perLap = capacity * GT_USAGE;
  const fuel = (progress: number): FuelProjectionSnapshot => ({
    isReplay: false,
    fuelLevel: capacity * own.energy,
    fuelLevelPct: own.energy,
    currentLap: Math.floor(progress) + 1,
    lapDistPct: progress - Math.floor(progress),
    currentLapUsage: perLap * (progress - Math.floor(progress)),
    projectedLapUsage: perLap,
    lastLapUsage: perLap,
    sessionLapsRemain: Math.floor(lapsToGo(progress)),
    sessionTimeRemain: TIME_LEFT,
    sessionTimeTotal: RACE_SECONDS,
    sessionFlags: 0,
    sessionState:
      stage.session === 'grid' ? SessionState.ParadeLaps : SessionState.Racing,
    sessionNum: 0,
    sessionLaps: stage.lapRace ? LAP_RACE_LAPS : 'unlimited',
    calculatedTotalRaceLaps: progress + lapsToGo(progress),
    estimatedLapsRemaining: lapsToGo(progress),
    hasValidRaceEstimate: true,
    isFixedLapRace: !!stage.lapRace,
    sessionType,
    fuelTankCapacity: capacity,
    budget: fuelCar ? 'fuel' : 'virtualEnergy',
    ...(fuelCar ? {} : { tank: { level: TANK_LITRES, perLap: 2.62 } }),
    completedLaps: [usageLap(perLap), usageLap(perLap)],
    isOnTrack: !stage.teamMate,
    // The sim goes on writing a car's virtual energy while somebody else
    // drives it, and nothing of a tank.
    ...(stage.teamMate && !fuelCar ? { watched: true } : {}),
    ...(stage.session === 'practice'
      ? {}
      : {
          race: {
            leaderCarIdx: LEADER_SLOT,
            playerCarIdx: OWN_SLOT,
            leaderPaceS: leader.pace,
            playerPaceS: OWN_PACE,
            leaderProgress: leader.place,
            playerProgress: progress,
            timeRemainingS: stage.lapRace ? 0 : TIME_LEFT,
            lapLimit: stage.lapRace ? LAP_RACE_LAPS : 0,
          },
        }),
    engine: {
      accumulatedRefuel: 0,
      isLapDistPctReset: false,
      lapCrossingTime: SESSION_TIME - 48,
      lapStartFuel: capacity * own.energy + perLap * 0.42,
      lastLap: Math.floor(progress) + 1,
      lastLapDistPct: progress - Math.floor(progress),
      lastSessionFlags: 0,
      wasOnPitRoad: false,
    },
  });

  const frame = (sessionTime: number): Telemetry =>
    ({
      SessionTime: { value: [sessionTime] },
      SessionNum: { value: [0] },
      PlayerCarIdx: { value: [OWN_SLOT] },
      // The tank is read for a car the user is in, and for no other.
      FuelLevel: { value: stage.teamMate ? [] : [TANK_LITRES] },
      ...(stage.teamMate
        ? { LmuWatching: { value: [true] }, IsOnTrack: { value: [false] } }
        : {}),
      CarIdxLap: { value: all((car) => laps(car) + 1) },
      CarIdxLapCompleted: { value: all((car) => laps(car)) },
      CarIdxLapDistPct: {
        value: all((car) => progressOf(car) - laps(car)),
      },
    }) as unknown as Telemetry;

  // The forecast, with the ten laps before this one played first so that
  // it remembers where it stood: until three laps ago car 91 used no more
  // than the rest, owed the stops we do, and was forecast to stay ahead.
  const state = {
    fuel: fuel(OWN_PROGRESS),
    carPit: carPit((car) => car.usage),
  };
  const processor = new RaceForecastProcessor({
    fuel: () => state.fuel,
    lapTimes: () => lapTimes,
    pitStop: () => pitStop,
    carPit: () => state.carPit,
    standings: () => standings,
  });
  processor.init(session);
  processor.onLifecycle({ type: 'enter', replay: false });
  for (let lapsAgo = 10; lapsAgo >= 0; lapsAgo -= 1) {
    state.fuel = fuel(OWN_PROGRESS - lapsAgo);
    state.carPit = carPit((car) =>
      lapsAgo > 3 && car.number === '91' ? GT_USAGE : car.usage
    );
    processor.onFrame(frame(SESSION_TIME - lapsAgo * OWN_PACE));
  }
  const forecast: RaceForecastSnapshot = processor.snapshot();

  const wear: WearSnapshot =
    stage.iracing || stage.teamMate
      ? EMPTY_WEAR
      : {
          ...EMPTY_WEAR,
          available: true,
          wheels: [84.2, 85.1, 88.4, 89].map(wearWheel),
          paceLapTime: OWN_PACE,
          budgetLapsLeft: 16.6,
          version: 1,
        };

  const damage: DamageSnapshot = {
    available: !stage.iracing && !stage.teamMate,
    body: stage.damaged ? [1, 1, 0, 0, 0, 0, 0, 0] : [0, 0, 0, 0, 0, 0, 0, 0],
    wheels: [0, 1, 2, 3].map(() => ({
      detached: false,
      punctured: false,
      suspensionDamage: 0,
    })),
    bodyIntegrity: stage.damaged ? 0.88 : 1,
    aeroIntegrity: stage.damaged ? 0.93 : 1,
    suspensionIntegrity: 1,
    tyreIntegrity: 0.98,
    overheating: false,
    impactBearingRad: null,
    repairSeconds: stage.damaged ? 34 : 0,
    repairChoice: stage.damaged ? 'Repair All' : null,
    sessionNum: 0,
    version: 1,
  };

  // Our car's stints, the last of them a team-mate's while one drives.
  const ownDrivers = stage.teamMate ? driversWith(stage.teamMate) : OWN_DRIVERS;
  const stints = new Map<number, RaceStint[]>(
    CARS.map((car, carIdx) => [
      carIdx,
      stintsOf(car, carIdx, (stint) =>
        carIdx === OWN_SLOT
          ? (ownDrivers[stint] ?? ownDrivers[ownDrivers.length - 1])
          : // Car 46 changed driver after its second stint; the rest have
            // one name throughout.
            car.number === '46' && stint >= 2
            ? 'Kwame Mensah'
            : car.driver
      ),
    ])
  );

  const previous = stints.get(OWN_SLOT)?.[own.stops - 1];
  const summary: RaceHistorySummarySnapshot = {
    raceToken: 'strategy-stage',
    raceId: null,
    resumed: false,
    laps: all((car) => laps(car)),
    lastLap: all((car) => laps(car)),
    missingLaps: all(() => 0),
    stintFirstLap: all((car) => laps(car) - car.since + 1),
    stintLaps: all((car) => car.since),
    stintDriver: all((car, slot) => gridCars[slot].driver),
    // The stint under way and the last one by another driver are not what
    // these panels read: left as "nothing to say".
    stintAvgLap: all(() => -1),
    stintCleanLaps: all(() => 0),
    previousStintAvgLap: all((_, slot) =>
      slot === OWN_SLOT ? OWN_PACE - 0.29 : -1
    ),
    previousStintDriver: all((_, slot) =>
      slot === OWN_SLOT ? (previous?.driver ?? '') : ''
    ),
    previousDriverStintAvgLap: all(() => -1),
    previousDriverStintDriver: all(() => ''),
    driverChanges: all(() => 0),
    stops: all((car) => car.stops),
    revision: all(() => 1),
    sessionNum: 0,
    version: 1,
  };

  const snapshots: Partial<ChannelPayloads> = {
    'race-forecast.snapshot': forecast,
    'race-history.summary': summary,
    'wear.snapshot': wear,
    'damage.snapshot': damage,
    'track-state.snapshot': {
      ...trackStateStorySnapshot,
      focusCarIdx: OWN_SLOT,
      sessionTime: SESSION_TIME,
      ...(stage.teamMate
        ? {
            isOnTrack: false,
            outOfCar: true,
            watching: true,
            watchingOwnCar: true,
          }
        : {}),
    },
  };

  return { session, snapshots, stints, forecast };
};

/** The staged race: its session, its channels and its recorded stints. */
export const strategyStage = (stage: StrategyStage = {}) => build(stage);

/** The race history's bridge, answering from the staged stints. */
export const strategyHistoryBridge = (
  stints: ReadonlyMap<number, RaceStint[]>
): RaceHistoryBridge => ({
  getCarLaps: async () => ({ laps: [], missingLaps: [], revision: 1 }),
  getCarStints: async (carIdx) => stints.get(carIdx) ?? [],
  getDriverChanges: async () => [],
  listRaces: async () => [],
});
