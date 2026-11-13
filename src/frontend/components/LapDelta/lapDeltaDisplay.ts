import type { LapDeltaConfig } from '@irdashies/types';
import { formatTime } from '@irdashies/utils/time';

/**
 * What the lap delta widget draws, worked out from the numbers the channel
 * carries. Kept apart from the component so the rules can be tested without
 * rendering anything.
 */

export type DeltaTone = 'faster' | 'slower' | 'level' | 'none';

/** The largest delta drawn in full. Past it the figure pins rather than grow. */
const DELTA_CAP_SECONDS = 99.99;

/**
 * Below this the trend bar stays empty. A car matching its reference still
 * measures a few thousandths either way, and a bar flickering between green
 * and red at that scale says nothing.
 */
const TREND_DEADBAND = 0.005;

export const REFERENCE_LABELS: Record<LapDeltaConfig['reference'], string> = {
  sessionBest: 'Session best',
  allTime: 'All-time best',
};

/**
 * The delta with its sign, or dashes when there is none.
 *
 * Rounded before the sign is chosen, so a delta of two thousandths at two
 * decimals reads 0.00 and not -0.00.
 */
export const formatDelta = (delta: number | null, decimals: 2 | 3): string => {
  if (delta === null || !Number.isFinite(delta)) {
    return `-.${'-'.repeat(decimals)}`;
  }
  const capped = Math.max(
    -DELTA_CAP_SECONDS,
    Math.min(DELTA_CAP_SECONDS, delta)
  );
  const text = Math.abs(capped).toFixed(decimals);
  if (Number(text) === 0) return text;
  return `${capped < 0 ? '-' : '+'}${text}`;
};

/** Whether the lap is up, down or level on its reference, as it is drawn. */
export const deltaTone = (delta: number | null, decimals: 2 | 3): DeltaTone => {
  if (delta === null || !Number.isFinite(delta)) return 'none';
  const shown = Number(Math.abs(delta).toFixed(decimals));
  if (shown === 0) return 'level';
  return delta < 0 ? 'faster' : 'slower';
};

export interface TrendFill {
  /** Which half of the bar fills. */
  side: 'faster' | 'slower' | 'none';
  /** How much of that half, 0..1. */
  fraction: number;
}

/**
 * How far the trend bar fills, and to which side.
 *
 * `range` is the rate that fills it: seconds gained or lost per second.
 */
export const trendFill = (trend: number | null, range: number): TrendFill => {
  if (trend === null || !Number.isFinite(trend) || !(range > 0)) {
    return { side: 'none', fraction: 0 };
  }
  const size = Math.abs(trend);
  if (size < TREND_DEADBAND) return { side: 'none', fraction: 0 };
  return {
    side: trend < 0 ? 'faster' : 'slower',
    fraction: Math.min(size / range, 1),
  };
};

/**
 * The lap time this lap is heading for: the reference's time plus what has
 * been gained or lost on it so far. Null without both.
 */
export const predictedLapTime = (
  lapTime: number | null,
  delta: number | null
): number | null => {
  if (lapTime === null || delta === null) return null;
  const predicted = lapTime + delta;
  return predicted > 0 ? predicted : null;
};

/** A lap time as m:ss.mmm, or dashes when there is none. */
export const formatLapTime = (seconds: number | null): string =>
  seconds === null || !(seconds > 0) ? '-:--.---' : formatTime(seconds, 'full');
