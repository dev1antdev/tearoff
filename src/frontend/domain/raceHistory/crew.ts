import type { RaceLap, RaceStint } from '@irdashies/types';
import {
  isDrivenStint,
  lapsAroundStop,
  lapsByStint,
  stopSeen,
  type CarRaceRecord,
  type StopSeen,
} from './carRecord';

/**
 * Crew and Stints, worked out from one car's records: who has driven how
 * much, and every stint with the stop that ended it.
 *
 * Nothing here is known from anywhere but the race history. A stint driven
 * while nothing was recording is not in it, so a driver's totals are of the
 * stints that were recorded and of no others.
 */

/**
 * Seconds a stint has been driven for.
 *
 * It runs from where the record says it began, which is the pit exit after
 * a stop, to where it ended, which is the pit entry: the time standing in
 * the box is in neither stint. The stint under way runs to `nowS`.
 *
 * A stint that began in the garage is counted from its first line crossing
 * instead. The record opens it when the car goes in and does not say when
 * it came out, and the minutes in the garage are not at the wheel.
 */
export const stintSeconds = (
  stint: RaceStint,
  ownLaps: readonly RaceLap[],
  nowS: number | null
): number => {
  const start =
    stint.openedBy === 'garage'
      ? (ownLaps[0]?.sessionTime ?? null)
      : stint.startTime;
  if (start === null) return 0;
  const end =
    stint.endTime ?? nowS ?? ownLaps[ownLaps.length - 1]?.sessionTime ?? start;
  return Math.max(0, end - start);
};

/** What a stint used a lap, and of which budget. */
export interface StintEnergy {
  /** Share of a full budget a lap, 0..1. */
  perLap: number;
  /** True for virtual energy, false for fuel. */
  virtual: boolean;
}

/**
 * What the car used a lap over a stint: the mean of the drops in what it
 * had left between one lap's line and the next. Null where the sim does not
 * publish it for the car, and for a stint of a single lap.
 *
 * Only two laps one after the other are compared, and only a drop is
 * counted: a lap the car ended with more than it began is a refill, not a
 * lap's use.
 */
export const stintEnergyPerLap = (
  ownLaps: readonly RaceLap[]
): StintEnergy | null => {
  let sum = 0;
  let count = 0;
  let virtual = false;
  for (let index = 1; index < ownLaps.length; index += 1) {
    const before = ownLaps[index - 1];
    const lap = ownLaps[index];
    if (lap.lap !== before.lap + 1) continue;
    if (before.energy === null || lap.energy === null) continue;
    if (before.energyIsVirtual !== lap.energyIsVirtual) continue;
    const used = before.energy - lap.energy;
    if (used < 0) continue;
    sum += used;
    count += 1;
    virtual = lap.energyIsVirtual;
  }
  return count > 0 ? { perLap: sum / count, virtual } : null;
};

/** One driver of the car, over every stint recorded for them. */
export interface CrewDriver {
  /** As the session names them; '' for stints nobody was named for. */
  name: string;
  /**
   * Their place among the car's drivers, counting from 0 in the order they
   * first drove: what they are coloured by, here and on the stint timeline.
   */
  index: number;
  stints: number;
  laps: number;
  /** Seconds at the wheel. */
  seconds: number;
  /** Mean of every clean lap of theirs, seconds; null with none. */
  avgLap: number | null;
  /** Their best clean lap, seconds; null with none. */
  bestLap: number | null;
  /** At the wheel now: the stint under way is theirs. */
  driving: boolean;
}

/** How a stint came to its end, or that it has not. */
export type StintEnd =
  | { kind: 'underWay' }
  | { kind: 'stop'; stop: StopSeen }
  /** The car went to its garage, or out of the world. */
  | { kind: 'garage' }
  /** The session named another driver, with no stop seen. */
  | { kind: 'driver' }
  /** The laps after it were not recorded. */
  | { kind: 'gap' }
  | { kind: 'session' };

