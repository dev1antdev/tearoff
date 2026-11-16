/**
 * The average of a car's last laps: one rule, for the Standings and Relative
 * columns and for anything else that lists the field's pace, so that two
 * tables never disagree about a car's "average of the last five".
 *
 * Pure, and free of both sides: it reads one car's list of lap times, oldest
 * first, as `lap-times.snapshot` keeps them.
 */

/** Zero and -1 are how the sims write "no time"; neither is a lap time. */
const isLapTime = (value: number): boolean =>
  Number.isFinite(value) && value > 0;

/**
 * The mean of the last `count` lap times of `history`, oldest first, in the
 * unit the history is in. Null until the history holds `count` of them.
 *
 * Never a partial average: four laps are not an average of five, and a
 * figure whose window was still filling could not be compared with the same
 * column of the car in the next row.
 *
 * An entry that is not a lap time (zero, negative, NaN, infinite) is passed
 * over as if it had never been recorded, so the window reaches one lap
 * further back for it. Averaged in it would make nonsense of the figure, and
 * letting it blank the result would hide a car's pace for the next `count`
 * laps over one missing time.
 *
 * `count` is a whole number of at least 1; anything else has no average.
 */
export const averageOfLastLaps = (
  history: readonly number[] | undefined,
  count: number
): number | null => {
  if (!history || !Number.isInteger(count) || count < 1) return null;
  let sum = 0;
  let taken = 0;
  for (
    let index = history.length - 1;
    index >= 0 && taken < count;
    index -= 1
  ) {
    const lapTime = history[index];
    if (!isLapTime(lapTime)) continue;
    sum += lapTime;
    taken += 1;
  }
  return taken === count ? sum / count : null;
};
