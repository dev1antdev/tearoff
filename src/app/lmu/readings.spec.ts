import { describe, expect, it } from 'vitest';
import { isReading, isVec3 } from './readings';

describe('isReading', () => {
  it('takes a number, zero and negatives included', () => {
    expect(isReading(0)).toBe(true);
    expect(isReading(-1677.8)).toBe(true);
    expect(isReading(240.72)).toBe(true);
  });

  it('refuses a field that is not there, and a number that is not one', () => {
    expect(isReading(undefined)).toBe(false);
    expect(isReading(Number.NaN)).toBe(false);
    expect(isReading(Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe('isVec3', () => {
  it('takes three numbers, as an array or as the addon’s typed array', () => {
    expect(isVec3([0, 0, 0])).toBe(true);
    expect(isVec3(new Float64Array([-0.567, -0.153, -2.453]))).toBe(true);
  });

  it('refuses a field that is not there, a short one and a broken one', () => {
    expect(isVec3(undefined)).toBe(false);
    expect(isVec3([1, 2])).toBe(false);
    expect(isVec3([1, Number.NaN, 3])).toBe(false);
  });
});
