import type { Session } from '@irdashies/types';

/**
 * How a lap is timed and sampled, in one place.
 *
 * Three things time laps from the lap fraction: the reference recorder, the
 * delta, and the lap library's recorder. A delta is one of their clocks set
 * against another's curve, so they have to agree on where a lap starts, how
 * the crossing is placed and where its samples sit, to the frame.
 */

/** Metres between two points of a lap's curve. */
export const TARGET_SPACING_METERS = 10;

/** The line is crossed when the lap fraction falls from above this... */
const WRAP_FROM_PCT = 0.95;
/** ...to below this. */
const WRAP_TO_PCT = 0.05;

/**
 * Longest gap between two frames that the line crossing is placed inside.
 * Past this the two frames are not neighbours and the later one is used as is.
 */
const MAX_CROSSING_GAP_SECONDS = 0.5;

/** The track's length in metres, or 0 when the session does not state one. */
export const trackLengthFrom = (session: Session): number => {
  const [value, unit] = session.WeekendInfo?.TrackLength?.split(' ') ?? [];
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return 0;
  return unit === 'km' ? parsed * 1000 : parsed;
};

/** How many points a lap of this length is sampled at. */
export const pointsCountFor = (trackLengthM: number): number =>
  Math.ceil(trackLengthM / TARGET_SPACING_METERS);

/** The lap fraction between two points, as the curves store it. */
export const intervalFor = (pointsCount: number): number =>
  Number.parseFloat((1 / pointsCount).toFixed(6));

/** Which point of the curve a lap fraction falls in. */
export const bucketIndex = (trackPct: number, pointsCount: number): number =>
  Math.min(Math.max(Math.floor(trackPct * pointsCount), 0), pointsCount - 1);

/** Whether the car went over the line between two lap fractions. */
export const isLineCrossing = (
  previousPct: number,
  trackPct: number
): boolean => previousPct > WRAP_FROM_PCT && trackPct < WRAP_TO_PCT;

/**
 * A lap fraction of exactly 0 is not a position. Le Mans Ultimate reports it
 * for a car that has not reached the line yet -- waiting on the grid, or
 * rolling up to the start -- and holds it there until the car crosses. A lap
 * timed from such a frame would count the wait as part of the lap, so no lap
 * starts on one. A moving car is never sampled at exactly 0.
 */
export const isHeldAtLine = (trackPct: number): boolean => trackPct === 0;

/**
 * When the car crossed the line, between the last frame before it and the
 * first one after.
 *
 * Taking the later frame's time starts every lap up to a frame late -- 16 ms
 * at 60 Hz -- and by a different amount each lap, which a delta between two
 * laps then carries for its whole length. The crossing is placed by distance
 * instead: the car covers the two sides of the line at very nearly one speed.
 */
export const crossingTime = (
  previousPct: number | null | undefined,
  trackPct: number,
  previousTime: number | null,
  sessionTime: number
): number => {
  if (previousTime === null || previousPct === null) return sessionTime;
  if (previousPct === undefined) return sessionTime;
  if (!(previousPct > 0.5) || !(trackPct < 0.5)) return sessionTime;
  const elapsed = sessionTime - previousTime;
  if (!(elapsed > 0) || elapsed > MAX_CROSSING_GAP_SECONDS) return sessionTime;
  const before = 1 - previousPct;
  const span = before + trackPct;
  return span > 0 ? previousTime + (before / span) * elapsed : sessionTime;
};
