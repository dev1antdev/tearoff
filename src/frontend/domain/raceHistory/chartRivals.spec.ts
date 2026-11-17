import { describe, expect, it } from 'vitest';
import { RACE_FORECAST_MAX_CARS } from '@irdashies/types';
import {
  parseCarNumbers,
  rivalLines,
  rivalsAround,
  rivalsChosen,
  type ForecastPlace,
} from './chartRivals';

/** A class in the order of its places: car 10 first, the own car where said. */
const classOf = (cars: number, own: number): ForecastPlace[] =>
  Array.from({ length: cars }, (_, index) => ({
    carIdx: 10 + index,
    own: index === own,
    classPosition: index + 1,
  }));

describe('rivalsAround', () => {
  it('draws the leader, the car ahead and the car behind, in that order', () => {
    expect(rivalsAround(classOf(8, 4))).toEqual([
      { carIdx: 10, role: 'leader' },
      { carIdx: 13, role: 'ahead' },
      { carIdx: 15, role: 'behind' },
    ]);
  });

  it('draws the leader once where it is also the car ahead', () => {
    expect(rivalsAround(classOf(8, 1))).toEqual([
      { carIdx: 10, role: 'leader' },
      { carIdx: 12, role: 'behind' },
    ]);
  });

  it('draws only the car behind while we lead', () => {
    expect(rivalsAround(classOf(8, 0))).toEqual([
      { carIdx: 11, role: 'behind' },
    ]);
  });

  it('draws no car behind while we are last', () => {
    expect(rivalsAround(classOf(3, 2))).toEqual([
      { carIdx: 10, role: 'leader' },
      { carIdx: 11, role: 'ahead' },
    ]);
  });

  it('draws nobody for a class of one', () => {
    expect(rivalsAround(classOf(1, 0))).toEqual([]);
  });

  it('draws nobody while the forecast has no cars, or not our own', () => {
    expect(rivalsAround([])).toEqual([]);
    expect(rivalsAround(classOf(5, -1))).toEqual([]);
  });

  it('takes the first car for the leader where the sim places nobody', () => {
    const unplaced = classOf(5, 3).map((car) => ({ ...car, classPosition: 0 }));
    expect(rivalsAround(unplaced)[0]).toEqual({ carIdx: 10, role: 'leader' });
  });

  it('names no leader where the list begins further down the class', () => {
    // A class larger than the forecast carries: it lists the cars nearest us.
    const nearest = classOf(6, 3).map((car) => ({
      ...car,
      classPosition: car.classPosition + 20,
    }));
    expect(rivalsAround(nearest)).toEqual([
      { carIdx: 12, role: 'ahead' },
      { carIdx: 14, role: 'behind' },
    ]);
  });

  it('names no leader in a full list that places nobody', () => {
    const full = classOf(RACE_FORECAST_MAX_CARS, 30).map((car) => ({
      ...car,
      classPosition: 0,
    }));
    expect(rivalsAround(full).map((rival) => rival.role)).toEqual([
      'ahead',
      'behind',
    ]);
  });

  it('calls the car ahead plainly that where it is not known to lead', () => {
    const nearest = classOf(4, 1).map((car) => ({
      ...car,
      classPosition: car.classPosition + 7,
    }));
    expect(rivalsAround(nearest)).toEqual([
      { carIdx: 10, role: 'ahead' },
      { carIdx: 12, role: 'behind' },
    ]);
  });
});

describe('parseCarNumbers', () => {
  it('splits at commas, semicolons and spaces', () => {
    expect(parseCarNumbers('46, 91;33')).toEqual(['46', '91', '33']);
    expect(parseCarNumbers('  46   91 ')).toEqual(['46', '91']);
  });

  it('drops a leading # and a number named twice', () => {
    expect(parseCarNumbers('#46, 46, #91')).toEqual(['46', '91']);
  });

  it('keeps no more than three', () => {
    expect(parseCarNumbers('1 2 3 4 5')).toEqual(['1', '2', '3']);
  });

  it('keeps a number as it was typed', () => {
    expect(parseCarNumbers('07, 7')).toEqual(['07', '7']);
  });

  it('is empty for nothing typed', () => {
    expect(parseCarNumbers('')).toEqual([]);
    expect(parseCarNumbers(' , ;')).toEqual([]);
    expect(parseCarNumbers(undefined)).toEqual([]);
  });
});

describe('rivalsChosen', () => {
  const driver = (CarIdx: number, CarNumber: string, extra = {}) => ({
    CarIdx,
    CarNumber,
    CarIsPaceCar: 0,
    IsSpectator: 0,
    ...extra,
  });
  const drivers = [
    driver(0, '0', { CarIsPaceCar: 1 }),
    driver(1, '46'),
    driver(2, '77'),
    driver(3, '91'),
    driver(4, '007'),
    driver(5, '12', { IsSpectator: 1 }),
    driver(6, '8A'),
  ];

  it('draws the cars named, in the order named', () => {
    expect(rivalsChosen(['91', '46'], drivers, 2)).toEqual([
      { carIdx: 3, role: 'chosen' },
      { carIdx: 1, role: 'chosen' },
    ]);
  });

  it('leaves out a number no car carries, and our own', () => {
    expect(rivalsChosen(['5', '77', '46'], drivers, 2)).toEqual([
      { carIdx: 1, role: 'chosen' },
    ]);
  });

  it('leaves out the pace car and a spectator', () => {
    expect(rivalsChosen(['0', '12'], drivers, 2)).toEqual([]);
  });

  it('tells 007 from 7, and not 8a from 8A', () => {
    expect(rivalsChosen(['7'], drivers, 2)).toEqual([]);
    expect(rivalsChosen(['007', '8a'], drivers, 2)).toEqual([
      { carIdx: 4, role: 'chosen' },
      { carIdx: 6, role: 'chosen' },
    ]);
  });

  it('draws nobody without a session', () => {
    expect(rivalsChosen(['46'], undefined, null)).toEqual([]);
  });
});

describe('rivalLines', () => {
  const NONE = new Map<number, number>();

  it('hands out the lines in the order the cars come', () => {
    expect([...rivalLines(NONE, [10, 13, 15])]).toEqual([
      [10, 0],
      [13, 1],
      [15, 2],
    ]);
  });

  it('keeps a car on its line when the cars around us change', () => {
    const before = rivalLines(NONE, [10, 13, 15]);
    // We pass car 13: it is now the car behind, and 12 the car ahead.
    const after = rivalLines(before, [10, 12, 13]);
    expect(after.get(10)).toBe(0);
    expect(after.get(13)).toBe(1);
    // The line the car that went had.
    expect(after.get(12)).toBe(2);
  });

  it('gives a car that comes in the first line that is free', () => {
    const before = rivalLines(NONE, [10, 13, 15]);
    const after = rivalLines(before, [13, 15]);
    expect([...after]).toEqual([
      [13, 1],
      [15, 2],
    ]);
    expect(rivalLines(after, [13, 15, 20]).get(20)).toBe(0);
  });

  it('hands back the same lines while the same cars are drawn', () => {
    const before = rivalLines(NONE, [10, 13]);
    expect(rivalLines(before, [13, 10])).toBe(before);
    expect(rivalLines(NONE, [])).toBe(NONE);
  });

  it('never draws more than three', () => {
    expect(rivalLines(NONE, [1, 2, 3, 4, 5]).size).toBe(3);
  });
});
