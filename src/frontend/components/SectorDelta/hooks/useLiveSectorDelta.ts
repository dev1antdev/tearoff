import { useMemo } from 'react';
import {
  useSectorTimingStore,
  useReferenceLapStore,
  useTrackStateSnapshot,
  useDriverCarIdx,
  useGhostReferenceLap,
} from '@irdashies/context';
import { calculateReferenceDelta } from '@irdashies/domain';

/**
 * Returns a live delta (seconds) for the current sector vs the reference lap.
 *
 * Compares the player's elapsed time since sector entry against the reference
 * lap's interpolated elapsed time at the same track position. Positive = behind
 * the reference, negative = ahead.
 *
 * Automatically selects the best available reference lap: prefers the player's
 * in-session personal best, falling back to the ghost lap -- the reference
 * of the player's class, or without one the player's own all-time lap.
 *
 * Returns null when no reference data is available or the current sector entry
 * is invalid (reset/teleport).
 */
export const useLiveSectorDelta = (): number | null => {
  // 4dp matches the reference-lap interpolation step (REFERENCE_INTERVAL = 0.0025);
  // 2dp on SessionTime gives 10ms resolution which exceeds the 0.1s display.
  const trackState = useTrackStateSnapshot();
  const lapDistPct = Math.round((trackState?.lapDistPct ?? 0) * 10000) / 10000;
  const sessionTime = Math.round((trackState?.sessionTime ?? 0) * 100) / 100;

  const sectorEntryTime = useSectorTimingStore((s) => s.sectorEntryTime);
  const sectorEntryValid = useSectorTimingStore((s) => s.sectorEntryValid);
  const currentSectorIdx = useSectorTimingStore((s) => s.currentSectorIdx);
  const sectors = useSectorTimingStore((s) => s.sectors);

  const playerCarIdx = useDriverCarIdx();
  const sessionBestLap = useReferenceLapStore((s) =>
    playerCarIdx != null ? (s.bestLaps.get(playerCarIdx) ?? null) : null
  );
  const ghostLap = useGhostReferenceLap();

  return useMemo(() => {
    if (!sectorEntryValid) return null;

    const refLap = sessionBestLap ?? ghostLap;

    if (!refLap || refLap.finishTime < 0) return null;

    const sectorStart = sectors[currentSectorIdx]?.SectorStartPct ?? 0;
    const ghostElapsed = calculateReferenceDelta(
      refLap,
      lapDistPct,
      sectorStart
    );
    const playerElapsed = sessionTime - sectorEntryTime;

    return playerElapsed - ghostElapsed;
  }, [
    sectorEntryValid,
    sessionBestLap,
    ghostLap,
    sectors,
    currentSectorIdx,
    lapDistPct,
    sessionTime,
    sectorEntryTime,
  ]);
};
