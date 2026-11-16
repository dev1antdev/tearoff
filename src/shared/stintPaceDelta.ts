import type { RaceHistorySummarySnapshot } from '../types/channels/raceHistory';
import type { StintPaceReference } from '../types/widgetConfigs';

/**
 * A car's pace in the stint it is on against an earlier stint of its own:
 * one rule, for the Timing Tower, the Standings and the Relative, so that
 * no two tables disagree about whether a car is quicker than before its
 * stop.
 *
 * Pure, and free of both sides. It reads the means the race history keeps
 * for each stint (`RaceHistoryRecorder`): of clean laps only, which leaves
 * out the lap into the pits, the lap out of them, a lap under a full-course
 * yellow, a lap the sim gave no time and the lap that began on the grid.
 */

/**
 * Clean laps a stint needs before its mean is held against another one.
 * The first laps after a stop are driven on cold tyres and in whatever
 * traffic the pit exit found: one or two of them say little about a stint.
 */
export const STINT_PACE_MIN_CLEAN_LAPS = 3;

/** Zero and -1 are how "no time" is written; neither is a lap time. */
const isLapTime = (value: number | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

/**
 * The mean clean lap of the stint under way less that of the stint it is
 * held against, in seconds: negative is quicker than before.
 *
 * Null until the stint has `STINT_PACE_MIN_CLEAN_LAPS` clean laps, and
 * where there is no earlier stint with a clean lap to hold it against.
 * Never a figure made from less.
 */
export const stintPaceDelta = (
  stintAvgLap: number | undefined,
  stintCleanLaps: number | undefined,
  referenceAvgLap: number | undefined
): number | null => {
  if (!isLapTime(stintAvgLap) || !isLapTime(referenceAvgLap)) return null;
  if (
    typeof stintCleanLaps !== 'number' ||
    !(stintCleanLaps >= STINT_PACE_MIN_CLEAN_LAPS)
  ) {
    return null;
  }
  return stintAvgLap - referenceAvgLap;
};

/** What the rule reads of `race-history.summary`. */
export type StintPaceSummary = Pick<
  RaceHistorySummarySnapshot,
  | 'stintAvgLap'
  | 'stintCleanLaps'
  | 'previousStintAvgLap'
  | 'previousDriverStintAvgLap'
>;

/**
 * One car's pace against the stint asked for: the one before, or the most
 * recent one somebody else drove. Null by the rule above, and for a car the
 * summary does not hold.
 */
export const carStintPaceDelta = (
  summary: StintPaceSummary | undefined,
  carIdx: number,
  against: StintPaceReference
): number | null =>
  summary
    ? stintPaceDelta(
        summary.stintAvgLap[carIdx],
        summary.stintCleanLaps[carIdx],
        (against === 'driver'
          ? summary.previousDriverStintAvgLap
          : summary.previousStintAvgLap)[carIdx]
      )
    : null;
