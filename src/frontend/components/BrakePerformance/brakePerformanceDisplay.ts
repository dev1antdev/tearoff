import type {
  BrakePerformanceConfig,
  BrakingSnapshot,
  BrakingZone,
} from '@irdashies/types';
import {
  distanceFromMetres,
  speedFromMs,
  type DistanceUnit,
  type SpeedUnit,
} from '@irdashies/utils/units';

/**
 * What the brake performance widget prints, worked out from the snapshot.
 * Pure, so that the figures and their colours can be tested without a DOM.
 */

/** Shown where a figure has no reading behind it. */
export const NO_READING = '--';

/** Seconds of lock from which the figure is drawn in red. */
export const LOCK_LONG_S = 1;

/**
 * How a zone compares with the best: harder, softer, or level with it, which
 * is also what a zone with nothing to be measured against reads as.
 */
export type DeltaTone = 'gained' | 'lost' | 'level';

/** How long a wheel was locked, as a colour: not at all, briefly, or long. */
export type LockTone = 'none' | 'some' | 'long';

export interface ZoneDelta {
  text: string;
  tone: DeltaTone;
}

const isReading = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const round = (value: number, decimals: number): number => {
  const scale = 10 ** decimals;
  const rounded = Math.round(value * scale) / scale;
  return rounded === 0 ? 0 : rounded;
};

/** A deceleration to the two decimals the widget prints, without its unit. */
export const formatG = (value: number | null | undefined): string =>
  isReading(value) ? value.toFixed(2) : NO_READING;

/** A time in seconds to the given decimals, without its unit. */
export const formatSeconds = (
  value: number | null | undefined,
  decimals: number
): string => (isReading(value) ? value.toFixed(decimals) : NO_READING);

/** A speed in metres a second as a whole number of the driver's unit. */
export const formatSpeed = (
  metresPerSecond: number | null | undefined,
  unit: SpeedUnit
): string =>
  isReading(metresPerSecond)
    ? String(Math.round(speedFromMs(metresPerSecond, unit)))
    : NO_READING;

/** A distance in metres as a whole number of the driver's unit. */
export const formatDistance = (
  metres: number | null | undefined,
  unit: DistanceUnit
): string =>
  isReading(metres)
    ? String(Math.round(distanceFromMetres(metres, unit)))
    : NO_READING;

/**
 * The best the widget is set to measure against, in g: the rolling best of
 * roughly the last minute, or the best of the session. 0 when there is none.
 */
export const bestFor = (
  snapshot: BrakingSnapshot,
  reference: BrakePerformanceConfig['reference']
): number =>
  reference === 'session' ? snapshot.sessionBestG : snapshot.referenceG;

/**
 * The last zone against the chosen best: the difference in g, and the best
 * it is a difference from. The best is 0 when the zone had nothing to be
 * measured against.
 *
 * Against the rolling best both come from the zone itself: it carries its
 * difference from the best as that stood when the brake went on, which the
 * snapshot's own rolling best has since moved on from. Against the session
 * best the zone that set it reads zero.
 */
export const zoneAgainstBest = (
  zone: BrakingZone,
  snapshot: BrakingSnapshot,
  reference: BrakePerformanceConfig['reference']
): { deltaG: number; bestG: number } =>
  reference === 'session'
    ? {
        deltaG: round(zone.peakG - snapshot.sessionBestG, 2),
        bestG: snapshot.sessionBestG,
      }
    : { deltaG: zone.deltaG, bestG: round(zone.peakG - zone.deltaG, 2) };

/**
 * The delta chip: "+4%" or "+0.09 g", and whether the stop was harder or
 * softer than the best.
 *
 * With no best to measure against there is no share to print, and the
 * difference in g, which is then the whole of the peak, is printed without a
 * colour. A difference that prints as zero has no colour either.
 */
export const formatDelta = (
  deltaG: number,
  bestG: number,
  unit: BrakePerformanceConfig['deltaUnit']
): ZoneDelta => {
  const hasBest = bestG > 0;
  if (unit === 'percent') {
    if (!hasBest) return { text: NO_READING, tone: 'level' };
    const percent = round((deltaG / bestG) * 100, 0);
    return {
      text: `${percent > 0 ? '+' : ''}${percent}%`,
      tone: percent > 0 ? 'gained' : percent < 0 ? 'lost' : 'level',
    };
  }
  const delta = round(deltaG, 2);
  return {
    text: `${delta > 0 ? '+' : ''}${delta.toFixed(2)} g`,
    tone: !hasBest
      ? 'level'
      : delta > 0
        ? 'gained'
        : delta < 0
          ? 'lost'
          : 'level',
  };
};

/** The colour of a lock time: none at zero, amber above it, red from 1.0 s. */
export const lockTone = (seconds: number | null | undefined): LockTone => {
  if (!isReading(seconds) || seconds <= 0) return 'none';
  return seconds >= LOCK_LONG_S ? 'long' : 'some';
};
