import type { LapAverageLaps } from '@irdashies/types';

/**
 * The line under an Avg 5 or Avg 10 column on the Standings and Relative
 * settings pages: what the column shows before it has a figure, and where
 * the choice of laps is. That choice sits on the Options tab because both
 * columns share it, so each column's own row says where to find it.
 */
export const lapAverageHint = (
  laps: number,
  over: LapAverageLaps | undefined
): string =>
  `Reads -- until a car has ${laps} ${
    over === 'all' ? 'timed' : 'clean'
  } laps. Which laps count is set under Options, Lap Averages.`;
