/**
 * How fast the in-game clock runs against the session clock, measured.
 *
 * A sim can run its day faster than real time, so that a two-hour race sees a
 * whole night. Le Mans Ultimate states the factor only as a race setting,
 * which is not known to hold in practice and qualifying, and so the factor is
 * measured instead: the advance of the time of day over the advance of the
 * session clock, across a window of a little over five seconds.
 *
 * Whole numbers only, since that is all a sim offers, and 0 for a time of day
 * that stands still.
 *
 * The two clocks need not be published together. Le Mans Ultimate writes the
 * time of day five times a second and the session clock a hundred, so a
 * reading of the time of day is up to a fifth of a second old, and how old
 * differs from one reading to the next: measured between two arbitrary
 * readings, a recorded real-time race gave anything from 0.984 to 1.034 per
 * window, which is 15 read as 14 or 16. A window therefore opens and closes
 * on a reading where the time of day has just moved, which is when it is
 * fresh. Feed every frame, not a sample of them: the sooner after the move a
 * reading is taken, the closer the answer.
 */
export interface TimeScaleEstimator {
  /**
   * Takes one reading of both clocks, in seconds, and returns the scale as it
   * now stands: undefined until a first window has passed, and after a window
   * whose answer no sim could have meant.
   */
  update(sessionTime: number, timeOfDay: number): number | undefined;
  /** The scale as of the last reading. */
  value(): number | undefined;
  /**
   * The last window's measurement before rounding, for telling how far from
   * a whole number the two clocks put it. Undefined before the first window.
   */
  lastRatio(): number | undefined;
  reset(): void;
}

/** A window is measured once the session clock is this far past its start. */
export const TIME_SCALE_WINDOW_SECONDS = 5;
/** The fastest day either sim offers. */
export const TIME_SCALE_MAX = 60;

/**
 * How far past the fastest day a measurement may land and still be it: the
 * error of one reading, which at 60 times real time is most of a unit.
 * Anything beyond is a jump of the clock, not a scale.
 */
const OVERSHOOT_TOLERANCE = 1.02;

const SECONDS_PER_DAY = 86_400;

export const createTimeScaleEstimator = (): TimeScaleEstimator => {
  let referenceTime: number | undefined;
  let referenceTimeOfDay = 0;
  /** The reference was taken on a reading where the time of day had moved. */
  let referenceIsFresh = false;
  let lastTimeOfDay = 0;
  /** Session time of the last reading on which the time of day moved. */
  let lastMovedAt = 0;
  let scale: number | undefined;
  let ratio: number | undefined;

  const startWindow = (
    sessionTime: number,
    timeOfDay: number,
    fresh: boolean
  ): void => {
    referenceTime = sessionTime;
    referenceTimeOfDay = timeOfDay;
    referenceIsFresh = fresh;
  };

  return {
    update(sessionTime, timeOfDay) {
      // A session clock behind the reference is a restart or a new session:
      // the window starts again, and the last answer stands until it closes.
      if (referenceTime === undefined || sessionTime < referenceTime) {
        startWindow(sessionTime, timeOfDay, false);
        lastTimeOfDay = timeOfDay;
        lastMovedAt = sessionTime;
        return scale;
      }
      const moved = timeOfDay !== lastTimeOfDay;
      lastTimeOfDay = timeOfDay;
      if (moved) lastMovedAt = sessionTime;

      const elapsed = sessionTime - referenceTime;
      if (elapsed <= TIME_SCALE_WINDOW_SECONDS) {
        // The first reading of a session is as old as it happens to be. Start
        // the window again on the first fresh one.
        if (moved && !referenceIsFresh) {
          startWindow(sessionTime, timeOfDay, true);
        }
        return scale;
      }
      // Wait for a fresh reading to close on, unless the time of day has not
      // moved for a whole window: that is a day standing still, and waiting
      // would never say so.
      if (!moved && sessionTime - lastMovedAt <= TIME_SCALE_WINDOW_SECONDS) {
        return scale;
      }

      let advance = timeOfDay - referenceTimeOfDay;
      // More than half a day backwards is the clock passing midnight, not
      // time running in reverse.
      if (advance < -SECONDS_PER_DAY / 2) advance += SECONDS_PER_DAY;
      ratio = Math.max(advance, 0) / elapsed;
      scale =
        ratio <= TIME_SCALE_MAX * OVERSHOOT_TOLERANCE
          ? Math.min(Math.round(ratio), TIME_SCALE_MAX)
          : undefined;
      startWindow(sessionTime, timeOfDay, moved);
      return scale;
    },
    value: () => scale,
    lastRatio: () => ratio,
    reset() {
      referenceTime = undefined;
      referenceTimeOfDay = 0;
      referenceIsFresh = false;
      lastTimeOfDay = 0;
      lastMovedAt = 0;
      scale = undefined;
      ratio = undefined;
    },
  };
};
