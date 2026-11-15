import { describe, expect, it } from 'vitest';
import type { Session } from '@irdashies/types';
import { carClassesFrom, isFasterClass } from './carClass';

const session = (
  drivers: {
    idx: number;
    classId: number;
    relSpeed?: number;
    estLap?: number;
  }[]
): Session =>
  ({
    DriverInfo: {
      Drivers: drivers.map((driver) => ({
        CarIdx: driver.idx,
        CarClassID: driver.classId,
        CarClassRelSpeed: driver.relSpeed ?? 0,
        CarClassEstLapTime: driver.estLap ?? 0,
      })),
    },
  }) as unknown as Session;

describe('car classes for processors', () => {
  it('indexes the session’s classes by car slot', () => {
    const classes = carClassesFrom(
      session([
        { idx: 0, classId: 3, relSpeed: 1 },
        { idx: 4, classId: 1, relSpeed: 5, estLap: 92.5 },
      ])
    );

    expect(classes[0]).toEqual({ classId: 3, relSpeed: 1, estLapTime: 0 });
    expect(classes[4]).toEqual({ classId: 1, relSpeed: 5, estLapTime: 92.5 });
    expect(classes[2]).toBeUndefined();
  });

  it('has nothing to say without a session', () => {
    expect(carClassesFrom(null)).toEqual([]);
    expect(carClassesFrom({} as Session)).toEqual([]);
  });

  it('ranks classes by the relative speed the session states', () => {
    const classes = carClassesFrom(
      session([
        { idx: 0, classId: 3, relSpeed: 1 },
        { idx: 1, classId: 1, relSpeed: 5 },
      ])
    );

    expect(isFasterClass(classes, 1, 0)).toBe(true);
    expect(isFasterClass(classes, 0, 1)).toBe(false);
  });

  it('falls back to the class lap time where no relative speed is stated', () => {
    const classes = carClassesFrom(
      session([
        { idx: 0, classId: 3, estLap: 100 },
        { idx: 1, classId: 1, estLap: 90 },
      ])
    );

    expect(isFasterClass(classes, 1, 0)).toBe(true);
    expect(isFasterClass(classes, 0, 1)).toBe(false);
  });

  it('never calls a car of the same class faster', () => {
    // Even with figures that differ, as an estimated lap can between two
    // cars of one class.
    const classes = carClassesFrom(
      session([
        { idx: 0, classId: 3, relSpeed: 1, estLap: 100 },
        { idx: 1, classId: 3, relSpeed: 2, estLap: 95 },
      ])
    );

    expect(isFasterClass(classes, 1, 0)).toBe(false);
    expect(isFasterClass(classes, 0, 1)).toBe(false);
  });

  it('does not rank a car the session does not list', () => {
    const classes = carClassesFrom(session([{ idx: 0, classId: 3 }]));

    expect(isFasterClass(classes, 7, 0)).toBe(false);
    expect(isFasterClass(classes, 0, 7)).toBe(false);
  });

  it('cannot rank two classes that state nothing', () => {
    const classes = carClassesFrom(
      session([
        { idx: 0, classId: 3 },
        { idx: 1, classId: 1 },
      ])
    );

    expect(isFasterClass(classes, 1, 0)).toBe(false);
  });
});
