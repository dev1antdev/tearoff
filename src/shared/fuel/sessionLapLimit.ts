// From the file rather than the @irdashies/types barrel: the fuel processor
// loads this under plain Node in the replay tools, where the barrel does not.
import { TIMED_SESSION_LAPS } from '../../types/telemetry';

/**
 * The number of laps a session is limited to, or 0 when it has no lap limit.
 *
 * A session run to the clock has no lap count, and every producer says so in
 * its own way: iRacing writes 'unlimited' in the session and 32767 in
 * telemetry, and Le Mans Ultimate has passed on rFactor 2's 2147483647. Read
 * as a number, the last of those is a race of two billion laps, and the fuel
 * to finish it. Anything at or above TIMED_SESSION_LAPS cannot be a lap
 * count, whichever sentinel it is, so none of them needs to be known here.
 */
export const sessionLapLimit = (sessionLaps: unknown): number => {
  const laps =
    typeof sessionLaps === 'number'
      ? sessionLaps
      : typeof sessionLaps === 'string'
        ? Number.parseInt(sessionLaps, 10)
        : Number.NaN;
  return Number.isFinite(laps) && laps > 0 && laps < TIMED_SESSION_LAPS
    ? laps
    : 0;
};
