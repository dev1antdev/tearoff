import type { RaceLap, RaceStint } from '@irdashies/types';
import { LEDGER_LAP_IN_LAP } from '../../types/ledger';
import { stopUnderWay } from '../raceStop';

/**
 * How long a car has run on its tyres, read from what the race history
 * holds of it: its stints, the stops that ended them and its laps.
 *
 * No sim says that a rival changed tyres, so the age of a set is worked out
 * backwards from the present, one stop at a time, and is only as sure as
 * the least sure stop it rests on:
 *
 * - **seen**: a wheel carries another compound after the stop than before
 *   it, or the car's own wear was watched going back up. The same rule as
 *   `stopSeen` of the car panels, which reads it from here.
 * - **likely**: the car stood longer than its refill and its driver change
 *   explain, by at least what four tyres take. Or the other way round: it
 *   stood too short a time for four tyres, so the set before is still on.
 * - **at least**: a stop, a spell in the garage or laps nobody saw, of
 *   which nothing can be said. The set is then at least as old as the laps
 *   since, and may be older.
 *
 * Pure, and free of both sides: the main process runs it over the records
 * as they are made, and over what the file holds after a restart.
 *
 * What it cannot tell, and does not claim to: a change of two tyres, which
 * takes little longer than a slow refill; a repair or a penalty served
 * with the stop, which reads as time for tyres; a new set of the same
 * compound where the stop cannot be timed against its refill.
 */

/** How sure the age of a set of tyres is. */
export type TyreSetSure = 'seen' | 'likely' | 'atLeast';

/** The set of tyres a car is on. */
export interface TyreSet {
  /**
   * Laps the car had completed when the set went on; for `atLeast`, when
   * it was last out of sight.
   */
  sinceLap: number;
  sure: TyreSetSure;
}

/** What a stop did to the tyres, as far as it can be told. */
export type TyreStopVerdict =
  /** Another compound went on. */
  | 'changed'
  /** It stood long enough for four tyres beyond everything else. */
  | 'likely'
  /** It did not stand long enough for four tyres. */
  | 'none'
  /** Nothing can be said. */
  | 'unknown';

/** What a stop's length is held against. Constants of a car in a session. */
export interface TyreStopRules {
  /** What changing four tyres takes, seconds; null where nobody says. */
  tyreChangeS: number | null;
  /**
   * Tyres may be changed while the car is refuelled, so a change does not
   * show in how long it stood.
   */
  tyresAlongside: boolean;
  /**
   * How long taking on `gain` of a full budget, 0..1, keeps a car standing,
   * seconds; null where the rates are not known.
   */
  refillS: (gain: number, isVirtual: boolean) => number | null;
  /** What a driver change takes, seconds; null where nobody says. */
  driverChangeS: number | null;
  /** A driver change may run alongside refuelling. */
  driverAlongside: boolean;
}

/** Rules that judge no stop by its length: only a compound is evidence. */
export const NO_TYRE_STOP_RULES: TyreStopRules = {
  tyreChangeS: null,
  tyresAlongside: false,
  refillS: () => null,
  driverChangeS: null,
  driverAlongside: true,
};

/**
 * A car's tyres as somebody watching its wear has them: under Le Mans
 * Ultimate our own car always, and every car where the sim publishes their
 * wear, which it does offline.
 */
export interface TyreWatch {
  /**
   * Session time from which the car's tyres have been watched without a
   * break; NaN while they are not being watched.
   */
  since: number;
  /** Session time a change was last seen at; NaN before one. */
  changedAt: number;
  /** Laps the car had completed then; -1 before one. */
  changeLap: number;
}

/** Where the car is now, for the stop that is not behind it yet. */
export interface TyreSetNow {
  /** Laps the car has completed. */
  lapsCompleted: number;
  /**
   * The compounds on the car now, LF RF LR RR, where they are read: what
   * the newest stop is judged by until the lap after it is completed.
   */
  compounds?: readonly number[];
}

/**
 * A wheel carries another compound than before. A wheel either reading
 * does not name is not a change: -1 is "not read", not a compound.
 */
export const tyresChangedAcross = (
  before: readonly number[],
  after: readonly number[]
): boolean =>
  before.some((compound, wheel) => {
    const next = after[wheel];
    return (
      compound >= 0 && next !== undefined && next >= 0 && next !== compound
    );
  });

/** What is known of one stop when its length is judged. */
export interface TyreStopFacts {
  /** A wheel carries another compound after it. */
  compoundsChanged: boolean;
  /** The car has not been seen to leave: its standing time still runs. */
  underWay: boolean;
  /** Seconds standing still. */
  standingS: number;
  /**
   * What its refill and its driver change account for, seconds; null where
   * that cannot be reckoned.
   */
  explainedS: number | null;
}

