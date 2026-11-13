import type { ReferenceLap } from '@irdashies/types';
import {
  referenceLapTime,
  referenceSpeedKphAt,
  referenceTimeAt,
} from '@irdashies/shared';
import type { TrackCorner } from '../corners/trackCorners';
import {
  MAX_CORNER_LAP_FRACTION,
  MAX_PLAUSIBLE_CORNER_DELTA_SEC,
  MIN_CORNER_LENGTH_M,
} from '../lapTrace/cornerComparison';
import { normalisePct } from '../lapTrace/lapSamples';
import type {
  CornerFigures,
  CornerPass,
  CornerSpan,
} from './cornerPassTracker';

/**
 * A corner just driven, set against the same corner on the player's other
 * laps: how much time was gained or lost through it, and how much faster or
 * slower the car went in and came out.
 */

const MS_TO_KPH = 3.6;

/** The laps a corner can be measured against. */
export type CornerReferenceId = 'allTime' | 'sessionBest' | 'lastLap';

/** One corner against one reference. Each figure stands or falls alone. */
export interface CornerReading {
  /** Seconds against the reference through the corner; negative is faster. */
  timeDeltaSec: number | null;
  /** km/h against the reference at the corner's start; positive is faster. */
  entrySpeedDeltaKph: number | null;
  /** km/h against the reference at the corner's end; positive is faster. */
  exitSpeedDeltaKph: number | null;
}

/** A corner the player completed, with its reading against every reference. */
export interface CornerResult {
  /** Counts the corners completed, so two passes of one corner differ. */
  serial: number;
  sectionId: string;
  label: string;
  /** Seconds through the corner. */
  timeSec: number;
  entrySpeedKph: number;
  exitSpeedKph: number;
  /**
   * All three, so changing which one the widget shows needs nothing driven
   * again, and a missing reference is never quietly replaced by another.
   */
  readings: Record<CornerReferenceId, CornerReading>;
}

export const NO_CORNER_READING: CornerReading = {
  timeDeltaSec: null,
  entrySpeedDeltaKph: null,
  exitSpeedDeltaKph: null,
};

/**
 * The corners that can be timed, from the track's list.
 *
 * Leaves out what is not a corner to time: one with a boundary that is not a
 * number, one of no length, one shorter than ten metres (noise in the data)
 * and one longer than half the lap (bad data). Without the track's length
 * the ten-metre test is skipped rather than failed.
 */
export const timeableCorners = (
  corners: readonly TrackCorner[],
  trackLengthM: number
): TrackCorner[] =>
  corners.filter((corner) => {
    if (!Number.isFinite(corner.start_pct) || !Number.isFinite(corner.end_pct))
      return false;
    const { startPct, endPct } = cornerSpanOf(corner);
    const length =
      endPct > startPct ? endPct - startPct : endPct - startPct + 1;
    if (!(length > 0) || length >= 1) return false;
    if (length > MAX_CORNER_LAP_FRACTION) return false;
    return !(trackLengthM > 0) || length * trackLengthM >= MIN_CORNER_LENGTH_M;
  });

/** Where a corner starts and ends on the lap. */
export const cornerSpanOf = (corner: TrackCorner): CornerSpan => ({
  startPct: normalisePct(corner.start_pct),
  endPct: normalisePct(corner.end_pct),
});

/**
 * A time delta, or null where it is not one. Past ten seconds the driver
 * went off, spun or was held up: the number is true and tells them nothing.
 */
const plausibleDelta = (delta: number): number | null =>
  Math.abs(delta) <= MAX_PLAUSIBLE_CORNER_DELTA_SEC ? delta : null;

/**
 * A corner driven against the same stretch of a recorded lap.
 *
 * The lap's time through the corner is read off its time curve at the
 * corner's two ends, the very points the pass was timed between, so the two
 * are the same stretch of road. Where the corner straddles the line the
 * recorded lap supplies its end and its start, one lap time apart.
 */
export const readAgainstLap = (
  pass: CornerFigures,
  span: CornerSpan,
  lap: ReferenceLap | null
): CornerReading => {
  if (!lap) return NO_CORNER_READING;

  let timeDeltaSec: number | null = null;
  const lapTime = referenceLapTime(lap);
  const startTime = referenceTimeAt(lap, span.startPct);
  const endTime = referenceTimeAt(lap, span.endPct);
  if (lapTime !== null && startTime !== null && endTime !== null) {
    const wraps = span.endPct < span.startPct;
    const referenceSec = endTime - startTime + (wraps ? lapTime : 0);
    if (referenceSec > 0) {
      timeDeltaSec = plausibleDelta(pass.timeSec - referenceSec);
    }
  }

  const entryKph = referenceSpeedKphAt(lap, span.startPct);
  const exitKph = referenceSpeedKphAt(lap, span.endPct);
  return {
    timeDeltaSec,
    entrySpeedDeltaKph:
      entryKph === null ? null : pass.entrySpeedMs * MS_TO_KPH - entryKph,
    exitSpeedDeltaKph:
      exitKph === null ? null : pass.exitSpeedMs * MS_TO_KPH - exitKph,
  };
};

/** A corner driven against the last time it was driven. */
export const readAgainstPass = (
  pass: CornerFigures,
  previous: CornerFigures | null
): CornerReading => {
  if (!previous) return NO_CORNER_READING;
  return {
    timeDeltaSec: plausibleDelta(pass.timeSec - previous.timeSec),
    entrySpeedDeltaKph: (pass.entrySpeedMs - previous.entrySpeedMs) * MS_TO_KPH,
    exitSpeedDeltaKph: (pass.exitSpeedMs - previous.exitSpeedMs) * MS_TO_KPH,
  };
};

export interface CornerReferenceLaps {
  /** The player's best clean lap of this session. */
  sessionBest: ReferenceLap | null;
  /** The player's reference lap for this track and car across sessions. */
  allTime: ReferenceLap | null;
}

/** The result of one pass: what was driven, against each reference. */
export const cornerResultFrom = (
  pass: CornerPass,
  corner: TrackCorner,
  laps: CornerReferenceLaps,
  serial: number
): CornerResult => {
  const span = cornerSpanOf(corner);
  return {
    serial,
    sectionId: corner.section_id,
    label: corner.label,
    timeSec: pass.timeSec,
    entrySpeedKph: pass.entrySpeedMs * MS_TO_KPH,
    exitSpeedKph: pass.exitSpeedMs * MS_TO_KPH,
    readings: {
      allTime: readAgainstLap(pass, span, laps.allTime),
      sessionBest: readAgainstLap(pass, span, laps.sessionBest),
      lastLap: readAgainstPass(pass, pass.previous),
    },
  };
};
