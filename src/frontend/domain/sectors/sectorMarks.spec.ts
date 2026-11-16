import { describe, expect, it } from 'vitest';
import type { CarSectorsSnapshot } from '@irdashies/types';
import { carSectorMarks, NO_SECTOR_MARKS, sectorMarkTone } from './sectorMarks';

describe('sectorMarkTone', () => {
  it('is none without a time', () => {
    expect(sectorMarkTone(null, 29.4, 29.2)).toBe('none');
    expect(sectorMarkTone(undefined, 29.4, 29.2)).toBe('none');
    expect(sectorMarkTone(0, 29.4, 29.2)).toBe('none');
    expect(sectorMarkTone(-1, 29.4, 29.2)).toBe('none');
    expect(sectorMarkTone(Number.NaN, 29.4, 29.2)).toBe('none');
  });

  it('is the best of the class when the time is that best', () => {
    expect(sectorMarkTone(29.2, 29.2, 29.2)).toBe('classBest');
  });

  it('is the car’s own best when somebody else of the class was quicker', () => {
    expect(sectorMarkTone(29.4, 29.4, 29.2)).toBe('ownBest');
  });

  it('is slower when the car has done the sector quicker itself', () => {
    expect(sectorMarkTone(29.9, 29.4, 29.2)).toBe('slower');
    // Even by a millisecond.
    expect(sectorMarkTone(29.401, 29.4, 29.2)).toBe('slower');
  });

  it('puts the class best before the car’s own, which it also is', () => {
    expect(sectorMarkTone(29.2, 29.2, 29.2)).toBe('classBest');
  });

  it('takes a time with nothing to hold it against as the car’s own best', () => {
    expect(sectorMarkTone(29.4, null, null)).toBe('ownBest');
    expect(sectorMarkTone(29.4, undefined, undefined)).toBe('ownBest');
  });

  it('holds a time against the car’s own best where the class has none', () => {
    expect(sectorMarkTone(29.4, 29.4, null)).toBe('ownBest');
    expect(sectorMarkTone(29.9, 29.4, null)).toBe('slower');
  });
});

describe('carSectorMarks', () => {
  /**
   * Three cars. Cars 0 and 1 are of class 7, car 2 of class 9.
   *
   * - Car 0 finished a lap of 29.4 / 30.5 / 17.5 and has since done a first
   *   sector of 29.2, the best of the class.
   * - Car 1 finished a lap and has done nothing of the next: its second
   *   sector is the class's best, its first its own best, its third slower
   *   than it has gone before.
   * - Car 2 has one sector, on its first lap.
   */
  const snapshot: CarSectorsSnapshot = {
    available: true,
    current: [29.2, null, null, null, null, null, 33.1, null, null],
    last: [29.4, 30.5, 17.5, 29.6, 30.2, 17.9, null, null, null],
    best: [29.2, 30.5, 17.5, 29.6, 30.2, 17.6, 33.1, null, null],
    classIds: [9, 7],
    classBest: [33.1, null, null, 29.2, 30.2, 17.5],
    sessionNum: 0,
    version: 4,
  };

  it('takes this lap’s time for a sector that is done, and the last lap’s for the rest', () => {
    // S1 is the 29.2 just driven; S2 and S3 are still the lap before's.
    expect(carSectorMarks(snapshot, 0, 7)).toEqual([
      'classBest',
      'ownBest',
      'classBest',
    ]);
  });

  it('shows the finished lap whole before the next has a sector', () => {
    expect(carSectorMarks(snapshot, 1, 7)).toEqual([
      'ownBest',
      'classBest',
      'slower',
    ]);
  });

  it('leaves a sector not driven yet without a mark', () => {
    expect(carSectorMarks(snapshot, 2, 9)).toEqual([
      'classBest',
      'none',
      'none',
    ]);
  });

  it('holds a car against its own class and no other', () => {
    // Car 2's 33.1 is nothing special among the cars of class 7.
    expect(carSectorMarks(snapshot, 2, 7)).toEqual(['ownBest', 'none', 'none']);
  });

  it('still tells a car’s own best from a slower time when its class is not listed', () => {
    expect(carSectorMarks(snapshot, 1, 12)).toEqual([
      'ownBest',
      'ownBest',
      'slower',
    ]);
    expect(carSectorMarks(snapshot, 1, undefined)).toEqual([
      'ownBest',
      'ownBest',
      'slower',
    ]);
  });

  it('gives one shared list of nothing where there is nothing', () => {
    expect(carSectorMarks(undefined, 0, 7)).toBe(NO_SECTOR_MARKS);
    expect(carSectorMarks({ ...snapshot, available: false }, 0, 7)).toBe(
      NO_SECTOR_MARKS
    );
    // A slot past the cars the channel holds, and no slot at all.
    expect(carSectorMarks(snapshot, 5, 7)).toBe(NO_SECTOR_MARKS);
    expect(carSectorMarks(snapshot, -1, 7)).toBe(NO_SECTOR_MARKS);
    expect(NO_SECTOR_MARKS).toEqual(['none', 'none', 'none']);
  });
});
