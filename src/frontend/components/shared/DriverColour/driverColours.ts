/**
 * A car's drivers are told apart by colour, in the order they first drove:
 * on Crew and Stints, and along the line of the Race Charts.
 *
 * Our own car's are the colours the stint timeline gives the bars of the
 * same drivers, amber first. Another car's start past amber, which on every
 * panel is the colour of our own.
 */
const TEXT = [
  'text-amber-300',
  'text-teal-300',
  'text-purple-300',
  'text-sky-300',
  'text-rose-300',
];
const FILL = [
  'bg-amber-400',
  'bg-teal-400',
  'bg-purple-400',
  'bg-sky-400',
  'bg-rose-400',
];
const TINT = [
  'bg-amber-400/10',
  'bg-teal-400/10',
  'bg-purple-400/10',
  'bg-sky-400/10',
  'bg-rose-400/10',
];
/** A line drawn in the driver's colour, and a mark filled with it. */
const STROKE = [
  'stroke-amber-400',
  'stroke-teal-400',
  'stroke-purple-400',
  'stroke-sky-400',
  'stroke-rose-400',
];
const MARK = [
  'fill-amber-400',
  'fill-teal-400',
  'fill-purple-400',
  'fill-sky-400',
  'fill-rose-400',
];

/** How many colours a car's drivers go round: a fifth takes the first again. */
const DRIVER_COLOURS = 4;

/**
 * A driver's colour: their place among the car's drivers, and whether the
 * car is our own. A number, so that a row is handed one prop for it.
 */
export const driverColour = (index: number, ownCar: boolean): number =>
  (Math.max(0, index) % DRIVER_COLOURS) + (ownCar ? 0 : 1);

export const driverTextClass = (colour: number): string =>
  TEXT[colour % TEXT.length];
export const driverFillClass = (colour: number): string =>
  FILL[colour % FILL.length];
export const driverTintClass = (colour: number): string =>
  TINT[colour % TINT.length];
/** For a line of an SVG drawing. */
export const driverStrokeClass = (colour: number): string =>
  STROKE[colour % STROKE.length];
/** For a filled mark of an SVG drawing. */
export const driverMarkClass = (colour: number): string =>
  MARK[colour % MARK.length];
