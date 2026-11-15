import { sectorSum } from '@irdashies/shared';
import type {
  SectorAllTimeBestsSnapshot,
  SectorDeltaConfig,
} from '@irdashies/types';

/**
 * What a lap's sectors are held against, and what they add up to: the
 * theoretical best (the best of each sector on its own), a best lap, or a
 * ghost. Pure, so the rules can be tested without rendering anything.
 */
export { sectorSum };

export type SectorComparison = SectorDeltaConfig['ghostComparison'];

/**
 * What the sum of a reference is called: TB where it is the best of each
 * sector, which no one lap need have driven; PB where it is the user's own
 * best lap; REF for the ghost, which is a lap and may be another driver's.
 */
export type SectorTargetLabel = 'TB' | 'PB' | 'REF';

/**
 * How the best of a sector was replaced, where the reference keeps that: a
 * card that has just set a best is then shown against the best before it.
 */
export interface SectorReference {
  label: SectorTargetLabel;
  /** Seconds per sector; null where there is nothing to compare with. */
  times: readonly (number | null)[];
  /** What `times` held before each sector's latest improvement. */
  previousTimes: readonly (number | null)[] | null;
}

export interface SectorReferenceSources {
  /** The ghost lap's sector times, or null with no ghost. */
  ghost: readonly (number | null)[] | null;
  sessionBestSectorTimes: readonly (number | null)[];
  previousSessionBestSectorTimes: readonly (number | null)[] | null;
  sessionBestLapSectorTimes: readonly (number | null)[];
  /** Null until the store that keeps them has answered. */
  allTime: SectorAllTimeBestsSnapshot | null;
}

const NOTHING: readonly (number | null)[] = [];

const sessionBestSectors = (
  sources: SectorReferenceSources
): SectorReference => ({
  label: 'TB',
  times: sources.sessionBestSectorTimes,
  previousTimes: sources.previousSessionBestSectorTimes,
});

/**
 * The reference a comparison setting names. Where it does not exist yet --
 * no whole lap this session, or the all-time bests not read -- its times
 * are empty and nothing is borrowed from another. Only the ghost has a
 * stand-in, as it always had: the session's best sectors.
 */
export const sectorReference = (
  comparison: SectorComparison,
  sources: SectorReferenceSources
): SectorReference => {
  switch (comparison) {
    case 'session-best-lap':
      return {
        label: 'PB',
        times: sources.sessionBestLapSectorTimes,
        previousTimes: null,
      };
    case 'all-time-best':
      return {
        label: 'TB',
        times: sources.allTime?.bestSectorTimes ?? NOTHING,
        previousTimes: sources.allTime?.previousBestSectorTimes ?? null,
      };
    case 'all-time-best-lap':
      return {
        label: 'PB',
        times: sources.allTime?.bestLapSectorTimes ?? NOTHING,
        previousTimes: null,
      };
    case 'prefer-ghost':
      return sources.ghost
        ? { label: 'REF', times: sources.ghost, previousTimes: null }
        : sessionBestSectors(sources);
    default:
      return sessionBestSectors(sources);
  }
};

/** The time and the reference a sector card shows its delta from. */
export interface SectorCardReading {
  /** What the sector's time is compared with; null for none. */
  referenceTime: number | null;
  /** The time is the best there is in this comparison, or better. */
  isBest: boolean;
}

/**
 * What one sector's time is compared with.
 *
 * A time that has just become the best is compared with the best it
 * replaced, where the reference keeps one: against itself it would read
 * +0.000 at the very moment there is something to show.
 */
export const sectorCardReading = (
  time: number | null,
  reference: SectorReference,
  sectorIdx: number
): SectorCardReading => {
  const best = reference.times[sectorIdx] ?? null;
  if (time === null || best === null) {
    return { referenceTime: best, isBest: false };
  }
  const isBest = time <= best;
  if (time === best && reference.previousTimes) {
    return {
      referenceTime: reference.previousTimes[sectorIdx] ?? null,
      isBest,
    };
  }
  return { referenceTime: best, isBest };
};

/**
 * How long the gap at the end of a sector is held in the target row: the
 * setting, but never more than half the previous time of the sector just
 * entered, so a short sector is not spent looking at the last one. Three
 * seconds at most where that time is not known.
 */
export const targetFreezeSeconds = (
  setting: number,
  previousTimeOfEnteredSector: number | null
): number => {
  if (!Number.isFinite(setting) || setting <= 0) return 0;
  const cap =
    previousTimeOfEnteredSector !== null && previousTimeOfEnteredSector > 0
      ? previousTimeOfEnteredSector / 2
      : 3;
  return Math.min(setting, cap);
};

/** The lap so far at the end of a sector, against the target to there. */
export interface SectorEndReading {
  /** The lap time at the end of the sector, s; null with a sector missing. */
  time: number | null;
  /** That time less the target's to the same point; negative is ahead. */
  gap: number | null;
}

/**
 * How the lap stood against its target when a sector ended.
 *
 * The true gap: the lap's time to that point less the target's, both whole.
 * A gain in an earlier sector counts for what it is, and the figure goes
 * negative when the lap is ahead.
 */
export const sectorEndReading = (
  lapSectorTimes: readonly (number | null)[],
  targetSectorTimes: readonly (number | null)[],
  sectorIdx: number
): SectorEndReading => {
  const time = sectorSum(lapSectorTimes, sectorIdx);
  const target = sectorSum(targetSectorTimes, sectorIdx);
  return {
    time,
    gap: time === null || target === null ? null : time - target,
  };
};
