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

const tyresChanged = (before: RaceLap, after: RaceLap): boolean =>
  before.compounds.some((compound, wheel) => {
    const next = after.compounds[wheel];
    return (
      compound >= 0 && next !== undefined && next >= 0 && next !== compound
    );
  });

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
    // The lane time is written when the car leaves. It also stays unknown
    // for a visit whose entry was not seen, which is told apart by the car
    // having lapped on since.
    inPits:
      stop.laneTime === null &&
      next !== undefined &&
      next.closedBy === null &&
      next.laps <= 1,
    refilled: either ? refilledAcross(lastLap, nextLap) : null,
    tyres: either ? tyresChanged(lastLap, nextLap) : false,
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
  /** This window can read the race history: false in a browser. */
  readable: boolean;
  /** A race is being recorded. */
  recording: boolean;
  /** The car's record has been read. */
  read: boolean;
}

/**
 * The one line a panel shows in place of a car's record, or null while it
 * has the record to show.
 */
export const carRecordNotice = ({
  readable,
  recording,
  read,
}: CarRecordStanding): string | null => {
  if (!readable) return 'The race history is not available in a browser yet.';
  if (!recording) return 'Waiting for a session to record.';
  if (!read) return 'Reading the race history.';
  return null;
};
