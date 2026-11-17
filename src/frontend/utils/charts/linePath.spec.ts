import { describe, expect, it } from 'vitest';
import { linePath } from './linePath';

describe('linePath', () => {
  it('moves to the first point and draws to the rest', () => {
    expect(
      linePath([
        { x: 0, y: 10 },
        { x: 20, y: 5 },
        { x: 40, y: 7.5 },
      ])
    ).toBe('M0 10L20 5L40 7.5');
  });

  it('rounds to a tenth of a pixel', () => {
    expect(
      linePath([
        { x: 1.234, y: 5.678 },
        { x: 9.96, y: 0.04 },
      ])
    ).toBe('M1.2 5.7L10 0');
  });

  it('draws a single point as a path of no length, for a round cap to dot', () => {
    expect(linePath([{ x: 4, y: 8 }])).toBe('M4 8h0');
  });

  it('is empty with nothing to draw', () => {
    expect(linePath([])).toBe('');
  });

  it('leaves out a point that is not a place', () => {
    expect(
      linePath([
        { x: 0, y: 0 },
        { x: Number.NaN, y: 3 },
        { x: 10, y: Number.POSITIVE_INFINITY },
        { x: 20, y: 4 },
      ])
    ).toBe('M0 0L20 4');
    expect(linePath([{ x: Number.NaN, y: 1 }])).toBe('');
  });
});
