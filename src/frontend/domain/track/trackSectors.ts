import type { Sector, TrackProfileSnapshot } from '@irdashies/types';

/**
 * Sectors as stretches of the lap, for a map that draws them on the road.
 *
 * iRacing's session says where its sectors start. Le Mans Ultimate times
 * three sectors and says where none of them starts, so the session mapped
 * from it carries even thirds, which are wrong on every real circuit: at
 * Laguna Seca the second sector starts 39.0 % of the way round and the third
 * 79.2 %. The real starts are learned from the car, by the track profile: on
 * a clean lap it places each start where the car was when the sim moved it
 * into the next sector, taking out the fifth of a second the sim's index
 * trails the crossing by, and keeps them for the circuit.
 */

/** A stretch of the lap as lap fractions, `from` below `to`, `to` at most 1. */
export interface LapSpan {
  from: number;
  to: number;
}

const NO_SPANS: readonly LapSpan[] = [];

/** Starts that begin at the line and rise to under a lap. */
const inLapOrder = (starts: readonly number[]): boolean =>
  starts.length > 0 &&
  starts[0] === 0 &&
  starts.every(
    (start, index) =>
      Number.isFinite(start) &&
      start < 1 &&
      (index === 0 || start > starts[index - 1])
  );

/**
 * Where a profile's sectors start, once the car has been seen crossing into
 * them; null until then.
 *
 * Null is "not known yet", and a map draws no boundary for it: thirds drawn
 * on the road would be a guess shown as a fact. It stays null through the
 * laps before the first clean one at a circuit, and for a circuit the driver
 * has only ever watched.
 */
export const learnedSectorStarts = (
  profile:
    | Pick<TrackProfileSnapshot, 'sectorStartPct' | 'sectorSource'>
    | null
    | undefined
): readonly number[] | null =>
  profile?.sectorSource === 'learned' && inLapOrder(profile.sectorStartPct)
    ? profile.sectorStartPct
    : null;

/** Sector starts in the shape a session describes its sectors in. */
export const sectorsFromStarts = (starts: readonly number[]): Sector[] =>
  starts.map((SectorStartPct, SectorNum) => ({ SectorNum, SectorStartPct }));

/**
 * The stretches of the lap covered by the sectors that are marked, in lap
 * order. Sectors next to each other come back as one stretch, so nothing is
 * drawn twice where they meet; the last sector and the first meet at the line
 * and stay two, each ending or starting there.
 */
export const sectorLapSpans = (
  starts: readonly number[],
  marked: readonly boolean[]
): readonly LapSpan[] => {
  if (!inLapOrder(starts)) return NO_SPANS;
  const spans: LapSpan[] = [];
  for (let index = 0; index < starts.length; index += 1) {
    if (marked[index] !== true) continue;
    const from = starts[index];
    const to = starts[index + 1] ?? 1;
    const previous = spans[spans.length - 1];
    if (previous && previous.to === from) previous.to = to;
    else spans.push({ from, to });
  }
  return spans.length > 0 ? spans : NO_SPANS;
};
