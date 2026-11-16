import { describe, expect, it } from 'vitest';
import {
  compassBearing,
  formatDrift,
  formatHeading,
  formatMetres,
  formatOdometer,
  formatTimeOnTrack,
} from './cruiseFormat';

describe('compassBearing', () => {
  it('names the four points', () => {
    expect(compassBearing(0)).toBe('N');
    expect(compassBearing(90)).toBe('E');
    expect(compassBearing(180)).toBe('S');
    expect(compassBearing(270)).toBe('W');
  });

  it('turns at the half sectors', () => {
    expect(compassBearing(22.4)).toBe('N');
    expect(compassBearing(22.5)).toBe('NE');
    expect(compassBearing(337.4)).toBe('NW');
    expect(compassBearing(337.5)).toBe('N');
  });

  it('names the points between', () => {
    expect(compassBearing(45)).toBe('NE');
    expect(compassBearing(135)).toBe('SE');
    expect(compassBearing(225)).toBe('SW');
    expect(compassBearing(315)).toBe('NW');
  });

  it('takes a heading outside one turn', () => {
    expect(compassBearing(360)).toBe('N');
    expect(compassBearing(-90)).toBe('W');
    expect(compassBearing(450)).toBe('E');
  });
});

describe('formatHeading', () => {
  it('prints three digits', () => {
    expect(formatHeading(0)).toBe('000');
    expect(formatHeading(45)).toBe('045');
    expect(formatHeading(344)).toBe('344');
  });

  it('rounds north of 359.5 round to north', () => {
    expect(formatHeading(359.6)).toBe('000');
    expect(formatHeading(360)).toBe('000');
  });
});

describe('formatMetres', () => {
  it('prints whole metres, or whole feet', () => {
    expect(formatMetres(38, true)).toEqual({ value: '38', unit: 'm' });
    expect(formatMetres(38, false)).toEqual({ value: '125', unit: 'ft' });
    expect(formatMetres(2345.4, true)).toEqual({ value: '2345', unit: 'm' });
  });

  it('shows a height below the datum as it is', () => {
    expect(formatMetres(-15.4, true)).toEqual({ value: '-15', unit: 'm' });
    expect(formatMetres(-15.4, false)).toEqual({ value: '-51', unit: 'ft' });
  });

  it('has no negative zero', () => {
    expect(formatMetres(-0.2, true).value).toBe('0');
  });
});

describe('formatOdometer', () => {
  it('prints kilometres or miles to one decimal', () => {
    expect(formatOdometer(1_234_560, true)).toEqual({
      value: '1234.6',
      unit: 'km',
    });
    expect(formatOdometer(1_234_560, false)).toEqual({
      value: '767.1',
      unit: 'mi',
    });
  });

  it('starts at nothing', () => {
    expect(formatOdometer(0, true).value).toBe('0.0');
    expect(formatOdometer(49, true).value).toBe('0.0');
    expect(formatOdometer(50, true).value).toBe('0.1');
  });
});

describe('formatTimeOnTrack', () => {
  it('prints minutes and seconds under an hour', () => {
    expect(formatTimeOnTrack(0)).toBe('0m 00s');
    expect(formatTimeOnTrack(240)).toBe('4m 00s');
    expect(formatTimeOnTrack(34 * 60 + 5.9)).toBe('34m 05s');
    expect(formatTimeOnTrack(3599.9)).toBe('59m 59s');
  });

  it('prints hours and minutes from an hour up', () => {
    expect(formatTimeOnTrack(3600)).toBe('1h 00m');
    expect(formatTimeOnTrack(12 * 3600 + 34 * 60 + 56)).toBe('12h 34m');
    expect(formatTimeOnTrack(250 * 3600 + 7 * 60)).toBe('250h 07m');
  });
});

describe('formatDrift', () => {
  it('prints whole degrees without a sign', () => {
    expect(formatDrift(-1.8)).toBe('2°');
    expect(formatDrift(3.2)).toBe('3°');
    expect(formatDrift(0)).toBe('0°');
  });
});
