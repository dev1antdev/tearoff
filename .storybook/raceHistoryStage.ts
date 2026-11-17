// Nothing here is imported through a path alias at run time, so a spec can
// load this file and check what a story is told with.
import {
  LEDGER_LAP_CAUTION,
  LEDGER_LAP_FROM_START,
  LEDGER_LAP_IN_LAP,
  LEDGER_LAP_OUT_LAP,
  LEDGER_LAP_VOIDED,
  LEDGER_LAP_YELLOW,
  type ChannelBridge,
  type ChannelName,
  type ChannelPayloads,
  type RaceCarLaps,
  type RaceDriverChange,
  type RaceForecastCar,
  type RaceForecastSnapshot,
  type RaceHistoryBridge,
  type RaceHistorySummarySnapshot,
  type RaceLap,
  type RaceStint,
  type Session,
  type StandingsSnapshot,
} from '../src/types';
import { isCleanLap } from '../src/shared';
import {
  buildStoryGrid,
  LMU_STORY_CLASSES,
  type StoryGridCar,
} from './lmuEnduranceGrid';
import { trackStateStorySnapshot } from './trackStateSnapshot';

/**
 * A staged eight-hour race as the race history would hold it, for the
 * stories and specs of the panels that read a car's records: Crew and
 * Stints, Car Laps, the Race Charts, and whatever is built on the same
 * records later.
 *
 * Twenty-two cars in three classes, five and a quarter hours in. Every lap
 * of every car is written out as the recorder would have kept it: its time
 * and sectors, what the car had left at the line, its compounds, its flags,
 * and the stints with the stops that ended them. The summary is made from
 * those records by the recorder's own reckoning, so the two cannot
 * disagree. Our #77 has had three drivers and is in its sixth stint.
 *
 * Every name and figure is invented, and no recording stands behind any of
 * it: no recorded race has a pit stop or a driver change. The shape of a
 * stop is the one `RaceHistoryRecorder` gives a circuit whose pit boxes are
 * before the line: the stint ends on the last lap completed before the car
 * stood still, the lap it stood on is the first of the stint after and an
 * in-lap, and the lap after that is the out-lap.
 */

type CarClass = keyof typeof LMU_STORY_CLASSES;

interface StagedCar {
  number: string;
  team: string;
  carClass: CarClass;
  /** Who drove each stint, the first first; the last named drives on. */
  drivers: readonly string[];
  /** A clean lap, seconds. */
  pace: number;
  /** Laps a stint runs to, the lap of the stop and the out-lap among them. */
  stintLaps: number;
  /** Seconds standing at each stop in turn; the last repeats. */
  standing: readonly number[];
  /** The stops, counted from 1, at which another compound went on. */
  tyreStops: readonly number[];
  /** A lap it drove four tenths under its pace: the best of its race. */
  flyingLap?: number;
}

export const RACE_HISTORY_STAGE_OWN_CAR = '77';

/** The session's tyre list. A lap's compounds are indices into it. */
const TYRES = ['Soft', 'Medium', 'Hard', 'Wet'] as const;
const MEDIUM = 1;
const HARD = 2;

/** Session clock when the cars were first seen, and when the race went green. */
const FIRST_SEEN_AT = 20;
const GREEN_AT = 200;
/** A full-course yellow, on the session clock: six minutes of the third hour. */
const CAUTION_FROM = 8040;
const CAUTION_TO = 8400;
/**
 * The staged race's clock, for a stage that tells the same race on other
 * channels: when it went green, and the full-course yellow.
 */
export const RACE_HISTORY_STAGE_CLOCK = {
  greenAt: GREEN_AT,
  cautionFrom: CAUTION_FROM,
  cautionTo: CAUTION_TO,
} as const;
/** How much slower a lap is under it, seconds. */
const CAUTION_LAP_LOSS = 38;
/** The share of a full budget a stint uses: three quarters of it. */
const STINT_BUDGET = 0.76;
/** What the lap of a stop loses besides the standing, and the out-lap. */
const STOP_LAP_LOSS = 9;
const OUT_LAP_LOSS = 12.5;
/**
 * A stop, in seconds: the pit entry is this long before the line on a lap
 * at speed, then the drive to the box, the standing, the box to the line,
 * and the line to the pit exit. The first three and the standing are what
 * the lap of the stop loses: STOP_LAP_LOSS and the standing.
 */
