import { describe, expect, it } from 'vitest';
import {
  sectorCardReading,
  sectorEndReading,
  sectorReference,
  sectorSum,
  targetFreezeSeconds,
  type SectorReferenceSources,
} from './sectorTargets';

const sources = (
  overrides: Partial<SectorReferenceSources> = {}
): SectorReferenceSources => ({
  ghost: null,
  sessionBestSectorTimes: [32.461, 35.07, 18.851],
  previousSessionBestSectorTimes: [32.739, 35.357, 19.007],
  sessionBestLapSectorTimes: [32.739, 35.07, 18.851],
  allTime: {
    bestSectorTimes: [32, 35.07, 18],
    previousBestSectorTimes: [null, 35.357, null],
    bestLapSectorTimes: [32.5, 35.2, 18.4],
  },
  ...overrides,
});

describe('sectorSum', () => {
  it('is the time to the end of a sector', () => {
    expect(sectorSum([30, 40, 20], 1)).toBe(70);
  });

  it('is null as soon as one part is missing', () => {
    expect(sectorSum([30, null, 20], 2)).toBeNull();
  });

  it('is the theoretical best where the times are the best of each sector', () => {
    expect(sectorSum(sources().sessionBestSectorTimes)).toBeCloseTo(86.382, 3);
    expect(sectorSum(sources().sessionBestLapSectorTimes)).toBeCloseTo(
      86.66,
      3
    );
  });
});

describe('sectorReference', () => {
  it('names the best sectors of the session TB', () => {
    const reference = sectorReference('session-best-only', sources());

    expect(reference.label).toBe('TB');
    expect(reference.times).toEqual([32.461, 35.07, 18.851]);
    expect(reference.previousTimes).toEqual([32.739, 35.357, 19.007]);
  });

  it('names a best lap PB, of the session or of all time', () => {
    const session = sectorReference('session-best-lap', sources());
    expect(session.label).toBe('PB');
    expect(session.times).toEqual([32.739, 35.07, 18.851]);

    const allTime = sectorReference('all-time-best-lap', sources());
    expect(allTime.label).toBe('PB');
    expect(allTime.times).toEqual([32.5, 35.2, 18.4]);
  });

  it('names the all-time best sectors TB, with what each replaced', () => {
    const reference = sectorReference('all-time-best', sources());

    expect(reference.label).toBe('TB');
    expect(reference.times).toEqual([32, 35.07, 18]);
    expect(reference.previousTimes).toEqual([null, 35.357, null]);
  });

  it('uses the ghost when there is one and the session bests when not', () => {
    const ghost = [33, 36, 19];
    const withGhost = sectorReference('prefer-ghost', sources({ ghost }));
    expect(withGhost.label).toBe('REF');
    expect(withGhost.times).toBe(ghost);

    const without = sectorReference('prefer-ghost', sources());
    expect(without.label).toBe('TB');
    expect(without.times).toEqual([32.461, 35.07, 18.851]);
  });

  it('leaves the ghost alone unless the ghost was asked for', () => {
    const ghost = [33, 36, 19];
    for (const comparison of [
      'session-best-only',
      'session-best-lap',
      'all-time-best',
      'all-time-best-lap',
    ] as const) {
      expect(sectorReference(comparison, sources({ ghost })).times).not.toBe(
        ghost
      );
    }
  });

  it('has nothing to compare with before the all-time bests are read', () => {
    for (const comparison of ['all-time-best', 'all-time-best-lap'] as const) {
      const reference = sectorReference(comparison, sources({ allTime: null }));

      expect(reference.times).toEqual([]);
      expect(sectorSum(reference.times, 0)).toBeNull();
    }
  });

  it('reads a setting it does not know as the session bests', () => {
    expect(sectorReference('lifetime' as never, sources()).times).toEqual([
      32.461, 35.07, 18.851,
    ]);
  });
});

