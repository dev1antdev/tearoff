import type {
  RaceEvent,
  RaceLogKinds,
  RaceLogScope,
  RacePenaltyEvent,
} from '@irdashies/types';
import { formatTrackClock } from '../trackClock/trackClock';

/**
 * How the race's log is read: which events a list shows, how each is
 * worded, and how the events a reader holds are kept together as the
 * channel's window moves on.
 *
 * Pure, and shared: an event is plain data made in the main process, and
 * everything about how it reads is here.
 */

/** What is written where a figure has no source. */
export const NO_VALUE = '--';

export type RaceLogKindGroup = keyof RaceLogKinds;

/** The groups, in the order their switches are drawn. */
export const RACE_LOG_KIND_GROUPS: readonly {
  id: RaceLogKindGroup;
  label: string;
}[] = [
  { id: 'pits', label: 'Pit stops' },
  { id: 'drivers', label: 'Driver changes' },
  { id: 'fastestLaps', label: 'Fastest laps' },
  { id: 'flags', label: 'Flags and forecast' },
  { id: 'status', label: 'Cars out, penalties, our place' },
];

export const RACE_LOG_SCOPES: readonly {
  id: RaceLogScope;
  label: string;
}[] = [
  { id: 'all', label: 'All' },
  { id: 'class', label: 'Class' },
  { id: 'car', label: 'Car' },
];

/**
 * Whether an event is of a kind that is switched on. A stop at which the
 * driver changed is a pit stop and a driver change: it is listed while
 * either is.
 */
export const isKindListed = (
  event: RaceEvent,
  kinds: RaceLogKinds
): boolean => {
  switch (event.kind) {
    case 'pit-entry':
    case 'drive-through':
      return kinds.pits;
    case 'pit-exit':
      return kinds.pits || (kinds.drivers && event.driverTo !== '');
    case 'driver-change':
      return kinds.drivers;
    case 'fastest-lap':
      return kinds.fastestLaps;
    case 'flag':
    case 'forecast':
      return kinds.flags;
    case 'retired':
    case 'rejoined':
    case 'position':
    case 'penalty':
      return kinds.status;
  }
};

export interface RaceLogOwnCar {
  /** The own car's slot; null while it is not known. */
  carIdx: number | null;
  /** Its class; null while that is not known. */
  classId: number | null;
}

/**
 * Whether an event is about a car the list is set to. One about the whole
 * field always is. So is every event while the own car is not known, as for
 * a spectator: there is no class and no car to keep the list to.
 */
export const isScopeListed = (
  event: RaceEvent,
  scope: RaceLogScope,
  own: RaceLogOwnCar,
  classOf: (carIdx: number) => number | undefined
): boolean => {
  if (event.carIdx === null || scope === 'all') return true;
  if (scope === 'car')
    return own.carIdx === null || event.carIdx === own.carIdx;
  return own.classId === null || classOf(event.carIdx) === own.classId;
};

/**
 * The events a reader holds, brought up to the channel's latest: the
 * channel's events as they stand now, and before them what the reader held
 * that the channel no longer carries. Oldest first, like both.
 *
 * The channel carries the most recent events only, so one that has moved
 * out of it is still wanted by a reader who has scrolled down to it. One
 * that the channel's window covers and does not have was taken out of the
 * log, and goes.
 */
export const mergeRaceLog = (
  held: readonly RaceEvent[],
  latest: readonly RaceEvent[]
): readonly RaceEvent[] => {
  if (latest.length === 0) return latest;
  const first = latest[0].seq;
  let before = 0;
  while (before < held.length && held[before].seq < first) before += 1;
  return before === 0 ? latest : [...held.slice(0, before), ...latest];
};

/** A page of earlier events put before the ones held. */
export const prependRaceLog = (
  page: readonly RaceEvent[],
  held: readonly RaceEvent[]
): readonly RaceEvent[] => {
  if (page.length === 0) return held;
  if (held.length === 0) return page;
  const first = held[0].seq;
  const earlier = page.filter((event) => event.seq < first);
  return earlier.length === 0 ? held : [...earlier, ...held];
};

/** The session clock as `3:26:56`, and `26:56` inside the first hour. */
export const formatSessionClock = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) return NO_VALUE;
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = String(whole % 60).padStart(2, '0');
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}`
    : `${minutes}:${rest}`;
};

/**
 * The time on an event's line: the clock in the sim to the minute where it
 * is asked for and the sim gave one, the session clock otherwise.
 */
export const raceEventTime = (
  event: Pick<RaceEvent, 'sessionTime' | 'timeOfDay'>,
  format: 'timeOfDay' | 'session'
): string =>
  (format === 'timeOfDay' && formatTrackClock(event.timeOfDay, '24h')) ||
  formatSessionClock(event.sessionTime);

/**
 * Seconds a car stood or was in the lane: `58.2 s`, and as a clock, `2:08`,
 * from a hundred seconds on. A stop is a minute, more or less, and the two
 * figures of one are read against each other: they are in the same form
 * until a stop is long enough to be a repair.
 */
const formatStop = (seconds: number | null): string | null => {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return null;
  if (seconds < 99.95) return `${seconds.toFixed(1)} s`;
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

/** How long something lasted, roughly: `45 s`, `6 min`, `1 h 05 min`. */
const formatSpan = (seconds: number): string => {
  if (seconds < 90) return `${Math.max(0, Math.round(seconds))} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
};

