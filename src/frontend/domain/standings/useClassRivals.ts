import { useMemo } from 'react';
import {
  useCarPitSnapshot,
  useDriverCarIdx,
  useLapHistorySnapshot,
  useRelativeGapsSnapshot,
  useSessionDrivers,
  useSessionType,
  useStandingsSnapshot,
} from '@irdashies/context';
import { buildClassRivals, type ClassRivals } from './classRivals';
import { useQualifyingResults } from './useQualifyingGrid';

export interface UseClassRivalsOptions {
  /** Decimal places of a gap in seconds. */
  decimalPlaces?: number;
  /**
   * Whether the line gaps are wanted: the gap over the line last lap, the
   * trend and the forecast. Off, the lap history is not subscribed to.
   */
  history?: boolean;
}

/**
 * The three rows of the rivals box: the class car ahead of the focus car,
 * the focus car, and the class car behind.
 *
 * The focus car is the one `standings.snapshot` names: the car being driven,
 * and while watching, the car the camera is on. Nothing is kept between
 * snapshots, so there is nothing to reset: every source it reads empties on
 * a session change and on disconnect.
 */
export const useClassRivals = ({
  decimalPlaces = 2,
  history = true,
}: UseClassRivalsOptions = {}): ClassRivals => {
  const standings = useStandingsSnapshot();
  const drivers = useSessionDrivers();
  const ownCarIdx = useDriverCarIdx();
  const sessionType = useSessionType(standings?.sessionNum ?? undefined);
  const qualifyingResults = useQualifyingResults();
  const carPit = useCarPitSnapshot();
  const lapHistory = useLapHistorySnapshot(history);
  const relativeGaps = useRelativeGapsSnapshot();
  const isRace = sessionType === 'Race';

  return useMemo(
    () =>
      buildClassRivals({
        standings,
        drivers,
        isRace,
        ownCarIdx,
        qualifyingResults,
        carPit,
        lapHistory: history ? lapHistory : undefined,
        relativeGaps,
        decimalPlaces,
      }),
    [
      standings,
      drivers,
      isRace,
      ownCarIdx,
      qualifyingResults,
      carPit,
      history,
      lapHistory,
      relativeGaps,
      decimalPlaces,
    ]
  );
};
