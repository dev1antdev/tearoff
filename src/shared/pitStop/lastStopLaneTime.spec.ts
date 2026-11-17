import { describe, expect, it } from 'vitest';
import {
  CAR_PIT_IN_LANE,
  CAR_PIT_ON_TRACK,
  type CarPitSnapshot,
} from '@irdashies/types';
import { lastStopLaneTimeS } from './lastStopLaneTime';

/** One car, slot 0. */
const carPit = (values: {
  where?: number;
  laneTimeS?: number;
  lastPitLap?: number;
  lastStopLap?: number;
}): Pick<
  CarPitSnapshot,
  'where' | 'laneTimeS' | 'lastPitLap' | 'lastStopLap'
> => ({
  where: [values.where ?? CAR_PIT_ON_TRACK],
  laneTimeS: [values.laneTimeS ?? 0],
  lastPitLap: [values.lastPitLap ?? -1],
  lastStopLap: [values.lastStopLap ?? -1],
});

describe('lastStopLaneTimeS', () => {
  it('is the time of the last pass down the lane when that pass was the last stop', () => {
    expect(
      lastStopLaneTimeS(
        carPit({ laneTimeS: 45.1, lastPitLap: 20, lastStopLap: 20 }),
        0
      )
    ).toBe(45.1);
    // Boxes past the line: the stop is counted a lap after the entry.
    expect(
      lastStopLaneTimeS(
        carPit({ laneTimeS: 45.1, lastPitLap: 20, lastStopLap: 21 }),
        0
      )
    ).toBe(45.1);
  });

  it('is not known once a drive-through has replaced it', () => {
    // A stop on lap 20, then a penalty served on lap 31: the lane time is
    // the drive-through's.
    expect(
      lastStopLaneTimeS(
        carPit({ laneTimeS: 24.6, lastPitLap: 31, lastStopLap: 20 }),
        0
      )
    ).toBeNull();
  });

  it('is not known while the car is in the lane, where it is still growing', () => {
    expect(
      lastStopLaneTimeS(
        carPit({
          where: CAR_PIT_IN_LANE,
          laneTimeS: 12.3,
          lastPitLap: 20,
          lastStopLap: 20,
        }),
        0
      )
    ).toBeNull();
  });

  it('is not known for a car that has passed down the lane and never stopped', () => {
    expect(
      lastStopLaneTimeS(carPit({ laneTimeS: 24.6, lastPitLap: 31 }), 0)
    ).toBeNull();
    expect(lastStopLaneTimeS(carPit({}), 0)).toBeNull();
    expect(lastStopLaneTimeS(undefined, 0)).toBeNull();
    expect(lastStopLaneTimeS(carPit({ laneTimeS: 45.1 }), 7)).toBeNull();
  });
});