/** One stint of the car. */
export interface CrewStint {
  /** Its number, as the record counts them. */
  ordinal: number;
  driver: string;
  driverIndex: number;
  laps: number;
  seconds: number;
  /** Mean clean lap, seconds; null with none. */
  avgLap: number | null;
  bestLap: number | null;
  energy: StintEnergy | null;
  end: StintEnd;
}

export interface CrewView {
  /** In the order they first drove. */
  drivers: CrewDriver[];
  /** Newest first. */
  stints: CrewStint[];
  /**
   * Which budget the car's laps were recorded in; null where the sim
   * published neither for any of them.
   */
  energyIsVirtual: boolean | null;
}

const endOf = (
  stint: RaceStint,
  next: RaceStint | undefined,
  ownLaps: readonly RaceLap[],
  nextLaps: readonly RaceLap[]
): StintEnd => {
  if (stint.closedBy === null) return { kind: 'underWay' };
  if (stint.closedBy === 'stop') {
    const stop = stopSeen(
      stint,
      next,
      ...lapsAroundStop(stint, ownLaps, nextLaps)
    );
    // A stint the record says a stop ended, without the stop: its end is
    // not known any better than that.
    return stop ? { kind: 'stop', stop } : { kind: 'gap' };
  }
  return { kind: stint.closedBy };
};

/**
 * The drivers and the stints of one car.
 *
 * @param nowS The session clock, for the stint under way; null where it is
 *   not known, and that stint then runs to its last line crossing.
 */
export const crewView = (
  record: CarRaceRecord,
  nowS: number | null
): CrewView => {
  const allLaps = lapsByStint(record.stints, record.laps);
  const drivers: CrewDriver[] = [];
  const stints: CrewStint[] = [];

  record.stints.forEach((stint, at) => {
    if (!isDrivenStint(stint)) return;
    const ownLaps = allLaps[at];
    const seconds = stintSeconds(stint, ownLaps, nowS);

    let driver = drivers.find((entry) => entry.name === stint.driver);
    if (!driver) {
      driver = {
        name: stint.driver,
        index: drivers.length,
        stints: 0,
        laps: 0,
        seconds: 0,
        avgLap: null,
        bestLap: null,
        driving: false,
      };
      drivers.push(driver);
    }
    driver.stints += 1;
    driver.laps += stint.laps;
    driver.seconds += seconds;
    if (stint.closedBy === null) driver.driving = true;
    if (stint.bestLap !== null) {
      driver.bestLap =
        driver.bestLap === null
          ? stint.bestLap
          : Math.min(driver.bestLap, stint.bestLap);
    }

    stints.push({
      ordinal: stint.ordinal,
      driver: stint.driver,
      driverIndex: driver.index,
      laps: stint.laps,
      seconds,
      avgLap: stint.cleanLaps > 0 ? stint.avgLap : null,
      bestLap: stint.bestLap,
      energy: stintEnergyPerLap(ownLaps),
      end: endOf(stint, record.stints[at + 1], ownLaps, allLaps[at + 1] ?? []),
    });
  });

  // A driver's mean is of their clean laps, not of their stints' means: a
  // stint of thirty laps counts for thirty.
  for (const driver of drivers) {
    let sum = 0;
    let cleanLaps = 0;
    for (const stint of record.stints) {
      if (stint.driver !== driver.name || !isDrivenStint(stint)) continue;
      if (stint.avgLap === null || !(stint.cleanLaps > 0)) continue;
      sum += stint.avgLap * stint.cleanLaps;
      cleanLaps += stint.cleanLaps;
    }
    driver.avgLap = cleanLaps > 0 ? sum / cleanLaps : null;
  }

  const metered = record.laps.find((lap) => lap.energy !== null);
  return {
    drivers,
    stints: stints.reverse(),
    energyIsVirtual: metered ? metered.energyIsVirtual : null,
  };
};

/** The limits a league sets on one driver's time at the wheel, seconds. */
export interface DriveTimeLimits {
  maxS: number;
  /** 0 for no minimum. */
  minS: number;
}

