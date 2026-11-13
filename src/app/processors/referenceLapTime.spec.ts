import { describe, expect, it } from 'vitest';
import type { ReferenceLap } from '@irdashies/types';
import { referenceLapTime, referenceTimeAt } from './referenceLapTime';

const LAP_TIME = 90;
const POINTS = 100;

/**
 * A lap whose time at a point is a known smooth function, sampled the way the
 * recorder samples: one point per bucket, somewhere inside it, with the true
 * slope as the tangent.
 */
const lapFrom = (
  timeAt: (pct: number) => number,
  slopeAt: (pct: number) => number,
  /** Where in its bucket each sample sits, 0..1. */
  offsetInBucket = 0.3
): ReferenceLap => {
  const pointPos = new Float32Array(POINTS);
  const times = new Float32Array(POINTS);
  const tangents = new Float32Array(POINTS);
  for (let index = 0; index < POINTS; index += 1) {
    const pct = (index + offsetInBucket) / POINTS;
    pointPos[index] = pct;
    times[index] = timeAt(pct);
    tangents[index] = slopeAt(pct);
  }
  return {
    pointPos,
    times,
    tangents,
    interval: 1 / POINTS,
    pointsCount: POINTS,
    startTime: 1000,
    finishTime: 1000 + LAP_TIME,
    lastTrackedPct: 0.999,
    isCleanLap: true,
  };
};

const steady = () =>
  lapFrom(
    (pct) => pct * LAP_TIME,
    () => LAP_TIME
  );

/** Slow through the middle of the lap, quick at either end. */
const uneven = () =>
  lapFrom(
    (pct) => pct * LAP_TIME - 4 * Math.sin(2 * Math.PI * pct),
    (pct) => LAP_TIME - 8 * Math.PI * Math.cos(2 * Math.PI * pct)
  );

describe('referenceLapTime', () => {
  it('is the lap from line to line, whatever the session clock read', () => {
    expect(referenceLapTime(steady())).toBe(LAP_TIME);
  });

  it('has no time for a lap that never finished', () => {
    expect(referenceLapTime({ ...steady(), finishTime: -1 })).toBeNull();
  });
});

describe('referenceTimeAt', () => {
  it('reads a steady lap exactly, anywhere on it', () => {
    const lap = steady();
    for (const pct of [0.0001, 0.0029, 0.0031, 0.25, 0.5, 0.7777, 0.9999]) {
      expect(referenceTimeAt(lap, pct)).toBeCloseTo(pct * LAP_TIME, 3);
    }
  });

  it('follows a lap that is not driven at one speed', () => {
    const lap = uneven();
    for (const pct of [0.004, 0.1, 0.25, 0.333, 0.5, 0.75, 0.9, 0.996]) {
      const expected = pct * LAP_TIME - 4 * Math.sin(2 * Math.PI * pct);
      expect(referenceTimeAt(lap, pct)).toBeCloseTo(expected, 2);
    }
  });

  it('reads a point ahead of its bucket sample from the span behind it', () => {
    // Bucket 40 covers 0.40 to 0.41 and its sample sits at 0.403. A point at
    // 0.401 lies between the samples of buckets 39 and 40.
    const lap = uneven();
    const pct = 0.401;
    const expected = pct * LAP_TIME - 4 * Math.sin(2 * Math.PI * pct);

    expect(referenceTimeAt(lap, pct)).toBeCloseTo(expected, 3);
  });

  it('keeps counting through the last bucket, up to the line', () => {
    // The final metres are where the delta becomes the lap's result. A time
    // held flat there, as a clamped index gives, would show the car losing a
    // tenth it has not lost.
    const lap = steady();

    expect(referenceTimeAt(lap, 0.9995)).toBeCloseTo(0.9995 * LAP_TIME, 3);
    expect(referenceTimeAt(lap, 1)).toBeCloseTo(LAP_TIME, 3);
    const secondLast = referenceTimeAt(lap, 0.996) as number;
    const last = referenceTimeAt(lap, 0.9995) as number;
    expect(last - secondLast).toBeCloseTo(0.0035 * LAP_TIME, 3);
  });

  it('starts from zero at the line, before the first sample', () => {
    const lap = steady();

    expect(referenceTimeAt(lap, 0)).toBeCloseTo(0, 3);
    expect(referenceTimeAt(lap, 0.001)).toBeCloseTo(0.001 * LAP_TIME, 3);
  });

  it('is continuous across the line', () => {
    const lap = uneven();
    const before = referenceTimeAt(lap, 0.99999) as number;
    const after = referenceTimeAt(lap, 0.00001) as number;

    expect(before - LAP_TIME).toBeCloseTo(after, 2);
  });

  it('never runs backwards along the lap', () => {
    const lap = uneven();
    let previous = -Infinity;
    for (let step = 0; step <= 2000; step += 1) {
      const time = referenceTimeAt(lap, step / 2000) as number;
      expect(time).toBeGreaterThanOrEqual(previous);
      previous = time;
    }
  });

  it('has no time for a point off the lap', () => {
    const lap = steady();

    expect(referenceTimeAt(lap, -0.01)).toBeNull();
    expect(referenceTimeAt(lap, 1.01)).toBeNull();
    expect(referenceTimeAt(lap, Number.NaN)).toBeNull();
  });

  it('has no time on a lap that is not complete', () => {
    expect(referenceTimeAt({ ...steady(), finishTime: -1 }, 0.5)).toBeNull();

    const holed = steady();
    holed.pointPos[50] = -1;
    expect(referenceTimeAt(holed, 0.505)).toBeNull();
    // Elsewhere on the same lap the samples are intact.
    expect(referenceTimeAt(holed, 0.2)).toBeCloseTo(0.2 * LAP_TIME, 3);
  });
});
