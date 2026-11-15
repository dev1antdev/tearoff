import type { TrackStateSnapshot } from '@irdashies/types';

/**
 * Where a car is on the track's profile, for the widgets that are about the
 * track rather than about one car: the elevation profile and the track
 * notes.
 *
 * The widgets place the car by these rules. A recorded race can only be
 * played in the main process, and the spec that checks the car's place on a
 * recorded lap has to place it as the widgets do, so the rules are here.
 */

/** A lap fraction brought into 0 <= fraction < 1. */
export const wrapLapFraction = (fraction: number): number => {
  if (!Number.isFinite(fraction)) return 0;
  // Left as it is where it can be: the sum below costs a fraction its last
  // digit, and 0.42 would come back a hair short of itself.
  if (fraction >= 0 && fraction < 1) return fraction;
  const wrapped = ((fraction % 1) + 1) % 1;
  // A value a hair under a whole lap rounds up to it in the sum above.
  return wrapped >= 1 ? 0 : wrapped;
};

/**
 * The lap fraction of the car a track widget is about.
 *
 * At the wheel that is the player's own. While watching it is the car the
 * camera is on, as the minimap centres on it: `lapDistPct` goes on describing
 * the user's own entry whatever is on screen, and the track is the same for
 * every car on it.
 *
 * `track-state.snapshot` carries the player's own fraction as the frame has
 * it, and every car's to three decimals. So a watched car is placed to a
 * thousandth of a lap: 3.6 m at Laguna Seca, 13.6 m at Le Mans.
 */
export const selectCarLapFraction = (
  snapshot: TrackStateSnapshot,
  followFocusCar: boolean
): number => {
  if (followFocusCar) {
    const focus = snapshot.carIdxLapDistPct[snapshot.focusCarIdx ?? -1];
    // Negative is a slot with no car on track.
    if (typeof focus === 'number' && focus >= 0) return wrapLapFraction(focus);
  }
  return wrapLapFraction(snapshot.lapDistPct);
};

/**
 * The height at a lap fraction, read off a profile of one height per bucket
 * by a straight line between the two buckets either side. The last bucket
 * runs on into the first: a lap ends where it began. Null without a profile.
 */
export const heightAtFraction = (
  elevationM: readonly number[],
  fraction: number
): number | null => {
  const count = elevationM.length;
  if (count === 0) return null;
  const position = wrapLapFraction(fraction) * count;
  const lower = Math.min(Math.floor(position), count - 1);
  const upper = (lower + 1) % count;
  const share = position - lower;
  return elevationM[lower] + (elevationM[upper] - elevationM[lower]) * share;
};
