/**
 * The log of a race: what happened in it, one event at a time, for somebody
 * who looks at the Pit Wall after an hour away and wants to catch up.
 *
 * Shared by the main process, which makes the events and stores them with
 * the rest of the race, and whatever lists them. `RaceLogRecorder` makes
 * them from what the race history's recorder already says of laps, stints
 * and driver changes, and from the flags and the pit lane as that recorder
 * reads them; the lap library's file keeps them (table `race_event`). The
 * most recent go out on `race-log.snapshot`; older ones are asked for
 * through `RaceHistoryBridge.getEvents`.
 *
 * An event is plain data. How it is worded is the reader's business, so
 * that the same event can be said differently in a list and in a line.
 *
 * Nothing here is made up. What was not seen is not logged, and a figure
 * that is not known is null.
 */

/**
 * Events kept for one race; past it the oldest go. A 24-hour race of sixty
 * cars makes about 700 pit visits, which with their exits is past this on
 * its own: the log is for catching up on the last hours, not an archive.
 */
export const RACE_LOG_MAX_EVENTS = 1000;

/**
 * From this many on, a new event costs the oldest fastest lap or change of
 * place, while there is one: they are the first to be told again and the
 * last to be missed.
 */
export const RACE_LOG_THIN_FROM = 900;

/** Events on `race-log.snapshot`: the most recent ones. */
export const RACE_LOG_SNAPSHOT_EVENTS = 200;

/** Events one call to `RaceHistoryBridge.getEvents` answers with. */
export const RACE_LOG_PAGE_EVENTS = 200;

/** What every event carries. */
interface RaceEventBase {
  /**
   * Its number in the race: counted up from 1 and never used twice. Numbers
   * are missing where events went at the cap.
   *
   * The order the events were said in, which is the order a list shows them
   * in and pages by. It is not quite the order of `sessionTime`: an event
   * is said once it is sure and timed when it happened. A class's fastest
   * lap is said when it has stood for fifteen seconds and timed at the
   * line; a pit entry is said a moment after the car crossed into the
   * lane. So an event can carry a time a few seconds earlier than the one
   * said before it. A reader keeps the order of `seq`: the newest line is
   * then always the last, and a line never appears among ones already read.
   */
  seq: number;
  /** Session clock, seconds: when it happened, not when it was said. */
  sessionTime: number;
  /**
   * The clock in the sim, seconds since midnight; null where the sim gave
   * none.
   */
  timeOfDay: number | null;
}

/** An event about one car. */
interface RaceCarEventBase extends RaceEventBase {
  carIdx: number;
}

/** An event about the whole field. */
interface RaceFieldEventBase extends RaceEventBase {
  carIdx: null;
}

/** A car drove into the pit lane and stayed more than a moment. */
export interface RacePitEntryEvent extends RaceCarEventBase {
  kind: 'pit-entry';
  /** Its place in its class as it went in; null where the sim had none. */
  classPosition: number | null;
}

/** A car is back on the circuit after a stop. */
export interface RacePitExitEvent extends RaceCarEventBase {
  kind: 'pit-exit';
  /**
   * Seconds it stood still, as the race history timed the stop; null when
   * it was not seen going in, as it may have stood before it was seen.
   */
  standingTime: number | null;
  /** Seconds from pit entry to pit exit; null when it was not seen going in. */
  laneTime: number | null;
  /**
   * Who got out and who got in, where the session named another driver at
   * the stop; both '' where it did not. The session can take a minute and
   * a half to say so, and the event is changed when it does.
   */
  driverFrom: string;
  driverTo: string;
}

/**
 * A car went down the pit lane without standing still. Whether that served
 * a penalty is not known from this: a `penalty` event says so where the sim
 * does.
 */
export interface RaceDriveThroughEvent extends RaceCarEventBase {
  kind: 'drive-through';
  /** Seconds in the pit lane. */
  laneTime: number | null;
}

/** The session named another driver for a car, with no stop seen. */
export interface RaceDriverChangeEvent extends RaceCarEventBase {
  kind: 'driver-change';
  driverFrom: string;
  driverTo: string;
}

/** The fastest lap of a class so far. */
export interface RaceFastestLapEvent extends RaceCarEventBase {
  kind: 'fastest-lap';
  lap: number;
  /** Seconds, as the sim timed it. */
  lapTime: number;
  /** Who drove it, as the session named them; '' unknown. */
  driver: string;
}