/** A lap time: `1:53.604`. */
const formatLap = (seconds: number): string => {
  const thousandths = Math.round(seconds * 1000);
  const minutes = Math.floor(thousandths / 60_000);
  const rest = (thousandths % 60_000) / 1000;
  return `${minutes}:${rest.toFixed(3).padStart(6, '0')}`;
};

const penaltyText = (event: RacePenaltyEvent): string => {
  const more = event.pending !== null && event.pending > 1;
  if (event.change === 'served') {
    if (event.penalty === 'black') return 'black flag cleared';
    return event.pending !== null && event.pending > 0
      ? `penalty served, ${event.pending} still to serve`
      : 'penalty served';
  }
  const pending = more ? `, ${event.pending} to serve` : '';
  switch (event.penalty) {
    case 'DT':
      return `drive-through penalty${pending}`;
    case 'SG':
      return `stop-and-go penalty${pending}`;
    case 'TIME':
      return event.seconds !== null
        ? `time penalty of ${event.seconds} s${pending}`
        : `time penalty${pending}`;
    case 'black':
      return 'black flag';
    default:
      return `penalty${pending}`;
  }
};

/**
 * What an event says, without the car it is about: the list writes the
 * car's number before it. An event about the whole field reads as a
 * sentence of its own.
 *
 * A figure that is not known is left out rather than guessed, and the one
 * estimate there is, when a forecast's rain begins, is marked with `~`.
 */
export const raceEventText = (event: RaceEvent): string => {
  switch (event.kind) {
    case 'pit-entry':
      return event.classPosition !== null
        ? `into the pits from P${event.classPosition}`
        : 'into the pits';
    case 'pit-exit': {
      const lane = formatStop(event.laneTime);
      const stood = formatStop(event.standingTime);
      const times = [
        lane !== null ? `out after ${lane}` : 'out of the pits',
        stood !== null ? `stopped ${stood}` : null,
      ]
        .filter(Boolean)
        .join(', ');
      return event.driverTo !== ''
        ? `${times}, driver ${event.driverFrom || NO_VALUE} to ${event.driverTo}`
        : times;
    }
    case 'drive-through': {
      const lane = formatStop(event.laneTime);
      return lane !== null
        ? `through the pit lane without stopping, ${lane}`
        : 'through the pit lane without stopping';
    }
    case 'driver-change':
      return `driver ${event.driverFrom || NO_VALUE} to ${event.driverTo || NO_VALUE}`;
    case 'fastest-lap':
      return `fastest lap of the class, ${formatLap(event.lapTime)}`;
    case 'flag':
      if (event.flag === 'chequered') return 'Chequered flag';
      if (event.flag === 'caution') {
        return event.late
          ? 'Full-course yellow, already out when recording began'
          : 'Full-course yellow';
      }
      if (event.flag === 'red') {
        return event.late
          ? 'Red flag, already out when recording began'
          : 'Red flag';
      }
      if (event.after === 'caution') {
        return event.durationS !== null
          ? `Full-course yellow ended after ${formatSpan(event.durationS)}`
          : 'Full-course yellow ended';
      }
      if (event.after === 'red') {
        return event.durationS !== null
          ? `Restarted after ${formatSpan(event.durationS)} under the red flag`
          : 'Restarted after the red flag';
      }
      return 'Green flag';
    case 'retired':
      switch (event.reason) {
        case 'garage':
          return 'in the garage for five minutes: parked or retired';
        case 'gone':
          return 'out of the session for five minutes: retired';
        case 'dnf':
          return 'retired';
        case 'disqualified':
          return 'disqualified';
      }
      break;
    case 'rejoined':
      return event.awayS !== null
        ? `back on track after ${formatSpan(event.awayS)}`
        : 'back on track';
    case 'position':
      return event.to < event.from
        ? `up to P${event.to} in class from P${event.from}`
        : `down to P${event.to} in class from P${event.from}`;
    case 'penalty':
      return penaltyText(event);
    case 'forecast': {
      if (!event.rain) return 'Forecast changed: no rain in it';
      const chance =
        event.rainChance !== null
          ? `, ${Math.round(event.rainChance * 100)} %`
          : '';
      return event.inMinutes !== null
        ? `Forecast changed: rain in ~${formatSpan(event.inMinutes * 60)}${chance}`
        : `Forecast changed: rain to come${chance}`;
    }
  }
  return '';
};

/**
 * The figure an event's line ends with and that is set apart from the rest
 * of it: the time of a class's fastest lap. Empty for every other event.
 */
export const raceEventFigure = (event: RaceEvent): string =>
  event.kind === 'fastest-lap' ? formatLap(event.lapTime) : '';

/** What stands at the head of a line: a car's number, or one of these. */
export type RaceEventMark =
  'green' | 'caution' | 'red' | 'chequered' | 'rain' | 'dry' | 'car';

/**
 * The mark of an event: a flag's colour or the weather for one about the
 * whole field, and the car's own number for one about a car.
 */
export const raceEventMark = (event: RaceEvent): RaceEventMark => {
  if (event.kind === 'flag') return event.flag;
  if (event.kind === 'forecast') return event.rain ? 'rain' : 'dry';
  return 'car';
};
