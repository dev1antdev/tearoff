import type {
  RaceForecastCar,
  RaceForecastSnapshot,
  RaceStint,
} from '@irdashies/types';
import { isDrivenStint } from '../raceHistory/carRecord';

/**
 * The stint timeline's drawing, worked out from what it is given: which
 * cars it shows, the bar of every stint driven and of every stint to come,
 * and the scale under them.
 *
 * The stints driven are the race history's records as they stand. The
 * stints to come are the forecast's figures laid end to end: the lap the
 * next stop is due, then a full stint and a stop's loss at a time, as many
 * as the car owes, the last one running to the flag. Nothing is added to
 * either: a car whose next stop cannot be named has no stints to come
 * drawn, and a stint nobody recorded is a gap in its bar.
 */

/** What the scale counts: the session clock in seconds, or laps. */
export type TimelineAxisKind = 'time' | 'laps';

export interface TimelineTick {
  at: number;
  label: string;
}

export interface TimelineAxis {
  kind: TimelineAxisKind;
  /**
   * The flag: the right edge. The left edge is 0. On the clock it is when
   * the leader takes it; in laps it is the lap the own car finishes on,
   * which for a car that is lapped is short of the race's distance.
   */
  end: number;
  /** Where the own car is now. */
  now: number;
  ticks: TimelineTick[];
}

export interface TimelineBar {
  from: number;
  to: number;
  /** A stint driven, or one the forecast expects. */
  kind: 'driven' | 'forecast';
  /** Who drove it, as the session named them; '' unknown or to come. */
  driver: string;
  /**
   * Which of the car's drivers that is, counting from 0 in the order they
   * first drove: what the own car's bars are coloured by.
   */
  driverIndex: number;
  /**
   * Driver changes the car had made before this stint: a rival's bars
   * change shade each time it goes up.
   */
  driverChanges: number;
  /** The stint is the one under way. */
  current: boolean;
}

export interface TimelineRow {
  carIdx: number;
  own: boolean;
  bars: TimelineBar[];
}

export interface TimelineModel {
  axis: TimelineAxis;
  rows: TimelineRow[];
}

/**
 * The own car and the class cars nearest it, taken from ahead and behind in
 * turn, in the order of their places.
 */
export const timelineCars = (
  cars: readonly RaceForecastCar[],
  rivals: number
): RaceForecastCar[] => {
  const ownIndex = cars.findIndex((car) => car.own);
  if (ownIndex < 0) return [];
  const picked = new Set<number>([ownIndex]);
  let ahead = ownIndex - 1;
  let behind = ownIndex + 1;
  const wanted = Math.max(0, Math.floor(rivals));
  while (picked.size - 1 < wanted && (ahead >= 0 || behind < cars.length)) {
    if (ahead >= 0) {
      picked.add(ahead);
      ahead -= 1;
    }
    if (picked.size - 1 < wanted && behind < cars.length) {
      picked.add(behind);
      behind += 1;
    }
  }
  // The own car first, as the row the others are read against.
  return [
    cars[ownIndex],
    ...[...picked]
      .filter((index) => index !== ownIndex)
      .sort((a, b) => a - b)
      .map((index) => cars[index]),
  ];
};

/** Minutes between ticks, the first that leaves no more than eight. */
const TIME_STEPS_MIN = [5, 10, 15, 30, 60, 120, 180, 240, 360, 720];
/** Laps between ticks, likewise. */
const LAP_STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500];
const MOST_TICKS = 8;

const stepFor = (span: number, steps: readonly number[]): number =>
  steps.find((step) => span / step <= MOST_TICKS) ?? steps[steps.length - 1];

const timeLabel = (seconds: number, stepMinutes: number): string => {
  const minutes = Math.round(seconds / 60);
  if (stepMinutes >= 60) return `${minutes / 60} h`;
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
};

