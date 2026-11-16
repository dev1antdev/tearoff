import { describe, expect, it } from 'vitest';
import {
  forecastCatch,
  placeAt,
  placeOfCatch,
  type CatchInput,
  type LapPlace,
} from './trafficForecast';

/** The player's lap, seconds. */
const LAP = 88;

/** A steady closing measured over twenty seconds, unless a case says. */
const input = (overrides: Partial<CatchInput>): CatchInput => {
  const closingS = overrides.closingS ?? 0.25;
  return {
    gapS: 4.25,
    closingS,
    closingQuickS: closingS,
    closingSlowS: closingS,
    measuredS: 20,
    lapS: LAP,
    chaserLapS: null,
    pct: 0.36,
    ...overrides,
  };
};

/** Laguna Seca's corners, as the bundled track data places them. */
const CORNERS: LapPlace[] = [
  { startPct: 0.045, endPct: 0.08, label: 'Turn 1' },
  { startPct: 0.1, endPct: 0.173, label: 'Andretti Hairpin' },
  { startPct: 0.191, endPct: 0.245, label: 'Turn 3' },
  { startPct: 0.265, endPct: 0.321, label: 'Turn 4' },
  { startPct: 0.4, endPct: 0.465, label: 'Turn 5' },
  { startPct: 0.52, endPct: 0.575, label: 'Turn 6' },
  { startPct: 0.661, endPct: 0.72, label: 'The Corkscrew' },
  { startPct: 0.725, endPct: 0.79, label: 'Turn 9' },
  { startPct: 0.805, endPct: 0.855, label: 'Turn 10' },
  { startPct: 0.89, endPct: 0.94, label: 'Turn 11' },
];

describe('the forecast of a catch', () => {
  it('puts a prototype closing at a quarter of a second a second 17 s off, at Turn 6', () => {
    const forecast = forecastCatch(input({}));

    expect(forecast).not.toBeNull();
    expect(forecast?.etaS).toBeCloseTo(17, 6);
    // Never said closer than a quarter either side.
    expect(forecast?.lowS).toBeCloseTo(12.75, 6);
    expect(forecast?.highS).toBeCloseTo(21.25, 6);
    expect(forecast?.steady).toBe(true);
    expect(forecast?.laps).toBeCloseTo(17 / LAP, 6);
    // 17 s of an 88 s lap on from 36 % round: 55.3 %, inside Turn 6.
    expect(forecast?.meetPct).toBeCloseTo(0.5532, 3);
    expect(placeOfCatch(forecast ?? missing(), CORNERS)).toEqual({
      label: 'Turn 6',
      inCorner: true,
      index: 5,
    });
  });

  it('gives a prototype 4.2 s behind closing at 1.3 s a lap three laps and no corner', () => {
    // 1.3 s a lap is 0.0148 s a second: it takes most of a minute to show.
    const closingS = 1.3 / LAP;
    const forecast = forecastCatch(
      input({
        gapS: 4.2,
        closingS,
        closingQuickS: closingS,
        closingSlowS: closingS,
        measuredS: 60,
        chaserLapS: LAP - 1.3,
      })
    );

    expect(forecast?.etaS).toBeCloseTo((4.2 / 1.3) * LAP, 3);
    expect(forecast?.laps).toBeCloseTo(3.23, 2);
    // The lap times agree with the measurement, so it is one figure.
    expect(forecast?.steady).toBe(true);
    // It will not arrive within the lap: no place.
    expect(forecast?.meetPct).toBeNull();
    expect(placeOfCatch(forecast ?? missing(), CORNERS)).toBeNull();
  });

  it('says nothing about a car that has stopped closing', () => {
    // Closing over the whole time, but not over its newer half.
    expect(forecastCatch(input({ closingQuickS: 0 }))).toBeNull();
    expect(forecastCatch(input({ closingQuickS: -0.05 }))).toBeNull();
    // Nor about one that only started to.
    expect(forecastCatch(input({ closingSlowS: 0 }))).toBeNull();
    expect(forecastCatch(input({ closingS: -0.1 }))).toBeNull();
  });

  it('waits until the closing has been measured for six seconds', () => {
    expect(forecastCatch(input({ measuredS: 5 }))).toBeNull();
    expect(forecastCatch(input({ measuredS: 6 }))).not.toBeNull();
  });

  it('needs the interval to have closed by half a second', () => {
    // 0.02 s a second over 20 s is 0.4 s: two cars through a corner.
    const slow = { closingS: 0.02, closingQuickS: 0.02, closingSlowS: 0.02 };
    expect(forecastCatch(input({ ...slow, measuredS: 20 }))).toBeNull();
    // Over a minute it is 1.2 s, which is closing.
    expect(forecastCatch(input({ ...slow, measuredS: 60 }))).not.toBeNull();
  });

  it('widens when the two halves disagree, and goes when they are far apart', () => {
    const swinging = forecastCatch(
      input({ gapS: 4, closingS: 0.2, closingQuickS: 0.35, closingSlowS: 0.15 })
    );
    expect(swinging?.etaS).toBeCloseTo(20, 6);
    expect(swinging?.lowS).toBeCloseTo(4 / 0.35, 6);
    expect(swinging?.highS).toBeCloseTo(4 / 0.15, 6);
    expect(swinging?.steady).toBe(false);

    expect(
      forecastCatch(
        input({ gapS: 4, closingS: 0.2, closingQuickS: 0.5, closingSlowS: 0.1 })
      )
    ).toBeNull();
  });

  it('doubles the range of an arrival further off than it was measured for', () => {
    // 6 s at 0.15 s a second is 40 s off, twice the 20 s it was measured.
    const forecast = forecastCatch(
      input({
        gapS: 6,
        closingS: 0.15,
        closingQuickS: 0.15,
        closingSlowS: 0.15,
      })
    );

    expect(forecast?.etaS).toBeCloseTo(40, 6);
    expect(forecast?.lowS).toBeCloseTo(20, 6);
    expect(forecast?.highS).toBeCloseTo(60, 6);
    expect(forecast?.steady).toBe(false);
    expect(forecast?.meetPct).toBeNull();
  });

  it('lets the lap times widen an arrival that far off, and vouch for it', () => {
    const closing = { closingS: 0.15, closingQuickS: 0.15, closingSlowS: 0.15 };
    // 90 s laps against 80 s laps: 0.111 s a second over a lap, 54 s off.
    const forecast = forecastCatch(
      input({ gapS: 6, ...closing, lapS: 90, chaserLapS: 80 })
    );
    expect(forecast?.etaS).toBeCloseTo(40, 6);
    expect(forecast?.lowS).toBeCloseTo(30, 6);
    expect(forecast?.highS).toBeCloseTo(54, 6);
    expect(forecast?.steady).toBe(true);
    expect(forecast?.meetPct).toBeNull();

    // A car whose laps are no quicker is not forecast to arrive that far
    // off, however it is closing now.
    expect(
      forecastCatch(input({ gapS: 6, ...closing, lapS: 90, chaserLapS: 90 }))
    ).toBeNull();
    // Inside the time it was measured for, the measurement stands alone.
    expect(
      forecastCatch(input({ gapS: 2, ...closing, lapS: 90, chaserLapS: 95 }))
        ?.etaS
    ).toBeCloseTo(2 / 0.15, 6);
  });

  it('reads the place off the caught car’s own running where it has one', () => {
    // A slow corner ahead: in 17 s it covers 0.1 of a lap, not 0.193.
    const forecast = forecastCatch(
      input({ travel: (seconds) => (seconds / 17) * 0.1 })
    );
    expect(forecast?.meetPct).toBeCloseTo(0.46, 6);

    // Where that running does not reach, the lap time stands in.
    const fallback = forecastCatch(input({ travel: () => null }));
    expect(fallback?.meetPct).toBeCloseTo(0.5532, 3);
    // With neither there is a time and no place.
    const nowhere = forecastCatch(input({ lapS: null }));
    expect(nowhere?.etaS).toBeCloseTo(17, 6);
    expect(nowhere?.laps).toBeNull();
    expect(nowhere?.meetPct).toBeNull();
  });

  it('wraps a meeting past the line', () => {
    const forecast = forecastCatch(input({ pct: 0.95 }));
    expect(forecast?.meetPct).toBeCloseTo(0.95 + 17 / LAP - 1, 6);
  });
});