/** What a flag event is about. */
export type RaceFlag = 'green' | 'caution' | 'red' | 'chequered';

/**
 * A flag for the whole field. Local yellows are not logged.
 *
 * `caution` is a full-course yellow or a safety car: neither sim says which
 * in what the app reads.
 */
export interface RaceFlagEvent extends RaceFieldEventBase {
  kind: 'flag';
  flag: RaceFlag;
  /** For a green, what it ends: the start procedure, a caution, a red. */
  after: 'start' | 'caution' | 'red' | null;
  /**
   * For a green that ends a caution or a red, how long that lasted, in
   * seconds; null when its beginning or its end was not seen.
   */
  durationS: number | null;
  /**
   * A caution or a red that was already out when recording began: the time
   * is when it was noticed, not when it was shown.
   */
  late: boolean;
}

/** Why a car is said to be out. */
export type RaceRetiredReason =
  /** In its garage for a long time. */
  | 'garage'
  /** Out of the world for a long time. */
  | 'gone'
  /** The sim lists it as not finishing. Le Mans Ultimate only. */
  | 'dnf'
  /** The sim disqualified it. */
  | 'disqualified';

/** A car is out of the race, or parked: said once for each time it leaves. */
export interface RaceRetiredEvent extends RaceCarEventBase {
  kind: 'retired';
  reason: RaceRetiredReason;
}

/** A car that was said to be out is on the circuit again. */
export interface RaceRejoinedEvent extends RaceCarEventBase {
  kind: 'rejoined';
  /** Seconds it was away; null when not known. */
  awayS: number | null;
}

/** The own car's place in its class changed, and held for a lap. */
export interface RacePositionEvent extends RaceCarEventBase {
  kind: 'position';
  from: number;
  to: number;
}

/**
 * What a penalty is, where the sim says: Le Mans Ultimate's drive-through,
 * stop-and-go and time penalty, or iRacing's black flag, which does not say
 * what for. '' where the sim gave a count and no kind.
 */
export type RacePenaltyName = 'DT' | 'SG' | 'TIME' | 'black' | '';

/** A penalty the sim gave a car, or took off it as served. */
export interface RacePenaltyEvent extends RaceCarEventBase {
  kind: 'penalty';
  change: 'given' | 'served';
  penalty: RacePenaltyName;
  /** Seconds of a time penalty, where the sim states them. */
  seconds: number | null;
  /** Penalties the car still has to serve after this; null where not counted. */
  pending: number | null;
}

/** Le Mans Ultimate's forecast for the rest of the session changed. */
export interface RaceForecastEvent extends RaceFieldEventBase {
  kind: 'forecast';
  /** The forecast now has rain in it. */
  rain: boolean;
  /**
   * Whole minutes until the first rain it has, by the Weather Forecast's
   * own estimate; null with no rain, and where that widget has no minutes.
   */
  inMinutes: number | null;
  /** The chance of rain at that point, 0..1; null with no rain. */
  rainChance: number | null;
}

export type RaceEvent =
  | RacePitEntryEvent
  | RacePitExitEvent
  | RaceDriveThroughEvent
  | RaceDriverChangeEvent
  | RaceFastestLapEvent
  | RaceFlagEvent
  | RaceRetiredEvent
  | RaceRejoinedEvent
  | RacePositionEvent
  | RacePenaltyEvent
  | RaceForecastEvent;

export type RaceEventKind = RaceEvent['kind'];

/** Every kind there is, in no order that matters. */
export const RACE_EVENT_KINDS: readonly RaceEventKind[] = [
  'pit-entry',
  'pit-exit',
  'drive-through',
  'driver-change',
  'fastest-lap',
  'flag',
  'retired',
  'rejoined',
  'position',
  'penalty',
  'forecast',
];

/** The kinds that go first when the log is near its cap. */
export const isThinnedFirst = (kind: RaceEventKind): boolean =>
  kind === 'fastest-lap' || kind === 'position';

/** An event as it lies in the file: what all have, and the rest as JSON. */
export interface StoredRaceEvent {
  seq: unknown;
  sessionTime: unknown;
  timeOfDay: unknown;
  carIdx: unknown;
  kind: unknown;
  /** What the kind adds, as it was written. */
  data: unknown;
}

type Fields = Record<string, unknown>;

