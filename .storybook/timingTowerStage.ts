import type {
  CarPitSnapshot,
  CarSectorsSnapshot,
  ChannelPayloads,
  RaceHistorySummarySnapshot,
  Session,
  StandingsSnapshot,
  Telemetry,
} from '@irdashies/types';
// By path and not by alias: the tower's spec loads this file, and a spec
// resolves no alias for a file outside src.
import {
  CAR_PIT_IN_GARAGE,
  CAR_PIT_IN_LANE,
  CAR_PIT_ON_TRACK,
} from '../src/types/channels/carPit';
import { CarSectorsProcessor } from '../src/app/processors/CarSectorsProcessor';
import { classTyresStorySnapshot } from './classTyresStage';
import { buildStoryLapTimes, type StoryLapPlan } from './lapTimesSnapshot';
import {
  buildStoryGrid,
  LMU_STORY_CLASSES,
  type StoryGridCar,
} from './lmuEnduranceGrid';
import { trackStateStorySnapshot } from './trackStateSnapshot';

/**
 * A staged eight-hour race for the Timing Tower's stories: twenty-two cars
 * in three classes, three and a half hours in, our LMGT3 fourth in class.
 * Every name, team and figure is invented.
 *
 * The places and gaps come out of the real StandingsProcessor, the lap
 * averages out of the real LapTimesProcessor and the sector bests out of
 * the real CarSectorsProcessor, each fed the staged cars, so what a story
 * shows of them is what the app would have made of such a race. The pit
 * stops, the stints and their pace are written out, as the race history and
 * the pit tracker would hold them after hours no story can replay.
 *
 * A few cars are worth finding:
 *
 * - #77 is ours: fourth in LMGT3, in the second half of a double stint,
 *   quicker than the first half and slower than the team-mate before.
 * - #23 (LMGT3) is in the pit lane, #94 (Hypercar) on its out-lap, #88
 *   (LMGT3) in its garage, three laps down.
 * - #50 and #28 stopped a few laps ago: too few clean laps since for a
 *   pace against the stint before, and their stops are in their averages
 *   over all laps.
 * - #10 (LMGT3) is nearly out of energy and on a mixed set of tyres.
 * - The LMGT3s, our class, carry the laps on their tyres and the tread
 *   left in every state that has one: see `classTyresStage.ts`.
 * - #54 (LMGT3) has a last lap the sim gave no time.
 * - The LMP2 cars run on fuel, not virtual energy.
 */

/** The session's tyre list. A car's `wheels` are indices into it. */
const TYRES = ['Soft', 'Medium', 'Hard', 'Wet'] as const;
const SOFT = 0;
const MEDIUM = 1;
const HARD = 2;

export interface TowerStoryCar extends StoryGridCar {
  /** Pit stops made. */
  stops: number;
  /** Laps completed since the last of them. */
  stintLaps: number;
  /** What the car has left to run on, 0..1. */
  energy: number;
  /** One compound for the set, or one a wheel: FL, FR, RL, RR. */
  wheels: number | [number, number, number, number];
  /** On the lap it left the pit lane on. */
  outLap?: boolean;
  /**
   * The stint's mean clean lap against the stint before, seconds, and
   * against the last stint by another driver where that is not the same
   * stint. Both left out for a car with nothing to compare.
   */
  vsStint?: number;
  vsDriver?: number;
  /** Who drove the stint before, where it was not the driver now. */
  driverBefore?: string;
}

/** The player's car, by number. */
export const TOWER_STORY_PLAYER = '77';