/**
 * What a stop did to the tyres.
 *
 * A compound that changed is seen, whatever the stop's length. Otherwise
 * the length decides, where four tyres are known to take a time: shorter
 * than that, and no set went on; longer than everything else explains by
 * that much, and one likely did; with less than half of it to spare, none
 * did. Between the two, and wherever the rest cannot be reckoned, nothing
 * is said.
 */
export const tyreStopVerdict = (
  stop: TyreStopFacts,
  rules: TyreStopRules
): TyreStopVerdict => {
  if (stop.compoundsChanged) return 'changed';
  if (stop.underWay) return 'unknown';
  const change = rules.tyreChangeS;
  if (change === null || !(change > 0)) return 'unknown';
  if (stop.standingS < change) return 'none';
  if (rules.tyresAlongside || stop.explainedS === null) return 'unknown';
  const spare = stop.standingS - stop.explainedS;
  if (spare >= change) return 'likely';
  return spare < change / 2 ? 'none' : 'unknown';
};

/** A lap by its number: laps are in the order driven, mostly without gaps. */
const lapNumbered = (
  laps: readonly RaceLap[],
  number: number
): RaceLap | undefined => {
  if (laps.length === 0) return undefined;
  const guess = laps[number - laps[0].lap];
  if (guess?.lap === number) return guess;
  let low = 0;
  let high = laps.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const lap = laps[middle].lap;
    if (lap === number) return laps[middle];
    if (lap < number) low = middle + 1;
    else high = middle - 1;
  }
  return undefined;
};

/**
 * What a lap costs the car of what it runs on, as a share of a full
 * budget: the middle of the falls between consecutive laps of a stint.
 * Null where no two laps of it show one, which is also every car whose
 * reading does not move.
 */
const usagePerLap = (
  laps: readonly RaceLap[],
  stint: RaceStint
): number | null => {
  if (stint.firstLap === null || stint.lastLap === null) return null;
  const falls: number[] = [];
  let before = lapNumbered(laps, stint.firstLap);
  for (let number = stint.firstLap + 1; number <= stint.lastLap; number += 1) {
    const lap = lapNumbered(laps, number);
    if (
      before &&
      lap &&
      before.energy !== null &&
      lap.energy !== null &&
      before.energyIsVirtual === lap.energyIsVirtual &&
      before.energy > lap.energy
    ) {
      falls.push(before.energy - lap.energy);
    }
    before = lap;
  }
  if (falls.length === 0) return null;
  falls.sort((a, b) => a - b);
  const middle = falls.length >> 1;
  return falls.length % 2 === 1
    ? falls[middle]
    : (falls[middle - 1] + falls[middle]) / 2;
};

/**
 * Seconds a stop's refill and its driver change account for.
 *
 * What the car took on is read from the two line crossings either side of
 * the stop. One lap's worth was burned between them, whichever side of the
 * line the pit box is on, so that is added back. Null where either reading
 * is missing, where what a lap costs the car cannot be seen, or where a
 * rate is not known.
 */
const explainedSeconds = (
  older: RaceStint,
  newer: RaceStint,
  lapBefore: RaceLap | undefined,
  lapAfter: RaceLap | undefined,
  laps: readonly RaceLap[],
  rules: TyreStopRules
): number | null => {
  if (
    !lapBefore ||
    !lapAfter ||
    lapBefore.energy === null ||
    lapAfter.energy === null ||
    lapBefore.energyIsVirtual !== lapAfter.energyIsVirtual
  ) {
    return null;
  }
  const usage = usagePerLap(laps, older) ?? usagePerLap(laps, newer);
  if (usage === null) return null;
  const gain = Math.min(
    1,
    Math.max(0, lapAfter.energy - lapBefore.energy + usage)
  );
  const refill = rules.refillS(gain, lapAfter.energyIsVirtual);
  if (refill === null) return null;

  const driverChanged =
    older.stop?.driverChanged === true ||
    (newer.driver !== '' &&
      older.driver !== '' &&
      newer.driver !== older.driver);
  if (!driverChanged) return refill;
  if (rules.driverChangeS === null) return null;
  return rules.driverAlongside
    ? Math.max(refill, rules.driverChangeS)
    : refill + rules.driverChangeS;
};

/**
 * The first lap count a set that went on at a stop is counted from.
 *
 * `lapsAtStop` is what the car had completed when it stood still. Where
 * the pit boxes are before the line, the lap it stood on is completed as
 * it leaves, with nearly all of it driven on the set that came off: that
 * lap, which the record marks as the lap into the pits, is not counted as
 * one on the new set.
 */
