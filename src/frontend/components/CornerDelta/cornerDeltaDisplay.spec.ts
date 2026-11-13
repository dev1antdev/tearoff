import { describe, expect, it } from 'vitest';
import {
  formatSpeed,
  formatSpeedDelta,
  formatTimeDelta,
  speedTone,
  timeTone,
} from './cornerDeltaDisplay';

describe('formatTimeDelta', () => {
  it('signs a gain and a loss', () => {
    expect(formatTimeDelta(-0.084, 2)).toBe('-0.08');
    expect(formatTimeDelta(0.031, 3)).toBe('+0.031');
  });

  it('shows no sign on a delta that rounds to nothing', () => {
    expect(formatTimeDelta(-0.002, 2)).toBe('0.00');
    expect(formatTimeDelta(0.0004, 3)).toBe('0.000');
  });

  it('draws dashes where there is no delta', () => {
    expect(formatTimeDelta(null, 2)).toBe('-.--');
    expect(formatTimeDelta(null, 3)).toBe('-.---');
    expect(formatTimeDelta(Number.NaN, 2)).toBe('-.--');
  });

  it('pins a delta too large to draw', () => {
    expect(formatTimeDelta(250, 2)).toBe('+99.99');
    expect(formatTimeDelta(-250, 2)).toBe('-99.99');
  });
});

describe('timeTone', () => {
  it('is faster for less time and slower for more', () => {
    expect(timeTone(-0.084, 2)).toBe('faster');
    expect(timeTone(0.031, 2)).toBe('slower');
  });

  it('is level where the figure drawn is zero', () => {
    expect(timeTone(-0.004, 2)).toBe('level');
    // The same delta is not zero at three decimals.
    expect(timeTone(-0.004, 3)).toBe('faster');
  });

  it('is none without a delta', () => {
    expect(timeTone(null, 2)).toBe('none');
  });
});

describe('formatSpeed', () => {
  it('draws a whole speed in the display unit', () => {
    expect(formatSpeed(171.4, 'km/h')).toBe('171');
    expect(formatSpeed(160.934, 'mph')).toBe('100');
  });

  it('draws dashes where there is no speed', () => {
    expect(formatSpeed(null, 'km/h')).toBe('--');
  });
});

describe('formatSpeedDelta', () => {
  it('signs a difference to one decimal', () => {
    expect(formatSpeedDelta(3.24, 'km/h')).toBe('+3.2');
    expect(formatSpeedDelta(-1.46, 'km/h')).toBe('-1.5');
  });

  it('converts the difference before rounding it', () => {
    // 1.0 km/h is 0.6 mph.
    expect(formatSpeedDelta(1, 'mph')).toBe('+0.6');
  });

  it('shows no sign on a difference that rounds to nothing', () => {
    expect(formatSpeedDelta(-0.04, 'km/h')).toBe('0.0');
  });

  it('draws dashes where there is no difference', () => {
    expect(formatSpeedDelta(null, 'km/h')).toBe('-.-');
  });
});

describe('speedTone', () => {
  it('is faster for more speed, the other way round from a time', () => {
    expect(speedTone(3.2, 'km/h')).toBe('faster');
    expect(speedTone(-1.4, 'km/h')).toBe('slower');
  });

  it('is level where the figure drawn is zero', () => {
    expect(speedTone(0.04, 'km/h')).toBe('level');
    // 0.07 km/h is 0.04 mph.
    expect(speedTone(0.07, 'mph')).toBe('level');
    expect(speedTone(0.07, 'km/h')).toBe('faster');
  });

  it('is none without a difference', () => {
    expect(speedTone(null, 'km/h')).toBe('none');
  });
});
