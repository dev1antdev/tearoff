import { describe, expect, it } from 'vitest';
import {
  GTrail,
  NO_READING,
  formatG,
  placeReading,
  trailOpacity,
  wholeGRings,
  type CirclePoint,
} from './frictionCircleGeometry';

const point = (): CirclePoint => ({ x: 0, y: 0, clamped: false });

describe('placeReading', () => {
  it('throws the dot right and up for a left-hander under braking', () => {
    // 1 g to the left and 2 g of braking, on a 100 px circle of 4 g.
    const placed = placeReading(1.0, -2.0, 4, 100, 'force', point());

    expect(placed).toEqual({ x: 25, y: -50, clamped: false });
  });

  it('turns both axes round in the acceleration orientation', () => {
    const placed = placeReading(1.0, -2.0, 4, 100, 'acceleration', point());

    expect(placed).toEqual({ x: -25, y: 50, clamped: false });
  });

  it('puts a car at rest in the centre', () => {
    expect(placeReading(0, 0, 3.5, 86, 'force', point())).toEqual({
      x: 0,
      y: 0,
      clamped: false,
    });
    expect(placeReading(0, 0, 3.5, 86, 'acceleration', point())).toEqual({
      x: 0,
      y: 0,
      clamped: false,
    });
  });

  it('draws a reading longer than the scale on the rim', () => {
    // 3 g and 4 g make 5 g, a quarter past a scale of 4.
    const placed = placeReading(3, 4, 4, 100, 'force', point());

    expect(placed.clamped).toBe(true);
    expect(Math.hypot(placed.x, placed.y)).toBeCloseTo(100, 10);
    // In the direction of the reading.
    expect(placed.x).toBeCloseTo(60, 10);
    expect(placed.y).toBeCloseTo(80, 10);
  });

  it('does not clamp a reading that is exactly on the rim', () => {
    const placed = placeReading(4, 0, 4, 100, 'force', point());

    expect(placed).toEqual({ x: 100, y: 0, clamped: false });
  });

  it('writes into the point it is given', () => {
    const out = point();

    expect(placeReading(2, 1, 4, 100, 'force', out)).toBe(out);
    expect(out).toEqual({ x: 50, y: 25, clamped: false });
  });

  it('draws nothing off the centre for a scale that is not one', () => {
    expect(placeReading(2, 1, 0, 100, 'force', point())).toEqual({
      x: 0,
      y: 0,
      clamped: false,
    });
  });
});

describe('wholeGRings', () => {
  it('rings each whole g inside the rim', () => {
    expect(wholeGRings(3.5)).toEqual([1, 2, 3]);
    expect(wholeGRings(6)).toEqual([1, 2, 3, 4, 5]);
  });

  it('leaves the rim itself to the rim', () => {
    expect(wholeGRings(3)).toEqual([1, 2]);
    expect(wholeGRings(1)).toEqual([]);
  });
});

describe('formatG', () => {
  it('prints a magnitude to two decimals', () => {
    expect(formatG(1.234)).toBe('1.23');
    expect(formatG(-2.2)).toBe('2.20');
    expect(formatG(0)).toBe('0.00');
  });

  it('prints dashes where there is no reading', () => {
    expect(formatG(undefined)).toBe(NO_READING);
    expect(formatG(null)).toBe(NO_READING);
    expect(formatG(Number.NaN)).toBe(NO_READING);
  });
});

describe('GTrail', () => {
  const samples = (trail: GTrail) =>
    Array.from({ length: trail.size }, (_, index) => [
      trail.latAt(index),
      trail.longAt(index),
      trail.timeAt(index),
    ]);

  it('keeps readings oldest first', () => {
    const trail = new GTrail();
    trail.push(0.5, -1, 10);
    trail.push(1, -0.5, 10.1);
    trail.push(1.5, 0, 10.2);

    expect(samples(trail)).toEqual([
      [0.5, -1, 10],
      [1, -0.5, 10.1],
      [1.5, 0, 10.2],
    ]);
  });

  it('does not store a reading that repeats the one before', () => {
    const trail = new GTrail();
    trail.push(1.23, -0.45, 10);
    trail.push(1.23, -0.45, 10.1);
    trail.push(1.23, -0.44, 10.2);

    expect(trail.size).toBe(2);
    expect(trail.timeAt(1)).toBe(10.2);
  });

  it('stores a reading again once the car has been somewhere else', () => {
    const trail = new GTrail();
    trail.push(1, 0, 10);
    trail.push(0, 0, 10.1);
    trail.push(1, 0, 10.2);

    expect(trail.size).toBe(3);
  });

  it('drops readings older than the trail is long', () => {
    const trail = new GTrail();
    trail.push(0.1, 0, 10);
    trail.push(0.2, 0, 11);
    trail.push(0.3, 0, 13);
    trail.push(0.4, 0, 14.5);

    // Four seconds of trail at 15 s: the first is 5 s old, the second 4 s.
    trail.prune(15, 4);
    expect(samples(trail).map(([lat]) => lat)).toEqual([
      Math.fround(0.2),
      Math.fround(0.3),
      Math.fround(0.4),
    ]);

    trail.prune(15.01, 4);
    expect(trail.size).toBe(2);

    trail.prune(30, 4);
    expect(trail.size).toBe(0);
  });

  it('makes room for the newest when it is full', () => {
    const trail = new GTrail(3);
    for (let index = 0; index < 5; index += 1) trail.push(index, 0, index);

    expect(samples(trail)).toEqual([
      [2, 0, 2],
      [3, 0, 3],
      [4, 0, 4],
    ]);
  });

  it('goes on working after it has wrapped and been pruned', () => {
    const trail = new GTrail(4);
    for (let index = 0; index < 10; index += 1) trail.push(index, 0, index);
    trail.prune(9.5, 2);
    trail.push(10, 0, 10);

    expect(samples(trail).map(([lat]) => lat)).toEqual([8, 9, 10]);
  });

  it('is emptied by clear', () => {
    const trail = new GTrail();
    trail.push(1, 1, 1);
    trail.push(2, 2, 2);

    trail.clear();
    expect(trail.size).toBe(0);

    trail.push(3, 3, 3);
    expect(samples(trail)).toEqual([[3, 3, 3]]);
  });
});

describe('trailOpacity', () => {
  it('fades from the newest to nothing at the end of the trail', () => {
    expect(trailOpacity(0, 4)).toBeCloseTo(0.6, 10);
    expect(trailOpacity(1, 4)).toBeCloseTo(0.45, 10);
    expect(trailOpacity(2, 4)).toBeCloseTo(0.3, 10);
    expect(trailOpacity(4, 4)).toBe(0);
    expect(trailOpacity(9, 4)).toBe(0);
  });

  it('is never stronger than the newest', () => {
    expect(trailOpacity(-0.2, 4)).toBeCloseTo(0.6, 10);
  });

  it('draws nothing for a trail of no length', () => {
    expect(trailOpacity(0, 0)).toBe(0);
  });
});
