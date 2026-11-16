/**
 * When and where a car that is catching another arrives.
 *
 * Pure arithmetic, shared by the main-process traffic processor, which
 * measures the closing, and the renderer, which names the place from the
 * track's corner list.
 *
 * The forecast is an estimate and is built to say so. It starts from a
 * measured interval and a measured closing rate, never from a lap time a
 * sim states; it is withheld until that rate has been steady for a few
 * seconds; it carries a range, and a place only where the whole range
 * agrees on one.
 */

/** A closing rate must have been measured without a break for this long. */
export const FORECAST_STEADY_S = 6;
/**
 * The interval must have closed by this much in the time it was measured
 * over, seconds: less is two cars taking a corner differently, not one
 * catching the other.
 */
export const FORECAST_MIN_FALL_S = 0.5;
/**
 * However steady the rate, the arrival is never said closer than a quarter
 * either side. On a recorded race the arrival worked out from twenty
 * seconds of closing was out by a fifth on average, whether it was five
 * seconds off or forty-five.
 */
const RANGE_FLOOR = 0.25;
/** Either end further than this factor from the figure makes it a range. */
const STEADY_FACTOR = 1.5;
/** A range whose ends differ by more than this factor says nothing. */
const USELESS_FACTOR = 3;
/** Contacts further off than this many laps are not forecast at all. */
export const FORECAST_MAX_LAPS = 50;

export interface CatchInput {
  /**
   * The interval now, seconds: how long ago the car ahead was where the
   * chasing car is.
   */
  gapS: number;
  /**
   * Fall of the interval per second over the time it was measured;
   * positive is closing. The forecast is made from this one.
   */
  closingS: number;
  /**
   * The same over the newer half of that time and over the older half.
   * Where they agree the closing is steady; how far apart they are is how
   * wide the forecast is.
   */
  closingQuickS: number;
  closingSlowS: number;
  /** Seconds the closing was measured over. */
  measuredS: number;
  /** Measured lap time of the car being caught, seconds; null without one. */
  lapS: number | null;
  /** Measured lap time of the chasing car, seconds; null without one. */
  chaserLapS: number | null;
  /** Lap fraction of the car being caught, 0..1. */
  pct: number;
  /**
   * Laps the car being caught covers in the next `seconds`, from its own
   * recorded running where there is one. Omitted, or returning null, the
   * lap time is used; without that either, no place is given.
   */
  travel?: (seconds: number) => number | null;
}

export interface CatchForecast {
  /** Seconds until the chasing car arrives. */
  etaS: number;
  /** The earliest and the latest arrival the measurements support. */
  lowS: number;
  highS: number;
  /** The range is narrow enough to be said as one figure. */
  steady: boolean;
  /** Laps of the car being caught until then; null without a lap time. */
  laps: number | null;
  /**
   * Lap fraction at which they meet, and the same for both ends of the
   * range. Null for an arrival further off than the closing was measured
   * for, or a lap or more off: neither is given a place.
   */
  meetPct: number | null;
  meetLowPct: number | null;
  meetHighPct: number | null;
}

const wrap01 = (pct: number): number => ((pct % 1) + 1) % 1;

/**
 * Forecasts the arrival of a chasing car, or returns null when there is
 * nothing honest to say: the closing has not been measured for long enough,
 * the interval has not closed by anything a stopwatch would see, it was not
 * closing in one half of the time, or the answers are more than a factor of
 * three apart.
 *
 * The arrival is the interval over the measured closing rate. The two
 * halves of the time it was measured over give two more arrivals, and those
 * are the range.
 *
 * An arrival further off than the closing was measured for is another
 * matter. A prototype gains more through the fast corners than under
 * braking, so twenty seconds of closing say little about the forty after
 * them: on a recorded race such a forecast was a third too early. There the
 * lap times have a say: what a car gains over a whole lap is the difference
 * of the two lap times, and the arrival that gives widens the range. A car
 * whose laps are no quicker than those of the car ahead is not forecast to
 * arrive that far off at all, and with no lap times to check against the
 * range is doubled and never said as one figure. No place is named for an
 * arrival that far off either way.
 */
