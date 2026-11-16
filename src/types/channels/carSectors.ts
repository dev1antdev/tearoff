/** Sectors in a lap as the sim times them, and the stride of the flat arrays. */
export const CAR_SECTORS_PER_LAP = 3;

/**
 * Every car's sector times, where the sim times sectors for the whole field.
 * Le Mans Ultimate does; iRacing times nobody's sectors, so there the
 * channel says `available: false` and carries nothing.
 *
 * `current`, `last` and `best` are flat, three entries a car at
 * `carIdx * 3 + sector`, in seconds to the millisecond; null where there is
 * no time.
 *
 * The bests are worked out here and not read from the sim, whose own best
 * figures are a best first sector and a best time to the end of the second:
 * taken apart they are not the best second and third sectors. So a best is
 * the quickest time seen for the sector since the channel was first read in
 * this session; the first sector alone also takes the sim's best, which is
 * a sector best and reaches back to the start of the session. They are kept
 * while no window reads the channel and are forgotten with the session.
 */
export interface CarSectorsSnapshot {
  /** The sim gives sector times for every car. */
  available: boolean;
  /**
   * The sectors finished on the lap under way. The third is always null:
   * the lap is over when it is, and its three are then in `last`.
   */
  current: readonly (number | null)[];
  /** The three sectors of the last completed lap. */
  last: readonly (number | null)[];
  /** The quickest each car has done each sector. */
  best: readonly (number | null)[];
  /** The classes the session lists, in no particular order. */
  classIds: readonly number[];
  /**
   * The quickest of each sector among the cars of each class: three entries
   * a class at `(index in classIds) * 3 + sector`; null before any of them
   * has a time.
   */
  classBest: readonly (number | null)[];
  sessionNum: number | null;
  version: number;
}
