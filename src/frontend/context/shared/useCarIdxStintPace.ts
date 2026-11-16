import { useMemo } from 'react';
import { carStintPaceDelta } from '@irdashies/shared';
import type { StintPaceReference } from '@irdashies/types';
import { useRaceHistorySummarySnapshot } from '../ChannelStore/useRaceHistorySummarySnapshot';

// One reference for "nothing to show", so a switched-off column never hands
// its rows a new array.
const NO_PACE: readonly (number | null)[] = [];

/**
 * Each car's pace in the stint it is on against an earlier stint of its
 * own, by car index, in seconds: negative is quicker than before. Null for
 * a car with nothing to compare yet. See `stintPaceDelta` for the rule.
 *
 * `against` chooses the earlier stint: the one before, or the most recent
 * one somebody else drove.
 *
 * Reads `race-history.summary`, and reading it is what has the race
 * recorded. So while `enabled` is false nothing is subscribed to and the
 * result is empty: a column that is switched off costs no recording.
 */
export const useCarIdxStintPace = (
  against: StintPaceReference,
  enabled = true
): readonly (number | null)[] => {
  const summary = useRaceHistorySummarySnapshot(enabled);

  return useMemo(
    () =>
      enabled && summary
        ? summary.stintAvgLap.map((_, carIdx) =>
            carStintPaceDelta(summary, carIdx, against)
          )
        : NO_PACE,
    [summary, against, enabled]
  );
};
