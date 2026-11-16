/**
 * How a car's pace against an earlier stint is printed, stated once for the
 * Timing Tower, the Standings and the Relative: signed, to the hundredth,
 * green when quicker than before and red when slower.
 *
 * The figure itself is `stintPaceDelta` in `src/shared`.
 */

export type StintPaceTone = 'faster' | 'slower' | 'level' | 'none';

export interface StintPaceDisplay {
  text: string;
  tone: StintPaceTone;
}

/** What the column reads while there is nothing to compare. */
export const NO_STINT_PACE = '--';

const NONE: StintPaceDisplay = { text: NO_STINT_PACE, tone: 'none' };

/**
 * `delta` is seconds against the earlier stint, negative for quicker.
 *
 * The colour follows the figure as printed: a difference that rounds to
 * 0.00 is level, and takes neither colour nor a sign.
 */
export const stintPaceDisplay = (
  delta: number | null | undefined
): StintPaceDisplay => {
  if (typeof delta !== 'number' || !Number.isFinite(delta)) return NONE;
  const hundredths = Math.round(delta * 100);
  if (hundredths === 0) return { text: '0.00', tone: 'level' };
  const text = (Math.abs(hundredths) / 100).toFixed(2);
  return hundredths < 0
    ? { text: `-${text}`, tone: 'faster' }
    : { text: `+${text}`, tone: 'slower' };
};
