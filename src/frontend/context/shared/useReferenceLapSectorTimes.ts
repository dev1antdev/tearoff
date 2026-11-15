import { useMemo } from 'react';
import type { ReferenceLap } from '@irdashies/types';
import { useSessionStore } from '../SessionStore/SessionStore';
import { useReferenceLapStore } from '../ReferenceLapStore/ReferenceLapStore';
import { useSectorTimingStore } from '../SectorTimingStore/SectorTimingStore';
import { interpolateAtPoint } from '@irdashies/utils/referenceLapInterpolation';
import { useActiveSimulator } from './useActiveSimulator';

/**
 * The lap the sector ghost is, or null when there is none.
 *
 * The class reference where the session has one for the player's class, as
 * an iRacing session does. Le Mans Ultimate has no class references, and
 * there the ghost is the player's own all-time lap on this track in this
 * car, from the lap library.
 *
 * Only there. An iRacing session whose class has no stored lap yet keeps to
 * the session's own bests, as it always has: its class lap arrives during
 * the session, and a ghost that was the player's lap until then would turn
 * into another car's mid-run.
 *
 * With neither, the sectors are compared against the session's own bests.
 */
export const useGhostReferenceLap = (): ReferenceLap | null => {
  const playerClassId = useSessionStore((s) => {
    const carIdx = s.session?.DriverInfo?.DriverCarIdx;
    const drivers = s.session?.DriverInfo?.Drivers;
    return drivers?.find((d) => d.CarIdx === carIdx)?.CarClassID ?? null;
  });

  // A selector for the lap itself, so this re-runs when the lap object
  // changes: once the stored laps have loaded, or the library has a new one.
  const ownLapStandsIn = useActiveSimulator() === 'lmu';
  return useReferenceLapStore(
    (s) =>
      (playerClassId != null ? s.persistedLaps.get(playerClassId) : null) ??
      (ownLapStandsIn ? s.playerAllTimeLap : null)
  );
};

/**
 * Derives per-sector times from the ghost reference lap (see
 * useGhostReferenceLap).  Returns the sector times and a flag indicating
 * whether a valid reference lap is available.
 *
 * Sector times are computed by interpolating the reference lap's
 * timeElapsedSinceStart at each sector-boundary trackPct, then diffing
 * adjacent boundary times.
 */
export const useReferenceLapSectorTimes = (): {
  refSectorTimes: (number | null)[];
  hasReferenceLap: boolean;
} => {
  const sectors = useSectorTimingStore((s) => s.sectors);
  const refLap = useGhostReferenceLap();

  return useMemo(() => {
    if (sectors.length === 0 || !refLap) {
      return { refSectorTimes: [], hasReferenceLap: false };
    }

    if (refLap.startTime < 0 || refLap.pointsCount === 0) {
      return { refSectorTimes: [], hasReferenceLap: false };
    }

    const lapTime = refLap.finishTime - refLap.startTime;
    if (lapTime <= 0) return { refSectorTimes: [], hasReferenceLap: false };

    // Time elapsed at each sector's start boundary.
    // Sector 0 always begins at the S/F line (elapsed = 0).
    const timesAtBoundary: (number | null)[] = sectors.map((sector, i) => {
      if (i === 0) return 0;
      return interpolateAtPoint(refLap, sector.SectorStartPct);
    });

    const refSectorTimes: (number | null)[] = sectors.map((_, i) => {
      const start = timesAtBoundary[i];
      const end = i < sectors.length - 1 ? timesAtBoundary[i + 1] : lapTime;
      if (start === null || end === null) return null;
      return end - start;
    });

    return { refSectorTimes, hasReferenceLap: true };
  }, [sectors, refLap]);
};
