import { describe, expect, it } from 'vitest';
import { isOnOutLap } from './outLap';

describe('isOnOutLap', () => {
  it('is the lap the car was on when it was last in the pit lane', () => {
    expect(isOnOutLap({ onPitRoad: false, lastPitLap: 12, lastLap: 12 })).toBe(
      true
    );
  });

  it('is over once the car has crossed the line', () => {
    expect(isOnOutLap({ onPitRoad: false, lastPitLap: 12, lastLap: 13 })).toBe(
      false
    );
  });

  it('is not yet while the car is still in the lane', () => {
    expect(isOnOutLap({ onPitRoad: true, lastPitLap: 12, lastLap: 12 })).toBe(
      false
    );
  });

  it('is nothing for a car that has not been in the pit lane', () => {
    expect(isOnOutLap({ onPitRoad: false, lastLap: 12 })).toBe(false);
    expect(isOnOutLap({ onPitRoad: false, lastPitLap: 0, lastLap: 0 })).toBe(
      false
    );
  });

  it('lasts a lap longer where the pit exit is just before the line', () => {
    const car = { onPitRoad: false, lastPitLap: 12, lastLap: 13 };
    expect(isOnOutLap({ ...car, pitExitAfterSF: true })).toBe(true);
    expect(isOnOutLap({ ...car, pitExitAfterSF: false })).toBe(false);
    expect(isOnOutLap({ ...car, lastLap: 14, pitExitAfterSF: true })).toBe(
      false
    );
  });

  it('is nothing for a car that is not in the world', () => {
    expect(
      isOnOutLap({
        onPitRoad: false,
        lastPitLap: 12,
        lastLap: 12,
        carTrackSurface: -1,
      })
    ).toBe(false);
  });
});
