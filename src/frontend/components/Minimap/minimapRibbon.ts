import type { TrackGeometry } from '@irdashies/domain/track';

/**
 * How much further than asked the stretch reaches, as a share of what was
 * asked, so the car can travel that far before a new one is built. More
 * means building less often and stroking more on every frame; frames are the
 * many, so it is kept small.
 */
const TRAVEL_SHARE = 0.25;

const wholeLap = (geometry: TrackGeometry): Path2D => {
  const path = new Path2D();
  path.moveTo(geometry.xs[0], geometry.ys[0]);
  for (let index = 1; index < geometry.count; index += 1) {
    path.lineTo(geometry.xs[index], geometry.ys[index]);
  }
  path.closePath();
  return path;
};

/**
 * The part of the lap the minimap can show, as one path.
 *
 * The map shows a couple of hundred metres round the car, of a lap that is a
 * sample every two metres: thousands of segments, of which a few hundred are
 * anywhere near the disc. Stroking the whole lap twice on every frame spends
 * nearly all of that on track that is clipped away.
 *
 * This keeps a path of just the segments in reach, as vectors: stroked under
 * the frame's own transform it gives the same pixels the whole lap would,
 * turned and placed to the fraction of a pixel. A picture of the track kept
 * in an offscreen canvas would not: slid or turned under the car it is
 * resampled, and at this zoom the whole of a long circuit is thousands of
 * pixels a side.
 *
 * The path is rebuilt only when the car has left the stretch it covers, or
 * when what is asked for changes: another track, range or track width.
 * Turning the map does not: the reach is a circle.
 */
export class MinimapRibbon {
  private path: Path2D | null = null;
  private geometry: TrackGeometry | null = null;
  private centreX = 0;
  private centreY = 0;
  private asked = -1;
  /** Distance from the centre it was built round that the path is whole to. */
  private reach = 0;

  /**
   * The path to stroke for a map centred on (`x`, `y`).
   *
   * `reach` is how far from there anything of the track can show, in drawing
   * units: the radius of the disc and half the width of the widest stroke.
   * Every segment that comes that close is in the path. Where a run of them
   * is cut off is therefore further away than that, and so is the round cap
   * the stroke puts on the cut end: the disc shows neither.
   */
  pathFor(
    geometry: TrackGeometry,
    x: number,
    y: number,
    reach: number
  ): Path2D {
    if (
      this.path &&
      this.geometry === geometry &&
      this.asked === reach &&
      Math.hypot(x - this.centreX, y - this.centreY) + reach <= this.reach
    ) {
      return this.path;
    }
    this.geometry = geometry;
    this.centreX = x;
    this.centreY = y;
    this.asked = reach;
    this.reach = reach * (1 + TRAVEL_SHARE);
    this.path = this.build(geometry, x, y, this.reach);
    return this.path;
  }

  private build(
    geometry: TrackGeometry,
    x: number,
    y: number,
    reach: number
  ): Path2D {
    const { xs, ys, count } = geometry;
    const reachSquared = reach * reach;
    /** Whether the segment from sample `index` to the next comes in reach. */
    const inReach = (index: number): boolean => {
      const next = index + 1 === count ? 0 : index + 1;
      const fromX = xs[index] - x;
      const fromY = ys[index] - y;
      const alongX = xs[next] - xs[index];
      const alongY = ys[next] - ys[index];
      const lengthSquared = alongX * alongX + alongY * alongY;
      // The nearest point of the segment, not just its ends: a long segment
      // can pass through the reach with both ends outside it.
      const along =
        lengthSquared > 0
          ? Math.min(
              1,
              Math.max(0, -(fromX * alongX + fromY * alongY) / lengthSquared)
            )
          : 0;
      const nearestX = fromX + alongX * along;
      const nearestY = fromY + alongY * along;
      return nearestX * nearestX + nearestY * nearestY <= reachSquared;
    };

    // Start in a gap, so that a run crossing the start/finish line is drawn
    // in one piece and joined there as the closed lap is.
    let gap = -1;
    for (let index = 0; index < count; index += 1) {
      if (!inReach(index)) {
        gap = index;
        break;
      }
    }
    // A short lap at a long range: all of it shows, closed as it always was.
    if (gap < 0) return wholeLap(geometry);

    const path = new Path2D();
    let drawing = false;
    for (let step = 1; step < count; step += 1) {
      const index = (gap + step) % count;
      if (!inReach(index)) {
        drawing = false;
        continue;
      }
      if (!drawing) {
        path.moveTo(xs[index], ys[index]);
        drawing = true;
      }
      const next = index + 1 === count ? 0 : index + 1;
      path.lineTo(xs[next], ys[next]);
    }
    return path;
  }
}
