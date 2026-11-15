/**
 * Race time behind the overall leader, for every car, laps included.
 *
 * LMU publishes `mTimeBehindLeader`, and for the first laps of a race it is
 * exactly what the standings want. It is not something to build on for a
 * whole race. rFactor 2, whose scoring LMU inherits, stops sending a time for
 * a car once it is more than a lap behind the leader -- and in a multi-class
 * race the leader is a prototype, so every GT car is more than a lap behind
 * it within a quarter of an hour and stays there to the flag. The standings
 * take a car's gap to its class leader as the difference of the two cars'
 * times behind the overall leader, so with both gone every gap and interval
 * in the class is a dash. That is what an eight-hour online multi-class race
 * showed here. There is no recording of one to measure the sim's figure on,
 * which is the other reason not to depend on it.
 *
 * So the figure is worked out here instead, from what the sim publishes for
 * every car whatever lap it is on: laps completed, and the sim's own estimate
 * of the time into the lap (`mTimeIntoLap`, against `mEstimatedLapTime` --
 * the pair TinyPedal builds its gaps on, having dropped `mTimeBehindLeader`
 * itself). Where a car is within a lap of the leader the result is the sim's
 * own number: on the recorded race the two agree to two hundredths of a
 * second for all 38 cars, but for one scoring update in which the sim's own
 * figures disagree with each other.
 *
 * Each class is measured on its own leader's lap time. A car's figure is its
 * class leader's time behind the overall leader plus its own time behind its
 * class leader, so the difference between two cars of one class -- the gap
 * and the interval the standings show -- depends only on those two cars and
 * on their class's pace, not on how many laps a faster class has put on them.
 */

export interface LmuRaceGapFrame {
  /** Overall position per car, 1 for the leader. */
  places: ArrayLike<number> | undefined;
  /** Class id per car. */
  classes: ArrayLike<number> | undefined;
  /** Position in class per car, 1-based, 0 where unknown. */
  classPositions: ArrayLike<number> | undefined;
  /** Laps completed per car. */
  totalLaps: ArrayLike<number> | undefined;
  /** The sim's estimate of each car's time into its lap, seconds. */
  timeIntoLap: ArrayLike<number> | undefined;
  /** The lap time that estimate is measured against, seconds. */
  estimatedLapTime: ArrayLike<number> | undefined;
  /** Lap fraction per car. Negative marks an empty slot. */
  lapDistPcts: ArrayLike<number> | undefined;
  /** The sim's own figure, kept where there is nothing to work one out from. */
  timeBehindLeader: ArrayLike<number> | undefined;
}

const usable = (value: number | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const positive = (value: number | undefined): value is number =>
  usable(value) && value > 0;

/**
 * How far round the race a car is, in laps.
 *
 * The part of the lap is taken in time rather than distance where the sim
 * gives both halves of it, because a second of gap is not the same length of
 * road in a hairpin as on a straight. A car the sim gives no estimate for
 * falls back to its place on the lap by distance.
 */
const progressOf = (frame: LmuRaceGapFrame, carIdx: number): number => {
  const laps = frame.totalLaps?.[carIdx];
  const completed = usable(laps) ? laps : 0;
  const estimate = frame.estimatedLapTime?.[carIdx];
  const into = frame.timeIntoLap?.[carIdx];
  if (positive(estimate) && usable(into)) return completed + into / estimate;
  const pct = frame.lapDistPcts?.[carIdx];
  return completed + (usable(pct) && pct > 0 ? Math.min(pct, 1) : 0);
};

/**
 * The time behind the overall leader per car slot, 0 for the leader and for
 * an empty slot, and negative for a car that is listed behind the leader and
 * is ahead of it on the road. A new array on every call.
 */
export function lmuTimeBehindLeader(frame: LmuRaceGapFrame): number[] {
  const { lapDistPcts, places, classes, classPositions, estimatedLapTime } =
    frame;
  const count = lapDistPcts?.length ?? 0;
  const result = new Array<number>(count).fill(0);
  if (count === 0 || !lapDistPcts) return result;

  // The leader by the sim's own order, which settles a dead heat and a
  // penalty the way the sim does. The car furthest round stands in for a
  // field with no car in first place.
  const progress = new Array<number>(count).fill(0);
  let leader = -1;
  let furthest = -1;
  for (let carIdx = 0; carIdx < count; carIdx += 1) {
    if (!(lapDistPcts[carIdx] >= 0)) continue;
    progress[carIdx] = progressOf(frame, carIdx);
    if (places?.[carIdx] === 1 && leader < 0) leader = carIdx;
    if (furthest < 0 || progress[carIdx] > progress[furthest]) {
      furthest = carIdx;
    }
  }
  if (leader < 0) leader = furthest;
  if (leader < 0) return result;

  const leaderEstimate = estimatedLapTime?.[leader];
  if (!positive(leaderEstimate)) {
    // Nothing to turn laps into seconds with. The sim's own figure is the
    // most that can be said.
    for (let carIdx = 0; carIdx < count; carIdx += 1) {
      const sim = frame.timeBehindLeader?.[carIdx];
      result[carIdx] = lapDistPcts[carIdx] >= 0 && positive(sim) ? sim : 0;
    }
    return result;
  }

  // Each class's leader, by the class positions worked out from the same
  // order; the car furthest round in the class where none holds first.
  const classLeader = new Map<number, number>();
  const classFurthest = new Map<number, number>();
  for (let carIdx = 0; carIdx < count; carIdx += 1) {
    if (!(lapDistPcts[carIdx] >= 0)) continue;
    const classId = classes?.[carIdx] ?? 0;
    if (classPositions?.[carIdx] === 1 && !classLeader.has(classId)) {
      classLeader.set(classId, carIdx);
    }
    const best = classFurthest.get(classId);
    if (best === undefined || progress[carIdx] > progress[best]) {
      classFurthest.set(classId, carIdx);
    }
  }

  for (let carIdx = 0; carIdx < count; carIdx += 1) {
    if (!(lapDistPcts[carIdx] >= 0) || carIdx === leader) continue;
    const classId = classes?.[carIdx] ?? 0;
    const head = classLeader.get(classId) ?? classFurthest.get(classId);
    if (head === undefined) continue;
    const headBehind = (progress[leader] - progress[head]) * leaderEstimate;
    const headEstimate = estimatedLapTime?.[head];
    const pace = positive(headEstimate) ? headEstimate : leaderEstimate;
    // A car the order has not caught up with yet -- one that has just made
    // a pass, or is held behind on a penalty -- comes out ahead of the car
    // it is listed behind, and its figure below that car's: negative, if
    // the car is the leader. The sim reports it the same way, and it is
    // kept so the gap between the two is its real size.
    result[carIdx] = headBehind + (progress[head] - progress[carIdx]) * pace;
  }
  return result;
}
