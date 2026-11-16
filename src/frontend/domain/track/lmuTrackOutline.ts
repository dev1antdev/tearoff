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
 * The samples of a map with the first repeated at the end, or null for a map
 * too short to be a circuit.
 *
 * An LMU map holds samples at even lap distance: sample `i` of `count` sits
 * `i / count` of the way round, so the stored line stops one sample short of
 * where it began. Repeating the first point closes it. Without that the last
 * stretch of every lap would be squeezed into the points before it and a car
 * crossing the line would jump the gap.
 */
const closedSamples = (
  map: LmuTrackMap | null | undefined
): TrackPathPoint[] | null => {
  const points = map?.active?.trackPathPoints;
  if (!points || points.length < 3) return null;
  return [...points, points[0]];
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
