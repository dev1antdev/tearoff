import { describe, expect, it } from 'vitest';
import type { LmuTrackMap } from '@irdashies/types';
import { lmuTrackPathData } from './sessionTrackGeometry';
import { buildTrackGeometry, pointAtProgress } from './trackGeometry';

/** A square circuit, driven from the top-left corner, one sample per side. */
const squareMap = (points: { x: number; y: number }[]): LmuTrackMap => ({
  orientation: 'lmu-ccw-v1',
  active: {
    inside: '',
    outside: '',
    trackPathPoints: points,
    totalLength: points.length - 1,
  },
  startFinish: {
    line: '',
    point: { ...points[0], length: 0 },
    direction: 'anticlockwise',
  },
});

const square = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];

describe('lmuTrackPathData', () => {
  it('closes the loop the stored line leaves open', () => {
    const path = lmuTrackPathData(squareMap(square));

    expect(path?.trackPathPoints).toHaveLength(5);
    expect(path?.trackPathPoints[4]).toEqual(square[0]);
  });

  it('puts sample i at i / count of a lap', () => {
    // Four samples, so each side of the square is a quarter of the lap. With
    // the map's own totalLength of count - 1 the last side would be missing
    // and the three before it stretched to cover it.
    const path = lmuTrackPathData(squareMap(square));
    if (!path) throw new Error('expected a path');
    // No smoothing, so the corners stay where the samples put them.
    const geometry = buildTrackGeometry(path, 400, { smoothing: 0 });
    if (!geometry) throw new Error('expected geometry');
    const point = { x: 0, y: 0 };

    pointAtProgress(geometry, 0.25, point);
    expect(point.x).toBeCloseTo(100, 0);
    expect(point.y).toBeCloseTo(0, 0);

    pointAtProgress(geometry, 0.75, point);
    expect(point.x).toBeCloseTo(0, 0);
    expect(point.y).toBeCloseTo(100, 0);

    // Half-way down the closing side, which only exists once the loop is shut.
    pointAtProgress(geometry, 0.875, point);
    expect(point.x).toBeCloseTo(0, 0);
    expect(point.y).toBeCloseTo(50, 0);
  });

  it('runs in the order the samples were driven', () => {
    const path = lmuTrackPathData(squareMap(square));

    expect(path?.direction).toBe('anticlockwise');
    expect(path?.startFinishLength).toBe(0);
  });

  it('gives nothing for a map with no line to draw', () => {
    expect(lmuTrackPathData(undefined)).toBeNull();
    expect(lmuTrackPathData(null)).toBeNull();
    expect(lmuTrackPathData(squareMap(square.slice(0, 2)))).toBeNull();
  });
});