export const forecastCatch = (input: CatchInput): CatchForecast | null => {
  const { gapS, measuredS } = input;
  if (!(gapS > 0) || measuredS < FORECAST_STEADY_S) return null;
  if (
    !(input.closingS * measuredS >= FORECAST_MIN_FALL_S) ||
    !(input.closingQuickS > 0) ||
    !(input.closingSlowS > 0)
  ) {
    return null;
  }
  const lapS = input.lapS !== null && input.lapS > 0 ? input.lapS : null;
  const chaserLapS =
    input.chaserLapS !== null && input.chaserLapS > 0 ? input.chaserLapS : null;

  const etaS = gapS / input.closingS;
  const quick = gapS / input.closingQuickS;
  const slow = gapS / input.closingSlowS;
  const beyond = etaS > measuredS;
  const checked = lapS !== null && chaserLapS !== null;
  const floor = beyond && !checked ? RANGE_FLOOR * 2 : RANGE_FLOOR;
  let lowS = Math.min(quick, slow, etaS * (1 - floor));
  let highS = Math.max(quick, slow, etaS * (1 + floor));
  if (beyond && lapS !== null && chaserLapS !== null) {
    // What the chaser gains per second over a whole lap of the car ahead.
    const paceClosingS = 1 - chaserLapS / lapS;
    if (!(paceClosingS > 0)) return null;
    const byPace = gapS / paceClosingS;
    lowS = Math.min(lowS, byPace);
    highS = Math.max(highS, byPace);
  }
  if (highS > lowS * USELESS_FACTOR) return null;
  const laps = lapS !== null ? etaS / lapS : null;
  if (laps !== null && laps > FORECAST_MAX_LAPS) return null;

  const travelled = (seconds: number): number | null =>
    input.travel?.(seconds) ?? (lapS !== null ? seconds / lapS : null);
  const meetAt = (seconds: number): number | null => {
    if (beyond) return null;
    const lapsOn = travelled(seconds);
    return lapsOn !== null && lapsOn >= 0 && lapsOn < 1
      ? wrap01(input.pct + lapsOn)
      : null;
  };

  return {
    etaS,
    lowS,
    highS,
    steady:
      (!beyond || checked) &&
      highS <= etaS * STEADY_FACTOR &&
      lowS >= etaS / STEADY_FACTOR,
    laps,
    meetPct: meetAt(etaS),
    meetLowPct: meetAt(lowS),
    meetHighPct: meetAt(highS),
  };
};

/** A named stretch of the lap: a corner, as the track data lists it. */
export interface LapPlace {
  /** Where it starts and ends, lap fractions; it may wrap the line. */
  startPct: number;
  endPct: number;
  label: string;
}

export interface NamedPlace {
  label: string;
  /** In the corner itself; false on the run up to it. */
  inCorner: boolean;
  /** Position of the corner in the list. */
  index: number;
}

const isInside = (place: LapPlace, pct: number): boolean =>
  place.startPct <= place.endPct
    ? pct >= place.startPct && pct <= place.endPct
    : pct >= place.startPct || pct <= place.endPct;

/**
 * The corner a lap fraction falls in, or failing that the next corner after
 * it, which the fraction is then on the run up to. Null without corners.
 */
export const placeAt = (
  places: readonly LapPlace[],
  pct: number
): NamedPlace | null => {
  if (places.length === 0) return null;
  let next = -1;
  let nextAhead = Number.POSITIVE_INFINITY;
  for (let index = 0; index < places.length; index += 1) {
    const place = places[index];
    if (isInside(place, pct)) {
      return { label: place.label, inCorner: true, index };
    }
    const ahead = wrap01(place.startPct - pct);
    if (ahead < nextAhead) {
      nextAhead = ahead;
      next = index;
    }
  }
  return { label: places[next].label, inCorner: false, index: next };
};

/**
 * Where a forecast puts the meeting, as a corner, or null when it cannot
 * say: no corners are known, the arrival is a lap or more off, or the
 * earliest and the latest arrival are more than one corner apart.
 */
export const placeOfCatch = (
  forecast: Pick<CatchForecast, 'meetPct' | 'meetLowPct' | 'meetHighPct'>,
  places: readonly LapPlace[]
): NamedPlace | null => {
  const { meetPct, meetLowPct, meetHighPct } = forecast;
  if (meetPct === null || meetLowPct === null || meetHighPct === null) {
    return null;
  }
  const middle = placeAt(places, meetPct);
  const low = placeAt(places, meetLowPct);
  const high = placeAt(places, meetHighPct);
  if (!middle || !low || !high) return null;
  // Counted forwards from the earliest to the latest, round the lap.
  const apart = (high.index - low.index + places.length) % places.length;
  return apart <= 1 ? middle : null;
};
