import { describe, expect, it } from 'vitest';
import type { LmuTrackMap } from '@irdashies/types';
import { progressToTrackPoint } from './useProgressAnimation';
import {
  lmuMapSignature,
  lmuTrackDrawing,
  lmuTrackPathData,
} from './lmuTrackOutline';
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

describe('lmuTrackDrawing', () => {
  /** Where the whole-circuit map puts a car at a lap fraction. */
  const place = (map: LmuTrackMap, progress: number) => {
    const drawing = lmuTrackDrawing(map);
    if (!drawing?.active.trackPathPoints) throw new Error('expected a drawing');
    const point = { x: 0, y: 0 };
    progressToTrackPoint(
      progress,
      drawing.active.trackPathPoints,
      drawing.active.totalLength ?? 0,
      drawing.startFinish.point?.length ?? 0,
      drawing.startFinish.direction,
      point
    );
    return point;
  };

  it('strokes the samples as one closed line', () => {
    const drawing = lmuTrackDrawing(squareMap(square));

    expect(drawing?.active.inside).toBe('M0,0 L100,0 L100,100 L0,100 Z');
    expect(drawing?.active.outside).toBe(drawing?.active.inside);
  });

  it('places a car where the close-range map does: sample i at i / count', () => {
    const map = squareMap(square);

    expect(place(map, 0)).toEqual({ x: 0, y: 0 });
    expect(place(map, 0.25)).toEqual({ x: 100, y: 0 });
    expect(place(map, 0.5)).toEqual({ x: 100, y: 100 });
    expect(place(map, 0.625)).toEqual({ x: 50, y: 100 });
    // The closing side, which the stored line leaves out.
    expect(place(map, 0.875)).toEqual({ x: 0, y: 50 });
    // A hair before the line is a hair before the first sample, not a
    // quarter of a lap back at the last one.
    const beforeLine = place(map, 0.999);
    expect(beforeLine.x).toBeCloseTo(0, 5);
    expect(beforeLine.y).toBeCloseTo(0.4, 5);
  });

  it('takes the line and the direction from the outline', () => {
    const drawing = lmuTrackDrawing(squareMap(square));

    expect(drawing?.startFinish.point).toEqual({ x: 0, y: 0, length: 0 });
    expect(drawing?.startFinish.direction).toBe('anticlockwise');
    // Read only for being there: without it the canvas draws no track.
    expect(drawing?.startFinish.line).toBeTruthy();
  });

  it('marks the line at the first sample when the outline places none', () => {
    const map = squareMap(square);
    map.startFinish.point = {
      x: Number.NaN,
      y: 0,
      length: 0,
    };

    expect(lmuTrackDrawing(map)?.startFinish.point).toEqual({
      x: 0,
      y: 0,
      length: 0,
    });
  });

  it('carries the corner names a bundled map has, and none otherwise', () => {
    const named = {
      ...squareMap(square),
      turns: [{ x: 100, y: 0, content: '1' }],
    };

    expect(lmuTrackDrawing(named)?.turns).toEqual([
      { x: 100, y: 0, content: '1' },
    ]);
    expect(lmuTrackDrawing(squareMap(square))?.turns).toBeUndefined();
  });

  it('gives nothing for a map with no line to draw', () => {
    expect(lmuTrackDrawing(undefined)).toBeNull();
    expect(lmuTrackDrawing(null)).toBeNull();
    expect(lmuTrackDrawing(squareMap(square.slice(0, 2)))).toBeNull();
    expect(
      lmuTrackDrawing(
        squareMap([...square.slice(0, 3), { x: Number.NaN, y: 100 }])
      )
    ).toBeNull();
  });
});

describe('lmuMapSignature', () => {
  it('is the same for a copy of a map and another for another map', () => {
    const copy = squareMap(square.map((point) => ({ ...point })));
    const other = squareMap(
      square.map((point) => ({ ...point, x: point.x * 2 }))
    );

    expect(lmuMapSignature(copy)).toBe(lmuMapSignature(squareMap(square)));
    expect(lmuMapSignature(other)).not.toBe(lmuMapSignature(squareMap(square)));
  });

  it('is empty for no map, which is how its absence is told', () => {
    expect(lmuMapSignature(undefined)).toBe('');
    expect(lmuMapSignature(squareMap([]))).toBe('');
  });
});
