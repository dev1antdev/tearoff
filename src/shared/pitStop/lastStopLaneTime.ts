import type { CarPitSnapshot } from '@irdashies/types';
import { CAR_PIT_IN_LANE } from '../../types/channels/carPit';

/**
 * The pit lane time of a car's last stop, s; null where it is not known.
 *
 * `laneTimeS` is the time of the car's last pass down the lane, whatever it
 * was. It is the last stop's only once the car is out of the lane again,
 * and only until a later pass that was not a stop replaces it: a
 * drive-through, or a brush with the entry line. A pass is noted as the car
 * enters the lane and a stop as it comes to rest, which where the boxes are
 * past the line is a lap later, so the pass is the stop's while it is not
 * after it.
 */
export const lastStopLaneTimeS = (
  carPit:
    | Pick<CarPitSnapshot, 'where' | 'laneTimeS' | 'lastPitLap' | 'lastStopLap'>
    | undefined,
  carIdx: number
): number | null => {
  if (!carPit) return null;
  const lastStopLap = carPit.lastStopLap?.[carIdx] ?? -1;
  const laneS = carPit.laneTimeS?.[carIdx] ?? 0;
  return lastStopLap >= 0 &&
    carPit.where?.[carIdx] !== CAR_PIT_IN_LANE &&
    laneS > 0 &&
    (carPit.lastPitLap?.[carIdx] ?? -1) <= lastStopLap
    ? laneS
    : null;
};
