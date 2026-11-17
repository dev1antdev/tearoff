import { describe, expect, it } from 'vitest';
import {
  MAX_GRIDLINES,
  buildFittedAxis,
  buildLinearAxis,
  lapAxisLabels,
  lapLabelCapacity,
  niceStep,
  roundLapTicks,
  valueToY,
} from './linearAxis';

describe('lapAxisLabels', () => {
  it('labels every lap for a short race', () => {
    expect(lapAxisLabels(1, 6, 10)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('thins labels so a long race does not smear', () => {
    const labels = lapAxisLabels(1, 500, 20);

    expect(labels.length).toBeLessThanOrEqual(20);
    expect(labels[0]).toBe(1);
    expect(labels[labels.length - 1]).toBe(500);
  });

  it('always includes the last lap', () => {
    const labels = lapAxisLabels(1, 47, 8);

    expect(labels[labels.length - 1]).toBe(47);
  });

  it('puts the last lap in place of a stepped lap it would crowd', () => {
    // At a step of seven the stepped laps end at 495. With 500 added after
    // it the two stood five laps apart where the others are seven, and at
    // other spans a single lap: 1, 4 and 5 for five laps and two labels.
    expect(lapAxisLabels(425, 500, 11)).toEqual([
      425, 432, 439, 446, 453, 460, 467, 474, 481, 488, 500,
    ]);
    expect(lapAxisLabels(1, 5, 2)).toEqual([1, 5]);
    expect(lapAxisLabels(1, 4, 3)).toEqual([1, 4]);
    expect(lapAxisLabels(1, 47, 8)).toEqual([1, 7, 13, 19, 25, 31, 37, 47]);
  });

  it('never names two laps nearer than its step, nor more laps than asked', () => {
    for (let maxLap = 2; maxLap <= 300; maxLap += 1) {
      for (let maxLabels = 1; maxLabels <= 24; maxLabels += 1) {
        const labels = lapAxisLabels(1, maxLap, maxLabels);
        const where = `laps 1-${maxLap}, ${maxLabels} labels`;
        const step = Math.max(1, Math.ceil(maxLap / Math.max(2, maxLabels)));

        expect(labels[0], where).toBe(1);
        expect(labels[labels.length - 1], where).toBe(maxLap);
        expect(labels.length, where).toBeLessThanOrEqual(
          Math.max(2, maxLabels)
        );
        for (let index = 1; index < labels.length; index += 1) {
          expect(
            labels[index] - labels[index - 1],
            where
          ).toBeGreaterThanOrEqual(step);
        }
      }
    }
  });

  it('handles a single recorded lap', () => {
    expect(lapAxisLabels(3, 3, 10)).toEqual([3]);
  });
});

describe('lapLabelCapacity', () => {
  it('scales with the plot width', () => {
    expect(lapLabelCapacity(1368, 34)).toBe(40);
    expect(lapLabelCapacity(340, 34)).toBe(10);
  });

  it('never drops below two labels, even at zero width', () => {
    expect(lapLabelCapacity(0, 34)).toBe(2);
  });
});

describe('roundLapTicks', () => {
  it('marks the round laps of a span', () => {
    expect(roundLapTicks(123, 162, 8)).toEqual([
      125, 130, 135, 140, 145, 150, 155, 160,
    ]);
    expect(roundLapTicks(123, 162, 5)).toEqual([130, 140, 150, 160]);
  });

  it('marks every lap where they all fit', () => {
    expect(roundLapTicks(1, 6, 10)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('keeps to the number of marks there is room for', () => {
    for (const [from, to, room] of [
      [1, 500, 12],
      [1, 20, 2],
      [37, 2000, 7],
      [143, 162, 3],
    ] as const) {
      const ticks = roundLapTicks(from, to, room);
      expect(ticks.length).toBeGreaterThan(0);
      expect(ticks.length).toBeLessThanOrEqual(room);
      expect(ticks.every((lap) => lap >= from && lap <= to)).toBe(true);
    }
  });

  it('spaces its marks evenly', () => {
    const ticks = roundLapTicks(1, 162, 9);
    const steps = ticks.slice(1).map((lap, index) => lap - ticks[index]);
    expect(new Set(steps).size).toBe(1);
  });

  it('names the one lap of a span of one', () => {
    expect(roundLapTicks(7, 7, 4)).toEqual([7]);
  });
});

describe('niceStep', () => {
  it('walks the ladder as the range grows', () => {
    expect(niceStep(8)).toBe(1);
    expect(niceStep(80)).toBe(10);
    expect(niceStep(800)).toBe(100);
  });

  it('handles a sub-unit range', () => {
    expect(niceStep(0.4)).toBeCloseTo(0.05, 10);
  });

  it('never returns zero', () => {
    expect(niceStep(0)).toBeGreaterThan(0);
    expect(niceStep(Number.NaN)).toBeGreaterThan(0);
  });

  it('takes a coarser step for fewer lines', () => {
    expect(niceStep(3, 4)).toBe(1);
    expect(niceStep(3, 8)).toBe(0.5);
  });
});

describe('buildLinearAxis', () => {
  it('spans a negative-to-positive trace range', () => {
    const axis = buildLinearAxis(-42, 17);

    expect(axis.min).toBeLessThanOrEqual(-42);
    expect(axis.max).toBeGreaterThanOrEqual(17);
    expect(axis.values.length).toBeLessThanOrEqual(MAX_GRIDLINES + 1);
  });

  it('never draws more than the gridline cap', () => {
    for (const [low, high] of [
      [0, 1],
      [-1000, 1000],
      [-1e6, 1e6],
      [0.001, 0.002],
    ] as const) {
      expect(buildLinearAxis(low, high).values.length).toBeLessThanOrEqual(
        MAX_GRIDLINES + 1
      );
    }
  });

  it('pads a flat series instead of returning a zero-height axis', () => {
    const axis = buildLinearAxis(5, 5);

    expect(axis.max).toBeGreaterThan(axis.min);
    expect(axis.values.length).toBeGreaterThan(1);
  });

  it('accepts a reversed range', () => {
    expect(buildLinearAxis(20, -20)).toEqual(buildLinearAxis(-20, 20));
  });

  it('survives non-finite input', () => {
    const axis = buildLinearAxis(Number.NaN, Number.POSITIVE_INFINITY);

    expect(Number.isFinite(axis.min)).toBe(true);
    expect(Number.isFinite(axis.max)).toBe(true);
  });

  it('does not drift on a fractional step', () => {
    const axis = buildLinearAxis(0, 1);

    for (const value of axis.values) {
      expect(Math.abs(value * 100 - Math.round(value * 100))).toBeLessThan(
        1e-6
      );
    }
  });
});

describe('buildFittedAxis', () => {
  it('keeps the range it is given, and marks the round values inside it', () => {
    const axis = buildFittedAxis(113.72, 115.61, 5);

    expect(axis.min).toBe(113.72);
    expect(axis.max).toBe(115.61);
    expect(axis.step).toBe(0.5);
    expect(axis.values).toEqual([114, 114.5, 115, 115.5]);
  });

  it('keeps a round value the range ends on', () => {
    expect(buildFittedAxis(-20, 40, 4).values).toEqual([-20, 0, 20, 40]);
  });

  it('takes fewer, coarser gridlines where there is room for fewer', () => {
    expect(buildFittedAxis(113.72, 115.61, 2).values).toEqual([114, 115]);
  });

  it('never draws more than the gridline cap', () => {
    for (const [low, high] of [
      [0, 1],
      [-1000, 1000],
      [0.001, 0.002],
      [113.2, 119.9],
    ] as const) {
      expect(buildFittedAxis(low, high).values.length).toBeLessThanOrEqual(
        MAX_GRIDLINES + 1
      );
    }
  });

  it('does not drift on a fractional step', () => {
    for (const value of buildFittedAxis(2.21, 2.69, 6).values) {
      expect(Math.abs(value * 100 - Math.round(value * 100))).toBeLessThan(
        1e-6
      );
    }
  });

  it('pads a flat range, accepts a reversed one and survives a bad one', () => {
    const flat = buildFittedAxis(5, 5);
    expect(flat.max).toBeGreaterThan(flat.min);
    expect(buildFittedAxis(20, -20)).toEqual(buildFittedAxis(-20, 20));
    const bad = buildFittedAxis(Number.NaN, Number.POSITIVE_INFINITY);
    expect(Number.isFinite(bad.min)).toBe(true);
    expect(Number.isFinite(bad.max)).toBe(true);
  });
});

describe('valueToY', () => {
  const axis = buildLinearAxis(0, 100);

  it('puts the maximum at the top for a normal axis', () => {
    expect(valueToY(axis.max, axis, 400, false)).toBe(0);
    expect(valueToY(axis.min, axis, 400, false)).toBe(400);
  });

  it('puts the minimum at the top when inverted', () => {
    expect(valueToY(axis.min, axis, 400, true)).toBe(0);
    expect(valueToY(axis.max, axis, 400, true)).toBe(400);
  });

  it('holds a value beyond the axis at its edge', () => {
    expect(valueToY(500, axis, 400, false)).toBe(0);
    expect(valueToY(-500, axis, 400, false)).toBe(400);
  });

  it('centres instead of dividing by zero', () => {
    expect(
      valueToY(5, { min: 3, max: 3, step: 1, values: [3] }, 400, false)
    ).toBe(200);
  });
});
