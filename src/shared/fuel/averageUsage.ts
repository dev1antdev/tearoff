import type { FuelLapData } from '@irdashies/types';

export interface LapUsageAverageOptions {
  /** How many of the most recent laps that qualify to take; all of them without. */
  laps?: number;
  /**
   * Leave out laps through the pits, which run a different distance at a
   * different speed and would pull a stint's average off.
   */
  excludePitLaps?: boolean;
}

/**
 * What a lap costs, averaged over the laps the fuel projection has counted:
 * litres, or percent of the budget for a car on virtual energy.
 *
 * The laps are newest first, as `fuel.projection` publishes them, and only
 * the ones the projection itself judged usable are taken. 0 when there is
 * none, which every reader treats as "no figure yet".
 *
 * Here, and not beside one widget, because the fuel calculator, the pit
 * stop estimate and the fuel saver have to agree on it.
 */
export const averageLapUsage = (
  laps: readonly FuelLapData[],
  { laps: count, excludePitLaps = false }: LapUsageAverageOptions = {}
): number => {
  let sum = 0;
  let taken = 0;
  for (const lap of laps) {
    if (count !== undefined && taken >= count) break;
    if (!lap.isValidForCalc || !(lap.fuelUsed > 0)) continue;
    if (excludePitLaps && (lap.isOutLap || lap.isInLap === true)) continue;
    sum += lap.fuelUsed;
    taken += 1;
  }
  return taken > 0 ? sum / taken : 0;
};
