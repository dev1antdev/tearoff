import { WEAR_MAX_LAPS, type WearRateSource } from '@irdashies/types';

/** Stands in for a figure the sim has not given, or that cannot be told yet. */
export const NO_READING = '--';

/** How a figure is drawn: as it is, as a caution, or as a problem. */
export type WearTone = 'plain' | 'caution' | 'bad';

export const TONE_CLASS: Record<WearTone, string> = {
  plain: 'text-white',
  caution: 'text-amber-300',
  bad: 'text-red-400',
};

const isNumber = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * A level left against its warning: a caution at or below it, a problem at
 * or below half of it. A warning of 0 never fires.
 */
export const levelTone = (
  level: number | null | undefined,
  warnAt: number
): WearTone => {
  if (!isNumber(level) || !(warnAt > 0)) return 'plain';
  if (level <= warnAt / 2) return 'bad';
  return level <= warnAt ? 'caution' : 'plain';
};

/** Laps left at or below the warning are a problem. */
export const areLapsFew = (
  laps: number | null | undefined,
  warnAt: number
): boolean => isNumber(laps) && warnAt > 0 && laps <= warnAt;

/** Wear per lap above the warning is a caution. */
export const isWearHigh = (
  perLap: number | null | undefined,
  warnAbove: number
): boolean => isNumber(perLap) && warnAbove > 0 && perLap > warnAbove;

/**
 * Whether a tread rate rests on no lap of the tyre now fitted: the session's
 * laps on an earlier set, earlier sessions, or the lap under way.
 */
export const isTreadEstimate = (source: WearRateSource | null): boolean =>
  source !== null && source !== 'tyre';

/**
 * Whether a disc rate rests on no lap of this session: earlier sessions, or
 * the lap under way.
 */
export const isBrakeEstimate = (source: WearRateSource | null): boolean =>
  source === 'baseline' || source === 'projected';

/** A figure with a fixed number of decimals, or the placeholder. */
export const formatFigure = (
  value: number | null | undefined,
  decimals: number
): string => (isNumber(value) ? value.toFixed(decimals) : NO_READING);

/** Wear per lap, as `0.49/lap`; the placeholder keeps its unit. */
export const formatPerLap = (
  value: number | null | undefined,
  decimals: number
): string => `${formatFigure(value, decimals)}/lap`;

/** Laps left, as `198 laps`; `999+` at the cap. Empty when unknown. */
export const formatLaps = (laps: number | null | undefined): string => {
  if (!isNumber(laps)) return '';
  if (laps >= WEAR_MAX_LAPS) return `${WEAR_MAX_LAPS}+`;
  return laps === 1 ? '1 lap' : `${laps} laps`;
};

/**
 * Whole minutes those laps take at a pace, at most 999. Null without either,
 * and for laps at the cap, where the minutes would be a cap of a cap.
 */
export const minutesLeft = (
  laps: number | null | undefined,
  paceLapTime: number | null | undefined
): number | null => {
  if (!isNumber(laps) || !isNumber(paceLapTime) || !(paceLapTime > 0)) {
    return null;
  }
  if (laps >= WEAR_MAX_LAPS) return null;
  return Math.min(WEAR_MAX_LAPS, Math.floor((laps * paceLapTime) / 60));
};

/** Minutes left, as `285 min`; `999+ min` at the cap. Empty when unknown. */
export const formatMinutes = (minutes: number | null | undefined): string => {
  if (!isNumber(minutes)) return '';
  return minutes >= WEAR_MAX_LAPS ? `${WEAR_MAX_LAPS}+ min` : `${minutes} min`;
};
