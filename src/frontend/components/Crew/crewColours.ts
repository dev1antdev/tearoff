/**
 * A car's drivers are told apart by colour, in the order they first drove.
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
