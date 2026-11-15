/**
 * The player's next pit stop, published by `PitStopEstimateProcessor` on
 * `pit-stop.snapshot`: how long it will stand and what it is made of, the
 * pit lane it is driven through, a timer for the visit under way, what goes
 * into the tank, and who is around on the way out.
 *
 * Not `pit-stops.snapshot`, which is the record of every stop every car has
 * made. This one is about the car the user is entered in, whoever is
 * driving it: through a team-mate's stint it goes on describing the team
 * car.
 *
 * Everything that depends on a setting -- the extra time added to a stop,
 * which cars a rejoin position counts -- is left to the renderer
 * (`src/frontend/domain/pitStop/`). What is here is what the sim and the
 * track say.
 *
 * Seconds, metres and metres per second throughout; the timer's fields are
 * `SessionTime` values, so a running timer publishes nothing.
 */

import type { LmuPenaltyKind } from '../lmu/penalty';

/**
 * `idle` with no car, in the garage or with stale data; `planning` out on
 * the circuit; `lane` in the pit lane and moving; `service` standing in it.
 */
export type PitStopPhase = 'idle' | 'planning' | 'lane' | 'service';

/** What a stop is made of, as the sim estimates each part. */
export interface PitStopParts {
  fuel: number; // s
  energy: number; // s, the sim's `ve`
  tyres: number; // s
  damage: number; // s
  driverSwap: number; // s
  brakes: number; // s
  brakeDucts: number; // s
  penalties: number; // s
}

/** The names of the parts, in the order the sim's estimate lists them. */
export const PIT_STOP_PART_KEYS = [
  'fuel',
  'energy',
  'tyres',
  'damage',
  'driverSwap',
  'brakes',
  'brakeDucts',
  'penalties',
] as const satisfies readonly (keyof PitStopParts)[];

/** The pit lane of the track being driven, as far as it has been learned. */
export interface PitLaneModel {
  entryPct: number | null; // lap fraction 0..1
  exitPct: number | null; // lap fraction 0..1
  lengthM: number | null; // m
  speedLimitMs: number | null; // m/s
  /**
   * `sim` is iRacing's own figure; `measured` was read off the limiter in
   * the lane; `assumed` is the 60 km/h Le Mans Ultimate is taken to run,
   * which no session states.
   */
  speedLimitSource: 'sim' | 'measured' | 'assumed' | null;
  /** Lane length over the limit: available once both lines are known. */
  driveAtLimitS: number | null; // s
  /**
   * Median of the player's own visits that stood: line to line less the
   * standing time, so with the braking into the box and the pulling away.
   */
  driveMeasuredS: number | null; // s
  /** What the same stretch costs on the racing line at the present pace. */
  trackTimeS: number | null; // s
}

export interface PitRejoinRival {
  carIdx: number;
  /** Race time behind the player, s; negative for a car ahead. */
  gapS: number;
  sameClass: boolean;
  inPit: boolean;
}

export interface PitExitPass {
  carIdx: number;
  /** SessionTime at which the car next crosses the pit exit line, s, to 0.1. */
  passAt: number;
  lapTimeS: number; // s, the pace used
  sameClass: boolean;
}

export interface PitStopSnapshot {
  phase: PitStopPhase;
  /** The sim says a stop is requested (LMU pit state 1). Always false under iRacing. */
  requested: boolean;
  lane: PitLaneModel;
  estimate: {
    /**
     * `sim` is Le Mans Ultimate's own estimate. `learned` is the median of
     * the player's earlier stops here in this car, which is all iRacing
     * allows; with `samples` 0 it is the required repair alone.
     */
    source: 'sim' | 'learned' | null;
    standingS: number | null; // s
    parts: PitStopParts | null; // LMU: all eight; iRacing: damage only
    optionalRepairS: number | null; // s, iRacing only
    samples: number; // stops behind a learned figure
    /**
     * The penalty the car has to serve, as Le Mans Ultimate names it: a
     * drive-through, which is a pass down the lane with nothing in `parts`,
     * a stop-and-go, or a time penalty taken at the stop. Null for a clean
     * car and under iRacing. Where the sim's UI socket has not named the
     * kind it is told from the estimate, which reads a time penalty as a
     * stop-and-go.
     */
    penalty: LmuPenaltyKind | null;
  };
  /** Frozen as the car crosses the entry line; what the timer counts against. */
  planned: { standingS: number | null; driveS: number | null } | null;
  timer: {
    enteredAt: number | null; // SessionTime, s
    stoppedAt: number | null; // SessionTime the car last came to rest, s
    standingS: number; // s, finished standing stretches of this visit
    exitedAt: number | null; // SessionTime, s
  };
  /** The last finished visit. */
  last: {
    laneS: number; // s, line to line
    standingS: number; // s
    plannedStandingS: number | null; // s
    lap: number;
  } | null;
  refuel: {
    isVirtualEnergy: boolean;
    target: number | null; // level the stop fills to: % or litres
    aboard: number; // same unit
    toAdd: number | null; // max(target - aboard, 0); iRacing: PitSvFuel
    toFinish: number | null; // signed: laps to go x usage per lap - aboard
    runLaps: number | null; // laps the target level lasts
    runMinutes: number | null; // runLaps x pace / 60
  } | null;
  rejoin: {
    position: number; // overall, now
    classPosition: number; // in class, now
    /** Nearest car ahead overall and in class, then cars behind up to 240 s, by gapS; at most 30. */
    ladder: readonly PitRejoinRival[];
    /** Driving time from here to the exit line through the pit lane with no stop, s. */
    driveToExitS: number | null;
    /** On-track cars and when each next crosses the exit line; at most 60. */
    passes: readonly PitExitPass[];
  } | null;
  sessionNum: number | null;
  version: number;
}

/** The most rivals a rejoin ladder carries. */
export const PIT_REJOIN_LADDER_MAX = 30;
/** How far behind the player a rival still makes the ladder, s. */
export const PIT_REJOIN_LADDER_BEHIND_S = 240;
/** The most exit-line passes carried. */
export const PIT_EXIT_PASSES_MAX = 60;
