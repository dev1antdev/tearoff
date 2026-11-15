/**
 * Whole laps between two cars, for every place a gap may be printed in laps.
 *
 * Each argument is a car's race progress: its laps plus the fraction of the
 * lap it is on. The car listed ahead comes first.
 *
 * The answer is 0 until more than one full lap separates the two, and the
 * difference truncated from there: 1.4 laps is 1, 2.3 laps is 2, exactly one
 * lap is still 0. It is also 0 when the car listed ahead is behind on the
 * road, which happens for a moment whenever the order has not caught up with
 * a pass, and on a formation lap: such a car is shown its time, not a lap.
 *
 * One rule, so that the gap to the class leader, the interval to the car
 * ahead and the gap to the player all switch to laps at the same instant.
 */
export const lapsApart = (
  aheadProgress: number,
  behindProgress: number
): number => {
  const difference = aheadProgress - behindProgress;
  return difference > 1 ? Math.trunc(difference) : 0;
};
