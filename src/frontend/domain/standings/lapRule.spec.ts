import { describe, expect, it } from 'vitest';
import { lapsApart } from './lapRule';

describe('lapsApart', () => {
  it.each([
    // ahead, behind, laps
    [5.6, 5.5, 0],
    [5.6, 4.7, 0],
    // Exactly one lap is still the same lap: the rule is "more than one".
    [5.5, 4.5, 0],
    [5.6, 4.4, 1],
    [5.9, 4.0, 1],
    [6.0, 4.0, 2],
    [7.5, 5.2, 2],
    [8.6, 5.4, 3],
  ])('%f ahead of %f is %i laps', (ahead, behind, laps) => {
    expect(lapsApart(ahead, behind)).toBe(laps);
  });

  it('is 0 when the car listed ahead is behind on the road', () => {
    expect(lapsApart(5.1, 5.3)).toBe(0);
    expect(lapsApart(3.0, 6.5)).toBe(0);
  });

  it('is 0 when either progress is unknown', () => {
    expect(lapsApart(Number.NaN, 4)).toBe(0);
    expect(lapsApart(6, Number.NaN)).toBe(0);
  });
});
