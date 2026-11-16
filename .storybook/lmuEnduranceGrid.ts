import type {
  LapTimesSnapshot,
  Session,
  StandingsSnapshot,
  Telemetry,
} from '@irdashies/types';
// Not through the path alias: a spec loads this file, and resolves
// aliases for files under src only.
import { LMU_CLASS_COLOURS } from '../src/types';
import { StandingsProcessor } from '../src/app/processors/StandingsProcessor';
import { buildStoryLapTimes, type StoryLapPlan } from './lapTimesSnapshot';

/**
 * A made-up multi-class endurance grid for stories: a session and the
 * standings snapshot the real StandingsProcessor publishes for it.
 *
 * The recorded Le Mans Ultimate race has nobody lapped, nobody in a garage
 * and no lap the sim refused to time, which are exactly the states the
 * standings' lap gaps, the uncounted-lap mark and the class summary are
 * about. So they are staged here, from a list of cars a story can read.
 * Every name is invented.
 */
export interface StoryGridClass {
  id: number;
  color: number;
  /** Higher is faster, as the session's CarClassRelSpeed. */
  relSpeed: number;
}

export interface StoryGridCar {
  number: string;
  driver: string;
  team: string;
  /** A key of the grid's classes; also the class name the session shows. */
  carClass: string;
  /** Race progress: laps completed plus the fraction of the lap under way. */
  progress: number;
  /** Seconds. */
  lastLap: number;
  bestLap: number;
  /** The sim gave the last lap no time: it did not count. */
  lastLapInvalid?: boolean;
  /** Driving down the pit lane or stopped at the box. */
  inPits?: boolean;
  /** Parked in the garage stall. */
  inGarage?: boolean;
  /** Retired: the sim's finish status reads DNF. */
  retired?: boolean;
}

export interface StoryGrid {
  session: Session;
  standings: StandingsSnapshot;
  /** The slot of each car, by its number. */
  slotOf: (carNumber: string) => number;
}

/** Seconds of race time one lap of progress stands for in the gaps. */
const REFERENCE_LAP_SECONDS = 212;

const IN_PIT_STALL = 1;
const ON_TRACK = 3;
const FINISH_DNF = 2;

/**
 * Builds the session and the standings snapshot for a list of cars. A car's
 * slot is its place in the list; places are worked out from progress.
 */
export const buildStoryGrid = (
  classes: Readonly<Record<string, StoryGridClass>>,
  cars: readonly StoryGridCar[],
  options: {
    /** The player's car, by number. */
    player: string;
    /** The car the camera is on, when it is not the player's. */
    watching?: string;
    sessionType?: 'Race' | 'Practice' | 'Open Qualify';
  }
): StoryGrid => {
  const slotOf = (carNumber: string) =>
    cars.findIndex((car) => car.number === carNumber);
  const order = cars
    .map((_, slot) => slot)
    .sort((a, b) => cars[b].progress - cars[a].progress);
  const place = cars.map((_, slot) => order.indexOf(slot) + 1);
  const classPlace = cars.map(
    (car, slot) =>
      order
        .filter((other) => cars[other].carClass === car.carClass)
        .indexOf(slot) + 1
  );
  const leader = cars[order[0]].progress;

  const session = {
    WeekendInfo: {
      NumCarClasses: Object.keys(classes).length,
      TeamRacing: 0,
      EventType: 'Race',
      TrackDisplayName: 'Circuit de la Sarthe',
    },
    SessionInfo: {
      Sessions: [
        {
          SessionNum: 0,
          SessionType: options.sessionType ?? 'Race',
          SessionName: 'RACE',
          ResultsPositions: order.map((slot) => ({
            CarIdx: slot,
            Position: place[slot],
            ClassPosition: classPlace[slot] - 1,
            FastestTime: cars[slot].bestLap,
            LastTime: cars[slot].lastLap,
            LapsComplete: Math.floor(cars[slot].progress),
          })),
          ResultsFastestLap: [],
        },
      ],
    },
    DriverInfo: {
      DriverCarIdx: slotOf(options.player),
      PaceCarIdx: -1,
      Drivers: cars.map((car, slot) => ({
        CarIdx: slot,
        CarNumber: car.number,
        CarNumberRaw: Number(car.number),
        UserName: car.driver,
        TeamName: car.team,
        CarClassID: classes[car.carClass].id,
        CarClassShortName: car.carClass,
        CarClassColor: classes[car.carClass].color,
        CarClassRelSpeed: classes[car.carClass].relSpeed,
        CarClassEstLapTime: REFERENCE_LAP_SECONDS,
        CarIsPaceCar: 0,
        IsSpectator: 0,
        IRating: 0,
        LicString: '',
      })),
    },
  } as unknown as Session;

  const perCar = <T>(value: (car: StoryGridCar, slot: number) => T) => ({
    value: cars.map(value),
  });
  const stopped = (car: StoryGridCar) => !!(car.inPits || car.inGarage);

  const frame = {
    SessionTime: { value: [7200] },
    SessionNum: { value: [0] },
    SessionState: { value: [4] },
    SessionUniqueID: { value: [1] },
    CamCarIdx: { value: [slotOf(options.watching ?? options.player)] },
    CarIdxPosition: perCar((_, slot) => place[slot]),
    CarIdxClassPosition: perCar((_, slot) => classPlace[slot]),
    CarIdxClass: perCar((car) => classes[car.carClass].id),
    CarIdxLap: perCar((car) => Math.floor(car.progress)),
    CarIdxLapCompleted: perCar((car) => Math.floor(car.progress)),
    CarIdxLapDistPct: perCar((car) => car.progress - Math.floor(car.progress)),
    CarIdxTrackSurface: perCar((car) =>
      stopped(car) ? IN_PIT_STALL : ON_TRACK
    ),
    CarIdxOnPitRoad: perCar(stopped),
    CarIdxF2Time: perCar(
      (car) => (leader - car.progress) * REFERENCE_LAP_SECONDS
    ),
    CarIdxEstTime: perCar(
      (car) => (car.progress - Math.floor(car.progress)) * REFERENCE_LAP_SECONDS
    ),
    CarIdxLastLapTime: perCar((car) => car.lastLap),
    CarIdxBestLapTime: perCar((car) => car.bestLap),
    CarIdxTireCompound: perCar(() => 0),
    CarIdxSessionFlags: perCar(() => 0),
    LmuCarIdxLastLapInvalid: perCar((car) => !!car.lastLapInvalid),
    LmuCarIdxInGarage: perCar((car) => !!car.inGarage),
    LmuCarIdxFinishStatus: perCar((car) => (car.retired ? FINISH_DNF : 0)),
  } as unknown as Telemetry;

  const processor = new StandingsProcessor();
  processor.init(session);
  processor.onFrame(frame);

  return { session, standings: processor.snapshot(), slotOf };
};