/** Where a driver stands against the limits. */
export interface DriveTime {
  /** Share of the maximum driven, 0..1. */
  fill: number;
  /** Where the minimum is along the bar, 0..1; null with no minimum. */
  minAt: number | null;
  /** Seconds still owed to the minimum; 0 once it is met. */
  owedS: number;
  /** Seconds left before the maximum; 0 once it is reached. */
  leftS: number;
  /** Seconds past the maximum; 0 while within it. */
  overS: number;
}

export const driveTime = (
  seconds: number,
  { maxS, minS }: DriveTimeLimits
): DriveTime => {
  const max = Math.max(1, maxS);
  const min = Math.max(0, minS);
  return {
    fill: Math.min(1, Math.max(0, seconds) / max),
    minAt: min > 0 ? Math.min(1, min / max) : null,
    owedS: Math.max(0, min - seconds),
    leftS: Math.max(0, max - seconds),
    overS: Math.max(0, seconds - max),
  };
};

/** What stands in for a figure there is no source for. */
export const NO_FIGURE = '--';

const hoursMinutes = (minutes: number): string =>
  `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;

/** Time done, in hours and minutes: "2:57". The minute under way is not done. */
export const formatDriven = (seconds: number): string =>
  hoursMinutes(Math.floor(Math.max(0, seconds) / 60));

/**
 * Time still to do, in hours and minutes: "1:30". Rounded up, so that it
 * and the time done never add up to less than the limit.
 */
export const formatOwed = (seconds: number): string =>
  hoursMinutes(Math.ceil(Math.max(0, seconds) / 60));

/**
 * A lap time, to the thousandth or the hundredth: "1:54.498", "1:54.50". A
 * mean of laps is printed to the hundredth, a lap as the sim timed it.
 */
export const formatLapTime = (
  seconds: number | null | undefined,
  decimals: 2 | 3 = 3
): string => {
  if (typeof seconds !== 'number' || !(seconds > 0)) return NO_FIGURE;
  if (!Number.isFinite(seconds)) return NO_FIGURE;
  const scale = 10 ** decimals;
  const total = Math.round(seconds * scale);
  const minutes = Math.floor(total / (60 * scale));
  const rest = (total - minutes * 60 * scale) / scale;
  return `${minutes}:${rest.toFixed(decimals).padStart(decimals + 3, '0')}`;
};

/** A sector time: "36.412", and "1:29.062" for one of a minute or more. */
export const formatSectorTime = (
  seconds: number | null | undefined
): string => {
  if (typeof seconds !== 'number' || !(seconds > 0)) return NO_FIGURE;
  if (!Number.isFinite(seconds)) return NO_FIGURE;
  return Math.round(seconds * 1000) < 60_000
    ? seconds.toFixed(3)
    : formatLapTime(seconds);
};

/** A share of a full budget in percent to a tenth: "2.4 %". */
export const formatShare = (share: number | null | undefined): string =>
  typeof share === 'number' && Number.isFinite(share)
    ? `${(share * 100).toFixed(1)} %`
    : NO_FIGURE;

/**
 * What a stop did, in the words of the stint list: "energy, tyres, driver".
 * Empty where nothing can be seen to have happened.
 */
export const stopWork = (stop: StopSeen, driverWord = 'driver'): string =>
  [stop.refilled, stop.tyres && 'tyres', stop.driver && driverWord]
    .filter(Boolean)
    .join(', ');

/** A stop in a line: "58 s: energy, driver", or "in the pits" while it lasts. */
export const stopText = (stop: StopSeen, driverWord = 'driver'): string => {
  if (stop.inPits) return 'in the pits';
  const work = stopWork(stop, driverWord);
  const standing = `${Math.round(stop.standingS)} s`;
  return work ? `${standing}: ${work}` : standing;
};

/** How a stint ended, in a line. */
export const stintEndText = (end: StintEnd): string => {
  switch (end.kind) {
    case 'underWay':
      return 'under way';
    case 'stop':
      return stopText(end.stop);
    case 'garage':
      return 'to the garage';
    case 'driver':
      return 'driver change, no stop seen';
    case 'gap':
      return 'laps after it not recorded';
    case 'session':
      return 'end of the session';
  }
};