export const TOWER_STORY_CARS: readonly TowerStoryCar[] = [
  {
    number: '7',
    driver: 'Kai Brandt',
    team: 'Aurora Hypersport',
    carClass: 'Hypercar',
    progress: 58.62,
    lastLap: 209.318,
    bestLap: 208.455,
    stops: 6,
    stintLaps: 9,
    energy: 0.71,
    wheels: MEDIUM,
    vsStint: -0.21,
    driverBefore: 'Noel Verhaegen',
  },
  {
    number: '12',
    driver: 'Julien Moreau',
    team: 'Equipe Lumiere',
    carClass: 'Hypercar',
    progress: 58.553,
    lastLap: 208.102,
    bestLap: 208.102,
    stops: 6,
    stintLaps: 10,
    energy: 0.68,
    wheels: MEDIUM,
    vsStint: 0.12,
    vsDriver: -0.3,
    driverBefore: 'Remy Castaing',
  },
  {
    number: '50',
    driver: 'Dario Ferraro',
    team: 'Rosso Corsa Lab',
    carClass: 'Hypercar',
    progress: 58.371,
    lastLap: 209.667,
    bestLap: 208.911,
    stops: 6,
    stintLaps: 3,
    energy: 0.91,
    wheels: SOFT,
    vsStint: -0.44,
    driverBefore: 'Luca Benedetti',
  },
  {
    number: '94',
    driver: 'Petr Novak',
    team: 'Vertex Hybrid',
    carClass: 'Hypercar',
    progress: 58.256,
    lastLap: 247.902,
    bestLap: 209.34,
    stops: 7,
    stintLaps: 1,
    energy: 0.97,
    wheels: MEDIUM,
    outLap: true,
    vsStint: 0.3,
    driverBefore: 'Tomas Havel',
  },
  {
    number: '22',
    driver: 'Adam Whitcombe',
    team: 'Union Row Racing',
    carClass: 'LMP2',
    progress: 56.4,
    lastLap: 217.338,
    bestLap: 216.904,
    stops: 5,
    stintLaps: 14,
    energy: 0.42,
    wheels: MEDIUM,
    vsStint: -0.08,
    driverBefore: 'George Alderton',
  },
  {
    number: '37',
    driver: 'Ilie Dragan',
    team: 'Carpathia Motorsport',
    carClass: 'LMP2',
    progress: 56.308,
    lastLap: 216.59,
    bestLap: 216.59,
    stops: 5,
    stintLaps: 15,
    energy: 0.38,
    wheels: MEDIUM,
    vsStint: -0.52,
    vsDriver: 0.17,
    driverBefore: 'Radu Ciobanu',
  },
  {
    number: '28',
    driver: 'Malik Oyelaran',
    team: 'Harmattan Racing',
    carClass: 'LMP2',
    progress: 56.111,
    lastLap: 218.021,
    bestLap: 217.115,
    stops: 6,
    stintLaps: 2,
    energy: 0.93,
    wheels: MEDIUM,
    vsStint: 0.25,
    driverBefore: 'Seun Adebayo',
  },
  {
    number: '65',
    driver: 'Viktor Lindahl',
    team: 'Polar Line',
    carClass: 'LMP2',
    progress: 55.2,
    lastLap: 219.74,
    bestLap: 217.86,
    stops: 5,
    stintLaps: 18,
    energy: 0.21,
    wheels: HARD,
    vsStint: 0.61,
    driverBefore: 'Anders Holm',
  },
  {
    number: '33',
    driver: 'Lars Hartmann',
    team: 'Nordwind Racing',
    carClass: 'LMGT3',
    progress: 51.74,
    lastLap: 237.612,
    bestLap: 236.98,
    stops: 4,
    stintLaps: 12,
    energy: 0.61,
    wheels: MEDIUM,
    vsStint: -0.17,
    driverBefore: 'Jonas Weber',
  },
  {
    number: '46',
    driver: 'Tobe Okafor',
    team: 'Blue Harbor Motorsport',
    carClass: 'LMGT3',
    progress: 51.7,
    lastLap: 236.705,
    bestLap: 236.705,
    stops: 4,
    stintLaps: 13,
    energy: 0.57,
    wheels: MEDIUM,
    vsStint: -0.33,
    vsDriver: -0.61,
    driverBefore: 'Ben Carrow',
  },
  {
    number: '91',
    driver: 'Sven Lindqvist',
    team: 'Atlas GT',
    carClass: 'LMGT3',
    progress: 51.637,
    lastLap: 237.944,
    bestLap: 237.21,
    stops: 4,
    stintLaps: 9,
    energy: 0.7,
    wheels: HARD,
    vsStint: 0.09,
    driverBefore: 'Mikkel Aas',
  },
  {
    number: TOWER_STORY_PLAYER,
    driver: 'Maxim Ivanov',
    team: 'Tearoff Endurance',
    carClass: 'LMGT3',
    progress: 51.578,
    lastLap: 237.288,
    bestLap: 237.288,
    stops: 4,
    stintLaps: 17,
    energy: 0.45,
    wheels: MEDIUM,
    // A double stint: quicker than his own first half, and not yet as
    // quick as the team-mate who drove before him.
    vsStint: -0.38,
    vsDriver: 0.21,
    driverBefore: 'Nadia Volkova',
  },
  {
    number: '54',
    driver: 'Rico Castellano',
    team: 'Scuderia Meridiano',
    carClass: 'LMGT3',
    progress: 51.543,
    lastLap: 244.3,
    bestLap: 237.905,
    lastLapInvalid: true,
    stops: 4,
    stintLaps: 16,
    energy: 0.48,
    wheels: MEDIUM,
    vsStint: 0.27,
    driverBefore: 'Paolo Greco',
  },
  {
    number: '23',
    driver: 'Elena Vasquez',
    team: 'Cobalt Works',
    carClass: 'LMGT3',
    progress: 51.465,
    lastLap: 251.118,
    bestLap: 237.44,
    inPits: true,
    stops: 5,
    stintLaps: 0,
    energy: 1,
    wheels: MEDIUM,
    vsStint: -0.05,
    driverBefore: 'Marta Iglesias',
  },
  {
    number: '85',
    driver: 'Hiro Tanaka',
    team: 'Kaze Racing',
    carClass: 'LMGT3',
    progress: 51.429,
    lastLap: 238.019,
    bestLap: 237.66,
    stops: 4,
    stintLaps: 15,
    energy: 0.51,
    wheels: MEDIUM,
    vsStint: 0.41,
    vsDriver: 0.02,
    driverBefore: 'Kenta Mori',
  },
  {
    number: '31',
    driver: 'Bruno Lefevre',
    team: 'Rive Gauche GT',
    carClass: 'LMGT3',
    progress: 51.365,
    lastLap: 238.47,
    bestLap: 237.82,
    stops: 4,
    stintLaps: 11,
    energy: 0.64,
    wheels: HARD,
    vsStint: -0.11,
    driverBefore: 'Alain Mercier',
  },
  {
    number: '60',
    driver: 'Chidi Adeyemi',
    team: 'Ironwood Competition',
    carClass: 'LMGT3',
    progress: 51.291,
    lastLap: 238.905,
    bestLap: 238.12,
    stops: 4,
    stintLaps: 20,
    energy: 0.35,
    wheels: MEDIUM,
    vsStint: 0.74,
    driverBefore: 'Obi Nwosu',
  },
  {
    number: '27',
    driver: 'Gustav Sorensen',
    team: 'Fjord Motorsport',
    carClass: 'LMGT3',
    progress: 51.223,
    lastLap: 239.154,
    bestLap: 238.31,
    stops: 4,
    stintLaps: 14,
    energy: 0.55,
    wheels: MEDIUM,
    // The same driver since the start: nobody to compare with.
    vsStint: 0.18,
  },
  {
    number: '92',
    driver: 'Fabio Romano',
    team: 'Monte Verde Racing',
    carClass: 'LMGT3',
    progress: 50.61,
    lastLap: 239.48,
    bestLap: 238.44,
    stops: 5,
    stintLaps: 4,
    energy: 0.88,
    wheels: MEDIUM,
    vsStint: -0.29,
    driverBefore: 'Enzo Ricci',
  },
  {
    number: '10',
    driver: 'Wim Achterberg',
    team: 'Lowlands GT',
    carClass: 'LMGT3',
    progress: 50.48,
    lastLap: 240.87,
    bestLap: 238.66,
    stops: 4,
    stintLaps: 18,
    energy: 0.08,
    // Mediums on the front, softs on the rear.
    wheels: [MEDIUM, MEDIUM, SOFT, SOFT],
    vsStint: 1.12,
    driverBefore: 'Daan Visser',
  },
  {
    number: '61',
    driver: 'Oskar Kowalski',
    team: 'Baltic Speed',
    carClass: 'LMGT3',
    progress: 49.52,
    lastLap: 239.905,
    bestLap: 238.72,
    stops: 5,
    stintLaps: 7,
    energy: 0.78,
    wheels: MEDIUM,
    vsStint: 0.06,
    driverBefore: 'Piotr Zielinski',
  },
  {
    number: '88',
    driver: 'Yusuf Haddad',
    team: 'Cedar Racing',
    carClass: 'LMGT3',
    progress: 47.9,
    lastLap: 241.36,
    bestLap: 239.05,
    inGarage: true,
    stops: 6,
    stintLaps: 0,
    energy: 0.95,
    wheels: MEDIUM,
  },
];

