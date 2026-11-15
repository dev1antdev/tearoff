import { describe, expect, it } from 'vitest';
import { lmuTimeBehindLeader, type LmuRaceGapFrame } from './raceGap';

interface Car {
  place: number;
  classId: number;
  classPosition: number;
  laps: number;
  /** Seconds into the lap, on the car's own estimated lap time. */
  into: number;
  estimate?: number;
  pct?: number;
  sim?: number;
}

/** A frame from a list of cars, slot by slot; null is an empty slot. */
const frameOf = (cars: (Car | null)[]): LmuRaceGapFrame => ({
  places: cars.map((car) => car?.place ?? 0),
  classes: cars.map((car) => car?.classId ?? 0),
  classPositions: cars.map((car) => car?.classPosition ?? 0),
  totalLaps: cars.map((car) => car?.laps ?? 0),
  timeIntoLap: cars.map((car) => car?.into ?? 0),
  estimatedLapTime: cars.map((car) => car?.estimate ?? 100),
  lapDistPcts: cars.map((car) =>
    car ? (car.pct ?? car.into / (car.estimate ?? 100)) : -1
  ),
  timeBehindLeader: cars.map((car) => car?.sim ?? 0),
});

describe('lmuTimeBehindLeader', () => {
  it('is the difference in time into the lap for cars on the same lap', () => {
    const result = lmuTimeBehindLeader(
      frameOf([
        { place: 1, classId: 0, classPosition: 1, laps: 5, into: 40 },
        { place: 2, classId: 0, classPosition: 2, laps: 5, into: 38.5 },
        { place: 3, classId: 0, classPosition: 3, laps: 5, into: 31 },
      ])
    );
    expect(result[0]).toBe(0);
    expect(result[1]).toBeCloseTo(1.5, 9);
    expect(result[2]).toBeCloseTo(9, 9);
  });

  it('carries on across the line, where the car behind is a lap short', () => {
    // The leader has just started lap 7; the car behind is finishing lap 6.
    const result = lmuTimeBehindLeader(
      frameOf([
        { place: 1, classId: 0, classPosition: 1, laps: 6, into: 1 },
        { place: 2, classId: 0, classPosition: 2, laps: 5, into: 98 },
      ])
    );
    expect(result[1]).toBeCloseTo(3, 9);
  });

  it('counts whole laps as time for a car more than a lap down', () => {
    // What the sim stops reporting: it would say 0 here.
    const result = lmuTimeBehindLeader(
      frameOf([
        { place: 1, classId: 0, classPosition: 1, laps: 30, into: 50 },
        {
          place: 2,
          classId: 0,
          classPosition: 2,
          laps: 27,
          into: 20,
          sim: 0,
        },
      ])
    );
    expect(result[1]).toBeCloseTo(330, 9);
  });

  it('keeps the gaps inside a class the leader has lapped many times', () => {
    // A prototype leading, and three GT cars 12 laps down running 2 s and
    // 7 s apart. Their class's lap is 20 s longer than the leader's.
    const result = lmuTimeBehindLeader(
      frameOf([
        {
          place: 1,
          classId: 0,
          classPosition: 1,
          laps: 100,
          into: 10,
          estimate: 100,
        },
        {
          place: 2,
          classId: 1,
          classPosition: 1,
          laps: 88,
          into: 60,
          estimate: 120,
        },
        {
          place: 3,
          classId: 1,
          classPosition: 2,
          laps: 88,
          into: 58,
          estimate: 120,
        },
        {
          place: 4,
          classId: 1,
          classPosition: 3,
          laps: 88,
          into: 51,
          estimate: 120,
        },
      ])
    );
    // What the standings show: each car against its class leader, and
    // against the car ahead.
    expect(result[2] - result[1]).toBeCloseTo(2, 9);
    expect(result[3] - result[1]).toBeCloseTo(9, 9);
    expect(result[3] - result[2]).toBeCloseTo(7, 9);
    // And the class leader itself, behind the prototype on the prototype's
    // lap: 11.6 laps of 100 s.
    expect(result[1]).toBeCloseTo(1160, 6);
  });

  it('measures a class on its own leader, not on each car', () => {
    // Two cars of one class whose estimates differ by a second. Scaled by
    // their own, a hundred laps behind the prototype would put a hundred
    // seconds between two cars that are side by side.
    const result = lmuTimeBehindLeader(
      frameOf([
        {
          place: 1,
          classId: 0,
          classPosition: 1,
          laps: 200,
          into: 0,
          estimate: 100,
        },
        {
          place: 2,
          classId: 1,
          classPosition: 1,
          laps: 100,
          into: 60,
          estimate: 120,
        },
        {
          place: 3,
          classId: 1,
          classPosition: 2,
          laps: 100,
          into: 60.5,
          estimate: 121,
        },
      ])
    );
    expect(result[2] - result[1]).toBeCloseTo(0, 6);
  });

  it('puts a car before the line at the start behind one past it', () => {
    // The sim counts time into the lap down to the line on the way to the
    // start: negative until the car crosses it.
    const result = lmuTimeBehindLeader(
      frameOf([
        {
          place: 1,
          classId: 0,
          classPosition: 1,
          laps: 0,
          into: 2.4,
          pct: 0.02,
        },
        { place: 2, classId: 0, classPosition: 2, laps: 0, into: -1.9, pct: 0 },
      ])
    );
    expect(result[1]).toBeCloseTo(4.3, 9);
  });

  it('reports a car past the leader on the road as the sim does', () => {
    // Second in the order and a few metres further round: a pass the order
    // has not caught up with. The sim reports a negative time, and so does
    // this, so the gap between the two keeps its size.
    const result = lmuTimeBehindLeader(
      frameOf([
        { place: 1, classId: 0, classPosition: 1, laps: 3, into: 20 },
        { place: 2, classId: 0, classPosition: 2, laps: 3, into: 20.4 },
      ])
    );
    expect(result[0]).toBe(0);
    expect(result[1]).toBeCloseTo(-0.4, 9);
  });

  it('keeps the size of a gap the order has not caught up with', () => {
    // Third on the road and listed fourth, half a second up on the car it
    // has just passed. The standings show the size of that gap, and it is
    // half a second either way round.
    const result = lmuTimeBehindLeader(
      frameOf([
        { place: 1, classId: 0, classPosition: 1, laps: 9, into: 70 },
        { place: 2, classId: 1, classPosition: 1, laps: 9, into: 40 },
        { place: 3, classId: 1, classPosition: 2, laps: 9, into: 30 },
        { place: 4, classId: 1, classPosition: 3, laps: 9, into: 30.5 },
      ])
    );
    expect(result[2] - result[1]).toBeCloseTo(10, 9);
    expect(result[3] - result[2]).toBeCloseTo(-0.5, 9);
  });

  it('goes by distance for a car the sim gives no estimate for', () => {
    const result = lmuTimeBehindLeader(
      frameOf([
        { place: 1, classId: 0, classPosition: 1, laps: 4, into: 50 },
        {
          place: 2,
          classId: 0,
          classPosition: 2,
          laps: 4,
          into: 0,
          estimate: 0,
          pct: 0.25,
        },
      ])
    );
    expect(result[1]).toBeCloseTo(25, 9);
  });

  it('falls back to the sim when the leader has no estimated lap', () => {
    const result = lmuTimeBehindLeader(
      frameOf([
        {
          place: 1,
          classId: 0,
          classPosition: 1,
          laps: 4,
          into: 0,
          estimate: 0,
          pct: 0.5,
        },
        {
          place: 2,
          classId: 0,
          classPosition: 2,
          laps: 4,
          into: 0,
          estimate: 0,
          pct: 0.4,
          sim: 8.25,
        },
      ])
    );
    expect(result).toEqual([0, 8.25]);
  });

  it('takes the car furthest round where no car is in first place', () => {
    const result = lmuTimeBehindLeader(
      frameOf([
        { place: 0, classId: 0, classPosition: 0, laps: 2, into: 10 },
        { place: 0, classId: 0, classPosition: 0, laps: 2, into: 30 },
      ])
    );
    expect(result[1]).toBe(0);
    expect(result[0]).toBeCloseTo(20, 9);
  });

  it('leaves an empty slot at zero and sizes the result to the grid', () => {
    const result = lmuTimeBehindLeader(
      frameOf([
        { place: 1, classId: 0, classPosition: 1, laps: 1, into: 30 },
        null,
        { place: 2, classId: 0, classPosition: 2, laps: 1, into: 28 },
      ])
    );
    expect(result).toHaveLength(3);
    expect(result[1]).toBe(0);
    expect(result[2]).toBeCloseTo(2, 9);
  });

  it('answers an empty grid with an empty result', () => {
    expect(lmuTimeBehindLeader(frameOf([]))).toEqual([]);
    expect(
      lmuTimeBehindLeader({
        places: undefined,
        classes: undefined,
        classPositions: undefined,
        totalLaps: undefined,
        timeIntoLap: undefined,
        estimatedLapTime: undefined,
        lapDistPcts: undefined,
        timeBehindLeader: undefined,
      })
    ).toEqual([]);
  });
});
