/**
 * `class-tyres.snapshot`: for every car of the class the user is entered
 * in, the compounds it is on, how many laps it has run on the set and what
 * is left of the tread. Published by `ClassTyresRuntime` about once a
 * second while a race is being recorded.
 *
 * The laps are worked out from the race history (`src/shared/tyreSet/`):
 * no sim says that a rival changed tyres, so the figure comes with how sure
 * it is. The tread is the sim's own reading where there is one, which is
 * our own car and, under Le Mans Ultimate offline, every car; for the rest
 * it is an estimate, our own wear per lap on that compound times the laps
 * the car has run on it, and is published as one.
 *
 * Every array is indexed by CarIdx. A car of another class, and a slot
 * with no car, reads -1 and `TYRE_SET_UNKNOWN` throughout.
 */

/** Nothing is said of the car: another class, or nothing held of it. */
export const TYRE_SET_UNKNOWN = 0;
/** The set is at least `setLaps` old, and may be older. */
export const TYRE_SET_AT_LEAST = 1;
/** Counted from a stop judged by how long the car stood. */
export const TYRE_SET_LIKELY = 2;
/** Counted from a change that was seen, or from the start. */
export const TYRE_SET_SEEN = 3;

/** No tread figure. */
export const TREAD_NONE = 0;
/** Our own wear per lap applied to the car's laps on the set. */
export const TREAD_ESTIMATE = 1;
/** The sim's own reading of the car's tyres. */
export const TREAD_MEASURED = 2;

/**
 * Clean laps our own car needs on a compound before its wear is applied to
 * another car's laps: fewer say too little of what a lap costs.
 */
export const TREAD_ESTIMATE_MIN_OWN_LAPS = 3;

export interface ClassTyresSnapshot {
  /** The user's own entry; -1 while there is none. */
  ownCarIdx: number;
  /**
   * Compound index per wheel, LF RF LR RR, as the session's tyre list
   * numbers them: `carIdx * 4 + wheel`. -1 unknown.
   */
  compounds: readonly number[];
  /** Laps completed on the set; -1 where nothing is said. */
  setLaps: readonly number[];
  /** `TYRE_SET_*`: how sure `setLaps` is. */
  sure: readonly number[];
  /** Tread left, the mean of the four wheels, whole percent; -1 with none. */
  treadPct: readonly number[];
  /** `TREAD_*`: where `treadPct` is from. */
  treadSource: readonly number[];
  sessionNum: number | null;
  version: number;
}

export const EMPTY_CLASS_TYRES: ClassTyresSnapshot = {
  ownCarIdx: -1,
  compounds: [],
  setLaps: [],
  sure: [],
  treadPct: [],
  treadSource: [],
  sessionNum: null,
  version: 0,
};

/**
 * What the reckoning takes from the Timing Tower's settings: how long four
 * tyres take to change. It reaches the main process from the current
 * dashboard.
 */
export interface ClassTyresTuning {
  /**
   * Seconds a change of four tyres takes. 0 leaves it to what the sim
   * states for the user's own car, which Le Mans Ultimate does; where
   * nothing states it, no stop is judged by its length.
   */
  tyreChangeSeconds: number;
}

export const DEFAULT_CLASS_TYRES_TUNING: ClassTyresTuning = {
  tyreChangeSeconds: 0,
};

/** The longest a change of four tyres can be set to take, seconds. */
export const TYRE_CHANGE_SECONDS_MAX = 120;
