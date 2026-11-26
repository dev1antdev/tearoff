/**
 * The colour of a car's track-limits points: amber from two thirds of the
 * ceiling, red at it.
 *
 * Two thresholds rather than a gradient: the number already says how close a
 * car is, and the colour is there to be caught out of the corner of an eye.
 * Shared by the table's cell and the Session Bar's item, so the two cannot
 * disagree about the same figure.
 */
export const trackLimitsTone = (
  points: number,
  max: number | undefined
): string => {
  if (!max || max <= 0) return '';
  if (points >= max) return 'text-red-400';
  if (points >= max * (2 / 3)) return 'text-amber-400';
  return '';
};