export const LMU_STORY_CLASSES = {
  Hypercar: { id: 10, color: LMU_CLASS_COLOURS.Hypercar, relSpeed: 5 },
  LMP2: { id: 20, color: LMU_CLASS_COLOURS.LMP2, relSpeed: 4 },
  LMGT3: { id: 30, color: LMU_CLASS_COLOURS.LMGT3, relSpeed: 2 },
} satisfies Record<string, StoryGridClass>;

/** The player's car in the endurance grid below. */
export const LMU_STORY_PLAYER = '77';

/**
 * Two hours into an endurance race at Le Mans: six Hypercars, five LMP2 and
 * eight LMGT3, the player third in LMGT3.
 *
 * In each class the field has strung out past a lap: one car is on the lap
 * behind its class leader but still close behind the car ahead of it, and
 * one is more than a lap behind the car ahead as well. One LMP2 is stopped
 * at its box and one LMGT3 has retired to its garage. Three last laps did
 * not count: one of them would have been the fastest of its class.
 */
export const LMU_STORY_CARS: readonly StoryGridCar[] = [
  {
    number: '8',
    driver: 'Dominik Gessler',
    team: 'Northstar Motorsport',
    carClass: 'Hypercar',
    progress: 34.4,
    lastLap: 209.214,
    bestLap: 208.455,
  },
  {
    number: '51',
    driver: 'Matteo Ferrante',
    team: 'Scuderia Monte Rosso',
    carClass: 'Hypercar',
    progress: 34.37,
    lastLap: 208.102,
    bestLap: 208.102,
  },
  {
    number: '6',
    driver: 'Henrik Aldersson',
    team: 'Kestrel Endurance',
    carClass: 'Hypercar',
    progress: 34.21,
    lastLap: 210.667,
    bestLap: 208.911,
  },
  {
    number: '15',
    driver: 'Julien Marchetti',
    team: 'Atelier Vaucluse',
    carClass: 'Hypercar',
    progress: 33.95,
    lastLap: 221.902,
    bestLap: 209.34,
    lastLapInvalid: true,
  },
  {
    number: '99',
    driver: 'Tomas Reinholt',
    team: 'Polar Works',
    carClass: 'Hypercar',
    progress: 33.2,
    lastLap: 211.48,
    bestLap: 210.022,
  },
  {
    number: '311',
    driver: 'Caleb Whitlock',
    team: 'Ironwood Racing',
    carClass: 'Hypercar',
    progress: 31.05,
    lastLap: 212.931,
    bestLap: 210.875,
  },
  {
    number: '22',
    driver: 'Jonas Lindqvist',
    team: 'United Nordic',
    carClass: 'LMP2',
    progress: 33.1,
    lastLap: 217.338,
    bestLap: 216.904,
  },
  {
    number: '37',
    driver: 'Rafael Quintero',
    team: 'Costa Verde Racing',
    carClass: 'LMP2',
    progress: 33.02,
    lastLap: 216.59,
    bestLap: 216.59,
  },
  {
    number: '28',
    driver: 'Oskar Bielawski',
    team: 'Vistula Motorsport',
    carClass: 'LMP2',
    progress: 32.8,
    lastLap: 218.021,
    bestLap: 217.115,
  },
  {
    number: '10',
    driver: 'Marcus Engel',
    team: 'Nordsee Racing',
    carClass: 'LMP2',
    progress: 31.95,
    lastLap: 219.74,
    bestLap: 217.86,
  },
  {
    number: '183',
    driver: 'Pierre Lacombe',
    team: 'Equipe Garonne',
    carClass: 'LMP2',
    progress: 30.72,
    lastLap: 247.305,
    bestLap: 218.447,
    inPits: true,
  },
  {
    number: '92',
    driver: 'Lukas Brandner',
    team: 'Alpenstern Racing',
    carClass: 'LMGT3',
    progress: 30.6,
    lastLap: 237.612,
    bestLap: 236.98,
  },
  {
    number: '46',
    driver: 'Davide Morelli',
    team: 'Squadra Lombarda',
    carClass: 'LMGT3',
    progress: 30.57,
    // Quicker than anyone's best in the class, and it did not count.
    lastLap: 236.412,
    bestLap: 236.705,
    lastLapInvalid: true,
  },
  {
    number: LMU_STORY_PLAYER,
    driver: 'Alex Mercer',
    team: 'Iron Coast Racing',
    carClass: 'LMGT3',
    progress: 30.41,
    lastLap: 237.288,
    bestLap: 237.288,
  },
  {
    number: '777',
    driver: 'Kenji Watanabe',
    team: 'Akashi Racing',
    carClass: 'LMGT3',
    progress: 30.33,
    lastLap: 238.019,
    bestLap: 237.44,
  },
  {
    number: '54',
    driver: 'Francesco Bellini',
    team: 'Riviera Corse',
    carClass: 'LMGT3',
    progress: 30.1,
    lastLap: 247.3,
    bestLap: 237.905,
    lastLapInvalid: true,
  },
  {
    number: '27',
    driver: 'Ian Hartley',
    team: 'Heart of Albion',
    carClass: 'LMGT3',
    progress: 29.45,
    lastLap: 239.154,
    bestLap: 238.31,
  },
  {
    number: '85',
    driver: 'Sophie Carrard',
    team: 'Lac Leman Racing',
    carClass: 'LMGT3',
    progress: 28.3,
    lastLap: 240.87,
    bestLap: 238.66,
  },
  {
    number: '61',
    driver: 'Arjun Mehta',
    team: 'Coromandel Motorsport',
    carClass: 'LMGT3',
    progress: 21.84,
    lastLap: 239.905,
    bestLap: 238.12,
    inGarage: true,
    retired: true,
  },
];

