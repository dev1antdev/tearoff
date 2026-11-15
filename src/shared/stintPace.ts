/**
 * The two pace figures of a stint that follow from the three that are kept:
 * the mean of the clean laps other than the best, less the best; and the
 * best over that mean.
 *
 * In one place because the stint tracker works them out as a stint runs and
 * the lap library works them out again when it reads a stint back, and the
 * two must give the same figures for the same stint.
 */
export interface StintPace {
  /** Seconds: the mean of the clean laps other than the best, less the best. */
  paceDelta: number | null;
  /** Best lap over the mean of the other clean laps, 0..1. */
  consistency: number | null;
}

export const stintPace = (
  bestLap: number | null,
  avgLap: number | null,
  cleanLaps: number
): StintPace => {
  if (bestLap === null || avgLap === null || cleanLaps < 2) {
    return { paceDelta: null, consistency: null };
  }
  const others = (avgLap * cleanLaps - bestLap) / (cleanLaps - 1);
  if (!(others > 0)) return { paceDelta: null, consistency: null };
  return { paceDelta: others - bestLap, consistency: bestLap / others };
};
