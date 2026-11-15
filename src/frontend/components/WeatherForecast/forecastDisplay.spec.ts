import { describe, expect, it } from 'vitest';
import {
  forecastTimeLabel,
  formatForecastCountdown,
  formatForecastPercent,
  formatForecastTemperature,
  formatForecastWind,
  isWetSky,
  NO_READING,
  rainBarWidth,
  skyAppearance,
} from './forecastDisplay';

describe('formatForecastCountdown', () => {
  it.each([
    [0, '<1m'],
    [1, '1m'],
    [12, '12m'],
    [59, '59m'],
    [60, '1.0h'],
    [84, '1.4h'],
    [150, '2.5h'],
    [1435, '23.9h'],
  ])('writes %s minutes as %s', (minutes, label) => {
    expect(formatForecastCountdown(minutes)).toBe(label);
  });

  it.each([[null], [undefined], [Number.NaN], [-1]])(
    'writes a dash for %s',
    (minutes) => {
      expect(formatForecastCountdown(minutes)).toBe(NO_READING);
    }
  );
});

describe('forecastTimeLabel', () => {
  it('marks a countdown as an estimate', () => {
    expect(forecastTimeLabel('countdown', 12, 55_020)).toBe('~12m');
    expect(forecastTimeLabel('countdown', 84, 55_020)).toBe('~1.4h');
  });

  it('leaves "under a minute" and a missing time unmarked', () => {
    expect(forecastTimeLabel('countdown', 0, 55_020)).toBe('<1m');
    // A race that ends on laps has no minutes.
    expect(forecastTimeLabel('countdown', null, null)).toBe(NO_READING);
  });

  it('writes the clock time a point starts at, marked as an estimate', () => {
    expect(forecastTimeLabel('clock', 4, 55_020)).toBe('~15:17');
    expect(forecastTimeLabel('clock', 14, 18_000)).toBe('~05:00');
  });

  it('writes a dash for a clock time not yet known', () => {
    // The time scale takes five seconds to measure.
    expect(forecastTimeLabel('clock', 4, null)).toBe(NO_READING);
    expect(forecastTimeLabel('clock', null, undefined)).toBe(NO_READING);
  });
});

describe('formatForecastTemperature', () => {
  it('rounds to a whole degree in the unit asked for', () => {
    expect(formatForecastTemperature(17, true)).toBe('17°');
    expect(formatForecastTemperature(17.15, true)).toBe('17°');
    expect(formatForecastTemperature(16.5, true)).toBe('17°');
    expect(formatForecastTemperature(17, false)).toBe('63°');
    expect(formatForecastTemperature(-3.6, true)).toBe('-4°');
  });

  it('writes a dash without a reading', () => {
    expect(formatForecastTemperature(null, true)).toBe(NO_READING);
    expect(formatForecastTemperature(undefined, false)).toBe(NO_READING);
  });
});

describe('formatForecastPercent and rainBarWidth', () => {
  it('writes a share as a whole percentage', () => {
    expect(formatForecastPercent(0)).toBe('0%');
    expect(formatForecastPercent(0.56)).toBe('56%');
    expect(formatForecastPercent(0.124)).toBe('12%');
    expect(formatForecastPercent(1)).toBe('100%');
    expect(formatForecastPercent(null)).toBe(NO_READING);
  });

  it('fills the bar in proportion and never past its ends', () => {
    expect(rainBarWidth(0)).toBe('0%');
    expect(rainBarWidth(0.35)).toBe('35%');
    expect(rainBarWidth(1.4)).toBe('100%');
    expect(rainBarWidth(-0.2)).toBe('0%');
    expect(rainBarWidth(null)).toBe('0%');
  });
});

describe('formatForecastWind', () => {
  it('writes the forecast’s metres per second in km/h or mph', () => {
    // The sim words 17 m/s as "61.2 kph".
    expect(formatForecastWind(17, true)).toBe('61');
    expect(formatForecastWind(17, false)).toBe('38');
    expect(formatForecastWind(0, true)).toBe('0');
    expect(formatForecastWind(null, true)).toBe(NO_READING);
  });
});

describe('skyAppearance', () => {
  it.each([
    [0, 'sun', 'fill', 'text-amber-300'],
    [1, 'cloudSun', 'regular', 'text-amber-200'],
    [2, 'cloudSun', 'fill', 'text-slate-200'],
    [3, 'cloud', 'regular', 'text-slate-200'],
    [4, 'cloud', 'fill', 'text-slate-400'],
    [5, 'cloudRain', 'regular', 'text-sky-300'],
    [6, 'cloudRain', 'regular', 'text-sky-300'],
    [7, 'cloudRain', 'fill', 'text-sky-400'],
    [8, 'cloudRain', 'fill', 'text-sky-400'],
    [9, 'cloudRain', 'fill', 'text-sky-500'],
    [10, 'cloudLightning', 'fill', 'text-red-400'],
  ] as const)('draws sky type %s as %s, %s', (sky, glyph, weight, colour) => {
    expect(skyAppearance(sky)).toMatchObject({
      glyph,
      weight,
      className: colour,
    });
  });

  it.each([[-1], [11], [2.5], [null], [undefined], [Number.NaN]])(
    'draws %s as unknown',
    (sky) => {
      expect(skyAppearance(sky)).toMatchObject({
        glyph: 'unknown',
        className: 'text-white/40',
      });
    }
  );

  it('names every sky for a tooltip', () => {
    const labels = Array.from(
      { length: 11 },
      (_, sky) => skyAppearance(sky).label
    );
    expect(labels.every((label) => label.length > 0)).toBe(true);
    expect(labels[0]).toBe('Clear');
    expect(labels[10]).toBe('Storm');
  });
});

describe('isWetSky', () => {
  it('is rain from drizzle to storm', () => {
    expect([0, 4, 5, 8, 10].map(isWetSky)).toEqual([
      false,
      false,
      true,
      true,
      true,
    ]);
    expect(isWetSky(-1)).toBe(false);
    expect(isWetSky(11)).toBe(false);
    expect(isWetSky(null)).toBe(false);
  });
});