/** The marks along the scale, strictly inside its ends. */
export const timelineTicks = (
  kind: TimelineAxisKind,
  end: number
): TimelineTick[] => {
  if (!(end > 0)) return [];
  const ticks: TimelineTick[] = [];
  if (kind === 'laps') {
    const step = stepFor(end, LAP_STEPS);
    for (let at = step; at < end; at += step) {
      ticks.push({ at, label: `lap ${at}` });
    }
    return ticks;
  }
  const stepMinutes = stepFor(end / 60, TIME_STEPS_MIN);
  const step = stepMinutes * 60;
  for (let at = step; at < end; at += step) {
    ticks.push({ at, label: timeLabel(at, stepMinutes) });
  }
  return ticks;
};

type AxisSource = Pick<
  RaceForecastSnapshot,
  'raceType' | 'lapLimit' | 'sessionTimeS' | 'flagInS'
>;

/**
 * The scale: laps for a race run to a lap count alone, the session clock
 * for one with a clock. Null while the forecast has no end to draw to.
 */
export const timelineAxis = (
  forecast: AxisSource,
  own: Pick<RaceForecastCar, 'progress' | 'lapsLeft'> | undefined
): TimelineAxis | null => {
  if (forecast.raceType === 'laps') {
    if (!own) return null;
    // The lap the own car takes the flag on, never past the distance.
    const finish = Math.round(own.progress + own.lapsLeft);
    const end =
      forecast.lapLimit !== null && forecast.lapLimit > 0
        ? Math.min(forecast.lapLimit, finish)
        : finish;
    if (!(end > 0)) return null;
    return {
      kind: 'laps',
      end,
      now: Math.min(end, own.progress),
      ticks: timelineTicks('laps', end),
    };
  }
  if (forecast.sessionTimeS === null || forecast.flagInS === null) return null;
  const end = forecast.sessionTimeS + Math.max(0, forecast.flagInS);
  if (!(end > 0)) return null;
  return {
    kind: 'time',
    end,
    now: forecast.sessionTimeS,
    ticks: timelineTicks('time', end),
  };
};

/** Each driver's place among a car's drivers, in the order they first drove. */
const driverIndexer = () => {
  const seen: string[] = [];
  return (driver: string): number => {
    if (!driver) return 0;
    const index = seen.indexOf(driver);
    if (index >= 0) return index;
    seen.push(driver);
    return seen.length - 1;
  };
};

/**
 * The bars of the stints a car has driven, oldest first. On the clock a
 * stint runs from when it began to its pit entry, so a stop is the gap
 * before the next, and so is the time a car spent in its garage; in laps
 * it runs over the laps it completed.
 */
export const drivenBars = (
  stints: readonly RaceStint[],
  axis: Pick<TimelineAxis, 'kind' | 'end'>,
  /** Where the car is now, in the axis's own unit. */
  now: number
): TimelineBar[] => {
  const indexOf = driverIndexer();
  const bars: TimelineBar[] = [];
  let lastLap = 0;
  let lastDriver = '';
  let driverChanges = 0;
  for (const stint of stints) {
    const current = stint.closedBy === null;
    // A stint that a spell in the garage opened is not drawn before it has
    // a lap, by the rule the car panels go by: the car may be standing
    // there still, and for one that never comes back the bar would go on
    // growing with the clock. Once it has a lap its start is where the car
    // came back to the track.
    if (!isDrivenStint(stint)) continue;
    const driverIndex = indexOf(stint.driver);
    // A stint with no name is not taken for another driver's.
    if (stint.driver && lastDriver && stint.driver !== lastDriver) {
      driverChanges += 1;
    }
    if (stint.driver) lastDriver = stint.driver;
    let from: number;
    let to: number;
    if (axis.kind === 'time') {
      from = stint.startTime;
      to = stint.endTime ?? now;
    } else {
      from = stint.firstLap !== null ? stint.firstLap - 1 : lastLap;
      to = current ? now : (stint.lastLap ?? from);
      if (stint.lastLap !== null) lastLap = stint.lastLap;
    }
    from = Math.max(0, Math.min(from, axis.end));
    to = Math.max(0, Math.min(to, axis.end));
    if (!(to > from)) continue;
    bars.push({
      from,
      to,
      kind: 'driven',
      driver: stint.driver,
      driverIndex,
      driverChanges,
      current,
    });
  }
  return bars;
};

