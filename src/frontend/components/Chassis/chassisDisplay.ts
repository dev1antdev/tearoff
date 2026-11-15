import type { ChassisConfig } from '@irdashies/types';
import {
  chassisAngleDeg,
  isBottoming,
  rollAngleShare,
  toeDirection,
} from '@irdashies/shared';

/**
 * Pure display logic for the chassis widget: millimetres into angles, which
 * corner is bottoming, and how each figure is written. Kept apart from the
 * component so each rule can be tested without rendering anything.
 *
 * The rules themselves are shared with the specs that read a recorded race,
 * and handed on from here so the widget has one place to look.
 */
export { chassisAngleDeg, isBottoming, rollAngleShare, toeDirection };

/** Shown where the sim has given no reading. */
export const NO_READING = '--';

type Reading = number | null | undefined;
type Readings = readonly number[] | null | undefined;

const isNumber = (value: Reading): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * A figure with its sign in front: "+0.18", "-0.10". One that rounds to
 * nothing is written without a sign, so "-0.00" never appears.
 */
export const formatSigned = (value: number, decimals: number): string => {
  const magnitude = Math.abs(value).toFixed(decimals);
  if (Number(magnitude) === 0) return magnitude;
  return value > 0 ? `+${magnitude}` : `-${magnitude}`;
};

/** Whole millimetres. A reading a hair under zero is written "0", not "-0". */
export const formatMillimetres = (value: Reading): string =>
  isNumber(value) ? String(Math.round(value) + 0) : NO_READING;

/** One corner of the ride height row. */
export interface RideHeightCorner {
  /** Whole millimetres, or the placeholder. */
  text: string;
  /** How much of the bar is filled, 0..1. */
  fill: number;
  bottoming: boolean;
}

const NO_CORNER: RideHeightCorner = {
  text: NO_READING,
  fill: 0,
  bottoming: false,
};

type RideHeightSettings = Pick<
  ChassisConfig,
  'rideHeightScale' | 'bottomingFront' | 'bottomingRear'
>;

/**
 * The four ride heights, LF RF LR RR: the figure, how full its bar is and
 * whether the corner is bottoming. Placeholders without a reading.
 */
export const rideHeightCorners = (
  heights: Readings,
  settings: RideHeightSettings
): RideHeightCorner[] =>
  [0, 1, 2, 3].map((wheel) => {
    const height = heights?.[wheel];
    if (!isNumber(height)) return NO_CORNER;
    const threshold =
      wheel < 2 ? settings.bottomingFront : settings.bottomingRear;
    return {
      text: formatMillimetres(height),
      fill:
        settings.rideHeightScale > 0
          ? Math.min(Math.max(height / settings.rideHeightScale, 0), 1)
          : 0,
      bottoming: isBottoming(height, threshold),
    };
  });

export interface RakeFigure {
  /** "+0.20°", or the placeholder. */
  angle: string;
  /** "10 mm", or empty without a reading. */
  millimetres: string;
  /** The nose is the higher end: drawn as low. */
  low: boolean;
}

/**
 * Rake as an angle over the wheelbase, with the millimetres it was taken
 * from. Positive is the rear higher than the front.
 */
export const rakeFigure = (
  rakeMm: Reading,
  wheelbaseMm: number
): RakeFigure => {
  if (!isNumber(rakeMm)) {
    return { angle: NO_READING, millimetres: '', low: false };
  }
  const angle = formatSigned(chassisAngleDeg(rakeMm, wheelbaseMm), 2);
  return {
    angle: `${angle}°`,
    millimetres: `${formatMillimetres(rakeMm)} mm`,
    // Judged on the figure drawn, so a rake that reads 0.00 is not blue.
    low: angle.startsWith('-'),
  };
};

/**
 * Roll at one axle as an angle over its track width, in degrees. Positive is
 * the right side higher, which is what a right-hand corner does. Written
 * without a degree sign: two of them, a letter each and the share have to
 * fit on one line.
 */
export const rollFigure = (rollMm: Reading, trackMm: number): string =>
  isNumber(rollMm)
    ? formatSigned(chassisAngleDeg(rollMm, trackMm), 2)
    : NO_READING;

/** The front axle's share of the roll angle as a whole percentage. */
export const rollShareFigure = (
  rollShareFront: Reading,
  trackFrontMm: number,
  trackRearMm: number
): string =>
  isNumber(rollShareFront)
    ? `${Math.round(rollAngleShare(rollShareFront, trackFrontMm, trackRearMm) * 100)}%`
    : NO_READING;

export interface CamberFigure {
  /** "-2.0", or the placeholder. */
  text: string;
  /** Upright or leaning out: zero or above, on the figure drawn. */
  positive: boolean;
}

/** Camber at one wheel, signed, to a tenth of a degree. */
export const camberFigure = (camberDeg: Reading): CamberFigure => {
  if (!isNumber(camberDeg)) return { text: NO_READING, positive: false };
  const text = formatSigned(camberDeg, 1);
  return { text, positive: !text.startsWith('-') };
};

/**
 * The total toe of an axle as a magnitude and a word: "0.21 in",
 * "0.10 out". A total that reads 0.00 gets no word.
 */
export const axleToeFigure = (totalDeg: Reading): string => {
  if (!isNumber(totalDeg)) return NO_READING;
  const magnitude = Math.abs(totalDeg).toFixed(2);
  const direction = toeDirection(totalDeg);
  return direction ? `${magnitude} ${direction}` : magnitude;
};

/** Toe at one wheel, toe-in positive, to a hundredth of a degree. */
export const wheelToeFigure = (toeDeg: Reading): string =>
  isNumber(toeDeg) ? formatSigned(toeDeg, 2) : NO_READING;

/**
 * Whether a row is drawn, and with what.
 *
 * Out of the car nothing is available and every row keeps its place with
 * placeholders, so the widget can still be positioned. In the car, a row the
 * sim gives nothing for is left out: camber and toe, for a car it publishes
 * none for.
 */
export type RowState = 'values' | 'placeholders' | 'hidden';

export const rowState = (available: boolean, source: unknown): RowState => {
  if (!available) return 'placeholders';
  return source === null || source === undefined ? 'hidden' : 'values';
};
