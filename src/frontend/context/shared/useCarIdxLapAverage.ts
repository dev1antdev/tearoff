import { useMemo } from 'react';
import { averageOfLastLaps } from '@irdashies/shared';
import type { LapAverageLaps } from '@irdashies/types';
import { useLapTimeHistory } from '../LapTimesStore/LapTimesStore';

// One reference for "nothing to show", so a switched-off column never hands
// its rows a new array.
const NO_AVERAGES: (number | null)[] = [];

/**
 * Each car's average lap time over its last `count` laps, by car index, in
 * seconds: null for a car that does not have `count` such laps yet. See
 * `averageOfLastLaps` for the rule.
 *
 * `laps` chooses the history: every lap that has a time, or the clean ones
 * only. A source that publishes no clean history has no clean average to
 * give, so every car reads null there rather than quietly falling back to
 * all laps under the "clean" heading.
 *
 * Needs `useLapTimesStoreUpdater` running in the widget, like every reader
 * of the lap-time store. Empty while `enabled` is false.
 */
export const useCarIdxLapAverage = (
  count: number,
  laps: LapAverageLaps,
  enabled = true
): (number | null)[] => {
  const histories = useLapTimeHistory(laps === 'clean');

  return useMemo(
    () =>
      enabled
        ? histories.map((history) => averageOfLastLaps(history, count))
        : NO_AVERAGES,
    [histories, count, enabled]
  );
};
