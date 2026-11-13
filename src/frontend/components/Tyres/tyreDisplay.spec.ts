import { describe, expect, it } from 'vitest';
import type { TyreWheelState } from '@irdashies/types';
import {
  BRAKE_FADE_C,
  NO_READING,
  NO_READING_COLOR,
  TYRE_FADE_C,
  formatPressure,
  formatTemperature,
  formatTread,
  mean,
  pressureFromKpa,
  pressureTone,
  pressureToKpa,
  temperatureColor,
  tyreWindow,
  tyreZones,
} from './tyreDisplay';

const wheel = (over: Partial<TyreWheelState> = {}): TyreWheelState => ({
  surfaceTempC: [80, 85, 90],
  innerLayerTempC: [82, 86, 91],
  carcassTempC: 84,
  optimalTempC: 92,
  pressureKpa: 171.2,
  treadRemaining: 0.984,
  brakeTempC: 400,
  compound: 0,
  ...over,
});

describe('pressure units', () => {
  it('shows what the sim reported, in the chosen unit', () => {
    // 171.2 kPa is what a recorded GT3 ran hot.
    expect(formatPressure(171.2, 'psi')).toBe('24.8');
    expect(formatPressure(171.2, 'kpa')).toBe('171');
    expect(formatPressure(171.2, 'bar')).toBe('1.71');
  });

  it('round-trips a target typed in another unit', () => {
    for (const unit of ['psi', 'kpa', 'bar'] as const) {
      expect(pressureFromKpa(pressureToKpa(27, unit), unit)).toBeCloseTo(27);
    }
  });

  it('shows a placeholder rather than a zero for a missing reading', () => {
    expect(formatPressure(null, 'psi')).toBe(NO_READING);
    expect(formatPressure(undefined, 'kpa')).toBe(NO_READING);
  });
});

describe('temperature units', () => {
  it('converts for display only', () => {
    expect(formatTemperature(92, 'celsius')).toBe('92');
    expect(formatTemperature(92, 'fahrenheit')).toBe('198');
    expect(formatTemperature(null, 'celsius')).toBe(NO_READING);
  });
});

describe('tyreZones', () => {
  it('picks the layer the driver asked for', () => {
    expect(tyreZones(wheel(), 'surface')).toEqual([80, 85, 90]);
    expect(tyreZones(wheel(), 'innerLayer')).toEqual([82, 86, 91]);
  });

  it('spreads the single carcass reading across the tyre', () => {
    expect(tyreZones(wheel(), 'carcass')).toEqual([84, 84, 84]);
  });

  it('has nothing to draw without a reading', () => {
    expect(tyreZones(undefined, 'surface')).toBeNull();
    expect(tyreZones(wheel({ carcassTempC: null }), 'carcass')).toBeNull();
    expect(tyreZones(wheel({ surfaceTempC: null }), 'surface')).toBeNull();
  });
});

describe('mean', () => {
  it('averages the zones for the headline number', () => {
    expect(mean([80, 85, 90])).toBe(85);
    expect(mean(null)).toBeNull();
  });
});

describe('tyreWindow', () => {
  const config = { followCompound: true, range: 10, min: 80, max: 100 };

  it('centres on the working temperature the sim states', () => {
    expect(tyreWindow(config, 92)).toEqual({ min: 82, max: 102 });
  });

  it('falls back to the configured window when the sim states none', () => {
    expect(tyreWindow(config, null)).toEqual({ min: 80, max: 100 });
  });

  it('uses the configured window when told not to follow the compound', () => {
    expect(tyreWindow({ ...config, followCompound: false }, 92)).toEqual({
      min: 80,
      max: 100,
    });
  });

  it('accepts a window typed the wrong way round', () => {
    expect(
      tyreWindow({ followCompound: false, range: 10, min: 100, max: 80 }, null)
    ).toEqual({ min: 80, max: 100 });
  });
});

describe('temperatureColor', () => {
  const window = { min: 80, max: 100 };
  const green = temperatureColor(90, window, TYRE_FADE_C);

  it('is one colour anywhere inside the window', () => {
    expect(temperatureColor(80, window, TYRE_FADE_C)).toBe(green);
    expect(temperatureColor(100, window, TYRE_FADE_C)).toBe(green);
    expect(green).toBe('rgb(34 197 94)');
  });

  it('runs to blue below the window and stays there', () => {
    const cold = temperatureColor(80 - TYRE_FADE_C, window, TYRE_FADE_C);

    expect(cold).toBe('rgb(59 130 246)');
    expect(temperatureColor(-40, window, TYRE_FADE_C)).toBe(cold);
    // Part-way down is neither end.
    const cool = temperatureColor(70, window, TYRE_FADE_C);
    expect(cool).not.toBe(green);
    expect(cool).not.toBe(cold);
  });

  it('runs to red above the window and stays there', () => {
    const hot = temperatureColor(100 + TYRE_FADE_C, window, TYRE_FADE_C);

    expect(hot).toBe('rgb(239 68 68)');
    expect(temperatureColor(400, window, TYRE_FADE_C)).toBe(hot);
    const warm = temperatureColor(108, window, TYRE_FADE_C);
    expect(warm).not.toBe(green);
    expect(warm).not.toBe(hot);
  });

  it('fades a brake over a far wider range than a tyre', () => {
    // 50 C over is a ruined tyre and an unremarkable brake.
    const brakes = { min: 300, max: 700 };

    expect(temperatureColor(150, window, TYRE_FADE_C)).toBe('rgb(239 68 68)');
    expect(temperatureColor(750, brakes, BRAKE_FADE_C)).not.toBe(
      'rgb(239 68 68)'
    );
  });

  it('is neutral for a reading that is not there', () => {
    expect(temperatureColor(null, window, TYRE_FADE_C)).toBe(NO_READING_COLOR);
    expect(temperatureColor(undefined, window, TYRE_FADE_C)).toBe(
      NO_READING_COLOR
    );
  });
});

describe('pressureTone', () => {
  it('is on target inside the tolerance, either side', () => {
    expect(pressureTone(186, 186, 3.5, true)).toBe('onTarget');
    expect(pressureTone(182.5, 186, 3.5, true)).toBe('onTarget');
    expect(pressureTone(189.5, 186, 3.5, true)).toBe('onTarget');
  });

  it('says which way it is off', () => {
    expect(pressureTone(180, 186, 3.5, true)).toBe('low');
    expect(pressureTone(192, 186, 3.5, true)).toBe('high');
  });

  it('is plain when no target is set or nothing is read', () => {
    expect(pressureTone(192, 186, 3.5, false)).toBe('plain');
    expect(pressureTone(null, 186, 3.5, true)).toBe('plain');
  });
});

describe('formatTread', () => {
  it('shows what is left as a percentage', () => {
    expect(formatTread(0.984)).toBe('98%');
    expect(formatTread(1)).toBe('100%');
    expect(formatTread(null)).toBe(NO_READING);
  });
});