describe('the place of a catch', () => {
  it('names the corner a fraction is in, or the next one after it', () => {
    expect(placeAt(CORNERS, 0.55)).toEqual({
      label: 'Turn 6',
      inCorner: true,
      index: 5,
    });
    // On the Rahal Straight: on the run to the Corkscrew.
    expect(placeAt(CORNERS, 0.6)).toEqual({
      label: 'The Corkscrew',
      inCorner: false,
      index: 6,
    });
    // After Turn 11 the next corner is Turn 1, across the line.
    expect(placeAt(CORNERS, 0.97)).toEqual({
      label: 'Turn 1',
      inCorner: false,
      index: 0,
    });
    expect(placeAt([], 0.5)).toBeNull();
  });

  it('knows a corner that wraps the line', () => {
    const wrapped: LapPlace[] = [
      { startPct: 0.97, endPct: 0.03, label: 'First' },
      { startPct: 0.5, endPct: 0.6, label: 'Second' },
    ];
    expect(placeAt(wrapped, 0.99)?.label).toBe('First');
    expect(placeAt(wrapped, 0.01)?.inCorner).toBe(true);
    expect(placeAt(wrapped, 0.2)).toEqual({
      label: 'Second',
      inCorner: false,
      index: 1,
    });
  });

  it('names a place only where the earliest and latest arrival agree on it', () => {
    const meeting = (low: number, middle: number, high: number) =>
      placeOfCatch(
        { meetPct: middle, meetLowPct: low, meetHighPct: high },
        CORNERS
      );

    // The run to Turn 6, Turn 6, the straight after it: neighbours.
    expect(meeting(0.5, 0.55, 0.6)?.label).toBe('Turn 6');
    // Turn 5 to the Corkscrew is two corners apart.
    expect(meeting(0.42, 0.55, 0.7)).toBeNull();
    // Round the line: Turn 11 and Turn 1 are neighbours.
    expect(meeting(0.9, 0.97, 0.05)?.label).toBe('Turn 1');
    expect(
      placeOfCatch(
        { meetPct: 0.55, meetLowPct: null, meetHighPct: 0.6 },
        CORNERS
      )
    ).toBeNull();
    expect(
      placeOfCatch({ meetPct: 0.55, meetLowPct: 0.5, meetHighPct: 0.6 }, [])
    ).toBeNull();
  });
});

function missing(): never {
  throw new Error('expected a forecast');
}
