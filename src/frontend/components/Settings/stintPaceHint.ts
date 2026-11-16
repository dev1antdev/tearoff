/**
 * The line under the "vs stint" column on the Standings and Relative
 * settings pages: what the column shows before it has a figure, where the
 * choice of the stint it is held against is, and what switching it on
 * starts. That choice sits on the Options tab with the other choices a
 * column shares with nothing on its own row.
 *
 * The three laps are `STINT_PACE_MIN_CLEAN_LAPS` of
 * `src/shared/stintPaceDelta.ts`; change the word with that.
 */
export const STINT_PACE_HINT =
  'Reads -- until the stint has three clean laps and there is an earlier stint to compare with. Which stint that is, is set under Options, Stint Pace. While the column is on, Tearoff records the race.';
