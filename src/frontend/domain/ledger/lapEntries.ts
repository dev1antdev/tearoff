import type { LedgerLap, PlayerStintSnapshot } from '@irdashies/types';
import {
  LEDGER_LAP_CAUTION,
  LEDGER_LAP_FROM_START,
  LEDGER_LAP_INCIDENT,
  LEDGER_LAP_NOT_OWN,
  LEDGER_LAP_VOIDED,
  LEDGER_LAP_WET,
  LEDGER_LAP_YELLOW,
} from '@irdashies/types';
import { isCleanLap, isPitLap } from '@irdashies/shared';
import { wheelWear, type WearMode } from './ledgerFigures';
import { hasLapFlag, lapsOfSession, shownLapTime } from './ledgerRows';

/**
 * The lap timer's history, read from the player's ledger: one entry a lap,
 * newest first, with what the lap cost and what it was driven under.
 */

/** One row of the lap history. */
export interface LapEntry {
  lap: number;
  /** Seconds: the sim's own time for the lap where it gave one. */
  time: number;
  /** Seconds against the lap before, or the best before it; 0 with neither. */
  delta?: number;
  /** The sim voided the lap, or it had an incident. */
  dirty?: boolean;
  /** The car was in the pit lane or its box during this lap. */
  pitted?: boolean;
  /** A full-course caution was shown during this lap. */
  caution?: boolean;
  /** A local yellow was shown during it. */
  yellow?: boolean;
  /** The track was wet, or declared wet. */
  wet?: boolean;
  /**
   * The first lap of a race, begun on the grid: the sim times it from the
   * green flag, so it is longer than a lap from the line.
   */
  fromStart?: boolean;
  /** The stint the lap belongs to; '' for a lap driven outside any. */
  stintId?: string;
  /** The lap's number within its stint. */
  stintLap?: number;
  /** Litres burned; null without a reading. */
  fuelUsed?: number | null;
  /** Share of the virtual energy budget, 0..1; null for a car on fuel. */
  energyUsed?: number | null;
  /** Tread worn, 0..1; null where the sim gives no live reading. */
  wear?: number | null;
}

export interface LapEntryOptions {
  /** The session whose laps are listed: the ledger holds earlier ones too. */
  sessionNum: number | null;
  /** A row's delta: against the lap before it, or the best before it. */
  deltaMethod: 'lastlap' | 'bestlap';
  /** The wear figure: the mean of the four wheels, or the worst. */
  wearMode?: WearMode;
  /** Only the laps of this stint. */
  stintId?: string;
}

/** What a lap was driven under, from its LEDGER_LAP_* bits. */
const marksOf = (flags: number) => ({
  dirty: (flags & (LEDGER_LAP_VOIDED | LEDGER_LAP_INCIDENT)) !== 0,
  pitted: isPitLap(flags),
  caution: (flags & LEDGER_LAP_CAUTION) !== 0,
  yellow: (flags & LEDGER_LAP_YELLOW) !== 0,
  wet: (flags & LEDGER_LAP_WET) !== 0,
  fromStart: (flags & LEDGER_LAP_FROM_START) !== 0,
});

/**
 * The rows of the session the user drove, newest first, as far back as the
 * session clock runs on: a row from before the clock went back belongs to a
 * session that was restarted, and so does everything older than it.
 */
const ownLapsOfSession = (
  laps: readonly LedgerLap[],
  sessionNum: number | null
): LedgerLap[] => {
  const own: LedgerLap[] = [];
  let newerEnd = Number.POSITIVE_INFINITY;
  for (const lap of lapsOfSession(laps, sessionNum)) {
    if (lap.endTime > newerEnd) break;
    newerEnd = lap.endTime;
    // A lap a team-mate drove any part of is the car's, not the user's.
    if (!hasLapFlag(lap, LEDGER_LAP_NOT_OWN)) own.push(lap);
  }
  return own;
};

/**
 * The history's entries, newest first.
 *
 * The delta is taken from the rows themselves: with `'lastlap'` a lap's time
 * less that of the lap before it, with `'bestlap'` less the best clean lap
 * before it; 0 for a lap with nothing to be measured against. It is worked
 * out over every lap of the session, so leaving rows out afterwards does not
 * change it.
 */
export const lapEntries = (
  laps: readonly LedgerLap[],
  { sessionNum, deltaMethod, wearMode = 'average', stintId }: LapEntryOptions
): LapEntry[] => {
  const own = ownLapsOfSession(laps, sessionNum);
  const entries: LapEntry[] = [];
  let previous: number | null = null;
  let best: number | null = null;
  let number = 0;
  for (let index = own.length - 1; index >= 0; index -= 1) {
    const lap = own[index];
    const time = shownLapTime(lap);
    const reference = deltaMethod === 'lastlap' ? previous : best;
    number = lap.lapNumber ?? number + 1;
    entries.push({
      lap: number,
      time,
      delta: reference === null ? 0 : time - reference,
      ...marksOf(lap.flags),
      stintId: lap.stintId,
      stintLap: lap.stintLap,
      fuelUsed: lap.fuelUsed,
      energyUsed: lap.energyUsed,
      wear: wheelWear(lap.treadUsed, wearMode),
    });
    previous = time;
    if (isCleanLap(lap.flags) && (best === null || time < best)) best = time;
  }
  entries.reverse();
  return stintId === undefined
    ? entries
    : entries.filter((entry) => entry.stintId === stintId);
};

export interface LapEntryFilter {
  /** How many rows are shown. */
  count: number;
  hidePittedLaps?: boolean;
  hideCautionLaps?: boolean;
}

/**
 * The entries the history shows, newest first. Laps are left out before the
 * count is applied, so hiding some still shows the number asked for while
 * there are enough others.
 */
export const visibleLapEntries = (
  entries: readonly LapEntry[],
  { count, hidePittedLaps, hideCautionLaps }: LapEntryFilter
): LapEntry[] =>
  entries
    .filter(
      (entry) =>
        !(hidePittedLaps && entry.pitted) && !(hideCautionLaps && entry.caution)
    )
    .sort((a, b) => b.lap - a.lap)
    .slice(0, count);

/**
 * The stint whose laps "this stint only" lists: the one under way while the
 * user drives it, otherwise the one their newest lap was driven in, so the
 * list can still be read in the garage after the stint.
 */
export const listedStintId = (
  laps: readonly LedgerLap[],
  live: PlayerStintSnapshot | undefined,
  sessionNum: number | null
): string => {
  const open = live?.stint;
  if (open && open.own && open.sessionNum === sessionNum) return open.id;
  return ownLapsOfSession(laps, sessionNum)[0]?.stintId ?? '';
};

/** The lap under way: a row without a time, and maybe without a number. */
export type LiveLapEntry = Omit<LapEntry, 'time' | 'lap' | 'delta'> & {
  lap: number | null;
};

/**
 * The lap under way as a row: what it has used and been driven under so
 * far. Its time is the running lap time, which the caller has.
 */
export const liveLapEntry = (
  live: PlayerStintSnapshot,
  wearMode: WearMode = 'average'
): LiveLapEntry => ({
  lap: live.lap.lapNumber,
  ...marksOf(live.lap.flags),
  stintId: live.stint?.id ?? '',
  stintLap: live.lap.stintLap,
  fuelUsed: live.lap.fuelUsed,
  energyUsed: live.lap.energyUsed,
  wear: live.lap.treadUsed ? wheelWear(live.lap.treadUsed, wearMode) : null,
});
