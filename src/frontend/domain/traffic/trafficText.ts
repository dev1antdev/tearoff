import type { TrafficForecast } from '@irdashies/types';
import { placeOfCatch, type LapPlace } from '@irdashies/shared';

/**
 * What the traffic widget writes: the forecast as words, and how a closing
 * rate is drawn. Pure, so the wording is tested once and every surface that
 * shows a forecast says it the same way.
 */

/** An arrival nearer than this is not counted down: it is here. */
const ARRIVING_S = 2;

/** Whole seconds up to twenty, then to the nearest five, then ten. */
const roundSeconds = (seconds: number): number => {
  if (seconds <= 20) return Math.round(seconds);
  if (seconds <= 60) return Math.round(seconds / 5) * 5;
  return Math.round(seconds / 10) * 10;
};

/** One decimal below three laps, whole laps from there. */
const formatLaps = (laps: number): string =>
  laps < 3 ? laps.toFixed(1) : String(Math.round(laps));

const lapWord = (laps: string): string => (laps === '1.0' ? 'lap' : 'laps');

/**
 * When the car arrives, in words. Always "about", or a range where the
 * closing rate has not been steady enough for one figure. An arrival a lap
 * or more off is given in laps of the player's.
 */
export const forecastTimeText = (
  forecast: TrafficForecast,
  lapS: number | null
): string => {
  if (forecast.etaS < ARRIVING_S) return 'arriving now';
  if (forecast.laps !== null && forecast.laps >= 1 && lapS !== null) {
    if (forecast.steady) {
      const laps = formatLaps(forecast.laps);
      return `in about ${laps} ${lapWord(laps)}`;
    }
    const low = formatLaps(forecast.lowS / lapS);
    const high = formatLaps(forecast.highS / lapS);
    return low === high
      ? `in about ${low} ${lapWord(low)}`
      : `in ${low} to ${high} laps`;
  }
  if (forecast.steady) return `in about ${roundSeconds(forecast.etaS)} s`;
  const low = roundSeconds(forecast.lowS);
  const high = roundSeconds(forecast.highS);
  return low === high ? `in about ${low} s` : `in ${low} to ${high} s`;
};

/**
 * Where the car arrives, or null when the forecast names no place: "at
 * Turn 6" inside a corner, "before Turn 6" on the run up to it. On a track
 * with no corner list it is how far round the lap.
 */
export const forecastPlaceText = (
  forecast: TrafficForecast,
  corners: readonly LapPlace[]
): string | null => {
  if (forecast.etaS < ARRIVING_S || forecast.meetPct === null) return null;
  if (corners.length === 0) {
    return `${Math.round(forecast.meetPct * 100)} % round the lap`;
  }
  const place = placeOfCatch(forecast, corners);
  if (!place) return null;
  return `${place.inCorner ? 'at' : 'before'} ${place.label}`;
};

/** How a closing rate is drawn: which arrow, if any. */
export type ClosingLevel = 'fast' | 'closing' | 'steady' | 'dropping';

/** A tenth of a second a second is a prototype on a GT car. */
const FAST_CLOSING_S = 0.1;
/** Less than this either way is holding station. */
const STEADY_CLOSING_S = 0.02;

/** The arrow for a closing rate; null where none has been measured. */
export const closingLevel = (closingS: number | null): ClosingLevel | null => {
  if (closingS === null) return null;
  if (closingS >= FAST_CLOSING_S) return 'fast';
  if (closingS >= STEADY_CLOSING_S) return 'closing';
  if (closingS <= -STEADY_CLOSING_S) return 'dropping';
  return 'steady';
};

/**
 * Seconds a lap a car is gaining, as racing says it: "1.3" for a rival,
 * "15" for a prototype. Null without a lap time or a rate, and for a car
 * that is not gaining.
 */
export const closingPerLapText = (
  closingS: number | null,
  lapS: number | null
): string | null => {
  if (closingS === null || lapS === null || closingS < STEADY_CLOSING_S) {
    return null;
  }
  const perLap = closingS * lapS;
  return perLap < 10 ? perLap.toFixed(1) : String(Math.round(perLap));
};

/** A gap as the widget writes it: one decimal, or a dash. */
export const gapText = (gapS: number | null): string =>
  gapS === null ? '--' : gapS.toFixed(1);

/**
 * Laps until a contact, one decimal, or a dash for none and for one beyond
 * the furthest the settings want drawn.
 */
export const contactLapsText = (
  laps: number | null,
  maxLaps: number
): string => (laps === null || laps > maxLaps ? '--' : laps.toFixed(1));
