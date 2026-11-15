import { describe, expect, it } from 'vitest';
import { REFERENCE_LABELS, trendFill } from './lapDeltaDisplay';

// The delta text and tone, the predicted lap and the lap time format moved to
// the domain with their cases: src/frontend/domain/lapTiming/deltaDisplay.spec.ts

describe('trendFill', () => {
  it('fills toward faster while gaining and slower while losing', () => {
    expect(trendFill(-0.15, 0.3)).toEqual({ side: 'faster', fraction: 0.5 });
    expect(trendFill(0.075, 0.3)).toEqual({ side: 'slower', fraction: 0.25 });
  });

  it('is full at the range and stays full beyond it', () => {
    expect(trendFill(-0.3, 0.3).fraction).toBe(1);
    expect(trendFill(2, 0.3)).toEqual({ side: 'slower', fraction: 1 });
  });

  it('follows the range setting', () => {
    expect(trendFill(-0.15, 0.6).fraction).toBe(0.25);
    expect(trendFill(-0.15, 0.15).fraction).toBe(1);
  });

  it('stays empty for a trend too small to mean anything', () => {
    // A lap matching its reference measures a few thousandths either way.
    expect(trendFill(0.003, 0.3)).toEqual({ side: 'none', fraction: 0 });
    expect(trendFill(-0.004, 0.3)).toEqual({ side: 'none', fraction: 0 });
    expect(trendFill(0, 0.3)).toEqual({ side: 'none', fraction: 0 });
  });

  it('stays empty without a trend or with a range that cannot fill', () => {
    expect(trendFill(null, 0.3)).toEqual({ side: 'none', fraction: 0 });
    expect(trendFill(Number.NaN, 0.3)).toEqual({ side: 'none', fraction: 0 });
    expect(trendFill(-0.2, 0)).toEqual({ side: 'none', fraction: 0 });
  });
});

describe('REFERENCE_LABELS', () => {
  it('names both references', () => {
    expect(REFERENCE_LABELS.sessionBest).toBe('Session best');
    expect(REFERENCE_LABELS.allTime).toBe('All-time best');
  });
});
