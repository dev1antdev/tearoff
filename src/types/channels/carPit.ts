/** `where` of a car out on the circuit. */
export const CAR_PIT_ON_TRACK = 0;
/** `where` of a car in the pit lane, moving or at its box. */
export const CAR_PIT_IN_LANE = 1;
/** `where` of a car in its garage, or of a slot with no car in the world. */
export const CAR_PIT_IN_GARAGE = 2;

/**
 * Every car's pit visits, stints and energy use, as far as they can be seen
 * from outside the car.
 *
 * Coarse on purpose: for a rival only standing still can be seen, so any
 * stop of over a second restarts the stint, a stop-and-go included. The
 * player's own stints, which end on a service, are a different record.
 *
 * What it knows starts when the channel is first subscribed to. A stop made
 * before that is in `stops` under Le Mans Ultimate, which states the count,
 * and is not seen at all under iRacing.
 *
 * Every array is indexed by CarIdx.
 */
export interface CarPitSnapshot {
  /** CAR_PIT_ON_TRACK, CAR_PIT_IN_LANE or CAR_PIT_IN_GARAGE. */
  where: readonly number[];
  /**
   * Seconds in the pit lane on the current or most recent visit, to 0.1; 0
   * before the first, and in the garage.
   */
  laneTimeS: readonly number[];
  /** Seconds standing still on that visit, to 0.1. */
  standingS: readonly number[];
  /**
   * Stops made this session: the sim's count under LMU, the observed count
   * otherwise.
   */
  stops: readonly number[];
  /**
   * Laps the car had completed when it last went through the pit lane for
   * more than two seconds, stopping or not; -1 before the first.
   */
  lastPitLap: readonly number[];
  /** Laps the car had completed when it last stopped; -1 before the first. */
  lastStopLap: readonly number[];
  /**
   * Laps completed since the last stop, or since the start. -1 where that
   * cannot be told: LMU says the car has stopped, and the stop was before
   * this began watching.
   */
  stintLaps: readonly number[];
  /** Longest completed stint this session, laps; 0 before the first stop. */
  longestStintLaps: readonly number[];
  /**
   * Share of a full allocation used over the last completed lap, 0..1; -1
   * unknown. Virtual energy for a car that runs on it, fuel otherwise. Empty
   * under iRacing, as the next two are.
   */
  usedLastLap: readonly number[];
  /**
   * Running average of the same: the first sample, then a third of the way
   * to each new one; -1 unknown.
   */
  usedAverage: readonly number[];
  /** Laps the remaining budget lasts at the last lap's usage; -1 unknown. */
  lapsLeft: readonly number[];
  /** A stop is requested (LMU pit state 1). Empty under iRacing. */
  requested: readonly boolean[];
  counts: {
    onTrack: number;
    inLane: number;
    /** Of those in the lane, the cars standing still. */
    standingInLane: number;
    requested: number;
    /** Cars of this session in their garage or out of the world. */
    inGarage: number;
  };
  sessionNum: number | null;
  version: number;
}
