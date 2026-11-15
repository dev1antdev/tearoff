/**
 * How the figures of the wheel channels are read: millimetres into angles,
 * and when a corner is bottoming, lifted, lightly loaded or cold.
 *
 * The tyre and chassis widgets draw by these rules. A recorded race can only
 * be played in the main process, and the specs that play one have to judge
 * its readings by the same rules the widgets do, so the rules are here.
 */

const DEG_PER_RAD = 180 / Math.PI;

/**
 * The angle of a difference in height over a length, degrees: rake over the
 * wheelbase, roll over a track width. 0 for a length that is not one.
 */
export const chassisAngleDeg = (riseMm: number, lengthMm: number): number =>
  lengthMm > 0 ? Math.atan(riseMm / lengthMm) * DEG_PER_RAD : 0;

/**
 * The front axle's share of the two roll angles, given its share of the two
 * differences in ride height. The same number when the tracks are equal; a
 * narrower axle leans further for the same difference, and gets more.
 */
export const rollAngleShare = (
  rollShareFront: number,
  trackFrontMm: number,
  trackRearMm: number
): number => {
  if (!(trackFrontMm > 0) || !(trackRearMm > 0)) return rollShareFront;
  const front = rollShareFront / trackFrontMm;
  const rear = (1 - rollShareFront) / trackRearMm;
  return front + rear > 0 ? front / (front + rear) : rollShareFront;
};

/** A corner is bottoming while its ride height is below the threshold. */
export const isBottoming = (
  rideHeightMm: number,
  thresholdMm: number
): boolean => rideHeightMm < thresholdMm;

export type ToeDirection = 'in' | 'out';

/**
 * Which way an axle's total toe points, or null for one that reads 0.00:
 * neither word belongs beside a zero. Positive is toe-in.
 */
export const toeDirection = (totalDeg: number): ToeDirection | null => {
  const hundredths = Math.round(totalDeg * 100);
  if (hundredths === 0) return null;
  return hundredths > 0 ? 'in' : 'out';
};

/** A wheel's share of the car's load as the whole percentage drawn. */
export const loadSharePercent = (share: number): number =>
  Math.round(share * 100);

/** The share at which a wheel's load bar is full: half the car's load. */
export const LOAD_BAR_FULL_SHARE = 0.5;

/** How much of its bar a wheel's share fills, 0..1. */
export const loadBarFill = (share: number): number =>
  Math.min(Math.max(share / LOAD_BAR_FULL_SHARE, 0), 1);

/**
 * A wheel carrying next to nothing: the percentage drawn is at or below the
 * threshold, so the figure on screen and its colour never disagree.
 */
export const isLoadLow = (share: number, thresholdPercent: number): boolean =>
  loadSharePercent(share) <= thresholdPercent;

/** Tyre deflection as the whole millimetres drawn. */
export const deflectionMillimetres = (deflectionMm: number): number =>
  Math.round(deflectionMm);

/**
 * A wheel off the ground, or all but: the millimetres drawn are at or below
 * the threshold. A wheel in the air reads exactly 0.
 */
export const isWheelLifted = (
  deflectionMm: number,
  thresholdMm: number
): boolean => deflectionMillimetres(deflectionMm) <= thresholdMm;

/**
 * Whether a tyre is too cold for its pressure to be judged against a hot
 * target: its carcass is below the threshold. A threshold of 0 switches the
 * rule off, and a wheel with no carcass reading is never called cold.
 */
export const isPressureCold = (
  carcassTempC: number | null | undefined,
  coldBelowC: number
): boolean =>
  coldBelowC > 0 &&
  typeof carcassTempC === 'number' &&
  carcassTempC < coldBelowC;
