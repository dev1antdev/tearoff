import type { ReferenceLap } from '@irdashies/types';

/**
 * "Is this lap usable as a speed reference", cached by lap identity.
 *
 * A promoted lap's speedsKph never changes, so this scan runs once per
 * reference lap rather than once per frame.
 */
const usableCache = new WeakMap<ReferenceLap, boolean>();

/**
 * True when every bucket of the lap carries a recorded speed.
 *
 * Speed recording only starts once the player's car index is known, so a lap
 * already in progress at that moment is still a valid *time* reference (and can
 * still be promoted to session best) while missing speeds for its early
 * buckets. We reject such a lap outright rather than blanking the bar across
 * part of every lap for the rest of the session, which would read as a broken
 * widget instead of a deliberate empty state.
 */
export function hasCompleteSpeedTrace(lap: ReferenceLap): boolean {
  const cached = usableCache.get(lap);
  if (cached !== undefined) return cached;

  const speeds = lap.speedsKph;
  // Length must match the lap's bucket count, not merely be non-empty: a
  // shorter trace reads as complete here while interpolation returns null for
  // every bucket past its end, which is the blanking this guard exists to
  // prevent. The recorder always allocates pointsCount, so this is an
  // invariant check rather than a known failure.
  let usable = !!speeds && speeds.length === lap.pointsCount;

  if (speeds && usable) {
    for (const speed of speeds) {
      if (speed <= 0) {
        usable = false;
        break;
      }
    }
  }

  usableCache.set(lap, usable);
  return usable;
}