describe('sectorCardReading', () => {
  const allTime = sectorReference('all-time-best', sources());

  it('compares a time with the best of its sector', () => {
    expect(sectorCardReading(32.6, allTime, 0)).toEqual({
      referenceTime: 32,
      isBest: false,
    });
  });

  it('compares a time that has just become the best with the one before', () => {
    expect(sectorCardReading(35.07, allTime, 1)).toEqual({
      referenceTime: 35.357,
      isBest: true,
    });
  });

  it('has nothing to compare a first-ever best with', () => {
    // The best is this time, and nothing stood before it.
    expect(sectorCardReading(32, allTime, 0)).toEqual({
      referenceTime: null,
      isBest: true,
    });
  });

  it('compares a quicker time that is not the best with the best', () => {
    // A sector with an incident in it: shown, and not kept as a best.
    expect(sectorCardReading(17.5, allTime, 2)).toEqual({
      referenceTime: 18,
      isBest: true,
    });
  });

  it('compares the sector of a best lap with itself where it is that lap', () => {
    const bestLap = sectorReference('session-best-lap', sources());

    expect(sectorCardReading(35.07, bestLap, 1)).toEqual({
      referenceTime: 35.07,
      isBest: true,
    });
  });

  it('has no reading without a time or without a reference', () => {
    expect(sectorCardReading(null, allTime, 0)).toEqual({
      referenceTime: 32,
      isBest: false,
    });
    const none = sectorReference('all-time-best', sources({ allTime: null }));
    expect(sectorCardReading(32.6, none, 0)).toEqual({
      referenceTime: null,
      isBest: false,
    });
  });
});

describe('targetFreezeSeconds', () => {
  it('is the setting where the sector entered is long enough', () => {
    expect(targetFreezeSeconds(5, 35.07)).toBe(5);
  });

  it('is never more than half the previous time of the sector entered', () => {
    expect(targetFreezeSeconds(5, 6)).toBe(3);
    expect(targetFreezeSeconds(10, 18.851)).toBeCloseTo(9.4255, 4);
  });

  it('is three seconds at most where that time is not known', () => {
    expect(targetFreezeSeconds(5, null)).toBe(3);
    expect(targetFreezeSeconds(2, null)).toBe(2);
  });

  it('is nothing when switched off, or for a setting that is no number', () => {
    expect(targetFreezeSeconds(0, 35)).toBe(0);
    expect(targetFreezeSeconds(-1, 35)).toBe(0);
    expect(targetFreezeSeconds(Number.NaN, 35)).toBe(0);
  });
});

describe('sectorEndReading', () => {
  const target = [32.461, 35.07, 18.851];

  it('is the lap to the end of the sector, and its gap to the target', () => {
    const reading = sectorEndReading([32.739, 35.357, null], target, 1);

    expect(reading.time).toBeCloseTo(68.096, 3);
    expect(reading.gap).toBeCloseTo(0.565, 3);
  });

  it('goes below zero for a lap that is ahead, a gain early on included', () => {
    // Three tenths found in the first sector and a tenth lost in the second:
    // still two tenths up, where a sum that stopped at the first gain would
    // have said nothing.
    const reading = sectorEndReading([32.161, 35.17, null], target, 1);

    expect(reading.gap).toBeCloseTo(-0.2, 3);
  });

  it('is the whole lap at the line', () => {
    const reading = sectorEndReading([32.739, 35.07, 18.851], target, 2);

    expect(reading.time).toBeCloseTo(86.66, 3);
    expect(reading.gap).toBeCloseTo(0.278, 3);
  });

  it('has no gap with a sector of the lap or of the target missing', () => {
    expect(sectorEndReading([null, 35.07, null], target, 1)).toEqual({
      time: null,
      gap: null,
    });
    const noTarget = sectorEndReading(
      [32.739, 35.07, null],
      [32.461, null, 18.851],
      1
    );
    expect(noTarget.time).toBeCloseTo(67.809, 3);
    expect(noTarget.gap).toBeNull();
  });
});
