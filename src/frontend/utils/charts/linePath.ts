/** A point of a line, in the pixels of the drawing. */
export interface PathPoint {
  x: number;
  y: number;
}

/** A tenth of a pixel is finer than anything drawn, and keeps a path short. */
const tenth = (value: number): number => Math.round(value * 10) / 10;

/**
 * The `d` of an SVG path through the points given, joined by straight
 * lines. A point that is not a finite place is left out, so one bad reading
 * bends the line past it instead of blanking the path. Empty with no point
 * to draw.
 *
 * One point makes a path of no length, which a round line cap draws as a
 * dot: a lap on its own between two breaks is still seen.
 */
export const linePath = (points: readonly PathPoint[]): string => {
  let path = '';
  let drawn = 0;
  for (const { x, y } of points) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    path += `${drawn === 0 ? 'M' : 'L'}${tenth(x)} ${tenth(y)}`;
    drawn += 1;
  }
  if (drawn === 1) path += 'h0';
  return path;
};
