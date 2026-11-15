import { describe, expect, it } from 'vitest';
import {
  deltaTone,
  formatDelta,
  formatLapTime,
  formatSectorTime,
  predictedLapTime,
} from './deltaDisplay';

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
    expect(formatLapTime(-1)).toBe('-:--.---');
    expect(formatLapTime(Number.NaN)).toBe('-:--.---');
  });

  it('follows the precision asked for, dashes included', () => {
    expect(formatLapTime(104.054, 2)).toBe('1:44.05');
    expect(formatLapTime(104.054, 1)).toBe('1:44.1');
    expect(formatLapTime(null, 2)).toBe('-:--.--');
    expect(formatLapTime(null, 1)).toBe('-:--.-');
  });

  it('carries a rounding into the minutes rather than writing 60 seconds', () => {
    expect(formatLapTime(59.9996)).toBe('1:00.000');
    expect(formatLapTime(119.96, 1)).toBe('2:00.0');
  });
});

describe('formatSectorTime', () => {
  it('writes seconds alone under a minute', () => {
    expect(formatSectorTime(32.739)).toBe('32.739');
    expect(formatSectorTime(9.05, 2)).toBe('9.05');
    expect(formatSectorTime(18.851, 1)).toBe('18.9');
  });

  it('writes minutes once the sector is that long', () => {
    expect(formatSectorTime(72.48)).toBe('1:12.480');
    // Rounded first: this is a minute, not 60.0 seconds.
    expect(formatSectorTime(59.96, 1)).toBe('1:00.0');
  });

  it('shows two dashes when there is no time', () => {
    expect(formatSectorTime(null)).toBe('--');
    expect(formatSectorTime(0)).toBe('--');
  });
});
