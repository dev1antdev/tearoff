import { describe, expect, it } from 'vitest';
import {
  DEMO_ELEVATION_M,
  ELEVATION_MARGIN_PX,
  elevationPaths,
  elevationPoints,
  elevationScaleOf,
  elevationY,
  formatHeight,
} from './elevationPath';

/** A lap of `count` buckets with one sharp peak and one sharp hollow. */
const lap = (count: number, peakAt: number, hollowAt: number): number[] =>
  Array.from({ length: count }, (_, bucket) =>
    bucket === peakAt
      ? 55.2
      : bucket === hollowAt
        ? 0
        : 20 + 5 * Math.sin((bucket / count) * 2 * Math.PI)
  );

describe('elevationScaleOf', () => {
  it('finds the lowest height and the range', () => {
    expect(elevationScaleOf([4.8, 0, 55.2, 12])).toEqual({
      lowest: 0,
      range: 55.2,
    });
    expect(elevationScaleOf([-10.6, -15.4, 39.8])).toEqual({
      lowest: -15.4,
      range: 39.8 + 15.4,
    });
  });

  it('has no range without a profile', () => {
    expect(elevationScaleOf([])).toEqual({ lowest: 0, range: 0 });
  });
});

describe('elevationY', () => {
  const scale = { lowest: 0, range: 50 };

  it('draws the highest point a margin below the top, the lowest a margin above the bottom', () => {
    expect(elevationY(50, scale, 70)).toBe(ELEVATION_MARGIN_PX);
    expect(elevationY(0, scale, 70)).toBe(70 - ELEVATION_MARGIN_PX);
    expect(elevationY(25, scale, 70)).toBe(35);
  });

  it('holds a height outside the profile to its edges', () => {
    expect(elevationY(80, scale, 70)).toBe(ELEVATION_MARGIN_PX);
    expect(elevationY(-5, scale, 70)).toBe(70 - ELEVATION_MARGIN_PX);
  });

  it('draws a flat lap along the middle', () => {
    expect(elevationY(12, { lowest: 12, range: 0 }, 70)).toBe(35);
  });
});

describe('elevationPoints', () => {
  it('keeps every bucket of a lap that fits the width', () => {
    const points = elevationPoints([0, 10, 20, 10], 400, 70);

    // Four buckets and the closing point.
    expect(points).toHaveLength(5);
    expect(points.map((point) => point.x)).toEqual([0, 100, 200, 300, 400]);
    expect(points[0].y).toBe(62);
    expect(points[2].y).toBe(8);
  });

  it('ends at the right-hand edge at the height the lap began at', () => {
    const points = elevationPoints([4.8, 30, 12, 9], 400, 70);

    expect(points.at(-1)).toEqual({ x: 400, y: points[0].y });
  });

  it('thins Le Mans to one point for every two pixels', () => {
    // 13,626 m: 1,363 buckets, drawn 400 px wide.
    const elevation = lap(1363, 911, 404);
    const points = elevationPoints(elevation, 400, 70);

    expect(points.length).toBeLessThanOrEqual(200);
    expect(points.length).toBeGreaterThan(150);
    // The top and the bottom are never thinned out.
    const ys = points.map((point) => point.y);
    expect(Math.min(...ys)).toBe(ELEVATION_MARGIN_PX);
    expect(Math.max(...ys)).toBe(70 - ELEVATION_MARGIN_PX);
    expect(points).toContainEqual({
      x: (911 / 1363) * 400,
      y: ELEVATION_MARGIN_PX,
    });
    expect(points).toContainEqual({
      x: (404 / 1363) * 400,
      y: 70 - ELEVATION_MARGIN_PX,
    });
  });

  it('always keeps the first and the last bucket', () => {
    const elevation = lap(1363, 911, 404);
    const points = elevationPoints(elevation, 400, 70);

    expect(points[0].x).toBe(0);
    expect(points.at(-2)?.x).toBeCloseTo((1362 / 1363) * 400, 10);
  });

  it('runs left to right without doubling back', () => {
    const points = elevationPoints(lap(1363, 3, 1361), 300, 60);

    for (let index = 1; index < points.length; index += 1) {
      expect(points[index].x).toBeGreaterThan(points[index - 1].x);
    }
    expect(points.length).toBeLessThanOrEqual(150);
  });

  it('thins less in a wider box', () => {
    const elevation = lap(1363, 911, 404);

    expect(elevationPoints(elevation, 800, 70).length).toBeGreaterThan(
      elevationPoints(elevation, 400, 70).length
    );
    expect(elevationPoints(elevation, 800, 70).length).toBeLessThanOrEqual(400);
  });

  it('draws nothing without a profile or a box', () => {
    expect(elevationPoints([], 400, 70)).toEqual([]);
    expect(elevationPoints([1, 2, 3], 0, 70)).toEqual([]);
    expect(elevationPoints([1, 2, 3], 400, 0)).toEqual([]);
  });
});

describe('elevationPaths', () => {
  it('writes the line, and the same closed along the bottom', () => {
    const { line, area } = elevationPaths([0, 10, 20, 10], 400, 70);

    expect(line).toBe('M0 62L100 35L200 8L300 35L400 62');
    expect(area).toBe('M0 62L100 35L200 8L300 35L400 62L400 70L0 70Z');
  });

  it('is a flat line at mid-height without a profile', () => {
    const { line, area } = elevationPaths([], 400, 70);

    expect(line).toBe('M0 35L400 35');
    expect(area).toBe('M0 35L400 35L400 70L0 70Z');
  });

  it('writes coordinates to the tenth of a pixel', () => {
    const { line } = elevationPaths([0, 1, 3], 100, 70);

    // 33.333 px and 66.667 px across; a third of the way up.
    expect(line).toBe('M0 62L33.3 44L66.7 8L100 62');
  });
});

describe('formatHeight', () => {
  it('prints one decimal', () => {
    expect(formatHeight(23.44, true, false)).toBe('23.4');
    expect(formatHeight(0, true, false)).toBe('0.0');
  });

  it('prints feet where the driver reads feet', () => {
    expect(formatHeight(10, false, false)).toBe('32.8');
    expect(formatHeight(55.2, false, false)).toBe('181.1');
  });

  it('signs a height measured from the line', () => {
    expect(formatHeight(18.6, true, true)).toBe('+18.6');
    expect(formatHeight(-4.8, true, true)).toBe('-4.8');
    expect(formatHeight(-4.8, false, true)).toBe('-15.7');
  });

  it('gives what rounds to nothing no sign', () => {
    expect(formatHeight(0.04, true, true)).toBe('0.0');
    expect(formatHeight(-0.04, true, true)).toBe('0.0');
  });
});

describe('the demo profile', () => {
  it('is a lap of 360 buckets', () => {
    expect(DEMO_ELEVATION_M).toHaveLength(360);
    expect(elevationScaleOf(DEMO_ELEVATION_M).range).toBeGreaterThan(30);
    expect(DEMO_ELEVATION_M.every(Number.isFinite)).toBe(true);
  });
});
