import type {
  FinishInvalidReason,
  FinishRaceType,
  FinishRivalBasis,
} from './finishProjection';

/**
 * How the race is heading for the class of the car the user is entered in,
 * published by `RaceForecastProcessor` on `race-forecast.snapshot`: every
 * running car of the class with the stops it still owes and the lap its
 * next one is due, the order they finish in if everything goes on as it
 * has, and for the own entry its stint, its pit window and where its next
 * stop puts it.
 *
 * Nothing in it is reckoned a second time. The end of the race, each car's
 * laps left, the stops it owes and what a stop costs are
 * `FinishProjectionProcessor`'s, run here over the whole class instead of
 * the three cars a side `finish-projection.snapshot` carries; a rejoin is
 * `projectRejoin` of `src/shared/pitStop/` on `pit-stop.snapshot`. What is
 * added is the order those figures put the class in, the laps they name,
 * and a memory of where the own entry was forecast to finish some laps ago.
 *
 * A forecast, never a result: it assumes every car keeps its recent pace
 * and makes exactly the stops it owes, each at the cost reckoned for it.
 * It knows nothing of a neutralisation, a penalty still to serve, a tyre or
 * driver change, or how much a rival takes on.
 *
 * Seconds and laps throughout; an amount aboard is in the unit
 * `fuel.projection` counts in, litres or percent of the energy budget.
 */

/** The most class cars a forecast carries, the own entry among them. */
export const RACE_FORECAST_MAX_CARS = 64;

/**
 * How far back the forecast place is remembered, in the own entry's laps:
 * `place.was` is the forecast as it stood this many laps ago, or as far
 * back as is held once that is at least RACE_FORECAST_MEMORY_MIN_LAPS.
 */
export const RACE_FORECAST_MEMORY_LAPS = 10;
export const RACE_FORECAST_MEMORY_MIN_LAPS = 5;

/** One running car of the class. */
export interface RaceForecastCar {
  carIdx: number;
  /** The user's own entry. */
  own: boolean;
  /** Its place in the class now; 0 where the sim gives it none. */
  classPosition: number;
  /** Race time behind the own entry now, s; negative for a car ahead. */
  gapS: number;
  inPit: boolean;
  /** The pace its finish is counted at, s a lap. */
  paceS: number;
  /** Laps completed plus the fraction of the lap under way. */
  progress: number;
  /** Laps to its own finish, with no further stop. */
  lapsLeft: number;
  /**
   * Whole stops it still has to make. Null for the own entry while what it
   * has aboard is not read, and nothing can be said.
   */
  stopsOwed: number | null;
  /** What that count rests on; null wherever `stopsOwed` is. */
  basis: FinishRivalBasis | null;
  /**
   * The lap at the end of which its next stop is due: the last one it
   * completes on what it has aboard, or the last of its stint. Null where
   * it owes none, and where the stint it is on was not seen to begin.
   */
  nextStopLap: number | null;
  /** Laps a full stint lasts it, on the same basis; 0 unknown. */
  stintLaps: number;
  /**
   * What one of its stops costs against staying out, s; for the own entry
   * the stop the pit menu is set to. Null until the pit lane is known.
   */
  stopLossS: number | null;
  /**
   * `gapS` once both cars have made the stops they owe, s. Null where a
   * stop is owed whose cost is not known, and for every rival while the
   * own entry's stops are not; 0 for the own entry.
   */
  netGapS: number | null;
  /**
   * `netGapS` with what the difference in measured pace does over the laps
   * left: the gap the forecast order is made from. Null wherever
   * `netGapS` is.
   */
  finishGapS: number | null;
  /**
   * Its place among these cars at the flag, 1 first; 0 while there is no
   * place to forecast, which is while `place` is null.
   */
  finishPosition: number;
  /** Stops made this session, as `car-pit.snapshot` counts them. */
  stops: number;
  /** Laps it had completed when it last stopped; null before the first. */
  lastStopLap: number | null;
  /**
   * Seconds in the pit lane on that stop; null before the first, while it
   * is still in the lane, and where a later pass down the lane has
   * replaced the figure.
   */
  lastStopLaneS: number | null;
  /** Laps completed since that stop or the start; null where not seen. */
  sinceStopLaps: number | null;
  /** Mean of its last five clean laps, s; null until it has five. */
  avg5S: number | null;
}

