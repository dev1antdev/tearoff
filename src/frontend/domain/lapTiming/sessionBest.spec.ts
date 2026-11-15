import { describe, expect, it } from 'vitest';
import { sessionBestLapTime } from './sessionBest';

// Cars 0 and 1 are prototypes, 2 to 4 GT cars; the player drives car 3.
const carIdxClass = [10, 10, 20, 20, 20];
const bestLaps = [81.4, 82.0, 104.3, 104.054, 103.9];

describe('sessionBestLapTime', () => {
  it("is the fastest lap of the player's class by default", () => {
    expect(
      sessionBestLapTime({
        carIdxBestLapTime: bestLaps,
        carIdxClass,
        playerCarIdx: 3,
        scope: 'class',
      })
    ).toBe(103.9);
  });

  it('is the fastest lap of any car when asked for overall', () => {
    expect(
      sessionBestLapTime({
        carIdxBestLapTime: bestLaps,
        carIdxClass,
        playerCarIdx: 3,
        scope: 'overall',
      })
    ).toBe(81.4);
  });

  it('skips cars with no lap: zero under iRacing, -1 under LMU', () => {
    expect(
      sessionBestLapTime({
        carIdxBestLapTime: [0, -1, 104.3, 0, -1],
        carIdxClass,
        playerCarIdx: 3,
        scope: 'overall',
      })
    ).toBe(104.3);
  });

  it('is nothing until a car in scope has a lap', () => {
    expect(
      sessionBestLapTime({
        carIdxBestLapTime: [81.4, 82.0, 0, 0, 0],
        carIdxClass,
        playerCarIdx: 3,
        scope: 'class',
      })
    ).toBeNull();
    expect(
      sessionBestLapTime({
        carIdxBestLapTime: undefined,
        carIdxClass,
        playerCarIdx: 3,
        scope: 'overall',
      })
    ).toBeNull();
  });

  it("does not pass the overall best off as the class's", () => {
    // The session has not said which class the player is in.
    expect(
      sessionBestLapTime({
        carIdxBestLapTime: bestLaps,
        carIdxClass: [],
        playerCarIdx: 3,
        scope: 'class',
      })
    ).toBeNull();
    expect(
      sessionBestLapTime({
        carIdxBestLapTime: bestLaps,
        carIdxClass,
        playerCarIdx: undefined,
        scope: 'class',
      })
    ).toBeNull();
  });
});
