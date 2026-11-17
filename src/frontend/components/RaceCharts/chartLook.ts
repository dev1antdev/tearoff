/**
 * How the lines of a chart are drawn.
 *
 * Our own car's line is the heavy one, in the colours of its drivers. The
 * cars beside it are thinner and each has a colour and a pattern of its
 * own, so that no car is told from another by its colour alone.
 *
 * The three colours were chosen against the four of our drivers (amber,
 * teal, purple and sky at 400) and against each other with the dataviz
 * palette validator, as Tailwind 4 has them, on the overlay's slate and on
 * the Pit Wall's. Of the pairs with one of these three in it the nearest
 * are 9.4 apart under simulated red and green colour blindness, where 8 is
 * asked, and 17.7 under normal vision, where 15 is; each stands at least
 * 4 to 1 against either surface. Pink at 400 and orange at 400 both fail
 * it, so run it again before changing a value here.
 *
 * The page's design drew the other cars in a grey and a blue. The blue is
 * not used: under red and green colour blindness it is the purple of our
 * own drivers (0.4 apart), and it is near their sky for everybody.
 */
export interface RivalLook {
  stroke: string;
  fill: string;
  /** `stroke-dasharray`, for a line with round ends; none for a solid one. */
  dash: string | undefined;
}

export const RIVAL_LOOKS: readonly RivalLook[] = [
  { stroke: 'stroke-slate-200', fill: 'fill-slate-200', dash: undefined },
  { stroke: 'stroke-pink-500', fill: 'fill-pink-500', dash: '5 4.5' },
  // Dots: a dash of no length, drawn by the line's round ends.
  { stroke: 'stroke-orange-500', fill: 'fill-orange-500', dash: '0.1 4' },
];

export const rivalLook = (line: number): RivalLook =>
  RIVAL_LOOKS[Math.max(0, line) % RIVAL_LOOKS.length];

/** Line widths, CSS pixels: our car's, and another car's beside it. */
export const OWN_LINE_PX = 2.5;
export const RIVAL_LINE_PX = 1.5;