const setStartLap = (laps: readonly RaceLap[], lapsAtStop: number): number => {
  const next = lapNumbered(laps, lapsAtStop + 1);
  return next && (next.flags & LEDGER_LAP_IN_LAP) !== 0
    ? lapsAtStop + 1
    : lapsAtStop;
};

/**
 * The set of tyres a car is on, from its stints and laps. Null for a car
 * with no stint: nothing is held of it.
 *
 * @param stints Oldest first, the one under way last.
 * @param laps In the order driven.
 * @param watch What somebody watching the car's wear saw, where that is.
 */
export const tyreSetOf = (
  stints: readonly RaceStint[],
  laps: readonly RaceLap[],
  rules: TyreStopRules,
  now: TyreSetNow,
  watch?: TyreWatch
): TyreSet | null => {
  if (stints.length === 0) return null;
  // Laps completed since the newest one held were driven while nothing was
  // recording: whatever the car did on them was not seen, unless somebody
  // was watching its wear all the while.
  const newest = laps[laps.length - 1];
  if (now.lapsCompleted > (newest?.lap ?? 0)) {
    const unseenFrom =
      newest?.sessionTime ?? stints[stints.length - 1].startTime;
    if (!(watch !== undefined && watch.since <= unseenFrom)) {
      return { sinceLap: now.lapsCompleted, sure: 'atLeast' };
    }
  }
  const hasChange = watch !== undefined && watch.changeLap >= 0;
  // Once a stop is judged by its length alone, nothing older is surer.
  let reckoned = false;
  const known = (lapsAtChange: number): TyreSet => ({
    sinceLap: setStartLap(laps, lapsAtChange),
    sure: reckoned ? 'likely' : 'seen',
  });

  for (let index = stints.length - 1; index >= 1; index -= 1) {
    const newer = stints[index];
    const older = stints[index - 1];
    // When the car left the track: NaN compares false both ways below.
    const leftAt = older.endTime ?? Number.NaN;
    if (hasChange && watch.changedAt >= leftAt) return known(watch.changeLap);
    // Watched all through it, and no tyre went on.
    if (watch !== undefined && watch.since <= leftAt) continue;

    const lapsAtStop = older.lastLap;
    const resumedAt = (newer.firstLap ?? now.lapsCompleted + 1) - 1;
    const adjacent =
      lapsAtStop !== null &&
      (newer.firstLap === null || newer.firstLap === lapsAtStop + 1);
    if (!adjacent) {
      // Laps between the two that nobody saw.
      return { sinceLap: resumedAt, sure: 'atLeast' };
    }

    const lapBefore = lapNumbered(laps, lapsAtStop);
    const lapAfter = lapNumbered(laps, lapsAtStop + 1);
    const isNewest = index === stints.length - 1;
    const compoundsAfter =
      lapAfter?.compounds ?? (isNewest ? now.compounds : undefined);
    const compoundsChanged =
      lapBefore !== undefined &&
      compoundsAfter !== undefined &&
      tyresChangedAcross(lapBefore.compounds, compoundsAfter);

    let verdict: TyreStopVerdict;
    if (compoundsChanged) {
      verdict = 'changed';
    } else if (older.closedBy === 'driver') {
      // Another name and no standing still: nothing was done to the car.
      continue;
    } else if (older.closedBy === 'stop' && older.stop) {
      verdict = tyreStopVerdict(
        {
          compoundsChanged: false,
          // As the car panels tell a stop that is not over.
          underWay: stopUnderWay(older, newer),
          standingS: older.stop.standingTime,
          explainedS: explainedSeconds(
            older,
            newer,
            lapBefore,
            lapAfter,
            laps,
            rules
          ),
        },
        rules
      );
    } else {
      // The garage, where any set may go on, or an end nobody saw.
      verdict = 'unknown';
    }

    if (verdict === 'changed') return known(lapsAtStop);
    if (verdict === 'likely') {
      return { sinceLap: setStartLap(laps, lapsAtStop), sure: 'likely' };
    }
    if (verdict === 'unknown') {
      return { sinceLap: setStartLap(laps, lapsAtStop), sure: 'atLeast' };
    }
    reckoned = true;
  }

  if (hasChange) return known(watch.changeLap);
  const first = stints[0];
  // Seen before its first lap: on the set it left the grid or the garage on.
  if (first.openedBy === 'start') {
    return { sinceLap: 0, sure: reckoned ? 'likely' : 'seen' };
  }
  return {
    sinceLap: Math.max(0, (first.firstLap ?? now.lapsCompleted + 1) - 1),
    sure: 'atLeast',
  };
};
