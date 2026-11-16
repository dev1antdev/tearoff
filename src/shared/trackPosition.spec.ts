import { describe, expect, it } from 'vitest';
import type { TrackStateSnapshot } from '@irdashies/types';
import {
  heightAtFraction,
  selectCarLapFraction,
  wrapLapFraction,
} from './trackPosition';

const trackState = (
  extra: Partial<TrackStateSnapshot> = {}
): TrackStateSnapshot =>
  ({
    focusCarIdx: 3,
    carIdxLapDistPct: [0.1, 0.2, 0.3, 0.75],
    lapDistPct: 0.42,
    ...extra,
  }) as TrackStateSnapshot;

describe('wrapLapFraction', () => {
  it('brings a lap fraction into the lap', () => {
    expect(wrapLapFraction(0)).toBe(0);
    expect(wrapLapFraction(0.25)).toBe(0.25);
    expect(wrapLapFraction(1)).toBe(0);
    expect(wrapLapFraction(1.25)).toBeCloseTo(0.25, 10);
    expect(wrapLapFraction(-0.25)).toBeCloseTo(0.75, 10);
  });

  it('reads a value that is not a number as the line', () => {
    expect(wrapLapFraction(Number.NaN)).toBe(0);
    expect(wrapLapFraction(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('selectCarLapFraction', () => {
  it("is the player's own lap fraction at the wheel", () => {
    expect(selectCarLapFraction(trackState(), false)).toBe(0.42);
  });

  it('is the car the camera is on while watching', () => {
    expect(selectCarLapFraction(trackState(), true)).toBe(0.75);
  });

  it("falls back to the player's own when the focus car is not on track", () => {
    expect(
      selectCarLapFraction(
        trackState({ carIdxLapDistPct: [0.1, 0.2, 0.3, -1] }),
        true
      )
    ).toBe(0.42);
    expect(selectCarLapFraction(trackState({ focusCarIdx: null }), true)).toBe(
      0.42
    );
    expect(selectCarLapFraction(trackState({ focusCarIdx: 40 }), true)).toBe(
      0.42
    );
  });

  it('wraps a fraction rounded up to a whole lap', () => {
    expect(selectCarLapFraction(trackState({ lapDistPct: 1 }), false)).toBe(0);
  });
});

describe('heightAtFraction', () => {
  const profile = [0, 10, 20, 10];

  it('is the bucket value where a bucket starts', () => {
    expect(heightAtFraction(profile, 0)).toBe(0);
    expect(heightAtFraction(profile, 0.25)).toBe(10);
    expect(heightAtFraction(profile, 0.5)).toBe(20);
  });

  it('is a straight line between two buckets', () => {
    expect(heightAtFraction(profile, 0.125)).toBeCloseTo(5, 10);
    expect(heightAtFraction(profile, 0.45)).toBeCloseTo(18, 10);
  });

  it('runs from the last bucket back to the first', () => {
    expect(heightAtFraction(profile, 0.875)).toBeCloseTo(5, 10);
    expect(heightAtFraction(profile, 0.999)).toBeCloseTo(0.04, 5);
    expect(heightAtFraction(profile, 1)).toBe(0);
  });

  it('is null without a profile', () => {
    expect(heightAtFraction([], 0.5)).toBeNull();
  });
});
