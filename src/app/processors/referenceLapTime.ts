import type { ReferenceLap } from '@irdashies/types';

/** A reference lap's time in seconds, or null when it is not a finished lap. */
export const referenceLapTime = (lap: ReferenceLap): number | null => {
  const lapTime = lap.finishTime - lap.startTime;
  return lap.finishTime >= 0 && lapTime > 0 ? lapTime : null;
};

/**
 * Seconds into the reference lap at a point on the track.
 *
 * The lap holds one sample per ten-metre bucket, taken wherever in the bucket
 * the car was on the frame that entered it, with a tangent at each so the
 * curve between two samples is a monotone cubic. This reads that curve.
 *
 * It differs from the interpolation the relative gaps use in the two places
 * a lap delta is most exposed. A point before its bucket's sample is read
 * from the span that ends at that sample, not extrapolated back from the one
 * that starts there. And the last bucket runs on to the first sample of the
 * next lap, where clamping the index instead holds the time flat for the
 * final metres -- a tenth of a second at the line, which is exactly where
 * the delta is read as the lap's result.
 *
 * Returns null for a lap that is not complete, or a point off the lap.
 */
export const referenceTimeAt = (
  lap: ReferenceLap,
  trackPct: number
): number | null => {
  const count = lap.pointsCount;
  const lapTime = referenceLapTime(lap);
  if (lapTime === null || count < 2) return null;
  if (!(trackPct >= 0) || trackPct > 1) return null;

  const { pointPos, times, tangents } = lap;
  let index = Math.min(Math.floor(trackPct * count), count - 1);
  // The bucket's sample sits at or after the bucket's start, so the point can
  // be ahead of it or behind it.
  if (trackPct < pointPos[index]) index -= 1;

  const last = count - 1;
  const from = index < 0 ? last : index;
  const to = index < 0 || index === last ? 0 : index + 1;
  if (pointPos[from] < 0 || pointPos[to] < 0) return null;

  // Either end of the lap borrows the sample across the line, moved one lap.
  const x0 = index < 0 ? pointPos[from] - 1 : pointPos[from];
  const y0 = index < 0 ? times[from] - lapTime : times[from];
  const x1 = index === last ? pointPos[to] + 1 : pointPos[to];
  const y1 = index === last ? times[to] + lapTime : times[to];

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
