import { describe, expect, it } from 'vitest';
import {
  EMPTY_CLASS_TYRES,
  TREAD_ESTIMATE,
  TREAD_MEASURED,
  TREAD_NONE,
  TYRE_SET_AT_LEAST,
  TYRE_SET_LIKELY,
  TYRE_SET_SEEN,
  TYRE_SET_UNKNOWN,
  type ClassTyresSnapshot,
} from '@irdashies/types';
import {
  hasTreadFigures,
  tyreSetDisplay,
  wheelCompoundsByCar,
} from './tyreSetDisplay';

/** One car a row: laps on the set, how sure, the tread and where it is from. */
const snapshot = (
  ...cars: [laps: number, sure: number, tread: number, source: number][]
): ClassTyresSnapshot => ({
  ...EMPTY_CLASS_TYRES,
  ownCarIdx: 0,
  setLaps: cars.map((car) => car[0]),
  sure: cars.map((car) => car[1]),
  treadPct: cars.map((car) => car[2]),
  treadSource: cars.map((car) => car[3]),
  compounds: cars.flatMap(() => [1, 1, 1, 1]),
  version: 1,
});

describe('tyreSetDisplay', () => {
  it('writes a set seen to go on as bare laps, and its estimate with a ~', () => {
    expect(
      tyreSetDisplay(snapshot([17, TYRE_SET_SEEN, 86, TREAD_ESTIMATE]), 0)
    ).toMatchObject({ laps: '17', tread: '~86%', certainty: 'seen' });
  });

  it('marks laps told from the length of a stop with a ?', () => {
    expect(
      tyreSetDisplay(snapshot([17, TYRE_SET_LIKELY, 86, TREAD_ESTIMATE]), 0)
    ).toMatchObject({ laps: '17?', tread: '~86%', certainty: 'likely' });
  });

  it('marks laps that are a floor with a +, and the tread as no more than', () => {
    const display = tyreSetDisplay(
      snapshot([17, TYRE_SET_AT_LEAST, 86, TREAD_ESTIMATE]),
      0
    );
    expect(display).toMatchObject({
      laps: '17+',
      tread: '<86%',
      certainty: 'atLeast',
    });
    expect(display.title).toContain('At least 17 laps');
    expect(display.title).toContain('no more than about 86%');
  });

  it('writes a tread the sim reads without a mark, whatever the laps are', () => {
    expect(
      tyreSetDisplay(snapshot([17, TYRE_SET_SEEN, 86, TREAD_MEASURED]), 0)
    ).toMatchObject({ laps: '17', tread: '86%' });
    expect(
      tyreSetDisplay(snapshot([4, TYRE_SET_AT_LEAST, 97, TREAD_MEASURED]), 0)
    ).toMatchObject({ laps: '4+', tread: '97%' });
  });

  it('reads -- while there is no tread figure', () => {
    expect(
      tyreSetDisplay(snapshot([6, TYRE_SET_SEEN, -1, TREAD_NONE]), 0)
    ).toMatchObject({ laps: '6', tread: '--', certainty: 'seen' });
  });

  it('counts a set that has just gone on as none', () => {
    const display = tyreSetDisplay(
      snapshot(
        [0, TYRE_SET_SEEN, 100, TREAD_ESTIMATE],
        [1, TYRE_SET_SEEN, 99, TREAD_ESTIMATE]
      ),
      0
    );
    expect(display).toMatchObject({ laps: '0', tread: '~100%' });
    expect(
      tyreSetDisplay(snapshot([1, TYRE_SET_SEEN, 99, TREAD_ESTIMATE]), 0).title
    ).toContain('1 lap on this set');
  });

  it('writes nothing of a car nothing is said of', () => {
    const nothing = { laps: '', tread: '', certainty: null, title: '' };
    // Another class.
    expect(
      tyreSetDisplay(snapshot([-1, TYRE_SET_UNKNOWN, -1, TREAD_NONE]), 0)
    ).toEqual(nothing);
    // A slot the snapshot does not reach, and no snapshot at all.
    expect(
      tyreSetDisplay(snapshot([3, TYRE_SET_SEEN, 90, TREAD_ESTIMATE]), 7)
    ).toEqual(nothing);
    expect(tyreSetDisplay(undefined, 0)).toEqual(nothing);
    expect(tyreSetDisplay(EMPTY_CLASS_TYRES, 0)).toEqual(nothing);
  });
});

describe('hasTreadFigures', () => {
  it('says whether any car has one', () => {
    expect(
      hasTreadFigures(
        snapshot(
          [3, TYRE_SET_SEEN, -1, TREAD_NONE],
          [5, TYRE_SET_SEEN, 92, TREAD_MEASURED]
        )
      )
    ).toBe(true);
    // iRacing: laps for every car, and no tread for any.
    expect(
      hasTreadFigures(
        snapshot(
          [3, TYRE_SET_SEEN, -1, TREAD_NONE],
          [5, TYRE_SET_AT_LEAST, -1, TREAD_NONE]
        )
      )
    ).toBe(false);
    expect(hasTreadFigures(undefined)).toBe(false);
  });
});

describe('wheelCompoundsByCar', () => {
  it('cuts the flat list into four wheels a car', () => {
    const cars = wheelCompoundsByCar({
      ...EMPTY_CLASS_TYRES,
      compounds: [1, 1, 2, 2, -1, -1, -1, -1, 0, 0, 0, 0],
    });
    expect(cars).toEqual([
      [1, 1, 2, 2],
      [-1, -1, -1, -1],
      [0, 0, 0, 0],
    ]);
    expect(wheelCompoundsByCar(undefined)).toEqual([]);
  });
});
