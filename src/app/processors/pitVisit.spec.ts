import { describe, expect, it } from 'vitest';
import {
  isPitLapVisit,
  isStandingStill,
  isStopVisit,
  Standstill,
} from './pitVisit';

describe('what a pit visit counts as', () => {
  it('is a stop after more than a second at rest, and a pit lap after more than two in the lane', () => {
    expect(isStopVisit(1)).toBe(false);
    expect(isStopVisit(1.01)).toBe(true);
    expect(isPitLapVisit(2)).toBe(false);
    expect(isPitLapVisit(2.01)).toBe(true);
  });

  it('holds a car at rest from below 0.5 m/s until it is above 1 m/s again', () => {
    expect(isStandingStill(false, 0.6)).toBe(false);
    expect(isStandingStill(false, 0.4)).toBe(true);
    // Creeping in the box: still at rest.
    expect(isStandingStill(true, 0.9)).toBe(true);
    expect(isStandingStill(true, 1.1)).toBe(false);
    // Reversing counts by its pace, not its sign.
    expect(isStandingStill(false, -0.2)).toBe(true);
  });

  it('agrees with the standstill the stint record keeps', () => {
    const standstill = new Standstill();
    let standing = false;
    const speeds = [20, 3, 0.4, 0, 0.8, 0.9, 1.2, 15];
    speeds.forEach((speed, index) => {
      standstill.update(speed, index);
      standing = isStandingStill(standing, speed);
      expect(standstill.isStanding, `speed ${speed}`).toBe(standing);
    });
    // At rest from the third reading until the seventh took it away.
    expect(standstill.seconds).toBe(4);
  });
});
