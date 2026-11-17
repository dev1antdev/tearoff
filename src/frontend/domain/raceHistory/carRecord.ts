import { stopUnderWay, tyresChangedAcross } from '@irdashies/shared';
import type { RaceLap, RaceStint } from '@irdashies/types';

/**
 * What the race history holds of one car, as the panels about a car read
 * it, and the two rules they share for reading it.
 */

/** Everything the race history holds of one car. */
export interface CarRaceRecord {
  /** In the order driven. */
  laps: readonly RaceLap[];
  /** Lap numbers the car has completed that are not among them. */
  missingLaps: readonly number[];
  /** Oldest first, the one under way last. */
  stints: readonly RaceStint[];
}

/**
 * A stint the car has been seen to drive in: one with a lap, or the one
 * under way. Not the stint the record opens when a car goes to its garage,
 * until the car has completed a lap again: a car that never comes back out
 * has that stint open for the rest of the race, and it drove none of it.
 */
export const isDrivenStint = (stint: RaceStint): boolean =>
  stint.laps > 0 || (stint.closedBy === null && stint.openedBy !== 'garage');

/**
 * The car's drivers in the order they first drove, as the session names
 * them: what a driver is coloured by on every panel. A stint nobody was
 * named for counts as one driver, ''.
 */
export const driverOrder = (stints: readonly RaceStint[]): string[] => {
  const drivers: string[] = [];
  for (const stint of stints) {
    if (isDrivenStint(stint) && !drivers.includes(stint.driver)) {
      drivers.push(stint.driver);
    }
  }
  return drivers;
};

/** What a lap used of what the car runs on. */
export interface LapEnergyUse {
  /** Share of a full budget, 0..1; null where it cannot be told. */
  used: number | null;
  /** The car ended the lap with more than it began it with. */
  refilled: boolean;
}

/**
 * What a lap used, from what the car had left at this line and at the one
 * before. Not told without the lap before under the number before, without
 * a reading at both lines, or where the two are of different budgets.
 */
export const lapEnergyUse = (
  lap: RaceLap,
  before: RaceLap | undefined
): LapEnergyUse => {
  if (
    !before ||
    before.lap !== lap.lap - 1 ||
    before.energy === null ||
    lap.energy === null ||
    before.energyIsVirtual !== lap.energyIsVirtual
  ) {
    return { used: null, refilled: false };
  }
  const used = before.energy - lap.energy;
  return used < 0 ? { used: null, refilled: true } : { used, refilled: false };
};

/**
 * The laps held for each stint, in the stints' order: those from its first
 * lap to its last. Both lists are in the order driven, so one pass serves.
 */
export const lapsByStint = (
  stints: readonly RaceStint[],
  laps: readonly RaceLap[]
): RaceLap[][] => {
  let at = 0;
  return stints.map((stint) => {
    const own: RaceLap[] = [];
    if (stint.firstLap === null || stint.lastLap === null) return own;
    while (at < laps.length && laps[at].lap < stint.firstLap) at += 1;
    while (at < laps.length && laps[at].lap <= stint.lastLap) {
      own.push(laps[at]);
      at += 1;
    }
    return own;
  });
};

/** What a stop can be seen to have done, from the laps either side of it. */
export interface StopSeen {
  /** Seconds the car stood still. */
  standingS: number;
  /**
   * The car has not been seen to leave the pit lane since: the standing
   * time is still running.
   */
  inPits: boolean;
  /**
   * What the car had left to run on went up across the stop: its virtual
   * energy, or its fuel. Null where neither can be seen to have.
   */
  refilled: 'energy' | 'fuel' | null;
  /** A wheel carries another compound than before the stop. */
  tyres: boolean;
  /** Another driver took the car over. */
  driver: boolean;
}

const refilledAcross = (
  before: RaceLap,
  after: RaceLap
): StopSeen['refilled'] => {
  if (before.energy === null || after.energy === null) return null;
  // A car does not change what it runs on; two kinds are two readings that
  // cannot be compared.
  if (before.energyIsVirtual !== after.energyIsVirtual) return null;
  if (!(after.energy > before.energy)) return null;
  return after.energyIsVirtual ? 'energy' : 'fuel';
};

/**
 * What the stop that ended a stint can be seen to have done. Null for a
 * stint no stop ended.
 *
 * Only what the records show is said. The driver changed where the record
 * says so, or names somebody else for the stint after. The tyres changed
 * where a wheel's compound differs between the last lap before the stop
 * and the first lap after it. The car was refilled where it had more at
 * the line after the stop than at the line before it. A new set of the same
 * compound cannot be seen, and neither can a top-up smaller than what the
 * lap of the stop used: neither is claimed.
 *
 * @param lastLap The stint's last lap, where it is held.
 * @param nextLap The lap after that one, where it is held: the lap the car
 *   stood still on.
 */
export const stopSeen = (
  stint: RaceStint,
  next: RaceStint | undefined,
  lastLap: RaceLap | undefined,
  nextLap: RaceLap | undefined
): StopSeen | null => {
  const stop = stint.stop;
  if (stint.closedBy !== 'stop' || !stop) return null;
  const either = lastLap !== undefined && nextLap !== undefined;
  return {
    standingS: stop.standingTime,
    // The lane time is written when the car leaves, and stays unknown for
    // a visit whose entry was not seen: the one rule that tells the two
    // apart is asked.
    inPits: stopUnderWay(stint, next),
    refilled: either ? refilledAcross(lastLap, nextLap) : null,
    // The rule the laps on a set of tyres are counted by, so that this
    // and the Tyres cells never disagree about one stop.
    tyres: either
      ? tyresChangedAcross(lastLap.compounds, nextLap.compounds)
      : false,
    driver:
      stop.driverChanged ||
      (next !== undefined &&
        next.driver !== '' &&
        stint.driver !== '' &&
        next.driver !== stint.driver),
  };
};

/**
 * The laps either side of the stop that ended a stint: its last lap and
 * the one after, each only where it is held under that very number.
 */
export const lapsAroundStop = (
  stint: RaceStint,
  ownLaps: readonly RaceLap[],
  nextLaps: readonly RaceLap[]
): [RaceLap | undefined, RaceLap | undefined] => {
  if (stint.lastLap === null) return [undefined, undefined];
  const last = ownLaps[ownLaps.length - 1];
  const after = nextLaps[0];
  return [
    last?.lap === stint.lastLap ? last : undefined,
    after?.lap === stint.lastLap + 1 ? after : undefined,
  ];
};

/** What a panel is told of where the record it shows stands. */
export interface CarRecordStanding {
  /**
   * This page can read the race history. False only where it was given no
   * bridge to it, which is no page of the app: a window has one over IPC,
   * a page served to a browser one over its socket.
   */
  readable: boolean;
  /** A race is being recorded. */
  recording: boolean;
  /** The car's record has been read. */
  read: boolean;
  /**
   * The last read of it failed, and no other is on its way: it is asked
   * for again when the car's records change, or the page reconnects.
   */
  failed?: boolean;
}

/**
 * The one line a panel shows in place of a car's record, or null while it
 * has the record to show.
 */
export const carRecordNotice = ({
  readable,
  recording,
  read,
  failed = false,
}: CarRecordStanding): string | null => {
  if (!readable) return 'The race history is not available on this page.';
  if (!recording) return 'Waiting for a session to record.';
  // Not "Reading": nothing is being read, and it would say so for ever.
  if (!read && failed) return 'The race history could not be read.';
  if (!read) return 'Reading the race history.';
  return null;
};
