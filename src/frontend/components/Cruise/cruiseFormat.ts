import {
  METRES_PER_KILOMETRE,
  METRES_PER_MILE,
  METRES_TO_FEET,
} from '@irdashies/domain/units/distance';

/**
 * The cruise block's figures as they are printed. Readings, not judgements:
 * nothing here colours a value.
 */

/** What a cell shows without a reading. */
export const NO_READING = '--';

const BEARINGS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

/**
 * The bearing a compass heading lies in: north from 337.5 to 22.5 degrees,
 * then north-east, east and so on round in sectors of 45.
 */
export const compassBearing = (headingDeg: number): string => {
  const wrapped = ((headingDeg % 360) + 360) % 360;
  return BEARINGS[Math.floor((wrapped + 22.5) / 45) % 8];
};

/** A heading as three digits: 45 is "045". */
export const formatHeading = (headingDeg: number): string =>
  String(((Math.round(headingDeg) % 360) + 360) % 360).padStart(3, '0');

/** A figure and the unit it is in, drawn apart. */
export interface Figure {
  value: string;
  unit: string;
}

/** A height or a distance into the lap: whole metres or whole feet. */
export const formatMetres = (metres: number, metric: boolean): Figure => ({
  // The 0 added keeps a negative zero from printing as "-0".
  value: String(Math.round(metric ? metres : metres * METRES_TO_FEET) + 0),
  unit: metric ? 'm' : 'ft',
});

/** Distance driven: kilometres or miles to one decimal. */
export const formatOdometer = (metres: number, metric: boolean): Figure => ({
  value: (
    Math.max(metres, 0) / (metric ? METRES_PER_KILOMETRE : METRES_PER_MILE)
  ).toFixed(1),
  unit: metric ? 'km' : 'mi',
});

const two = (value: number): string => String(value).padStart(2, '0');

/**
 * Time driven: hours and minutes from an hour up, minutes and seconds
 * below it. "12h 34m", "34m 05s".
 */
export const formatTimeOnTrack = (seconds: number): string => {
  const whole = Math.max(Math.floor(seconds), 0);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  return hours > 0
    ? `${hours}h ${two(minutes)}m`
    : `${minutes}m ${two(whole % 60)}s`;
};

/** A drift angle in whole degrees, without a sign: the needle shows the side. */
export const formatDrift = (driftDeg: number): string =>
  `${Math.round(Math.abs(driftDeg))}°`;
