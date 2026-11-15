/**
 * The time of a lap the sim would not put a time to.
 *
 * LMU gives a car's last lap as nothing at all when the lap did not count:
 * a track limit, a cut, and the lap time is gone. In an online race that is
 * a fair share of every stint. The car still drove the lap and it still took
 * a time, which is what a driver wants in the last-lap column and what the
 * pace of the last ten laps is made of; left out, the column went blank and
 * the average was of the laps that happened to be clean.
 *
 * The sim does publish when each car's current lap began, so a lap's time is
 * the difference between two starts. This is how TinyPedal times a lap LMU
 * has not: the same two timestamps.
 *
 * Only where the sim gives no time. A lap it did time keeps the sim's
 * figure, which is the official one.
 */

export interface LmuLapStartState {
  /** When each car's current lap began, by slot; NaN where not known. */
  starts: number[];
  /** The lap before it, timed start to start; -1 where not measured. */
  measured: number[];
}

export const createLmuLapStartState = (): LmuLapStartState => ({
  starts: [],
  measured: [],
});

export const resetLmuLapStartState = (state: LmuLapStartState): void => {
  state.starts.length = 0;
  state.measured.length = 0;
};

/** Two starts closer than this are one start, republished. */
const MIN_LAP_SECONDS = 1;

/**
 * A lap this many times the sim's estimate is not a lap: the car was parked,
 * or the start time is from before a spell in the garage.
 */
const MAX_LAP_ESTIMATES = 4;

export interface LmuLapStartFrame {
  /** When each car's current lap began, seconds on the session clock. */
  lapStartETs: ArrayLike<number> | undefined;
  /** Lap fraction per car. Negative marks an empty slot. */
  lapDistPcts: ArrayLike<number> | undefined;
  /** The sim's estimated lap time per car, where it has one. */
  estimatedLapTimes?: ArrayLike<number>;
}

/** Takes a frame's lap starts, measuring each lap that has just ended. */
export const observeLmuLapStarts = (
  state: LmuLapStartState,
  frame: LmuLapStartFrame
): void => {
  const { lapStartETs, lapDistPcts, estimatedLapTimes } = frame;
  const count = lapStartETs?.length ?? 0;
  state.starts.length = count;
  state.measured.length = count;
  for (let carIdx = 0; carIdx < count; carIdx += 1) {
    const start = lapStartETs?.[carIdx];
    const occupied = (lapDistPcts?.[carIdx] ?? -1) >= 0;
    if (
      !occupied ||
      typeof start !== 'number' ||
      !Number.isFinite(start) ||
      start < 0
    ) {
      state.starts[carIdx] = Number.NaN;
      state.measured[carIdx] = -1;
      continue;
    }
    const previous = state.starts[carIdx];
    if (previous === undefined || Number.isNaN(previous) || start < previous) {
      // First sight of the car, or a clock that started again: nothing to
      // measure from, and the lap before is another session's.
      state.starts[carIdx] = start;
      state.measured[carIdx] = -1;
      continue;
    }
    if (start - previous < MIN_LAP_SECONDS) continue;
    const lapTime = start - previous;
    const estimate = estimatedLapTimes?.[carIdx];
    state.measured[carIdx] =
      typeof estimate === 'number' &&
      estimate > 0 &&
      lapTime > estimate * MAX_LAP_ESTIMATES
        ? -1
        : lapTime;
    state.starts[carIdx] = start;
  }
};

/**
 * Each car's last lap: the sim's time where it gave one, the lap timed from
 * its two starts where it did not, and -1 where there is neither.
 */
export const lmuLastLapTimes = (
  state: LmuLapStartState | undefined,
  lastLapTimes: ArrayLike<number> | undefined
): number[] =>
  lastLapTimes
    ? Array.from(lastLapTimes, (time, carIdx) => {
        if (time > 0) return time;
        const measured = state?.measured[carIdx];
        return measured !== undefined && measured > 0 ? measured : -1;
      })
    : [];

/**
 * Whether each car's last lap did not count: the sim gave it no time, and
 * the time published in its place is the one measured from its two starts.
 *
 * The sim's own statement, not a verdict about why. It is wider than a lap
 * voided for track limits: an out-lap in practice is untimed as well. False
 * before a car has completed a lap, which the sim also reports as no time
 * and which has nothing measured to stand in.
 */
export const lmuLastLapInvalid = (
  state: LmuLapStartState | undefined,
  lastLapTimes: ArrayLike<number> | undefined
): boolean[] =>
  lastLapTimes
    ? Array.from(lastLapTimes, (time, carIdx) => {
        if (time > 0) return false;
        const measured = state?.measured[carIdx];
        return measured !== undefined && measured > 0;
      })
    : [];
