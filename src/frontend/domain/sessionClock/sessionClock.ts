import { SessionState } from '@irdashies/types';

/** What the session timing store holds about the clock. */
export interface SessionClockInput {
  sessionType?: string;
  /** Seconds into the session. */
  time: number;
  timeRemaining: number;
  timeTotal: number;
  state: number;
  /** Session time at the green flag; the session timer does not restart. */
  greenFlagTimestamp: number;
  isFixedLapRace: boolean;
  /** Estimated race length in seconds, for a race over a set of laps. */
  totalRaceTime: number;
  adjustedRaceTime: number;
}

/** The session's clock in seconds, as the session bar and the Pit Wall show it. */
export interface SessionClock {
  elapsed: number;
  remaining: number;
  total: number;
}

/**
 * How long the session has run, has left and lasts.
 *
 * Outside a race these are the sim's own figures. In a race the clock is
 * counted from the green flag, held still until then, and for a race over a
 * set of laps taken from the estimate of how long those laps will take.
 */
export const sessionClock = ({
  sessionType,
  time,
  timeRemaining,
  timeTotal,
  state,
  greenFlagTimestamp,
  isFixedLapRace,
  totalRaceTime,
  adjustedRaceTime,
}: SessionClockInput): SessionClock => {
  if (sessionType !== 'Race') {
    return { elapsed: time, remaining: timeRemaining, total: timeTotal };
  }

  switch (state) {
    case SessionState.GetInCar:
      // Before grid, there is a ~2min countdown
      return {
        elapsed: time,
        remaining: timeRemaining,
        total: time + timeRemaining,
      };
    case SessionState.Warmup:
    case SessionState.ParadeLaps:
      // Freeze the race timers until green
      return isFixedLapRace
        ? { elapsed: 0, remaining: adjustedRaceTime, total: adjustedRaceTime }
        : { elapsed: 0, remaining: timeRemaining, total: timeTotal };
    case SessionState.Racing:
    case SessionState.Checkered: {
      // Session timer does not restart at green
      const elapsed = time - greenFlagTimestamp;
      return isFixedLapRace
        ? { elapsed, remaining: totalRaceTime - elapsed, total: totalRaceTime }
        : { elapsed, remaining: timeTotal - elapsed, total: timeTotal };
    }
    case SessionState.CoolDown: {
      const elapsed = time - greenFlagTimestamp;
      return isFixedLapRace
        ? {
            elapsed,
            remaining: adjustedRaceTime - elapsed,
            total: adjustedRaceTime,
          }
        : { elapsed, remaining: 0, total: timeTotal };
    }
    default:
      return { elapsed: 0, remaining: 0, total: 0 };
  }
};
