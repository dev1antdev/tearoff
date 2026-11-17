import { describe, expect, it } from 'vitest';
import { MAX_GRIDLINES } from '@irdashies/utils/charts/linearAxis';
import {
  MAX_GAP_CEILING_SECONDS,
  buildGapAxis,
  buildPositionAxis,
  formatAxisValue,
  gapAxisStep,
} from './lapGraphScales';

describe('buildGapAxis', () => {
  it('keeps a close field on a fine step', () => {
    const axis = buildGapAxis(12);

    expect(axis.step).toBe(2);
    expect(axis.max).toBe(12);
    expect(axis.values).toEqual([0, 2, 4, 6, 8, 10, 12]);
  });

  it('never draws more than the gridline cap', () => {
    for (const maxGap of [30, 300, 1800, 3600, 1e6]) {
      expect(buildGapAxis(maxGap).values.length).toBeLessThanOrEqual(
        MAX_GRIDLINES + 1
      );
    }
  });

  it('clamps a garbage sentinel instead of allocating an unbounded axis', () => {
    const axis = buildGapAxis(1e6);

    expect(axis.max).toBeLessThanOrEqual(MAX_GAP_CEILING_SECONDS);
    expect(axis.values.length).toBeLessThanOrEqual(MAX_GRIDLINES + 1);
  });

  it('survives a non-finite maximum', () => {
    const axis = buildGapAxis(Number.NaN);

    expect(Number.isFinite(axis.max)).toBe(true);
    expect(axis.values.length).toBeGreaterThan(0);
  });

  it('keeps a usable axis when every gap is zero', () => {
    const axis = buildGapAxis(0);

    expect(axis.max).toBeGreaterThan(0);
    expect(axis.values[0]).toBe(0);
  });
});

describe('gapAxisStep', () => {
  it('grows the step as the range grows', () => {
    expect(gapAxisStep(8)).toBe(1);
    expect(gapAxisStep(40)).toBe(5);
    expect(gapAxisStep(200)).toBe(30);
    expect(gapAxisStep(600)).toBe(120);
  });
});

describe('buildPositionAxis', () => {
  it('starts at one and steps by whole positions', () => {
    const axis = buildPositionAxis(12);

    expect(axis.min).toBe(1);
    expect(axis.max).toBe(12);
    expect(axis.values.every((v) => Number.isInteger(v))).toBe(true);
  });

  it('thins a full 60-car field within the gridline cap', () => {
    const axis = buildPositionAxis(60);

    expect(axis.values.length).toBeLessThanOrEqual(MAX_GRIDLINES + 1);
    expect(axis.values[0]).toBe(1);
    expect(axis.values[axis.values.length - 1]).toBe(60);
  });

  it('keeps a usable axis for a two-car class', () => {
    expect(buildPositionAxis(1).max).toBeGreaterThanOrEqual(2);
  });

  it('survives non-finite input', () => {
    expect(Number.isFinite(buildPositionAxis(Number.NaN).max)).toBe(true);
  });
});

describe('formatAxisValue', () => {
  it('writes positions as whole numbers', () => {
    expect(formatAxisValue('position', 7)).toBe('7');
  });

  it('signs a positive time', () => {
    expect(formatAxisValue('trace', 12.5)).toBe('+12.5');
  });

  it('keeps the minus sign on a negative time', () => {
    expect(formatAxisValue('trace', -12.5)).toBe('-12.5');
  });

  it('does not sign zero', () => {
    expect(formatAxisValue('gap', 0)).toBe('0.0');
  });

  it('drops decimals on a large value', () => {
    expect(formatAxisValue('gap', 600)).toBe('+600');
  });
});
