import type { LmuTrackMap } from '@irdashies/types';
import type { TrackDrawing } from './trackDrawing';
import type { TrackPathData, TrackPathPoint } from './trackGeometry';

/**
 * The outline Le Mans Ultimate's session carries, in the two shapes the maps
 * draw from: a centreline for the close-range map, and a drawing for the two
 * maps of the whole circuit.
 *
 * Nothing here reads a store or a window, so a spec that plays a recording
 * in the main process's project can place cars exactly as the widgets do.
 */

/**
 * How much the stretches of a line sampled at even steps along it may differ:
 * the stored coordinates are rounded to a hundredth.
 */
const EVEN_SPACING_TOLERANCE = 0.05;

const between = (
  from: TrackPathPoint,
  to: TrackPathPoint,
  share: number
): TrackPathPoint => ({
  x: from.x + (to.x - from.x) * share,
  y: from.y + (to.y - from.y) * share,
});

/**
 * The samples of a map as the maps read them: `count` of them, sample `i`
 * standing `i / count` of the way round the lap.
 *
 * A map the app recorded is stored that way, and comes back as it is. The
 * outlines bundled with the app, and one read from TinyPedal's files, were
 * sampled at even steps along a line that ended short of where it began:
 * every stretch is the same length but the one from the last sample back to
 * the first, which is up to four times as long and holds that much more of
 * the lap. Read as one part in `count` like the others, it had a car drawn
 * further and further behind as the lap went on, by up to 0.6 % of a lap at
 * the end of it, and then made up over the last 0.2 %. For such a line the
 * closing stretch is given the share of the lap its length is of the whole
 * line, the samples before it share the rest, and the line is sampled again
 * at even lap distance. Every new sample lies on the stored line.
 */
const samplesAtEvenLapDistance = (
  points: readonly TrackPathPoint[]
): readonly TrackPathPoint[] => {
  const count = points.length;
  let shortest = Number.POSITIVE_INFINITY;
  let longest = 0;
  let stored = 0;
  for (let index = 1; index < count; index += 1) {
    const stretch = Math.hypot(
      points[index].x - points[index - 1].x,
      points[index].y - points[index - 1].y
    );
    shortest = Math.min(shortest, stretch);
    longest = Math.max(longest, stretch);
    stored += stretch;
  }
  const closing = Math.hypot(
    points[0].x - points[count - 1].x,
    points[0].y - points[count - 1].y
  );
  const spacing = stored / (count - 1);
  const evenAlongTheLine =
    shortest > 0 && longest - shortest <= shortest * EVEN_SPACING_TOLERANCE;
  if (
    !evenAlongTheLine ||
    !Number.isFinite(closing) ||
    closing <= spacing * (1 + EVEN_SPACING_TOLERANCE)
  ) {
    return points;
  }

  const closingShare = closing / (stored + closing);
  const storedShare = 1 - closingShare;
  return Array.from({ length: count }, (_, index) => {
    const lap = index / count;
    if (lap >= storedShare) {
      return between(
        points[count - 1],
        points[0],
        (lap - storedShare) / closingShare
      );
    }
    const at = (lap / storedShare) * (count - 1);
    const from = Math.floor(at);
    return between(
      points[from],
      points[Math.min(from + 1, count - 1)],
      at - from
    );
  });
};

/**
 * The samples of a map at even lap distance, with the first repeated at the
 * end, or null for a map too short to be a circuit.
 *
 * Sample `i` of `count` sits `i / count` of the way round, so the line stops
 * one sample short of where it began. Repeating the first point closes it.
 * Without that the last stretch of every lap would be squeezed into the
 * points before it and a car crossing the line would jump the gap.
 */
const closedSamples = (
  map: LmuTrackMap | null | undefined
): TrackPathPoint[] | null => {
  const points = map?.active?.trackPathPoints;
  if (!points || points.length < 3) return null;
  const samples = samplesAtEvenLapDistance(points);
  return [...samples, samples[0]];
};

/**
 * The centreline of a Le Mans Ultimate map, in the shape the geometry builder
 * takes.
 */
export const lmuTrackPathData = (
  map: LmuTrackMap | null | undefined
): TrackPathData | null => {
  const closed = closedSamples(map);
  if (!closed) return null;
  return {
    trackPathPoints: closed,
    // One unit of length per sample, so a lap is as long as it has samples.
    totalLength: closed.length - 1,
    // The samples begin at the line.
    startFinishLength: 0,
    // Samples are stored in the order they are driven.
    direction: 'anticlockwise',
  };
};

/**
 * A cheap fingerprint of an LMU map.
 *
 * The session is republished whenever a position or lap time moves, and every
 * publish carries a fresh copy of the same map. Selecting the map itself would
 * rebuild whatever is made of it each time; selecting this string does it only
 * when the map really is a different one.
 */
export const lmuMapSignature = (map: LmuTrackMap | undefined): string => {
  const points = map?.active?.trackPathPoints;
  if (!points || points.length === 0) return '';
  const first = points[0];
  const middle = points[Math.floor(points.length / 2)];
  const last = points[points.length - 1];
  return [
    points.length,
    first.x,
    first.y,
    middle.x,
    middle.y,
    last.x,
    last.y,
  ].join(',');
};

const isCoordinate = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * A Le Mans Ultimate map as a drawing the whole-circuit maps draw from, or
 * null for a map with no usable line.
 *
 * The same closed centreline the close-range map is built on, so a car is
 * placed on the line that is stroked, and the two maps agree on where a lap
 * fraction is. The stroke is made from those samples rather than taken from
 * the path stored beside them: one list of points then says both where the
 * road is and where the cars are.
 *
 * The start/finish mark stands where the outline says the line is, which is
 * its first sample, and the direction is the outline's own. A map recorded
 * from a lap has no corner names; a bundled one may.
 */
export const lmuTrackDrawing = (
  map: LmuTrackMap | null | undefined
): TrackDrawing | null => {
  const path = lmuTrackPathData(map);
  if (!map || !path) return null;
  const closed = path.trackPathPoints as TrackPathPoint[];
  const samples = closed.slice(0, -1);
  if (!samples.every((point) => isCoordinate(point.x) && isCoordinate(point.y)))
    return null;

  // Closed with Z rather than by drawing back to the first point, so the
  // join at the line is mitred like every other and has no gap in it.
  const stroke = `${samples
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x},${point.y}`)
    .join(' ')} Z`;
  const first = samples[0];
  const line = map.startFinish?.point;
  const startFinish =
    line && isCoordinate(line.x) && isCoordinate(line.y)
      ? { x: line.x, y: line.y }
      : { x: first.x, y: first.y };

  return {
    active: {
      inside: stroke,
      outside: stroke,
      trackPathPoints: closed,
      totalLength: path.totalLength,
    },
    startFinish: {
      // Only its presence is read; the mark itself is drawn across the road
      // at `point`.
      line: `M${startFinish.x},${startFinish.y - 30} L${startFinish.x},${startFinish.y + 30}`,
      point: { ...startFinish, length: path.startFinishLength },
      direction: path.direction,
    },
    turns: map.turns,
  };
};