/** The staged endurance grid, as driven. */
export const lmuEnduranceGrid = buildStoryGrid(
  LMU_STORY_CLASSES,
  LMU_STORY_CARS,
  { player: LMU_STORY_PLAYER }
);

/**
 * The endurance grid's last laps, as the app has them fourteen laps after it
 * began watching: `lap-times.snapshot` for the stories of the Avg 5 and
 * Avg 10 columns.
 *
 * Most cars have run all fourteen without stopping. Four have not, and they
 * are what those columns are there to show:
 *
 * - #22 stopped four laps ago: its in-lap and its out-lap are two of its
 *   last five laps, and of nobody's clean laps.
 * - #183 is at its box now: the lap that brought it there is its last.
 * - #311 has been through the pits twice in eleven laps, which leaves it
 *   short of ten clean ones.
 * - #61 retired four laps after the app first saw it.
 */
const ENDURANCE_LAP_PLANS: Readonly<Record<string, StoryLapPlan>> = {
  '22': { laps: 14, inLaps: [10] },
  '183': { laps: 14, inLaps: [14] },
  '311': { laps: 11, inLaps: [3, 8] },
  '61': { laps: 4 },
};

export const lmuEnduranceLapTimes: LapTimesSnapshot = buildStoryLapTimes(
  LMU_STORY_CARS,
  (car) => ENDURANCE_LAP_PLANS[car.number] ?? { laps: 14 }
);

/**
 * The same laps from a source that publishes no clean history, as a build
 * from before it existed would.
 */
export const lmuEnduranceLapTimesWithoutClean: LapTimesSnapshot = {
  lapTimes: lmuEnduranceLapTimes.lapTimes,
  lapTimeHistory: lmuEnduranceLapTimes.lapTimeHistory,
  sessionNum: lmuEnduranceLapTimes.sessionNum,
  version: lmuEnduranceLapTimes.version,
};

const SINGLE_CLASS = {
  GT3: { id: 40, color: 0xff5888, relSpeed: 2 },
} satisfies Record<string, StoryGridClass>;

/**
 * A single-class sprint: 24 GT3 cars, one retired to its garage and three in
 * the pit lane.
 */
export const singleClassGrid = buildStoryGrid(
  SINGLE_CLASS,
  Array.from({ length: 24 }, (_, index) => ({
    number: String(index + 1),
    driver: `Driver ${index + 1}`,
    team: `Team ${index + 1}`,
    carClass: 'GT3',
    progress: 12.9 - index * 0.02,
    lastLap: 101.2 + index * 0.11,
    bestLap: 100.8 + index * 0.1,
    inPits: index >= 14 && index <= 16,
    inGarage: index === 23,
    retired: index === 23,
  })),
  { player: '7' }
);
