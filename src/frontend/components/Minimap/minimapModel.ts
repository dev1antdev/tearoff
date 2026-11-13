import type { MinimapConfig } from '@irdashies/types';

/**
 * Pure geometry and labelling for the minimap, kept apart from the canvas so
 * it can be tested without one.
 *
 * All angles follow the canvas: y grows downward, so a positive rotation turns
 * clockwise on screen.
 */

export interface MinimapView {
  /** The point of the track drawing that sits at the centre of the map. */
  centreX: number;
  centreY: number;
  cos: number;
  sin: number;
  /** Pixels per drawing unit. */
  scale: number;
  /** The centre of the map on the canvas, in pixels. */
  originX: number;
  originY: number;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * The rotation that points a direction of travel at the top of the map.
 *
 * The tangent is a unit vector in drawing coordinates. Already pointing up,
 * (0, -1), it needs no turn; pointing right, (1, 0), it needs a quarter turn
 * anticlockwise.
 */
export const headingRotation = (tangentX: number, tangentY: number): number =>
  Math.atan2(-tangentX, -tangentY);

export const createView = (): MinimapView => ({
  centreX: 0,
  centreY: 0,
  cos: 1,
  sin: 0,
  scale: 1,
  originX: 0,
  originY: 0,
});

/** Fills `view` in place: the draw loop reuses one object across frames. */
export const updateView = (
  view: MinimapView,
  centre: Point,
  rotation: number,
  /** Canvas radius in pixels. */
  radius: number,
  /** Metres from the centre of the map to its edge. */
  range: number,
  /** Drawing units per metre of real track. */
  unitsPerMeter: number,
  originX: number,
  originY: number
): MinimapView => {
  view.centreX = centre.x;
  view.centreY = centre.y;
  view.cos = Math.cos(rotation);
  view.sin = Math.sin(rotation);
  view.scale = radius / (range * unitsPerMeter);
  view.originX = originX;
  view.originY = originY;
  return view;
};

/** A point of the track drawing to canvas pixels, written into `output`. */
export const project = (
  view: MinimapView,
  x: number,
  y: number,
  output: Point
): Point => {
  const dx = x - view.centreX;
  const dy = y - view.centreY;
  output.x = view.originX + (dx * view.cos - dy * view.sin) * view.scale;
  output.y = view.originY + (dx * view.sin + dy * view.cos) * view.scale;
  return output;
};

/** Whether a marker of `radius` pixels at `point` shows inside the disc. */
export const insideDisc = (
  view: MinimapView,
  point: Point,
  discRadius: number,
  radius: number
): boolean =>
  Math.hypot(point.x - view.originX, point.y - view.originY) <=
  discRadius + radius;

export interface MarkerSource {
  /** Overall position, 0 or less when the sim has not ranked the car. */
  position: number | undefined;
  classPosition: number | undefined;
  carNumber: string | undefined;
}

const ranked = (value: number | undefined): string =>
  typeof value === 'number' && Number.isFinite(value) && value > 0
    ? String(value)
    : '';

/** The text for one marker; empty when the chosen figure is not known yet. */
export const markerLabel = (
  mode: MinimapConfig['label'],
  source: MarkerSource
): string => {
  switch (mode) {
    case 'position':
      return ranked(source.position);
    case 'classPosition':
      return ranked(source.classPosition);
    case 'carNumber':
      return source.carNumber ?? '';
    case 'none':
      return '';
  }
};

/** Marker fill when class colours are off, or a class has none. */
export const NEUTRAL_MARKER = '#e2e8f0';
const DARK_TEXT = '#0f172a';
const LIGHT_TEXT = '#ffffff';

/** Black or white, whichever reads on `hex` (`#rrggbb`). */
export const textColorOn = (hex: string): string => {
  const value = Number.parseInt(hex.slice(1), 16);
  if (!Number.isFinite(value) || hex.length !== 7) return DARK_TEXT;
  const red = (value >> 16) & 0xff;
  const green = (value >> 8) & 0xff;
  const blue = value & 0xff;
  return red * 0.299 + green * 0.587 + blue * 0.114 > 150
    ? DARK_TEXT
    : LIGHT_TEXT;
};

/**
 * Font size that fits a label inside a marker: two characters fill it, and
 * a third or fourth shrinks the text rather than spilling over the edge.
 */
export const labelFontSize = (markerRadius: number, label: string): number => {
  const characters = Math.max(2, label.length);
  return (markerRadius * 2.1) / characters;
};
