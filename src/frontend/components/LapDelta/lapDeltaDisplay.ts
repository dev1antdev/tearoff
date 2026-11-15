import type { LapDeltaConfig } from '@irdashies/types';

/**
 * What only the lap delta widget draws: its trend bar and the names of its
 * references. The delta text and tone, the predicted lap and the lap time
 * format are shared with other widgets and live in
 * `@irdashies/domain/lapTiming/deltaDisplay`.
 */

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