/** A car beside the own entry, in the order named. */
export interface RaceForecastNeighbour {
  carIdx: number;
  /** Seconds between the two cars; never negative. */
  gapS: number;
}

export interface RaceForecastPlace {
  /** Place in the class now. */
  now: number;
  /** Forecast place among the running cars of the class. */
  finish: number;
  /**
   * The forecast rests on less than a reading for a car that decides the
   * place: one of the two it finishes between, or one it changes places
   * with on the way. Its stops are assumed, its stop cannot be costed, or
   * it is in the pit lane now, with its stop not yet over.
   */
  uncertain: boolean;
  /** The forecast as it stood some laps ago; null before there is one. */
  was: { finish: number; lapsAgo: number } | null;
  /** The cars forecast to finish directly ahead and behind, at the flag. */
  ahead: RaceForecastNeighbour | null;
  behind: RaceForecastNeighbour | null;
}

/** Which budget ends the own entry's stint first. */
export type RaceForecastStintLimit = 'energy' | 'fuel';

/** The own entry's stint, from what it has aboard. */
export interface RaceForecastStint {
  isVirtualEnergy: boolean;
  /** Percent of the budget or litres. */
  aboard: number;
  capacity: number | null;
  perLap: number;
  /** Laps until the first of its budgets runs out. */
  lapsLeft: number;
  /**
   * `energy` for a car that stops on virtual energy, `fuel` for a car that
   * stops on its tank, and for an energy car whose tank will be empty
   * first.
   */
  limit: RaceForecastStintLimit;
  /**
   * Laps the tank of a car on virtual energy lasts. Null for a car on
   * fuel, before a lap of it has been measured, and while the sim does not
   * send the litres, which is while a team-mate drives.
   */
  tankLapsLeft: number | null;
  /**
   * The laps at the end of which the next stop can be made without adding
   * a stop to the race: from the first after which the stops owed still
   * cover the distance, to the last the car completes on what it has. Null
   * where no stop is owed.
   */
  window: { openLap: number; closeLap: number } | null;
}

/** Where the own entry rejoins if it stops now for its planned stop. */
export interface RaceForecastRejoin {
  /** Place in the class on rejoining. */
  position: number;
  /** The class car it comes out behind, and by how much. */
  ahead: RaceForecastNeighbour | null;
  /** The class car that comes out behind it, and by how much. */
  behind: RaceForecastNeighbour | null;
  /** Class cars near enough to get past that are in the pits themselves. */
  inPits: number;
  /** A car rejoins within the margin: the place could go either way. */
  closeCall: boolean;
}

export interface RaceForecastSnapshot {
  /** False while `reason` is set. */
  valid: boolean;
  /** Why there is nothing to forecast, as the finish projection says it. */
  reason: FinishInvalidReason | null;
  raceType: FinishRaceType;
  /** Seconds on the race clock; null in a race run to a lap count alone. */
  timeLeftS: number | null;
  /** Null in a race run to the clock alone. */
  lapLimit: number | null;
  /** The session clock when this was worked out, whole seconds. */
  sessionTimeS: number | null;
  /** Seconds from then until the leader takes the flag. */
  flagInS: number | null;
  /** The own entry; null while there is nothing to forecast. */
  ownCarIdx: number | null;
  /** The lap the own entry is on. */
  ownLap: number | null;
  /** Its last lap and its best of the session, s; null without one. */
  ownLastLapS: number | null;
  ownBestLapS: number | null;
  /**
   * The running cars of the own entry's class in the order of their places
   * now, the own entry among them; at most RACE_FORECAST_MAX_CARS.
   */
  cars: readonly RaceForecastCar[];
  /**
   * Null while what the own entry has aboard is not read: with its stops
   * unknown there is no gap to project to any car, and no place to name.
   */
  place: RaceForecastPlace | null;
  /** Null while what the car has aboard is not read. */
  stint: RaceForecastStint | null;
  /** Null outside the pit stop's own conditions for one: see `projectRejoin`. */
  rejoin: RaceForecastRejoin | null;
  sessionNum: number | null;
  version: number;
}