const ENTRY_BEFORE_LINE = 8;
const ENTRY_TO_BOX = 10;
const BOX_TO_LINE = 7;
const LINE_TO_EXIT = 14;
/** How a lap of the staged circuit splits into its first two sectors. */
const SECTOR_SHARES = [0.317, 0.4];
/** Where round its lap our car is, and the laps it has completed. */
const OWN_LAP_FRACTION = 0.42;
const OWN_LAPS = 162;

const double = (first: string, second: string, third?: string): string[] =>
  third
    ? [first, first, second, second, third, third, first, first]
    : [first, first, second, second, first, first, second, second];

const car = (
  number: string,
  team: string,
  carClass: CarClass,
  pace: number,
  stintLaps: number,
  drivers: readonly string[],
  standing: readonly number[] = [38, 44, 61, 40, 59],
  tyreStops: readonly number[] = [2, 4]
): StagedCar => ({
  number,
  team,
  carClass,
  drivers,
  pace,
  stintLaps,
  standing,
  tyreStops,
});

const CARS: readonly StagedCar[] = [
  car(
    '7',
    'Aurora Hypersport',
    'Hypercar',
    93.4,
    38,
    double('Kai Brandt', 'Noel Verhaegen', 'Jonas Friis')
  ),
  car(
    '12',
    'Equipe Lumiere',
    'Hypercar',
    93.6,
    38,
    double('Julien Moreau', 'Remy Castaing')
  ),
  car(
    '50',
    'Rosso Corsa Lab',
    'Hypercar',
    93.5,
    37,
    double('Dario Ferraro', 'Luca Benedetti', 'Marco Sala')
  ),
  car(
    '94',
    'Vertex Hybrid',
    'Hypercar',
    93.9,
    38,
    double('Petr Novak', 'Tomas Havel')
  ),
  car(
    '22',
    'Union Row Racing',
    'LMP2',
    98.2,
    34,
    double('Adam Whitcombe', 'George Alderton')
  ),
  car(
    '37',
    'Carpathia Motorsport',
    'LMP2',
    98.4,
    34,
    double('Ilie Dragan', 'Radu Ciobanu', 'Mihai Stan')
  ),
  car(
    '28',
    'Harmattan Racing',
    'LMP2',
    98.5,
    33,
    double('Malik Oyelaran', 'Seun Adebayo')
  ),
  car(
    '65',
    'Polar Line',
    'LMP2',
    98.9,
    34,
    double('Viktor Lindahl', 'Anders Holm')
  ),
  {
    ...car(
      '33',
      'Nordwind Racing',
      'LMGT3',
      114.12,
      31,
      double('Lars Hartmann', 'Jonas Weber', 'Emil Brandl'),
      [39.2, 41, 60.4, 39.8, 58.9]
    ),
    // The class leader set the best lap of the class a few laps ago.
    flyingLap: 160,
  },
  car(
    '46',
    'Blue Harbor Motorsport',
    'LMGT3',
    114.2,
    32,
    double('Tobe Okafor', 'Ben Carrow'),
    [37.2, 59.1, 38.4, 57.7, 37.9]
  ),
  car(
    '91',
    'Atlas GT',
    'LMGT3',
    114.71,
    27,
    double('Sven Lindqvist', 'Mikkel Aas'),
    [28.2, 49.5, 29, 51.2, 28.4, 50.3]
  ),
  {
    number: RACE_HISTORY_STAGE_OWN_CAR,
    team: 'Tearoff Endurance',
    carClass: 'LMGT3',
    // Two double stints, a single one by the third driver, and the first
    // driver back in the car.
    drivers: [
      'Mikhail Ivanov',
      'Mikhail Ivanov',
      'Andrei Petrov',
      'Andrei Petrov',
      'Dmitri Sokolov',
      'Mikhail Ivanov',
    ],
    pace: 114.4,
    stintLaps: 31,
    standing: [40.2, 62.4, 41.1, 58.3, 57.6],
    // Mediums to hards at the second stop, and back at the fifth.
    tyreStops: [2, 5],
  },
  car(
    '54',
    'Scuderia Meridiano',
    'LMGT3',
    114.52,
    31,
    double('Rico Castellano', 'Paolo Greco')
  ),
  car(
    '23',
    'Cobalt Works',
    'LMGT3',
    114.75,
    30,
    double('Elena Vasquez', 'Marta Iglesias')
  ),
  car(
    '85',
    'Kaze Racing',
    'LMGT3',
    114.74,
    31,
    double('Hiro Tanaka', 'Kenta Mori', 'Ryo Aoki')
  ),
  car(
    '31',
    'Rive Gauche GT',
    'LMGT3',
    114.81,
    31,
    double('Bruno Lefevre', 'Alain Mercier')
  ),
  car(
    '60',
    'Ironwood Competition',
    'LMGT3',
    114.92,
    32,
    double('Chidi Adeyemi', 'Obi Nwosu')
  ),
  // One driver since the start.
  car('27', 'Fjord Motorsport', 'LMGT3', 115.2, 31, ['Gustav Sorensen']),
  car(
    '92',
    'Monte Verde Racing',
    'LMGT3',
    115.3,
    30,
    double('Fabio Romano', 'Enzo Ricci')
  ),
  car(
    '10',
    'Lowlands GT',
    'LMGT3',
    115.6,
    31,
    double('Wim Achterberg', 'Daan Visser')
  ),
  car(
    '61',
    'Baltic Speed',
    'LMGT3',
    115.9,
    30,
    double('Oskar Kowalski', 'Piotr Zielinski')
  ),
  car(
    '88',
    'Cedar Racing',
    'LMGT3',
    116.2,
    29,
    double('Yusuf Haddad', 'Karim Nassar')
  ),
];

