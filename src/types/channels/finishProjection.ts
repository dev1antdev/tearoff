/**
 * How the race ends for the car the user is entered in, published by
 * `FinishProjectionProcessor` on `finish-projection.snapshot`: where the
 * leader and that car are and how fast they lap, what a stop costs it and
 * what it has aboard, and how its class neighbours come out once everyone
 * has made the stops they still owe.
 *
 * What depends on a setting -- which stop lengths to try, the extra time a
 * stop is given, how close to a line counts as close -- is worked out by the
 * reader from these figures (`src/shared/finishProjection/`), so changing a
 * setting needs no round trip.
 *
 * The leader's and the player's pace and progress are the ones
 * `fuel.projection` projects the race from. Nothing here derives them a
 * second time, so the two can never disagree about when the race ends.
 *
 * Seconds and laps throughout; an amount of fuel or energy is in the unit
 * `fuel.projection` counts in, litres or percent of the energy budget.
 */

/** One of the two cars the end of the race is worked out from. */
export interface FinishCar {
  carIdx: number;
  /** Seconds a lap. */
  paceS: number;
  /** Laps completed plus the fraction of the lap under way. */
  progress: number;
  /**
   * The pit lane time of the car's last stop, less what the same stretch
   * takes on the racing line, s. 0 before the first, while the car is in
   * the lane, and once a later pass down the lane that was not a stop (a
   * drive-through) has replaced the time.
   */
  lastStopLossS: number;
}

/**
 * What a rival's remaining stops are reckoned from. `energy`: what the sim
 * says it has left and what a lap costs it. `observed`: the longest stint it
 * has been seen to drive. `assumed`: the longest stint seen in its class,
 * or failing that the player's own.
 */
export type FinishRivalBasis = 'energy' | 'observed' | 'assumed';

/** A class neighbour of the player, and how the two come out of the pits. */
export interface FinishRival {
  carIdx: number;
  classPosition: number;
  /** Ahead of the player in the class order; behind otherwise. */
  ahead: boolean;
  /** Race time behind the player now, s; negative for a car ahead. */
  gapS: number;
  /** Laps to this car's own finish, with no further stop. */
  lapsLeft: number;
  /** Whole stops it still has to make. */
  stopsOwed: number;
  /**
   * What one of its stops costs against staying out, s. Null until the pit
   * lane of the track is known.
   */
  stopLossS: number | null;
  basis: FinishRivalBasis;
  /**
   * `gapS` after both cars have made the stops they owe, s. Null where a
   * stop is owed whose cost is not known, and where the stops the player
   * owes are not (`playerStopsOwed`).
   */
  projectedGapS: number | null;
  /**
   * How much further the gap moves on pace alone over the laps left, s:
   * positive when the rival is the slower of the two.
   */
  paceDeltaS: number;
  inPit: boolean;
}

/** How the length of the race is counted. */
export type FinishRaceType = 'time' | 'laps' | 'lapsAndTime';

/**
 * Why there is nothing to project. `notRace`: the session is not a race.
 * `notStarted`: the green flag has not been shown. `finished`: the flag is
 * out, or the car is classified. `noCar`: the user has no car in the race.
 * `otherCar`: the camera is on another car, and the race to hand is that
 * car's. `noPace`: the leader or the player has no lap time yet.
 */
export type FinishInvalidReason =
  'notRace' | 'notStarted' | 'finished' | 'noCar' | 'otherCar' | 'noPace';

/**
 * One of the hoses of a refuelling stop. Adding `x` units of the budget
 * keeps the car standing for the largest of `fixedS + x * perUnitS` over
 * the lines: they go in side by side.
 */
export interface FinishRefuelLine {
  fixedS: number;
  /** Seconds for each unit of the budget: per litre, or per percent. */
  perUnitS: number;
}

export interface FinishProjectionSnapshot {
  /** False while `reason` is set. */
  valid: boolean;
  reason: FinishInvalidReason | null;
  raceType: FinishRaceType;
  /** Seconds on the race clock; null in a race run to a lap count alone. */
  timeLeftS: number | null;
  /** Null in a race run to the clock alone. */
  lapLimit: number | null;
  /** Null when the player leads: the flag then falls for the player. */
  leader: FinishCar | null;
  player: FinishCar | null;
  /**
   * The laps to go that `fuel.projection` publishes, which holds a
   * finishing lap against flickering near a line. Null without one.
   */
  lapsToGo: number | null;
  energy: {
    isVirtualEnergy: boolean;
    /** Percent of the budget or litres a lap, over the player's valid laps. */
    perLap: number;
    /** Same unit. */
    aboard: number;
    capacity: number | null;
  } | null;
  /**
   * The pit lane's drive time less what the stretch takes on the racing
   * line, s: what a visit costs before any standing. Null until the lane
   * and a pace are known.
   */
  laneLossS: number | null;
  /** The standing time of the stop as the pit menu has it, s. */
  plannedStandingS: number | null;
  /** Null where the sim states no refuelling rates, which under iRacing is always. */
  refuelLines: readonly FinishRefuelLine[] | null;
  /** Standing time that cannot overlap refuelling: tyres, repairs, brakes, a penalty; s. */
  separateS: number;
  /** Standing time that can: a driver change; s. */
  overlapS: number;
  /**
   * Whole stops the player still has to make on what a lap costs. Null while
   * what the car has aboard is not read (`energy` is null): before its first
   * measured lap, and with a team-mate driving where the sim stops writing
   * the budget. Not known is not none: nothing is to be made of it.
   */
  playerStopsOwed: number | null;
  /**
   * The class cars nearest the player that are still running, at most
   * three ahead and three behind, nearest first on each side: those ahead,
   * then those behind.
   */
  rivals: readonly FinishRival[];
  sessionNum: number | null;
  version: number;
}

/** The most rivals carried on each side of the player. */
export const FINISH_RIVALS_PER_SIDE = 3;
