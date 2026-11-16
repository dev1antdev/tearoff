import { describe, expect, it } from 'vitest';
import { averageOfLastLaps } from './lapAverage';

describe('averageOfLastLaps', () => {
  it('is the mean of the last laps, oldest first in the history', () => {
    expect(averageOfLastLaps([100, 90, 91, 92, 93, 94], 5)).toBe(92);
    // The newest lap alone.
    expect(averageOfLastLaps([100, 90, 91], 1)).toBe(91);
  });

  it('takes the whole history when it holds exactly that many', () => {
    expect(averageOfLastLaps([90, 91, 92, 93, 94], 5)).toBe(92);
  });

  it('gives nothing, not a partial average, until there are enough laps', () => {
    expect(averageOfLastLaps([90, 91, 92, 93], 5)).toBeNull();
    expect(averageOfLastLaps([], 5)).toBeNull();
    expect(averageOfLastLaps([], 1)).toBeNull();
    expect(averageOfLastLaps(undefined, 5)).toBeNull();
  });

  it('gives the two windows of one car independently', () => {
    const history = [95, 95, 95, 95, 90, 91, 92, 93, 94];
    expect(averageOfLastLaps(history, 5)).toBe(92);
    // Nine laps: enough for five, not for ten.
    expect(averageOfLastLaps(history, 10)).toBeNull();
    expect(averageOfLastLaps([...history, 95], 10)).toBeCloseTo(93.5, 9);
  });

  it('passes over an entry that is not a lap time and reaches further back', () => {
    // 0 and -1 are "no time"; the three laps around them are the last three.
    expect(averageOfLastLaps([90, 0, 91, -1, 92], 3)).toBe(91);
    expect(
      averageOfLastLaps([90, Number.NaN, 91, Number.POSITIVE_INFINITY, 92], 3)
    ).toBe(91);
  });

  it('does not count such an entry towards the laps needed', () => {
    // Five entries, four lap times.
    expect(averageOfLastLaps([90, 91, -1, 92, 93], 5)).toBeNull();
    expect(averageOfLastLaps([0, 0, 0], 1)).toBeNull();
  });

  it('has no average for a count that is not a whole number of laps', () => {
    const history = [90, 91, 92];
    for (const count of [0, -3, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(averageOfLastLaps(history, count)).toBeNull();
    }
  });

  it('leaves the history as it was', () => {
    const history = Object.freeze([90, -1, 91, 92]);
    expect(averageOfLastLaps(history, 3)).toBe(91);
    expect(history).toEqual([90, -1, 91, 92]);
  });
});