const OWN_SLOT = CARS.findIndex(
  (entry) => entry.number === RACE_HISTORY_STAGE_OWN_CAR
);

/** A number in 0..1 that is the same every time for the same two seeds. */
const seeded = (a: number, b: number): number => {
  const x = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

const thousandth = (value: number): number => Math.round(value * 1000) / 1000;

/** What is held of one car: its laps and stints, as the recorder keeps them. */
export interface StagedCarRecord {
  laps: RaceLap[];
  stints: RaceStint[];
  /** Lap numbers the car has completed that are not among the laps. */
  missingLaps: number[];
  /** Race progress now: laps completed and the fraction of the lap under way. */
  progress: number;
}

export interface RaceHistoryStageOptions {
  /**
   * Laps our car has completed. 162 as staged; fewer for the same race
   * earlier on, and 0 for the first minute of it.
   */
  ownLaps?: number;
  /**
   * iRacing: no sector times, nothing of what a car has left, and one
   * compound for the whole race.
   */
  iracing?: boolean;
  /**
   * The app was not running between two moments of the race, here given
   * as laps of our car: what every car did meanwhile is not held, a stint
   * that was open is cut short where the laps stop, and the race is said
   * to have been carried on.
   */
  outage?: { afterOwnLap: number; untilOwnLap: number };
  /**
   * Laps of our car that were lost to traffic, and the seconds each lost.
   * Nothing in a record says why a lap was slow, and these carry no flag.
   */
  traffic?: Readonly<Record<number, number>>;
  /**
   * A car that is catching us: quicker than its staged pace by `perLap`
   * seconds on every lap of its own from `fromLap` on.
   */
  closing?: { car: string; fromLap: number; perLap: number };
  /**
   * The share of a full budget a car has used when it stops, 0..1. Three
   * quarters as staged, which has every car stop with a quarter of its
   * budget aboard. A stage that shows a forecast beside these records asks
   * for nearly all of it, so that the stops the forecast counts from what a
   * car has left are the stops the records show it making.
   */
  stintBudget?: number;
}

/**
 * The race as the Race Charts are shown on it: three laps of our car lost
 * to traffic, the first by little enough to stay on the scale of the pace
 * chart, and the car behind us, #23, catching us from its lap 136 on.
 */
export const RACE_HISTORY_STAGE_FOR_CHARTS: RaceHistoryStageOptions = {
  traffic: { 131: 0.7, 132: 3.4, 150: 2.2 },
  closing: { car: '23', fromLap: 136, perLap: 0.8 },
};

/** Seconds a lap is slower by than the car's staged lap, for one car. */
type LapTweak = (lap: number) => number;

const NO_TWEAK: LapTweak = () => 0;

const newStint = (
  carIdx: number,
  ordinal: number,
  driver: string,
  openedBy: RaceStint['openedBy'],
  startTime: number
): RaceStint => ({
  carIdx,
  ordinal,
  driver,
  openedBy,
  closedBy: null,
  firstLap: null,
  lastLap: null,
  startTime,
  endTime: null,
  laps: 0,
  cleanLaps: 0,
  avgLap: null,
  bestLap: null,
  stop: null,
});

/** Counts a lap into its stint, as the recorder does. */
const countLap = (stint: RaceStint, lap: RaceLap): void => {
  stint.laps += 1;
  stint.firstLap ??= lap.lap;
  stint.lastLap = lap.lap;
  if (lap.lapTime === null || !isCleanLap(lap.flags)) return;
  const sum = (stint.avgLap ?? 0) * stint.cleanLaps + lap.lapTime;
  stint.cleanLaps += 1;
  stint.avgLap = sum / stint.cleanLaps;
  stint.bestLap =
    stint.bestLap === null ? lap.lapTime : Math.min(stint.bestLap, lap.lapTime);
};

/**
 * One car driven from the green flag to `now`, or for a number of laps.
 * What the laps do not hold yet -- places and the gap to the class leader
 * -- is filled in once every car has been driven.
 */
const driveCar = (
  staged: StagedCar,
  carIdx: number,
  until: { now: number } | { laps: number },
  iracing: boolean,
  tweak: LapTweak = NO_TWEAK,
  stintBudget = STINT_BUDGET
): StagedCarRecord & { lastLineAt: number } => {
  const virtual = !iracing && staged.carClass !== 'LMP2';
  const usage = stintBudget / staged.stintLaps;
  const driverOf = (stint: number): string =>
    staged.drivers[Math.min(stint, staged.drivers.length - 1)];
  const atEnd = (lapsDone: number, endsAt: number): boolean =>
    'now' in until ? endsAt > until.now : lapsDone >= until.laps;

  const laps: RaceLap[] = [];
  const stints: RaceStint[] = [
    newStint(carIdx, 1, driverOf(0), 'start', FIRST_SEEN_AT),
  ];
  let stint = stints[0];
  let clock = GREEN_AT;
  let stops = 0;
  let lapsInStint = 0;
  let energy = 1;
  let compound = MEDIUM;

  for (;;) {
    const number = laps.length + 1;
    const noise = (seeded(carIdx + 1, number) - 0.5) * 0.9;
    // A stint's tyres go off by half a second from its first lap to its last.
    const base =
      staged.pace +
      noise +
      (lapsInStint / staged.stintLaps) * 0.5 -
      (number === staged.flyingLap ? 0.4 : 0) +
      tweak(number);
    const stopLap = stops > 0 && lapsInStint === 0;
    const outLap = stops > 0 && lapsInStint === 1;
    const standing =
      staged.standing[Math.min(stops - 1, staged.standing.length - 1)] ?? 0;
    let flags = 0;
    let time = base;
    if (number === 1) {
      flags |= LEDGER_LAP_FROM_START;
      time += 4.6;
    }
    if (stopLap) {
      flags |= LEDGER_LAP_IN_LAP;
      time += STOP_LAP_LOSS + standing;
    }
    if (outLap) {
      flags |= LEDGER_LAP_OUT_LAP;
      time += OUT_LAP_LOSS;
    }
    if (clock < CAUTION_TO && clock + time > CAUTION_FROM) {
      flags |= LEDGER_LAP_CAUTION;
      time += CAUTION_LAP_LOSS;
    }
    // Our car: a sector under yellow late in the fifth stint, and one lap
    // the sim gave no time.
    const own = carIdx === OWN_SLOT;
    if (own && (number === 140 || number === 141)) {
      flags |= LEDGER_LAP_YELLOW;
      time += 1.9;
    }
    const voided = own && number === 147;
    if (voided) flags |= LEDGER_LAP_VOIDED;

    time = thousandth(time);
    const endsAt = clock + time;
    if (atEnd(laps.length, endsAt)) break;

    if (stopLap) {
      // The line is a few metres past the box: nearly all of it is aboard.
      energy = 1 - usage * 0.05;
    } else {
      const share =
        (flags & LEDGER_LAP_CAUTION) !== 0
          ? 0.55
          : 0.94 + seeded(number, 9) * 0.12;
      energy = Math.max(0, energy - usage * share);
    }
    const s1 = thousandth(
      base * SECTOR_SHARES[0] +
        (seeded(carIdx + 3, number) - 0.5) * 0.3 +
        (outLap ? OUT_LAP_LOSS * 0.8 : 0)
    );
    const s2 = thousandth(
      base * SECTOR_SHARES[1] + (seeded(carIdx + 5, number) - 0.5) * 0.3
    );
    const lap: RaceLap = {
      carIdx,
      lap: number,
      sessionTime: thousandth(endsAt),
      lapTime: voided ? null : time,
      // The stop is at the end of its lap, so in its third sector.
      sectors: iracing
        ? [null, null, null]
        : [s1, s2, thousandth(time - s1 - s2)],
      position: null,
      classPosition: null,
      classGap: null,
      flags,
      driver: stint.driver,
      energy: iracing ? null : thousandth(energy),
      energyIsVirtual: virtual,
      compounds: iracing
        ? [0, 0, 0, 0]
        : [compound, compound, compound, compound],
    };
    laps.push(lap);
    countLap(stint, lap);
    lapsInStint += 1;
    clock = endsAt;

    if (lapsInStint < staged.stintLaps) continue;
    // The stint is run: the car comes in at the end of the lap after this.
    const nextBase = staged.pace + (seeded(carIdx + 1, number + 1) - 0.5) * 0.9;
    const entryAt = clock + nextBase - ENTRY_BEFORE_LINE;
    const stoodAt = entryAt + ENTRY_TO_BOX;
    // It ends the stint once it has stood still for a second. Until then
    // the car is on its way in, and has not completed the lap either.
    if ('now' in until && stoodAt + 1 > until.now) break;
    const nextStanding =
      staged.standing[Math.min(stops, staged.standing.length - 1)];
    const exitAt = stoodAt + nextStanding + BOX_TO_LINE + LINE_TO_EXIT;
    const stillIn = 'now' in until && exitAt > until.now;
    const nextDriver = driverOf(stops + 1);
    stint.closedBy = 'stop';
    stint.endTime = thousandth(entryAt);
    stint.stop = {
      laneTime: stillIn ? null : thousandth(exitAt - entryAt),
      standingTime:
        'now' in until
          ? thousandth(Math.min(nextStanding, until.now - stoodAt))
          : nextStanding,
      driverChanged: nextDriver !== stint.driver,
    };
    stops += 1;
    if (staged.tyreStops.includes(stops)) {
      compound = compound === MEDIUM ? HARD : MEDIUM;
    }
    stint = newStint(
      carIdx,
      stint.ordinal + 1,
      nextDriver,
      'stop',
      thousandth(stillIn ? entryAt : exitAt)
    );
    stints.push(stint);
    lapsInStint = 0;
  }

  const now = 'now' in until ? until.now : clock;
  // Round the lap under way as far as a clean lap's pace has taken it.
  const fraction = Math.min(0.98, Math.max(0, (now - clock) / staged.pace));
  return {
    laps,
    stints,
    missingLaps: [],
    progress: laps.length + fraction,
    lastLineAt: clock,
  };
};

/**
 * Takes out what was driven while the app was not running, as a race
 * carried on after a restart holds it: the laps completed meanwhile are
 * gone, a stint that was open when the app stopped ends with the last lap
 * before it, and what the car has driven since is a stint that was joined.
 * A stop made meanwhile was seen by nobody and ends no stint.
 */
const withOutage = (
  record: StagedCarRecord,
  from: number,
  until: number
): StagedCarRecord => {
  const gone = (lap: RaceLap): boolean =>
    lap.sessionTime > from && lap.sessionTime <= until;
  const missing = record.laps.filter(gone).map((lap) => lap.lap);
  if (missing.length === 0) return record;
  const kept = record.laps.filter((lap) => !gone(lap));
  const firstMissing = missing[0];
  const lastMissing = missing[missing.length - 1];

  const stints: RaceStint[] = [];
  /** A stint of the laps given, counted afresh. */
  const add = (
    source: RaceStint,
    own: readonly RaceLap[],
    values: Partial<RaceStint>
  ): void => {
    const stint: RaceStint = {
      ...source,
      ...values,
      ordinal: stints.length + 1,
      firstLap: null,
      lastLap: null,
      laps: 0,
      cleanLaps: 0,
      avgLap: null,
      bestLap: null,
    };
    for (const lap of own) countLap(stint, lap);
    stints.push(stint);
  };
  for (const stint of record.stints) {
    const own = kept.filter(
      (lap) =>
        stint.firstLap !== null &&
        stint.lastLap !== null &&
        lap.lap >= stint.firstLap &&
        lap.lap <= stint.lastLap
    );
    const before = own.filter((lap) => lap.lap < firstMissing);
    const after = own.filter((lap) => lap.lap > lastMissing);
    // Under way when the app stopped: its end was seen by nobody.
    const openThen =
      stint.startTime <= from &&
      (stint.endTime === null || stint.endTime > from);
    // Begun before the app was back: only its laps since are held.
    const joined = stint.startTime <= until;
    if (before.length > 0) {
      add(
        stint,
        before,
        openThen
          ? {
              closedBy: 'gap',
              endTime: before[before.length - 1].sessionTime,
              stop: null,
            }
          : {}
      );
    }
    if (after.length > 0 || (stint.closedBy === null && !openThen)) {
      add(stint, after, joined ? { openedBy: 'joined', startTime: until } : {});
    } else if (stint.closedBy === null && before.length > 0) {
      // Still under way with no lap since: a stint with none yet.
      add(stint, [], { openedBy: 'joined', startTime: until });
    }
  }
  return { ...record, laps: kept, stints, missingLaps: missing };
};

/** The most recent stint before the last that somebody else drove. */
const stintByAnotherDriver = (
  stints: readonly RaceStint[],
  driver: string
): RaceStint | undefined => {
  if (driver === '') return undefined;
  for (let index = stints.length - 2; index >= 0; index -= 1) {
    const stint = stints[index];
    if (stint.driver !== '' && stint.driver !== driver) return stint;
  }
  return undefined;
};

/** The summary of the staged records, by the recorder's own reckoning. */
const summaryOf = (
  records: readonly StagedCarRecord[],
  resumed: boolean
): RaceHistorySummarySnapshot => {
  const per = <T>(value: (record: StagedCarRecord) => T): T[] =>
    records.map(value);
  const last = (record: StagedCarRecord): RaceStint | undefined =>
    record.stints[record.stints.length - 1];
  const before = (record: StagedCarRecord): RaceStint | undefined =>
    record.stints.length > 1
      ? record.stints[record.stints.length - 2]
      : undefined;
  const others = (record: StagedCarRecord): RaceStint | undefined =>
    stintByAnotherDriver(record.stints, last(record)?.driver ?? '');
  return {
    raceToken: 'race-history-stage',
    raceId: null,
    resumed,
    laps: per((record) => record.laps.length),
    lastLap: per((record) => record.laps[record.laps.length - 1]?.lap ?? 0),
    missingLaps: per((record) => record.missingLaps.length),
    stintFirstLap: per((record) => last(record)?.firstLap ?? 0),
    stintLaps: per((record) => last(record)?.laps ?? 0),
    stintDriver: per((record) => last(record)?.driver ?? ''),
    stintAvgLap: per((record) => last(record)?.avgLap ?? -1),
    stintCleanLaps: per((record) => last(record)?.cleanLaps ?? 0),
    previousStintAvgLap: per((record) => before(record)?.avgLap ?? -1),
    previousStintDriver: per((record) => before(record)?.driver ?? ''),
    previousDriverStintAvgLap: per((record) => others(record)?.avgLap ?? -1),
    previousDriverStintDriver: per((record) => others(record)?.driver ?? ''),
    driverChanges: per(
      (record) =>
        record.stints.filter(
          (stint, at) =>
            at > 0 &&
            stint.driver !== '' &&
            record.stints[at - 1].driver !== '' &&
            stint.driver !== record.stints[at - 1].driver
        ).length
    ),
    stops: per(
      (record) =>
        record.stints.filter((stint) => stint.closedBy === 'stop').length
    ),
    revision: per(() => 1),
    sessionNum: 0,
    version: 1,
  };
};

/**
 * The race forecast as far as the Race Charts read it: the cars of our
 * class in the order of their places, each with what the staged records
 * say of it. None of the forecast proper is staged -- the stops a car
 * owes, the pit window, the finishing order -- and each of those reads as
 * the snapshot writes a figure it does not have. Before our car has a lap
 * there is no forecast at all, as before a pace has been measured.
 */
const forecastOf = (
  records: readonly StagedCarRecord[],
  standings: StandingsSnapshot,
  now: number
): RaceForecastSnapshot => {
  const own = records[OWN_SLOT];
  const started = own.laps.length > 0;
  const lapTime = (value: number | undefined): number | null =>
    value !== undefined && value > 0 ? value : null;
  const cars: RaceForecastCar[] = started
    ? CARS.map((staged, carIdx) => ({ staged, carIdx }))
        .filter(({ staged }) => staged.carClass === CARS[OWN_SLOT].carClass)
        .sort(
          (a, b) =>
            (standings.carIdxClassPosition[a.carIdx] ?? 0) -
            (standings.carIdxClassPosition[b.carIdx] ?? 0)
        )
        .map(({ staged, carIdx }) => {
          const record = records[carIdx];
          const stops = record.stints.filter(
            (stint) => stint.closedBy === 'stop'
          );
          return {
            carIdx,
            own: carIdx === OWN_SLOT,
            classPosition: standings.carIdxClassPosition[carIdx] ?? 0,
            gapS: thousandth((own.progress - record.progress) * staged.pace),
            inPit: false,
            paceS: staged.pace,
            progress: record.progress,
            lapsLeft: 0,
            stopsOwed: null,
            basis: null,
            nextStopLap: null,
            stintLaps: 0,
            stopLossS: null,
            netGapS: null,
            finishGapS: null,
            finishPosition: 0,
            stops: stops.length,
            lastStopLap: stops[stops.length - 1]?.lastLap ?? null,
            lastStopLaneS: null,
            sinceStopLaps: null,
            avg5S: null,
          };
        })
    : [];
  return {
    valid: started,
    reason: started ? null : 'noPace',
    raceType: 'time',
    timeLeftS: started ? Math.max(0, Math.round(8 * 3600 - now)) : null,
    lapLimit: null,
    sessionTimeS: started ? Math.floor(now) : null,
    flagInS: null,
    ownCarIdx: started ? OWN_SLOT : null,
    ownLap: started ? own.laps.length + 1 : null,
    ownLastLapS: lapTime(standings.carIdxLastLapTime[OWN_SLOT]),
    ownBestLapS: lapTime(standings.carIdxBestLapTime[OWN_SLOT]),
    cars,
    place: null,
    stint: null,
    rejoin: null,
    sessionNum: 0,
    version: 1,
  };
};

/**
 * The race history's bridge, answering from records. They are read at the
 * time of asking, so a spec can change what a car holds and ask again.
 */
export const raceHistoryStageBridge = (
  records: ReadonlyMap<number, StagedCarRecord>,
  revisionOf: (carIdx: number) => number = () => 1
): RaceHistoryBridge => ({
  getCarLaps: async (carIdx): Promise<RaceCarLaps> => {
    const record = records.get(carIdx);
    return {
      laps: record ? [...record.laps] : [],
      missingLaps: record ? [...record.missingLaps] : [],
      revision: revisionOf(carIdx),
    };
  },
  getCarStints: async (carIdx) => [...(records.get(carIdx)?.stints ?? [])],
  getDriverChanges: async () => {
    const changes: RaceDriverChange[] = [];
    for (const [carIdx, record] of records) {
      let seq = 0;
      record.stints.forEach((stint, at) => {
        const from = record.stints[at - 1];
        if (!from || from.driver === stint.driver) return;
        seq += 1;
        changes.push({
          carIdx,
          seq,
          sessionTime: stint.startTime,
          lap: from.lastLap ?? 0,
          from: from.driver,
          to: stint.driver,
          atStop: from.closedBy === 'stop',
        });
      });
    }
    return changes.sort((a, b) => a.sessionTime - b.sessionTime);
  },
  listRaces: async () => [],
  // The panels of the race history read no log.
  getEvents: async () => [],
});

/**
 * A channel bridge for a spec: it answers each subscription with the staged
 * snapshot, lets the spec publish another one afterwards, and says how many
 * readers a channel has.
 */
export const raceHistoryStageChannels = (
  snapshots: Partial<ChannelPayloads>
) => {
  type Listener = (payload: unknown) => void;
  const listeners = new Map<string, Set<Listener>>();
  const bridge: ChannelBridge = {
    subscribe: <K extends ChannelName>(
      channel: K,
      callback: (payload: ChannelPayloads[K]) => void
    ) => {
      const set = listeners.get(channel) ?? new Set<Listener>();
      listeners.set(channel, set);
      const listener = callback as Listener;
      set.add(listener);
      const snapshot = snapshots[channel];
      if (snapshot !== undefined) callback(snapshot as ChannelPayloads[K]);
      return () => set.delete(listener);
    },
  };
  return {
    bridge,
    publish: <K extends ChannelName>(
      channel: K,
      payload: ChannelPayloads[K]
    ): void => listeners.get(channel)?.forEach((listener) => listener(payload)),
    readers: (channel: ChannelName): number =>
      listeners.get(channel)?.size ?? 0,
  };
};

export interface RaceHistoryStage {
  session: Session;
  /** Every channel the panels read, one snapshot each. */
  snapshots: Partial<ChannelPayloads>;
  /** What the race history holds of each car, by car index. */
  records: Map<number, StagedCarRecord>;
  /** The slot of a car, by its number. */
  slotOf: (carNumber: string) => number;
  /** The session clock at the staged moment, seconds. */
  sessionTime: number;
}

/** The staged race, as the session, the channels and the records hold it. */
export const raceHistoryStage = ({
  ownLaps = OWN_LAPS,
  iracing = false,
  outage,
  traffic,
  closing,
  stintBudget,
}: RaceHistoryStageOptions = {}): RaceHistoryStage => {
  const closingSlot = closing
    ? CARS.findIndex((entry) => entry.number === closing.car)
    : -1;
  const tweakOf = (carIdx: number): LapTweak => {
    if (carIdx === OWN_SLOT && traffic) return (lap) => traffic[lap] ?? 0;
    if (carIdx === closingSlot && closing) {
      return (lap) => (lap >= closing.fromLap ? -closing.perLap : 0);
    }
    return NO_TWEAK;
  };
  // Our car first, for as many laps as asked: the moment staged is the one
  // it has gone a little under half way round its next lap.
  const ownRun = driveCar(
    CARS[OWN_SLOT],
    OWN_SLOT,
    { laps: ownLaps },
    iracing,
    tweakOf(OWN_SLOT),
    stintBudget
  );
  const now = thousandth(
    ownRun.lastLineAt + CARS[OWN_SLOT].pace * OWN_LAP_FRACTION
  );
  let driven: StagedCarRecord[] = CARS.map((staged, carIdx) =>
    driveCar(staged, carIdx, { now }, iracing, tweakOf(carIdx), stintBudget)
  );

  // Places and gaps at the line, from who completed each lap when.
  const crossings = new Map<number, { carIdx: number; at: number }[]>();
  driven.forEach((record, carIdx) => {
    for (const lap of record.laps) {
      const list = crossings.get(lap.lap) ?? [];
      list.push({ carIdx, at: lap.sessionTime });
      crossings.set(lap.lap, list);
    }
  });
  for (const list of crossings.values()) list.sort((a, b) => a.at - b.at);
  driven.forEach((record, carIdx) => {
    for (const lap of record.laps) {
      const list = crossings.get(lap.lap) ?? [];
      const ownClass = list.filter(
        (entry) => CARS[entry.carIdx].carClass === CARS[carIdx].carClass
      );
      lap.position = list.findIndex((entry) => entry.carIdx === carIdx) + 1;
      lap.classPosition =
        ownClass.findIndex((entry) => entry.carIdx === carIdx) + 1;
      lap.classGap = thousandth(lap.sessionTime - ownClass[0].at);
    }
  });

  if (outage) {
    const own = driven[OWN_SLOT].laps;
    const at = (lap: number): number =>
      own.find((entry) => entry.lap === lap)?.sessionTime ?? 0;
    // A few seconds after our car crossed the line each time.
    const from = at(outage.afterOwnLap) + 6;
    const until = at(outage.untilOwnLap) + 6;
    driven = driven.map((record) => withOutage(record, from, until));
  }

  const gridCars: StoryGridCar[] = CARS.map((staged, carIdx) => {
    const record = driven[carIdx];
    const timed = record.laps.filter((lap) => lap.lapTime !== null);
    const clean = timed.filter((lap) => isCleanLap(lap.flags));
    return {
      number: staged.number,
      // Who is at the wheel now.
      driver:
        record.stints[record.stints.length - 1]?.driver ?? staged.drivers[0],
      team: staged.team,
      carClass: staged.carClass,
      progress: record.progress,
      lastLap: timed[timed.length - 1]?.lapTime ?? -1,
      bestLap:
        clean.length > 0
          ? Math.min(...clean.map((lap) => lap.lapTime ?? Infinity))
          : -1,
    };
  });
  const grid = buildStoryGrid(LMU_STORY_CLASSES, gridCars, {
    player: RACE_HISTORY_STAGE_OWN_CAR,
  });
  const session = {
    ...grid.session,
    WeekendInfo: { ...grid.session.WeekendInfo, TeamRacing: 1 },
    DriverInfo: {
      ...grid.session.DriverInfo,
      DriverTires: (iracing ? TYRES.slice(0, 1) : TYRES).map(
        (TireCompoundType, TireIndex) => ({ TireIndex, TireCompoundType })
      ),
    },
  } as Session;
  const standings: StandingsSnapshot = grid.standings;

  return {
    session,
    slotOf: grid.slotOf,
    sessionTime: now,
    records: new Map(driven.map((record, carIdx) => [carIdx, record])),
    snapshots: {
      'standings.snapshot': standings,
      'race-history.summary': summaryOf(driven, outage !== undefined),
      'race-forecast.snapshot': forecastOf(driven, standings, now),
      'track-state.snapshot': {
        ...trackStateStorySnapshot,
        focusCarIdx: OWN_SLOT,
        sessionTime: now,
      },
    },
  };
};
