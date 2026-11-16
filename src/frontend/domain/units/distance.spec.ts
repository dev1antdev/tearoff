import { describe, expect, it } from 'vitest';
import { isMetricDistance } from './distance';

describe('isMetricDistance', () => {
  it('ignores the sim setting when the unit is named', () => {
    expect(isMetricDistance('m', 0)).toBe(true);
    expect(isMetricDistance('Metric', 0)).toBe(true);
    expect(isMetricDistance('ft', 1)).toBe(false);
    expect(isMetricDistance('Imperial', 1)).toBe(false);
  });

  it('follows the sim setting on auto', () => {
    expect(isMetricDistance('auto', 1)).toBe(true);
    expect(isMetricDistance('auto', 0)).toBe(false);
  });

  it('treats missing telemetry as metric', () => {
    expect(isMetricDistance('auto', undefined)).toBe(true);
  });
});
