import { useMemo } from 'react';
import {
  useDriverCarIdx,
  useSessionBarSelector,
  useSessionDrivers,
} from '@irdashies/context';
import type { SessionBarSnapshot } from '@irdashies/types';

const selectPlayerCarIdx = (snapshot: SessionBarSnapshot) =>
  snapshot.playerCarIdx;

export interface OwnCar {
  /** Its slot; null while it is not known, as for a spectator. */
  carIdx: number | null;
  /** Its class as the session numbers it; null while that is not known. */
  classId: number | null;
}

/**
 * Our car: the entry the user drives or shares, by the rule the Pit Wall's
 * header finds it with. The session bar's own car where it has one, which
 * under Le Mans Ultimate stays the team car while a team-mate drives it and
 * while the camera is on somebody else, and the session's own slot
 * otherwise.
 *
 * A widget that calls this reads `session-bar.snapshot` and the session.
 */
export const useOwnCar = (): OwnCar => {
  const barCarIdx = useSessionBarSelector(selectPlayerCarIdx);
  const sessionCarIdx = useDriverCarIdx();
  const drivers = useSessionDrivers();
  const found = barCarIdx ?? sessionCarIdx;
  const carIdx =
    typeof found === 'number' && found >= 0 ? Math.trunc(found) : null;

  return useMemo(() => {
    const entry =
      carIdx === null
        ? undefined
        : drivers?.find((driver) => driver.CarIdx === carIdx);
    return {
      carIdx,
      classId: typeof entry?.CarClassID === 'number' ? entry.CarClassID : null,
    };
  }, [carIdx, drivers]);
};
