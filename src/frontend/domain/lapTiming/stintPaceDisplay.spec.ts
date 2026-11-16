import { describe, expect, it } from 'vitest';
import { stintPaceDisplay } from './stintPaceDisplay';

describe('stintPaceDisplay', () => {
  it('prints a quicker stint with a minus, and calls it faster', () => {
    expect(stintPaceDisplay(-0.38)).toEqual({ text: '-0.38', tone: 'faster' });
    expect(stintPaceDisplay(-12.347)).toEqual({
      text: '-12.35',
      tone: 'faster',
    });
  });

  it('prints a slower stint with a plus, and calls it slower', () => {
    expect(stintPaceDisplay(0.42)).toEqual({ text: '+0.42', tone: 'slower' });
    expect(stintPaceDisplay(3)).toEqual({ text: '+3.00', tone: 'slower' });
  });

  it('rounds to the hundredth', () => {
    expect(stintPaceDisplay(0.104).text).toBe('+0.10');
    expect(stintPaceDisplay(0.106).text).toBe('+0.11');
    expect(stintPaceDisplay(-0.996).text).toBe('-1.00');
  });

  it('takes no sign and no colour for a difference that prints as nothing', () => {
    expect(stintPaceDisplay(0)).toEqual({ text: '0.00', tone: 'level' });
    expect(stintPaceDisplay(0.004)).toEqual({ text: '0.00', tone: 'level' });
    expect(stintPaceDisplay(-0.004)).toEqual({ text: '0.00', tone: 'level' });
  });

  it('prints two dashes while there is nothing to compare', () => {
    const none = { text: '--', tone: 'none' };
    expect(stintPaceDisplay(null)).toEqual(none);
    expect(stintPaceDisplay(undefined)).toEqual(none);
    expect(stintPaceDisplay(Number.NaN)).toEqual(none);
    expect(stintPaceDisplay(Number.POSITIVE_INFINITY)).toEqual(none);
  });
});
