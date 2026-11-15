import { describe, expect, it } from 'vitest';
import {
  emptySectorBests,
  isQuickerLap,
  offerSectorTime,
  parseSectorBests,
  sectorBestsKey,
  sectorLayoutKey,
  sectorSum,
  SIM_SECTOR_LAYOUT,
} from './sectorBests';

describe('sectorSum', () => {
  it('adds the sectors up to and including the one named', () => {
    expect(sectorSum([30, 40, 20], 1)).toBe(70);
    expect(sectorSum([30, 40, 20], 0)).toBe(30);
  });

  it('adds the whole lap when no sector is named', () => {
    expect(sectorSum([32.739, 35.07, 18.851])).toBeCloseTo(86.66, 3);
  });

  it('is null as soon as one part is missing', () => {
    expect(sectorSum([30, null, 20], 2)).toBeNull();
    expect(sectorSum([30, null, 20], 0)).toBe(30);
    expect(sectorSum([30, undefined, 20])).toBeNull();
  });

  it('is null for a sector the lap does not have, and for no sectors', () => {
    expect(sectorSum([30, 40, 20], 3)).toBeNull();
    expect(sectorSum([30, 40, 20], -1)).toBeNull();
    expect(sectorSum([])).toBeNull();
  });

  it('takes a time that is zero, negative or not a number as missing', () => {
    expect(sectorSum([30, 0, 20])).toBeNull();
    expect(sectorSum([30, -1, 20])).toBeNull();
    expect(sectorSum([30, Number.NaN, 20])).toBeNull();
  });
});

describe('offerSectorTime', () => {
  it('takes the first time and any quicker one, and nothing else', () => {
    const bests = emptySectorBests(3).bestSectorTimes;

    expect(offerSectorTime(bests, 1, 35.357)).toBe(true);
    expect(offerSectorTime(bests, 1, 35.07)).toBe(true);
    expect(offerSectorTime(bests, 1, 35.07)).toBe(false);
    expect(offerSectorTime(bests, 1, 36)).toBe(false);

    expect(bests).toEqual([null, 35.07, null]);
  });

  it('refuses what is not a time, and a sector the lap does not have', () => {
    const bests = [32, 36, 18];

    expect(offerSectorTime(bests, 0, 0)).toBe(false);
    expect(offerSectorTime(bests, 0, -1)).toBe(false);
    expect(offerSectorTime(bests, 0, Number.NaN)).toBe(false);
    expect(offerSectorTime(bests, 3, 10)).toBe(false);
    expect(offerSectorTime(bests, -1, 10)).toBe(false);

    expect(bests).toEqual([32, 36, 18]);
  });
});

describe('isQuickerLap', () => {
  it('is any whole lap when there is no best lap yet', () => {
    expect(isQuickerLap([32, 35, 19], [null, null, null])).toBe(true);
  });

  it('compares the laps, not their sectors', () => {
    // Slower through the first sector and quicker round the lap.
    expect(isQuickerLap([33, 34, 18], [32, 35, 19])).toBe(true);
    expect(isQuickerLap([31, 36, 19.5], [32, 35, 19])).toBe(false);
    expect(isQuickerLap([32, 35, 19], [32, 35, 19])).toBe(false);
  });

  it('is never a lap with a sector missing, or of another layout', () => {
    expect(isQuickerLap([null, 30, 15], [32, 35, 19])).toBe(false);
    expect(isQuickerLap([30, 30], [32, 35, 19])).toBe(false);
  });
});

describe('the key sector bests are kept under', () => {
  it('names the simulator, the track, the car and the sector layout', () => {
    expect(
      sectorBestsKey('lmu', 1234, 'Ferrari 296 LMGT3 Evo', SIM_SECTOR_LAYOUT)
    ).toBe('lmu|1234|Ferrari 296 LMGT3 Evo|sim3');
  });

  it('tells one sector layout from another on the same track', () => {
    expect(sectorLayoutKey([0, 0.33333, 0.66667])).toBe(
      '3@0.0000,0.3333,0.6667'
    );
    expect(sectorLayoutKey([0, 0.5])).not.toBe(sectorLayoutKey([0, 0.51]));
    // The same boundaries as the session gives them from one day to the next.
    expect(sectorLayoutKey([0, 0.333331])).toBe(sectorLayoutKey([0, 0.333329]));
  });
});

describe('parseSectorBests', () => {
  it('reads back what was stored', () => {
    expect(
      parseSectorBests(
        {
          bestSectorTimes: [32.461, 35.07, 18.851],
          bestLapSectorTimes: [32.739, 35.07, 18.851],
        },
        3
      )
    ).toEqual({
      bestSectorTimes: [32.461, 35.07, 18.851],
      bestLapSectorTimes: [32.739, 35.07, 18.851],
    });
  });

  it('keeps the sectors there are and reads the rest as none', () => {
    expect(
      parseSectorBests(
        { bestSectorTimes: [32, null, 'fast'], bestLapSectorTimes: null },
        3
      )
    ).toEqual({
      bestSectorTimes: [32, null, null],
      bestLapSectorTimes: [null, null, null],
    });
  });

  it('has no best lap where the stored one has a sector missing', () => {
    expect(
      parseSectorBests(
        { bestSectorTimes: [32, 35, 18], bestLapSectorTimes: [32, null, 19] },
        3
      )?.bestLapSectorTimes
    ).toEqual([null, null, null]);
  });

  it('refuses a value that is not sector bests or is of another layout', () => {
    expect(parseSectorBests(undefined, 3)).toBeNull();
    expect(parseSectorBests(null, 3)).toBeNull();
    expect(parseSectorBests('32,35,18', 3)).toBeNull();
    expect(parseSectorBests({ bestSectorTimes: [32, 35] }, 3)).toBeNull();
    expect(parseSectorBests({ bestSectorTimes: [] }, 0)).toBeNull();
  });
});
