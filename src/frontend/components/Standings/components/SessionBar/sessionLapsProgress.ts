import { SessionState } from '@irdashies/types';

export interface SessionLapsProgressInput {
  sessionType: string | undefined;
  state: number;
  isFixedLapRace: boolean;
  /** Laps the focus car has completed. */
  lapsCompleted: number;
  /** Share of the lap it is on, 0..1. */
  lapProgress: number;
  /** Its own distance at the flag, in laps; 0 where nothing projects one. */
  projectedLaps: number;
  /** The projection is the scheduled distance. */
  projectedLapsExact: boolean;
  /** Whole laps to add to the projection rounded up. */
  extraLaps: number;
  /** The race clock has run out. */
  timeIsUp: boolean;
}

export interface SessionLapsProgressDisplay {
  /** Laps done with the share of this one: "2.72". */
  done: string;
  /**
   * Where the car will be at the flag: "25" for a scheduled distance,
   * "~10.3" for a projection. Undefined where there is none.
   */
  total: string | undefined;
  /** "+1" or "-1"; undefined at 0 and where it is not wanted. */
  extra: string | undefined;
  /** The car is on its last lap of the race. */
  finalLap: boolean;
}

/**
 * The laps item in its progress format: "2.72 / ~10.3 +1".
 *
 * The projection is said as a projection: "~" and one decimal when it is the
 * car's pace against the clock, a whole number when it is the scheduled
 * distance. With no pace to project from there is no total at all, only the
 * laps done.
 */
export const sessionLapsProgressDisplay = (
  input: SessionLapsProgressInput,
  showExtraLaps = true
): SessionLapsProgressDisplay => {
  const isRace = input.sessionType === 'Race';
  const finished = isRace && input.state >= SessionState.Checkered;
  // Past the flag the lap under way is the lap back to the pits: the laps
  // completed are the car's race.
  if (finished) {
    return {
      done: `${input.lapsCompleted}`,
      total: undefined,
      extra: undefined,
      finalLap: false,
    };
  }

  const done = (input.lapsCompleted + input.lapProgress).toFixed(2);
  const hasProjection = isRace && input.projectedLaps > 0;
  if (!hasProjection) {
    return { done, total: undefined, extra: undefined, finalLap: false };
  }

  const racing = input.state === SessionState.Racing;
  return {
    done,
    total: input.projectedLapsExact
      ? `${Math.round(input.projectedLaps)}`
      : `~${input.projectedLaps.toFixed(1)}`,
    extra:
      showExtraLaps && !input.projectedLapsExact && input.extraLaps !== 0
        ? `${input.extraLaps > 0 ? '+' : ''}${input.extraLaps}`
        : undefined,
    finalLap:
      racing &&
      (input.projectedLapsExact
        ? input.lapsCompleted + 1 >= input.projectedLaps
        : input.timeIsUp),
  };
};
