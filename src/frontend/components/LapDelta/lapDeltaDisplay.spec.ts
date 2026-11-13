import { describe, expect, it } from 'vitest';
import {
  REFERENCE_LABELS,
  deltaTone,
  formatDelta,
  formatLapTime,
  predictedLapTime,
  trendFill,
} from './lapDeltaDisplay';

describe('formatDelta', () => {
  it('always carries a sign', () => {
    expect(formatDelta(-0.342, 2)).toBe('-0.34');
    expect(formatDelta(1.204, 2)).toBe('+1.20');
    expect(formatDelta(-12.5, 2)).toBe('-12.50');
  });

  it('follows the precision asked for', () => {
    expect(formatDelta(-0.3421, 3)).toBe('-0.342');
    expect(formatDelta(0.0456, 3)).toBe('+0.046');
  });

  it('shows level without a sign, including a delta too small to show', () => {
    expect(formatDelta(0, 2)).toBe('0.00');
    // Two thousandths up is not "-0.00".
    expect(formatDelta(-0.002, 2)).toBe('0.00');
    expect(formatDelta(0.004, 2)).toBe('0.00');
    // The same lap at three decimals does have something to show.
    expect(formatDelta(-0.002, 3)).toBe('-0.002');
  });

  it('shows dashes of the same width when there is no delta', () => {
    expect(formatDelta(null, 2)).toBe('-.--');
    expect(formatDelta(null, 3)).toBe('-.---');
    expect(formatDelta(Number.NaN, 2)).toBe('-.--');
  });

  it('pins a delta too large to be worth reading', () => {
    // A car parked for five minutes is not 312 seconds down in any useful
    // sense, and the figure must not push the layout apart.
    expect(formatDelta(312.4, 2)).toBe('+99.99');
    expect(formatDelta(-312.4, 2)).toBe('-99.99');
  });
});

describe('deltaTone', () => {
  it('is faster below zero and slower above', () => {
    expect(deltaTone(-0.342, 2)).toBe('faster');
    expect(deltaTone(1.204, 2)).toBe('slower');
  });

  it('agrees with the figure about what counts as level', () => {
    // Coloured green while reading 0.00 would be the tone contradicting the
    // number beside it.
    expect(deltaTone(-0.002, 2)).toBe('level');
    expect(deltaTone(0.004, 2)).toBe('level');
    expect(deltaTone(-0.002, 3)).toBe('faster');
    expect(deltaTone(0, 3)).toBe('level');
  });

  it('has no tone without a delta', () => {
    expect(deltaTone(null, 2)).toBe('none');
    expect(deltaTone(Number.NaN, 2)).toBe('none');
  });
});

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

describe('predictedLapTime', () => {
  it('is the reference lap plus what has been gained or lost on it', () => {
    expect(predictedLapTime(98.556, -0.342)).toBeCloseTo(98.214, 6);
    expect(predictedLapTime(98.556, 1.2)).toBeCloseTo(99.756, 6);
  });

  it('needs both a reference and a delta', () => {
    expect(predictedLapTime(null, -0.342)).toBeNull();
    expect(predictedLapTime(98.556, null)).toBeNull();
  });

  it('is not a lap time when it comes out at nothing', () => {
    expect(predictedLapTime(98.556, -200)).toBeNull();
  });
});

describe('formatLapTime', () => {
  it('writes minutes, seconds and thousandths', () => {
    expect(formatLapTime(98.556)).toBe('1:38.556');
    expect(formatLapTime(59.9)).toBe('0:59.900');
    expect(formatLapTime(204.0004)).toBe('3:24.000');
  });

  it('shows dashes when there is no lap', () => {
    expect(formatLapTime(null)).toBe('-:--.---');
    expect(formatLapTime(0)).toBe('-:--.---');
  });
});

describe('REFERENCE_LABELS', () => {
  it('names both references', () => {
    expect(REFERENCE_LABELS.sessionBest).toBe('Session best');
    expect(REFERENCE_LABELS.allTime).toBe('All-time best');
  });
});
