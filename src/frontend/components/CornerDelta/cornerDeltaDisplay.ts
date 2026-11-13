import type { CornerDeltaConfig } from '@irdashies/types';
import { speedFromKph, type SpeedUnit } from '@irdashies/utils/units';

/**
 * What the corner delta widget draws, worked out from the figures of a
 * corner. Kept apart from the component so the rules can be tested without
 * rendering anything.
 */

export type DeltaTone = 'faster' | 'slower' | 'level' | 'none';

/** The largest time delta drawn in full. Past it the figure pins. */
const TIME_CAP_SECONDS = 99.99;

export const REFERENCE_LABELS: Record<CornerDeltaConfig['reference'], string> =
  {
    allTime: 'All-time best',
    sessionBest: 'Session best',
    lastLap: 'Last lap',
  };

/**
 * A figure with its sign, or the given dashes when there is none.
 *
 * Rounded before the sign is chosen, so two thousandths at two decimals
 * reads 0.00 and not -0.00.
 */
const signed = (value: number, decimals: number): string => {
  const text = Math.abs(value).toFixed(decimals);
  if (Number(text) === 0) return text;
  return `${value < 0 ? '-' : '+'}${text}`;
};

const isNumber = (value: number | null): value is number =>
  value !== null && Number.isFinite(value);

/** Seconds gained or lost through the corner, signed, or dashes. */
export const formatTimeDelta = (
  delta: number | null,
  decimals: 2 | 3
): string => {
  if (!isNumber(delta)) return `-.${'-'.repeat(decimals)}`;
  return signed(
    Math.max(-TIME_CAP_SECONDS, Math.min(TIME_CAP_SECONDS, delta)),
    decimals
  );
};

/** Whether the corner was quicker, slower or level, as the delta is drawn. */
export const timeTone = (delta: number | null, decimals: 2 | 3): DeltaTone => {
  if (!isNumber(delta)) return 'none';
  if (Number(Math.abs(delta).toFixed(decimals)) === 0) return 'level';
  return delta < 0 ? 'faster' : 'slower';
};

/** A speed in the display unit, whole, or dashes. */
export const formatSpeed = (
  speedKph: number | null,
  unit: SpeedUnit
): string =>
  isNumber(speedKph) ? speedFromKph(speedKph, unit).toFixed(0) : '--';

/**
 * A speed difference in the display unit, signed, to one decimal.
 *
 * Converted before it is rounded: a difference of 1.0 km/h is 0.6 mph.
 */
export const formatSpeedDelta = (
  deltaKph: number | null,
  unit: SpeedUnit
): string =>
  isNumber(deltaKph) ? signed(speedFromKph(deltaKph, unit), 1) : '-.-';

/** More speed is the better side, the other way round from a time. */
export const speedTone = (
  deltaKph: number | null,
  unit: SpeedUnit
): DeltaTone => {
  if (!isNumber(deltaKph)) return 'none';
  const shown = speedFromKph(deltaKph, unit);
  if (Number(Math.abs(shown).toFixed(1)) === 0) return 'level';
  return shown > 0 ? 'faster' : 'slower';
};
