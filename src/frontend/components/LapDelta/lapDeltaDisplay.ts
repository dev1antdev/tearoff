import { predictedLapTime } from '@irdashies/domain/lapTiming/deltaDisplay';
import type { LapDeltaConfig, LapDeltaSnapshot } from '@irdashies/types';

/**
 * What only the lap delta widget draws: its trend bar, the names of its
 * references, and which figures stand where -- the live delta, or for a
 * moment after the line the result of the lap just finished. The delta text
 * and tone, the predicted lap and the lap time format are shared with other
 * widgets and live in `@irdashies/domain/lapTiming/deltaDisplay`.
 */

/**
 * Below this the trend bar stays empty. A car matching its reference still
 * measures a few thousandths either way, and a bar flickering between green
 * and red at that scale says nothing.
 */
const TREND_DEADBAND = 0.005;

export type LapDeltaReferenceKey = LapDeltaConfig['reference'];

/** The references in the order the strip shows them. */
export const REFERENCE_KEYS: readonly LapDeltaReferenceKey[] = [
  'sessionBest',
  'allTime',
  'stintBest',
  'lastLap',
];

export const REFERENCE_LABELS: Record<LapDeltaReferenceKey, string> = {
  sessionBest: 'Session best',
  allTime: 'All-time best',
  stintBest: 'Stint best',
  lastLap: 'Last lap',
};

/** What a reference goes by in the strip, where there is room for a letter. */
export const REFERENCE_LETTERS: Record<LapDeltaReferenceKey, string> = {
  sessionBest: 'S',
  allTime: 'A',
  stintBest: 'T',
  lastLap: 'L',
};

/** The time of the lap just finished is named the same in every mode. */
const FINISHED_LAP_LABEL = 'Last lap';

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

/** What the widget draws from: the four references and the last result. */
export type LapDeltaReadings = Pick<
  LapDeltaSnapshot,
  'sessionBest' | 'allTime' | 'stintBest' | 'lastLap' | 'lastLapFinal'
>;

export interface LapDeltaCell {
  key: LapDeltaReferenceKey;
  letter: string;
  /** Seconds against that reference; null where there is none. */
  delta: number | null;
}

export interface LapDeltaFigures {
  /** The large figure: the delta to the reference the settings choose. */
  delta: number | null;
  /** How that delta is moving, for the trend bar. */
  trend: number | null;
  /** The lap time the lap being driven is heading for. */
  predictedLapTime: number | null;
  /** The last row: which lap its time is, and the time. */
  lapLabel: string;
  lapTime: number | null;
  /** The other references, for the strip under the trend bar. */
  cells: LapDeltaCell[];
}

/**
 * The figures the widget draws.
 *
 * Live, they are the lap being driven against each reference. While the
 * result of the lap just finished is held -- `held`, for a few seconds after
 * the line -- the large figure and the strip are how that lap ended against
 * each reference as it stood, and the last row is its time. The trend and
 * the predicted lap are the new lap's throughout: there is nothing of the
 * finished lap to say there.
 *
 * The strip lists the other references the settings switch on and never the
 * one the large figure is for. A reference that does not exist has a cell
 * all the same, with no delta in it, so the strip does not jump.
 */
export const lapDeltaFigures = (
  readings: LapDeltaReadings,
  settings: Pick<LapDeltaConfig, 'reference' | 'secondary'>,
  held: boolean
): LapDeltaFigures => {
  const { reference, secondary } = settings;
  const live = readings[reference];
  const final = held ? readings.lastLapFinal : null;
  return {
    delta: final ? final[reference] : live.delta,
    trend: live.trend,
    predictedLapTime: predictedLapTime(live.lapTime, live.delta),
    lapLabel: final ? FINISHED_LAP_LABEL : REFERENCE_LABELS[reference],
    lapTime: final ? final.lapTime : live.lapTime,
    cells: REFERENCE_KEYS.filter(
      (key) => key !== reference && secondary[key] === true
    ).map((key) => ({
      key,
      letter: REFERENCE_LETTERS[key],
      delta: final ? final[key] : readings[key].delta,
    })),
  };
};
