import type { LedgerLap, LedgerStint } from '@irdashies/types';
import { isCleanLap } from '@irdashies/shared';

/**
 * Reading the player's ledger, for every widget that shows it: which rows
 * are a session's or a stint's, which lap time to show, what a stint used.
 * Pure, and over the rows as `player-ledger.snapshot` carries them: newest
 * first.
 */

/** The rows of one session. Practice, qualifying and race share the ring. */
export const lapsOfSession = (
  laps: readonly LedgerLap[],
  sessionNum: number | null
): LedgerLap[] => laps.filter((lap) => lap.sessionNum === sessionNum);

/** The rows of one stint; none for the '' of a lap driven outside any. */
export const lapsOfStint = (
  laps: readonly LedgerLap[],
  stintId: string
): LedgerLap[] =>
  stintId === '' ? [] : laps.filter((lap) => lap.stintId === stintId);

/** The rows a rate or a best lap may be taken from. */
export const cleanLapsOf = (laps: readonly LedgerLap[]): LedgerLap[] =>
  laps.filter((lap) => isCleanLap(lap.flags));

/** Whether a row carries one of the LEDGER_LAP_* bits. */
export const hasLapFlag = (lap: LedgerLap, flag: number): boolean =>
  (lap.flags & flag) !== 0;

/**
 * The lap time to show: the sim's own when it gave one, which is the figure
 * a driver recognises, otherwise the one timed here from line to line.
 */
export const shownLapTime = (lap: LedgerLap): number =>
  lap.simLapTime ?? lap.lapTime;

const spent = (start: number | null, end: number | null): number | null =>
  start !== null && end !== null ? start - end : null;

const spentPerWheel = (
  start: readonly (number | null)[],
  end: readonly (number | null)[]
): (number | null)[] =>
  start.map((value, wheel) => spent(value, end[wheel] ?? null));

/** What a stint used, level against level. */
export interface StintTotals {
  /** Seconds on track; the pit lane at its end is not in it. */
  time: number | null;
  /** Litres. */
  fuel: number | null;
  /** Virtual energy, as a fraction of the budget. */
  energy: number | null;
  /** Tread per wheel, 0..1. */
  tread: (number | null)[];
  /** Disc per wheel, millimetres. */
  brake: (number | null)[];
}

/**
 * A stint's totals: its start values less its end values, never the sum of
 * its rows, so a stretch without a row -- the run from the pit exit to the
 * line -- still counts. For the open stint of `player-stint.snapshot` the
 * end values are the present ones, so these are the totals so far.
 */
export const stintTotals = (stint: LedgerStint): StintTotals => ({
  time: stint.endTime === null ? null : stint.endTime - stint.startTime,
  fuel: spent(stint.startFuel, stint.endFuel),
  energy: spent(stint.startEnergy, stint.endEnergy),
  tread: spentPerWheel(stint.startTread, stint.endTread),
  brake: spentPerWheel(stint.startBrake, stint.endBrake),
});
