import { describe, expect, it } from 'vitest';
import type { TrafficForecast } from '@irdashies/types';
import type { LapPlace } from '@irdashies/shared';
import {
  closingLevel,
  closingPerLapText,
  contactLapsText,
  forecastPlaceText,
  forecastTimeText,
  gapText,
} from './trafficText';

const LAP = 88;

const forecast = (
  overrides: Partial<TrafficForecast> = {}
): TrafficForecast => ({
  carIdx: 1,
  etaS: 18,
  lowS: 14,
  highS: 23,
  steady: true,
  laps: 0.2,
  meetPct: 0.55,
  meetLowPct: 0.5,
  meetHighPct: 0.6,
  ...overrides,
});

const CORNERS: LapPlace[] = [
  { startPct: 0.4, endPct: 0.465, label: 'Turn 5' },
  { startPct: 0.52, endPct: 0.575, label: 'Turn 6' },
  { startPct: 0.661, endPct: 0.72, label: 'The Corkscrew' },
];

describe('the forecast in words', () => {
  it('says about, in seconds', () => {
    expect(forecastTimeText(forecast(), LAP)).toBe('in about 18 s');
    // To the nearest five past twenty seconds, and ten past a minute.
    expect(forecastTimeText(forecast({ etaS: 33, laps: 0.38 }), LAP)).toBe(
      'in about 35 s'
    );
    expect(forecastTimeText(forecast({ etaS: 74, laps: 0.84 }), LAP)).toBe(
      'in about 70 s'
    );
  });

  it('gives a range when the closing has not been steady', () => {
    expect(
      forecastTimeText(
        forecast({ etaS: 28, lowS: 14, highS: 42, steady: false, laps: 0.31 }),
        LAP
      )
    ).toBe('in 14 to 40 s');
    // A range that rounds to one figure is said as one.
    expect(
      forecastTimeText(
        forecast({ etaS: 31, lowS: 31, highS: 32, steady: false }),
        LAP
      )
    ).toBe('in about 30 s');
  });

  it('counts an arrival a lap or more off in laps', () => {
    expect(forecastTimeText(forecast({ etaS: 284, laps: 3.23 }), LAP)).toBe(
      'in about 3 laps'
    );
    expect(forecastTimeText(forecast({ etaS: 150, laps: 1.7 }), LAP)).toBe(
      'in about 1.7 laps'
    );
    expect(forecastTimeText(forecast({ etaS: 90, laps: 1.02 }), LAP)).toBe(
      'in about 1.0 lap'
    );
    expect(
      forecastTimeText(
        forecast({
          etaS: 150,
          lowS: 100,
          highS: 200,
          steady: false,
          laps: 1.7,
        }),
        LAP
      )
    ).toBe('in 1.1 to 2.3 laps');
    // Without a lap time there are no laps to count in.
    expect(forecastTimeText(forecast({ etaS: 150, laps: null }), null)).toBe(
      'in about 150 s'
    );
  });

  it('stops counting when the car is there', () => {
    expect(forecastTimeText(forecast({ etaS: 1 }), LAP)).toBe('arriving now');
    expect(forecastPlaceText(forecast({ etaS: 1 }), CORNERS)).toBeNull();
  });

  it('names the corner, or the run up to it', () => {
    expect(forecastPlaceText(forecast(), CORNERS)).toBe('at Turn 6');
    expect(
      forecastPlaceText(
        forecast({ meetPct: 0.6, meetLowPct: 0.56, meetHighPct: 0.65 }),
        CORNERS
      )
    ).toBe('before The Corkscrew');
  });

  it('names no place the forecast is not sure of', () => {
    // From Turn 5 to the Corkscrew: two corners apart.
    expect(
      forecastPlaceText(
        forecast({ meetLowPct: 0.42, meetHighPct: 0.7 }),
        CORNERS
      )
    ).toBeNull();
    // Further off than it was measured for: no fraction at all.
    expect(
      forecastPlaceText(
        forecast({ meetPct: null, meetLowPct: null, meetHighPct: null }),
        CORNERS
      )
    ).toBeNull();
  });

  it('says how far round the lap on a track with no corner list', () => {
    expect(forecastPlaceText(forecast(), [])).toBe('55 % round the lap');
  });
});

describe('a closing rate as it is drawn', () => {
  it('picks the arrow', () => {
    expect(closingLevel(null)).toBeNull();
    expect(closingLevel(0.17)).toBe('fast');
    expect(closingLevel(0.03)).toBe('closing');
    expect(closingLevel(0.01)).toBe('steady');
    expect(closingLevel(-0.01)).toBe('steady');
    expect(closingLevel(-0.05)).toBe('dropping');
  });

  it('is seconds a lap', () => {
    // 1.3 s a lap is 0.015 s a second: too little to tell from holding
    // station over the few seconds the arrow is measured on.
    expect(closingPerLapText(1.3 / LAP, LAP)).toBeNull();
    expect(closingPerLapText(0.03, LAP)).toBe('2.6');
    expect(closingPerLapText(0.17, LAP)).toBe('15');
    expect(closingPerLapText(0.17, null)).toBeNull();
    expect(closingPerLapText(null, LAP)).toBeNull();
    expect(closingPerLapText(-0.1, LAP)).toBeNull();
  });

  it('writes gaps and laps to one decimal, and a dash for none', () => {
    expect(gapText(4.2)).toBe('4.2');
    expect(gapText(12)).toBe('12.0');
    expect(gapText(null)).toBe('--');
    expect(contactLapsText(3.56, 10)).toBe('3.6');
    expect(contactLapsText(12, 10)).toBe('--');
    expect(contactLapsText(null, 10)).toBe('--');
  });
});
