import { describe, expect, it } from 'vitest';
import {
  NO_READING,
  chargeBand,
  clampDecimals,
  formatCharge,
  formatPower,
  formatSeconds,
  formatSigned,
  formatSignedPower,
  formatTemperature,
  formatWhole,
  lapUse,
  netToneClass,
  temperatureToneClass,
} from './hybridDisplay';

describe('the charge bands', () => {
  it('is low at or below the low threshold', () => {
    expect(chargeBand(10, 10, 95)).toBe('low');
    expect(chargeBand(0, 10, 95)).toBe('low');
    expect(chargeBand(10.01, 10, 95)).toBe('normal');
  });

  it('is high at or above the high threshold', () => {
    expect(chargeBand(95, 10, 95)).toBe('high');
    expect(chargeBand(100, 10, 95)).toBe('high');
    expect(chargeBand(94.99, 10, 95)).toBe('normal');
  });

  it('is neither without a reading', () => {
    expect(chargeBand(null, 10, 95)).toBe('normal');
  });

  it('follows the thresholds as they are set', () => {
    expect(chargeBand(22, 25, 80)).toBe('low');
    expect(chargeBand(81, 25, 80)).toBe('high');
    // With both at the middle the low band has the boundary.
    expect(chargeBand(50, 50, 50)).toBe('low');
  });
});

describe('the figures', () => {
  it('draws the charge to the decimals set', () => {
    expect(formatCharge(74.26, 1)).toBe('74.3');
    expect(formatCharge(74.26, 0)).toBe('74');
    expect(formatCharge(74.26, 2)).toBe('74.26');
    expect(formatCharge(null, 1)).toBe(NO_READING);
  });

  it('keeps a saved number of decimals between 0 and 2', () => {
    expect(clampDecimals(5)).toBe(2);
    expect(clampDecimals(-1)).toBe(0);
    expect(clampDecimals(undefined)).toBe(1);
    expect(clampDecimals(Number.NaN)).toBe(1);
  });

  it('signs a figure, and not one that rounds to nothing', () => {
    expect(formatSigned(10.87, 1)).toBe('+10.9');
    expect(formatSigned(-12.44, 1)).toBe('-12.4');
    expect(formatSigned(0, 1)).toBe('0.0');
    expect(formatSigned(-0.04, 1)).toBe('0.0');
    expect(formatSigned(0.004, 2)).toBe('0.00');
    expect(formatSigned(null, 1)).toBe(NO_READING);
  });

  it('draws seconds to a tenth', () => {
    expect(formatSeconds(8.4)).toBe('8.4');
    expect(formatSeconds(0)).toBe('0.0');
    expect(formatSeconds(null)).toBe(NO_READING);
  });

  it('draws a temperature in whole degrees of either unit', () => {
    expect(formatTemperature(68.4, 'celsius')).toBe('68');
    expect(formatTemperature(80, 'fahrenheit')).toBe('176');
    expect(formatTemperature(null, 'celsius')).toBe(NO_READING);
  });

  it('draws power in kilowatts, horsepower or metric horsepower', () => {
    expect(formatPower(200, 'kW')).toBe('200');
    expect(formatPower(200, 'hp')).toBe('268');
    expect(formatPower(200, 'ps')).toBe('272');
    expect(formatPower(null, 'kW')).toBe(NO_READING);
    expect(formatSignedPower(-84.3, 'kW')).toBe('-84');
    expect(formatSignedPower(-84.3, 'hp')).toBe('-113');
    expect(formatSignedPower(0, 'kW')).toBe('0');
  });

  it('draws a small negative as nothing, not as minus nothing', () => {
    expect(formatWhole(-0.3)).toBe('0');
    expect(formatWhole(9150)).toBe('9150');
    expect(formatWhole(null)).toBe(NO_READING);
  });
});

describe('the colours', () => {
  it('is green for a lap that gains and amber for one that loses', () => {
    expect(netToneClass(2.3)).toBe('text-emerald-300');
    expect(netToneClass(0)).toBe('text-emerald-300');
    expect(netToneClass(-0.1)).toBe('text-amber-400');
    expect(netToneClass(null)).toBe('text-slate-500');
  });

  it('is amber within ten degrees of the threshold and red from it', () => {
    expect(temperatureToneClass(69.9, 80)).toBe('text-white');
    expect(temperatureToneClass(70, 80)).toBe('text-amber-400');
    expect(temperatureToneClass(79.9, 80)).toBe('text-amber-400');
    expect(temperatureToneClass(80, 80)).toBe('text-red-400');
    expect(temperatureToneClass(null, 80)).toBe('text-slate-500');
  });
});

describe('the hold after the line', () => {
  const lap = {
    drainLapPct: 0.42,
    regenLapPct: 0.1,
    drainLastLapPct: 12.44,
    regenLastLapPct: 10.87,
    lapElapsedS: 4,
  };

  it('shows last lap’s totals while the lap is younger than the hold', () => {
    expect(lapUse(lap, 10)).toEqual({
      frozen: true,
      used: 12.44,
      regen: 10.87,
    });
    expect(lapUse({ ...lap, lapElapsedS: 9 }, 10).frozen).toBe(true);
  });

  it('shows this lap’s once the hold is over', () => {
    expect(lapUse({ ...lap, lapElapsedS: 10 }, 10)).toEqual({
      frozen: false,
      used: 0.42,
      regen: 0.1,
    });
    expect(lapUse({ ...lap, lapElapsedS: 30 }, 10).frozen).toBe(false);
  });

  it('holds nothing with the hold set to 0', () => {
    expect(lapUse({ ...lap, lapElapsedS: 0 }, 0).frozen).toBe(false);
  });

  it('shows this lap’s from the start before a lap has been completed', () => {
    expect(
      lapUse({ ...lap, drainLastLapPct: null, regenLastLapPct: null }, 10)
    ).toEqual({ frozen: false, used: 0.42, regen: 0.1 });
  });
});