/** A stint to come, before it is given a driver. */
export interface ForecastSpan {
  from: number;
  to: number;
  /** What is left of the stint under way, where the others are whole ones. */
  rest: boolean;
}

type ForecastSource = Pick<
  RaceForecastCar,
  | 'progress'
  | 'paceS'
  | 'lapsLeft'
  | 'stopsOwed'
  | 'nextStopLap'
  | 'stintLaps'
  | 'stopLossS'
>;

/**
 * The bars of the stints a car has still to drive: what is left of the one
 * under way, then one for each stop it owes.
 *
 * None where the forecast cannot say when the car stops: its stops are not
 * known, or it owes one and the lap it is due cannot be named. An unbroken
 * bar to the flag would say it does not stop at all.
 */
export const forecastBars = (
  car: ForecastSource,
  axis: Pick<TimelineAxis, 'kind' | 'end' | 'now'>,
  /** Where this car is now, in the axis's own unit. */
  now: number
): ForecastSpan[] => {
  if (car.stopsOwed === null || !(axis.end > now)) return [];
  if (car.stopsOwed === 0) return [{ from: now, to: axis.end, rest: true }];
  if (car.nextStopLap === null || !(car.stintLaps > 0)) return [];

  const inLaps = axis.kind === 'laps';
  // On the clock a lap is its pace long and a stop its loss; in laps a
  // stop takes no room at all.
  const perLap = inLaps ? 1 : car.paceS;
  const stop = inLaps ? 0 : (car.stopLossS ?? 0);
  // A car lapped by the flag finishes short of the scale's end in laps.
  const end = inLaps
    ? Math.min(axis.end, car.progress + car.lapsLeft)
    : axis.end;

  const bars: ForecastSpan[] = [];
  let from = now;
  let to = now + Math.max(0, car.nextStopLap - car.progress) * perLap;
  let rest = true;
  for (let stops = 0; stops < car.stopsOwed; stops += 1) {
    if (!(to < end)) break;
    if (to > from) bars.push({ from, to, rest });
    from = Math.min(end, to + stop);
    to = from + car.stintLaps * perLap;
    rest = false;
  }
  if (end > from) bars.push({ from, to: end, rest });
  return bars;
};

/**
 * The whole drawing: the scale, and a row of bars for the own car and each
 * rival picked. Null while there is nothing to forecast.
 */
export const timelineModel = (
  forecast: RaceForecastSnapshot | undefined,
  stints: ReadonlyMap<number, readonly RaceStint[]>,
  rivals: number
): TimelineModel | null => {
  if (!forecast?.valid) return null;
  const cars = timelineCars(forecast.cars, rivals);
  const axis = timelineAxis(forecast, cars[0]);
  if (!axis || cars.length === 0) return null;

  return {
    axis,
    rows: cars.map((car) => {
      // Every car is at the same moment on the clock, and at its own lap.
      const now =
        axis.kind === 'time' ? axis.now : Math.min(axis.end, car.progress);
      const driven = drivenBars(stints.get(car.carIdx) ?? [], axis, now);
      const last = driven[driven.length - 1];
      const current = last?.current ? last : null;
      return {
        carIdx: car.carIdx,
        own: car.own,
        bars: [
          ...driven,
          ...forecastBars(car, axis, now).map(
            ({ from, to, rest }): TimelineBar => ({
              from,
              to,
              kind: 'forecast',
              // What is left of the stint under way is its driver's; who
              // drives the ones after it is not known.
              driver: rest && current ? current.driver : '',
              driverIndex: rest && current ? current.driverIndex : 0,
              driverChanges: current?.driverChanges ?? 0,
              current: rest,
            })
          ),
        ],
      };
    }),
  };
};
