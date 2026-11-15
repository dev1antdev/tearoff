/**
 * How a lap time is coloured, stated once: the lap did not count, it is the
 * session's best, it is the driver's own best, or it is none of those.
 *
 * The standings' last-lap cell, the session bar's last lap and the lap timer's
 * rows each apply this rule (session-fastest purple, personal best green);
 * a widget that prints a lap time in a tile takes it from here.
 */

export type LapTimeTone =
  'invalid' | 'sessionBest' | 'personalBest' | 'slower' | 'none';

/** Two lap times closer than this are the same lap time. */
export const LAP_TIME_MATCH_SECONDS = 0.001;

export interface LapTimeToneInput {
  /** The lap time in seconds; null, 0 or negative when there is none. */
  time: number | null;
  /** The sim gave the lap no time: it did not count. */
  invalid?: boolean;
  /** The fastest lap of the session among the cars being compared. */
  sessionBest?: number | null;
  /** The driver's own best lap of the session. */
  personalBest?: number | null;
}

/**
 * The same lap as the best, not merely as quick: a time under the session
 * best that is not that lap (an all-time best from another day, a predicted
 * lap) is not the session best.
 */
const matchesBest = (time: number, best: number | null | undefined) =>
  typeof best === 'number' &&
  best > 0 &&
  Math.abs(time - best) < LAP_TIME_MATCH_SECONDS;

/** The first of the rules that applies, in the order they are listed above. */
export const lapTimeTone = ({
  time,
  invalid = false,
  sessionBest,
  personalBest,
}: LapTimeToneInput): LapTimeTone => {
  if (time === null || !(time > 0)) return 'none';
  if (invalid) return 'invalid';
  if (matchesBest(time, sessionBest)) return 'sessionBest';
  if (matchesBest(time, personalBest)) return 'personalBest';
  return 'slower';
};
