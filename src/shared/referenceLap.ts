import type { ReferenceLap } from '@irdashies/types';

/**
 * Reading a recorded lap at a point on the track.
 *
 * The recorder lives in the main process and the laps it publishes are read
 * on both sides: the lap delta in main, the corner and speed deltas in the
 * renderer. They all have to read the same curve the same way, so the reading
 * is here.
 */

/** A reference lap's time in seconds, or null when it is not a finished lap. */
export const referenceLapTime = (lap: ReferenceLap): number | null => {
  const lapTime = lap.finishTime - lap.startTime;
  return lap.finishTime >= 0 && lapTime > 0 ? lapTime : null;
};

/**
 * The two samples a point lies between. One object, rewritten by every
 * lookup: this runs per telemetry frame and the result never leaves the
 * function that asked for it.
 */
const span = {
  from: 0,
  to: 0,
  /** Where the two samples sit, moved a lap where the span crosses the line. */
  x0: 0,
  x1: 0,
  /** The span starts with the last sample of the lap before. */
  wrapsBefore: false,
  /** The span ends with the first sample of the lap after. */
  wrapsAfter: false,
};

/**
 * Finds the samples either side of a point, into `span`. False for a point
 * off the lap or one beside a sample that was never recorded.
 *
 * The lap holds one sample per ten-metre bucket, taken wherever in the bucket
 * the car was on the frame that entered it. So a point can be ahead of its
 * bucket's sample or behind it, and one before the sample is read from the
 * span that ends there, not extrapolated back from the one that starts there.
 * The last bucket runs on to the first sample of the next lap, and the
 * stretch before the first sample back to the last one of the lap before.
 */
const locate = (lap: ReferenceLap, trackPct: number): boolean => {
  const count = lap.pointsCount;
  if (count < 2) return false;
  if (!(trackPct >= 0) || trackPct > 1) return false;

  const { pointPos } = lap;
  let index = Math.min(Math.floor(trackPct * count), count - 1);
  if (trackPct < pointPos[index]) index -= 1;

  const last = count - 1;
  span.wrapsBefore = index < 0;
  span.wrapsAfter = index === last;
  span.from = index < 0 ? last : index;
  span.to = index < 0 || index === last ? 0 : index + 1;
  if (!(pointPos[span.from] >= 0) || !(pointPos[span.to] >= 0)) return false;

  span.x0 = span.wrapsBefore ? pointPos[span.from] - 1 : pointPos[span.from];
  span.x1 = span.wrapsAfter ? pointPos[span.to] + 1 : pointPos[span.to];
  return true;
};

/**
 * Seconds into the reference lap at a point on the track.
 *
 * Each sample carries a tangent, so the curve between two of them is a
 * monotone cubic. This reads that curve.
 *
 * It differs from the interpolation the relative gaps use in the two places
 * a lap delta is most exposed: a point before its bucket's sample, and the
 * last bucket, where clamping the index holds the time flat for the final
 * metres -- a tenth of a second at the line, which is exactly where the
 * delta is read as the lap's result.
 *
 * Returns null for a lap that is not complete, or a point off the lap.
 */
export const referenceTimeAt = (
  lap: ReferenceLap,
  trackPct: number
): number | null => {
  const lapTime = referenceLapTime(lap);
  if (lapTime === null || !locate(lap, trackPct)) return null;

  const { times, tangents } = lap;
  const { from, to, x0, x1 } = span;
  // Either end of the lap borrows the sample across the line, moved one lap.
  const y0 = span.wrapsBefore ? times[from] - lapTime : times[from];
  const y1 = span.wrapsAfter ? times[to] + lapTime : times[to];

  const width = x1 - x0;
  if (!(width > 0)) return y0;
  const t = (trackPct - x0) / width;
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    (2 * t3 - 3 * t2 + 1) * y0 +
    (t3 - 2 * t2 + t) * width * tangents[from] +
    (-2 * t3 + 3 * t2) * y1 +
    (t3 - t2) * width * tangents[to]
  );
};

/**
 * The speed the reference lap was doing at a point on the track, in km/h.
 *
 * A straight line between the two samples either side: speed rises and falls
 * along a lap, so the monotone curve the times are read from does not apply.
 * Unlike a time, a speed needs nothing added where the span crosses the line.
 *
 * Returns null for a lap recorded without speeds, a point off the lap, and a
 * point beside a sample whose speed was never written (stored as 0).
 */
export const referenceSpeedKphAt = (
  lap: ReferenceLap,
  trackPct: number
): number | null => {
  const speeds = lap.speedsKph;
  if (!speeds || !locate(lap, trackPct)) return null;

  const v0 = speeds[span.from];
  const v1 = speeds[span.to];
  // Negated so an index past the end of a short trace fails closed too.
  if (!(v0 > 0) || !(v1 > 0)) return null;

  const width = span.x1 - span.x0;
  if (!(width > 0)) return v0;
  // The samples are stored as float32, so a point can sit a hair outside
  // the two it was matched to.
  const t = Math.min(Math.max((trackPct - span.x0) / width, 0), 1);
  return v0 + (v1 - v0) * t;
};