/** A number in 0..1 that is the same every time for the same two seeds. */
const seeded = (a: number, b: number): number => {
  const x = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

/** How a lap of the staged circuit splits into its three sectors. */
const SECTOR_SHARES = [0.33, 0.41];

/** A lap time as three sector times that add up to it. */
const sectorsOf = (lapTime: number, shift: readonly number[]) => {
  const s1 = lapTime * SECTOR_SHARES[0] + shift[0];
  const s2 = lapTime * SECTOR_SHARES[1] + shift[1];
  return [s1, s2, lapTime - s1 - s2];
};

/**
 * The sector channel for the staged cars, from the real processor: a lap
 * before the last one, the last one, and what is done of the lap under
 * way. Which of them is a car's best, and a class's, is the processor's
 * answer.
 */
const buildSectors = (
  cars: readonly TowerStoryCar[],
  session: Session,
  racing: boolean
): CarSectorsSnapshot => {
  const processor = new CarSectorsProcessor();
  processor.onLifecycle({ type: 'enter', replay: false });
  processor.init(session);
  const none = [null, null, null];
  const frame = (
    time: number,
    last: (number | null)[][],
    current: (number | null)[][]
  ) =>
    ({
      SessionTime: { value: [time] },
      SessionNum: { value: [0] },
      LmuCarIdxLastSectorTimes: { value: last.flat() },
      LmuCarIdxCurrentSectorTimes: { value: current.flat() },
    }) as unknown as Telemetry;

  if (!racing) {
    processor.onFrame(
      frame(
        10,
        cars.map(() => none),
        cars.map(() => none)
      )
    );
    return structuredClone(processor.snapshot());
  }

  // The lap before the last: a little quicker or slower in each sector, so
  // that some of the last lap's sectors are the car's best and some not.
  const before = cars.map((car, slot) =>
    sectorsOf(car.bestLap + 0.9, [
      (seeded(slot, 1) - 0.5) * 0.9,
      (seeded(slot, 2) - 0.5) * 0.9,
    ])
  );
  const last = cars.map((car, slot) =>
    sectorsOf(car.lastLap, [
      (seeded(slot, 3) - 0.5) * 0.5,
      (seeded(slot, 4) - 0.5) * 0.5,
    ])
  );
  // The lap under way, as far round as the car is.
  const current = cars.map((car, slot) => {
    const fraction = car.progress - Math.floor(car.progress);
    if (car.inPits || car.inGarage) return none;
    const [s1, s2] = sectorsOf(car.bestLap + 0.4, [
      (seeded(slot, 5) - 0.5) * 0.9,
      (seeded(slot, 6) - 0.5) * 0.9,
    ]);
    return [
      fraction > SECTOR_SHARES[0] ? s1 : null,
      fraction > SECTOR_SHARES[0] + SECTOR_SHARES[1] ? s2 : null,
      null,
    ];
  });

  processor.onFrame(
    frame(
      12_000,
      before,
      cars.map(() => none)
    )
  );
  processor.onFrame(frame(12_240, last, current));
  return structuredClone(processor.snapshot());
};

/**
 * The laps the app has watched each car complete: fourteen for most, with
 * the stops of the cars that made one in that time.
 */
const lapPlanOf = (car: TowerStoryCar): StoryLapPlan => {
  const laps = 14;
  if (car.inGarage) return { laps: 6 };
  // The lap into the pits is the one before the first lap of the stint.
  if (car.inPits) return { laps, inLaps: [laps] };
  if (car.outLap) return { laps, inLaps: [laps] };
  return car.stintLaps < laps
    ? { laps, inLaps: [laps - car.stintLaps] }
    : { laps };
};

const buildSummary = (
  cars: readonly TowerStoryCar[],
  racing: boolean
): RaceHistorySummarySnapshot => {
  const laps = cars.map((car) => (racing ? Math.floor(car.progress) : 0));
  // The lap a stop was made on is the first of its stint, and no clean one.
  const cleanLaps = cars.map((car) =>
    racing ? Math.max(0, car.stintLaps - 1) : 0
  );
  const stintAvg = cars.map((car, slot) =>
    cleanLaps[slot] > 0 ? car.bestLap + 0.62 + seeded(slot, 7) * 0.3 : -1
  );
  const before = (slot: number, delta: number | undefined) =>
    racing && delta !== undefined && stintAvg[slot] > 0
      ? stintAvg[slot] - delta
      : -1;
  return {
    raceToken: 'story:1',
    raceId: null,
    resumed: false,
    laps,
    lastLap: laps,
    missingLaps: cars.map(() => 0),
    stintFirstLap: cars.map((car, slot) =>
      racing ? Math.max(1, laps[slot] - car.stintLaps + 1) : 0
    ),
    stintLaps: cars.map((car) => (racing ? car.stintLaps : 0)),
    stintDriver: cars.map((car) => car.driver),
    stintAvgLap: stintAvg,
    stintCleanLaps: cleanLaps,
    previousStintAvgLap: cars.map((car, slot) => before(slot, car.vsStint)),
    // After a double stint the stint before is the same driver's.
    previousStintDriver: cars.map((car) =>
      !racing || car.vsStint === undefined
        ? ''
        : car.vsDriver !== undefined || !car.driverBefore
          ? car.driver
          : car.driverBefore
    ),
    previousDriverStintAvgLap: cars.map((car, slot) =>
      before(slot, car.driverBefore ? (car.vsDriver ?? car.vsStint) : undefined)
    ),
    previousDriverStintDriver: cars.map((car) =>
      racing ? (car.driverBefore ?? '') : ''
    ),
    driverChanges: cars.map((car) => (racing && car.driverBefore ? 2 : 0)),
    stops: cars.map((car) => (racing ? car.stops : 0)),
    revision: cars.map(() => 1),
    sessionNum: 0,
    version: 1,
  };
};

const buildCarPit = (
  cars: readonly TowerStoryCar[],
  racing: boolean
): CarPitSnapshot => {
  const where = cars.map((car) =>
    car.inGarage
      ? CAR_PIT_IN_GARAGE
      : car.inPits
        ? CAR_PIT_IN_LANE
        : CAR_PIT_ON_TRACK
  );
  const none = cars.map(() => -1);
  return {
    where,
    laneTimeS: cars.map((car) => (car.inPits ? 31.4 : 0)),
    standingS: cars.map((car) => (car.inPits ? 18.2 : 0)),
    stops: cars.map((car) => (racing ? car.stops : 0)),
    lastPitLap: none,
    lastStopLap: none,
    stintLaps: cars.map((car) => (racing ? car.stintLaps : 0)),
    longestStintLaps: cars.map(() => (racing ? 21 : 0)),
    usedLastLap: none,
    usedAverage: none,
    lapsLeft: none,
    requested: cars.map(() => false),
    counts: {
      onTrack: where.filter((place) => place === CAR_PIT_ON_TRACK).length,
      inLane: where.filter((place) => place === CAR_PIT_IN_LANE).length,
      standingInLane: where.filter((place) => place === CAR_PIT_IN_LANE).length,
      requested: 0,
      inGarage: where.filter((place) => place === CAR_PIT_IN_GARAGE).length,
    },
    sessionNum: 0,
    version: 1,
  };
};

export interface TimingTowerStage {
  session: Session;
  /** Every channel the tower reads, one snapshot each. */
  snapshots: Partial<ChannelPayloads>;
  /** The slot of a car, by its number. */
  slotOf: (carNumber: string) => number;
}

export interface TimingTowerStageOptions {
  /**
   * The same field before the start: every car on its way to the line for
   * the first time, with no lap, no sector and no stop behind it.
   */
  beforeStart?: boolean;
  /**
   * The laps on a set of tyres as iRacing allows them: no tread to make a
   * figure from, and a set that is either the one from the start or at
   * least as old as the laps since the last stop.
   */
  iracingTyres?: boolean;
}

/** The tread the sim reads on our own car, percent. */
const OWN_TREAD_PCT = 86.4;

/** The staged race, as the channels and the session would hold it. */
export const timingTowerStage = ({
  beforeStart = false,
  iracingTyres = false,
}: TimingTowerStageOptions = {}): TimingTowerStage => {
  const racing = !beforeStart;
  const cars: readonly TowerStoryCar[] = racing
    ? TOWER_STORY_CARS
    : TOWER_STORY_CARS.map((car, slot) => ({
        ...car,
        // In grid order, a few metres apart, on the lap to the line.
        progress: 0.97 - slot * 0.004,
        lastLap: -1,
        bestLap: -1,
        lastLapInvalid: false,
        inPits: false,
        inGarage: false,
        outLap: false,
        stops: 0,
        stintLaps: 0,
        energy: 1,
      }));
  const grid = buildStoryGrid(LMU_STORY_CLASSES, cars, {
    player: TOWER_STORY_PLAYER,
  });

  const session = {
    ...grid.session,
    WeekendInfo: { ...grid.session.WeekendInfo, TeamRacing: 1 },
    DriverInfo: {
      ...grid.session.DriverInfo,
      DriverTires: TYRES.map((TireCompoundType, TireIndex) => ({
        TireIndex,
        TireCompoundType,
      })),
    },
  } as Session;

  const standings: StandingsSnapshot = {
    ...grid.standings,
    // What the story grid's frame does not carry: Le Mans Ultimate's energy
    // and its compound for each wheel.
    carIdxEnergyRemaining: cars.map((car) => car.energy),
    carIdxEnergyIsVirtual: cars.map((car) => car.carClass !== 'LMP2'),
    carIdxWheelCompounds: cars.flatMap((car) =>
      typeof car.wheels === 'number'
        ? [car.wheels, car.wheels, car.wheels, car.wheels]
        : car.wheels
    ),
    carIdxPitStops: cars.map((car) => car.stops),
    // A car is on its out-lap while it is still on the lap it was on in the
    // pit lane.
    lastPitLap: cars.map((car) =>
      car.outLap || car.inPits ? Math.floor(car.progress) : undefined
    ),
  };

  return {
    session,
    slotOf: grid.slotOf,
    snapshots: {
      'standings.snapshot': standings,
      'lap-times.snapshot': racing
        ? buildStoryLapTimes(cars, lapPlanOf)
        : { lapTimes: [], lapTimeHistory: [], sessionNum: 0, version: 1 },
      'race-history.summary': buildSummary(cars, racing),
      'car-sectors.snapshot': buildSectors(cars, session, racing),
      'car-pit.snapshot': buildCarPit(cars, racing),
      'class-tyres.snapshot': classTyresStorySnapshot(
        cars.map((car) => ({ number: car.number, sinceStop: car.stintLaps })),
        {
          own: TOWER_STORY_PLAYER,
          ownTreadPct: OWN_TREAD_PCT,
          beforeStart,
          iracing: iracingTyres,
        }
      ),
      'track-state.snapshot': {
        ...trackStateStorySnapshot,
        focusCarIdx: grid.slotOf(TOWER_STORY_PLAYER),
      },
    },
  };
};

/** The staged race three and a half hours in. */
export const timingTowerRace = timingTowerStage();
/** The same field on its way to the start. */
export const timingTowerGrid = timingTowerStage({ beforeStart: true });
/** The race with the tyres as iRacing would let them be told. */
export const timingTowerRaceIRacingTyres = timingTowerStage({
  iracingTyres: true,
});
