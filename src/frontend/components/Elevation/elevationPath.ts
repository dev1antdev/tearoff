/**
 * The elevation profile as it is drawn: the heights of the lap, one per ten
 * metres, turned into a line across a box of so many pixels.
 *
 * x is how far round the lap a height lies, y how high it is between the
 * lowest and the highest point of the lap, inside a margin at the top and
 * the bottom. The line ends at the right-hand edge at the height it began
 * at, because the lap does.
 */

import { METRES_TO_FEET } from '@irdashies/domain/units/distance';

/** Pixels kept clear above the highest point and below the lowest. */
export const ELEVATION_MARGIN_PX = 8;
/** Pixels of width a point of the line is given at least. */
const PIXELS_PER_POINT = 2;

export interface ElevationScale {
  /** The lowest height of the profile, metres. */
  lowest: number;
  /** Highest minus lowest, metres. */
  range: number;
}

export const elevationScaleOf = (
  elevationM: readonly number[]
): ElevationScale => {
  let lowest = Infinity;
  let highest = -Infinity;
  for (const height of elevationM) {
    if (height < lowest) lowest = height;
    if (height > highest) highest = height;
  }
  return elevationM.length === 0
    ? { lowest: 0, range: 0 }
    : { lowest, range: highest - lowest };
};

/**
 * Where a height is drawn, in pixels from the top of a box `heightPx` tall.
 * A profile with no range, or none at all, lies along the middle.
 */
export const elevationY = (
  heightM: number,
  scale: ElevationScale,
  heightPx: number,
  marginPx = ELEVATION_MARGIN_PX
): number => {
  const drawable = Math.max(heightPx - 2 * marginPx, 0);
  if (!(scale.range > 0)) return heightPx / 2;
  const share = Math.min(
    Math.max((heightM - scale.lowest) / scale.range, 0),
    1
  );
  return marginPx + (1 - share) * drawable;
};

export interface ElevationPoint {
  x: number;
  y: number;
}

/**
 * The points of the line, left to right.
 *
 * At most one for every two pixels of width: every k-th bucket, and always
 * the first, the highest, the lowest and the last, so that thinning never
 * takes the top off the Corkscrew. The closing point at the right-hand edge
 * is counted in that limit.
 */
export const elevationPoints = (
  elevationM: readonly number[],
  widthPx: number,
  heightPx: number,
  marginPx = ELEVATION_MARGIN_PX
): ElevationPoint[] => {
  const count = elevationM.length;
  if (count === 0 || !(widthPx > 0) || !(heightPx > 0)) return [];
  const scale = elevationScaleOf(elevationM);

  let highestAt = 0;
  let lowestAt = 0;
  for (let bucket = 1; bucket < count; bucket += 1) {
    if (elevationM[bucket] > elevationM[highestAt]) highestAt = bucket;
    if (elevationM[bucket] < elevationM[lowestAt]) lowestAt = bucket;
  }

  // Room for the highest, the lowest, the last and the closing point.
  const most = Math.max(Math.floor(widthPx / PIXELS_PER_POINT) - 4, 1);
  const step = Math.max(Math.ceil(count / most), 1);
  const buckets = new Set<number>([highestAt, lowestAt, count - 1]);
  for (let bucket = 0; bucket < count; bucket += step) buckets.add(bucket);

  const points = [...buckets]
    .sort((a, b) => a - b)
    .map((bucket) => ({
      x: (bucket / count) * widthPx,
      y: elevationY(elevationM[bucket], scale, heightPx, marginPx),
    }));
  // The lap ends where it began.
  points.push({ x: widthPx, y: points[0].y });
  return points;
};

/** To the tenth of a pixel a path is written to. */
const coordinate = (value: number): string =>
  String(Math.round(value * 10) / 10);

export interface ElevationPaths {
  /** The profile line. */
  line: string;
  /** The same, closed along the bottom of the box. */
  area: string;
}

/**
 * The SVG paths of a profile in a box of `widthPx` by `heightPx`. Without a
 * profile both are a flat line at mid-height, so the widget keeps its shape.
 */
export const elevationPaths = (
  elevationM: readonly number[],
  widthPx: number,
  heightPx: number,
  marginPx = ELEVATION_MARGIN_PX
): ElevationPaths => {
  const points = elevationPoints(elevationM, widthPx, heightPx, marginPx);
  const shown =
    points.length > 0
      ? points
      : [
          { x: 0, y: heightPx / 2 },
          { x: widthPx, y: heightPx / 2 },
        ];
  const line = shown
    .map(
      (point, index) =>
        `${index === 0 ? 'M' : 'L'}${coordinate(point.x)} ${coordinate(point.y)}`
    )
    .join('');
  return {
    line,
    area: `${line}L${coordinate(widthPx)} ${coordinate(heightPx)}L0 ${coordinate(heightPx)}Z`,
  };
};

/**
 * A height as it is printed: one decimal, in metres or feet, with a sign
 * when it is measured from the line and may lie either side of it.
 */
export const formatHeight = (
  heightM: number,
  metric: boolean,
  signed: boolean
): string => {
  const value = metric ? heightM : heightM * METRES_TO_FEET;
  const text = Math.abs(value).toFixed(1);
  // What rounds to nothing has no sign.
  if (Number(text) === 0) return text;
  if (value < 0) return `-${text}`;
  return signed ? `+${text}` : text;
};

/** A fixed lap for demo mode: 360 buckets, two hills and a hollow. */
export const DEMO_ELEVATION_M: readonly number[] = Array.from(
  { length: 360 },
  (_, bucket) => {
    const lap = bucket / 360;
    const height =
      24 +
      18 * Math.sin(2 * Math.PI * (lap - 0.42)) +
      7 * Math.sin(4 * Math.PI * (lap + 0.08)) +
      2.5 * Math.sin(10 * Math.PI * lap);
    return Math.round(height * 10) / 10;
  }
);
