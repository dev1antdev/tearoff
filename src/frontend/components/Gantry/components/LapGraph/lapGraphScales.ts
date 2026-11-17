import {
  MAX_GRIDLINES,
  type LinearAxis,
} from '@irdashies/utils/charts/linearAxis';

/**
 * The lap graph's own axes: a gap that starts at zero, and a position that
 * starts at one. The maths any chart over laps needs is in
 * `@irdashies/utils/charts/linearAxis`.
 */

/** Above this the axis stops growing and out-of-range points are clipped. */
export const MAX_GAP_CEILING_SECONDS = 600;

const GAP_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

/**
 * Smallest step from the ladder that keeps the gridline count within
 * MAX_GRIDLINES. Falls back to an even split of the range when even the
 * largest step is too fine.
 */
export const gapAxisStep = (maxGap: number): number => {
  for (const step of GAP_STEPS) {
    if (maxGap / step <= MAX_GRIDLINES) return step;
  }
  return Math.ceil(maxGap / MAX_GRIDLINES);
};

export interface GapAxis {
  max: number;
  step: number;
  values: number[];
}

/**
 * Builds the y axis for a gap plot. The range is clamped, so a car sitting in
 * the garage cannot compress the field into a smear at the top, and the
 * gridline loop can never run away on a garbage value.
 */
export const buildGapAxis = (rawMaxGap: number): GapAxis => {
  const bounded = Math.min(
    Math.max(Number.isFinite(rawMaxGap) ? rawMaxGap : 0, 1),
    MAX_GAP_CEILING_SECONDS
  );
  const step = gapAxisStep(bounded);
  const max = Math.ceil(bounded / step) * step;
  const values: number[] = [];
  for (
    let value = 0;
    value <= max && values.length <= MAX_GRIDLINES;
    value += step
  ) {
    values.push(value);
  }
  return { max, step, values };
};

const POSITION_STEPS = [1, 2, 5, 10, 20, 25, 50, 100];

/**
 * Position axis. Always starts at 1, always steps by whole positions, and the
 * caller draws it inverted so position 1 sits at the top.
 */
export const buildPositionAxis = (rawMaxPosition: number): LinearAxis => {
  const bounded = Math.min(
    Math.max(
      Number.isFinite(rawMaxPosition) ? Math.ceil(rawMaxPosition) : 2,
      2
    ),
    999
  );
  const step =
    POSITION_STEPS.find(
      (candidate) => (bounded - 1) / candidate <= MAX_GRIDLINES
    ) ?? Math.ceil((bounded - 1) / MAX_GRIDLINES);
  const values: number[] = [];
  for (
    let value = 1;
    value <= bounded && values.length <= MAX_GRIDLINES;
    value += step
  ) {
    values.push(value);
  }
  if (values[values.length - 1] !== bounded && values.length <= MAX_GRIDLINES) {
    values.push(bounded);
  }
  return { min: 1, max: bounded, step, values };
};

/** Axis tick text. Position ticks are whole numbers; times carry a sign. */
export const formatAxisValue = (
  mode: 'trace' | 'position' | 'gap',
  value: number
): string => {
  if (mode === 'position') return String(Math.round(value));
  const rounded = Math.abs(value) < 0.05 ? 0 : value;
  const decimals = Math.abs(rounded) >= 100 ? 0 : 1;
  const text = rounded.toFixed(decimals);
  return rounded > 0 ? `+${text}` : text;
};