const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const text = (value: unknown): string =>
  typeof value === 'string' ? value : '';

const oneOf = <Value extends string>(
  value: unknown,
  allowed: readonly Value[]
): Value | null =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as Value)
    : null;

const FLAGS: readonly RaceFlag[] = ['green', 'caution', 'red', 'chequered'];
const AFTER = ['start', 'caution', 'red'] as const;
const RETIRED_REASONS: readonly RaceRetiredReason[] = [
  'garage',
  'gone',
  'dnf',
  'disqualified',
];
const PENALTY_CHANGES = ['given', 'served'] as const;
const PENALTY_NAMES: readonly RacePenaltyName[] = [
  'DT',
  'SG',
  'TIME',
  'black',
  '',
];

/**
 * What a kind adds to an event, for the file: everything but what all
 * events have.
 */
export const raceEventData = (event: RaceEvent): Fields => {
  const data: Fields = { ...event };
  delete data.seq;
  delete data.sessionTime;
  delete data.timeOfDay;
  delete data.carIdx;
  delete data.kind;
  return data;
};

/**
 * An event from what the file holds of it, or null for a row that is not
 * one: a kind this build does not know, a car event without a car, a field
 * its kind cannot do without.
 *
 * A file is read as untrusted. Every field is taken by name and checked,
 * and nothing else that lies in the row comes along.
 */
export const raceEventFrom = (stored: StoredRaceEvent): RaceEvent | null => {
  const seq = finite(stored.seq);
  const sessionTime = finite(stored.sessionTime);
  if (seq === null || !Number.isSafeInteger(seq) || seq < 1) return null;
  if (sessionTime === null) return null;
  const kind = oneOf(stored.kind, RACE_EVENT_KINDS);
  if (kind === null) return null;
  const data: Fields =
    stored.data && typeof stored.data === 'object'
      ? (stored.data as Fields)
      : {};
  const base = { seq, sessionTime, timeOfDay: finite(stored.timeOfDay) };

  if (kind === 'flag') {
    const flag = oneOf(data.flag, FLAGS);
    if (flag === null) return null;
    return {
      ...base,
      carIdx: null,
      kind,
      flag,
      after: oneOf(data.after, AFTER),
      durationS: finite(data.durationS),
      late: data.late === true,
    };
  }
  if (kind === 'forecast') {
    return {
      ...base,
      carIdx: null,
      kind,
      rain: data.rain === true,
      inMinutes: finite(data.inMinutes),
      rainChance: finite(data.rainChance),
    };
  }

  const carIdx = finite(stored.carIdx);
  if (carIdx === null || !Number.isSafeInteger(carIdx) || carIdx < 0) {
    return null;
  }
  const car = { ...base, carIdx };
  switch (kind) {
    case 'pit-entry':
      return { ...car, kind, classPosition: finite(data.classPosition) };
    case 'pit-exit':
      return {
        ...car,
        kind,
        standingTime: finite(data.standingTime),
        laneTime: finite(data.laneTime),
        driverFrom: text(data.driverFrom),
        driverTo: text(data.driverTo),
      };
    case 'drive-through':
      return { ...car, kind, laneTime: finite(data.laneTime) };
    case 'driver-change':
      return {
        ...car,
        kind,
        driverFrom: text(data.driverFrom),
        driverTo: text(data.driverTo),
      };
    case 'fastest-lap': {
      const lapTime = finite(data.lapTime);
      if (lapTime === null) return null;
      return {
        ...car,
        kind,
        lap: finite(data.lap) ?? 0,
        lapTime,
        driver: text(data.driver),
      };
    }
    case 'retired': {
      const reason = oneOf(data.reason, RETIRED_REASONS);
      return reason === null ? null : { ...car, kind, reason };
    }
    case 'rejoined':
      return { ...car, kind, awayS: finite(data.awayS) };
    case 'position': {
      const from = finite(data.from);
      const to = finite(data.to);
      return from === null || to === null ? null : { ...car, kind, from, to };
    }
    case 'penalty': {
      const change = oneOf(data.change, PENALTY_CHANGES);
      if (change === null) return null;
      return {
        ...car,
        kind,
        change,
        penalty: oneOf(data.penalty, PENALTY_NAMES) ?? '',
        seconds: finite(data.seconds),
        pending: finite(data.pending),
      };
    }
  }
};
