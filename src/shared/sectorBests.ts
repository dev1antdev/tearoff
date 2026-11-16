/**
 * The player's best sectors for a simulator, track and car: what is kept of
 * them between sessions, the key they are kept under, and the one rule by
 * which a sector time or a lap of them becomes a best.
 *
 * Pure, and imported by main and renderer both, so that whoever gathers
 * sector times -- the sector timer today, the player's ledger if it ever
 * does -- and whoever adds them up uses the same arithmetic.
 */

/** What is stored for one key. Times are seconds; null is "none yet". */
export interface SectorBests {
  /** Quickest time of each sector on any lap: the parts of the theoretical best. */
  bestSectorTimes: (number | null)[];
  /** The sector times of the quickest whole lap. */
  bestLapSectorTimes: (number | null)[];
}

/**
 * The layout part of the key under Le Mans Ultimate, which times its own
 * three sectors on every track and does not say where they start.
 */
export const SIM_SECTOR_LAYOUT = 'sim3';

/** A sector time worth keeping: above nothing and below a day. */
const MAX_SECTOR_SECONDS = 99999;

export const isSectorTime = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value > 0 &&
  value < MAX_SECTOR_SECONDS;

/**
 * The layout part of the key where the session says where the sectors
 * start: how many there are and where, to four decimals, so the bests of
 * one sector layout never meet those of another on the same track.
 */
export const sectorLayoutKey = (sectorStartPcts: readonly number[]): string =>
  `${sectorStartPcts.length}@${sectorStartPcts
    .map((pct) => pct.toFixed(4))
    .join(',')}`;

/** `simulator|trackId|carKey|layout`, the key of the store's namespace. */
export const sectorBestsKey = (
  simulator: string,
  trackId: number,
  carKey: string,
  layout: string
): string => [simulator, trackId, carKey, layout].join('|');

export const emptySectorBests = (sectorCount: number): SectorBests => ({
  bestSectorTimes: Array<number | null>(sectorCount).fill(null),
  bestLapSectorTimes: Array<number | null>(sectorCount).fill(null),
});

/**
 * The time to the end of a sector: the sum of the sector times up to and
 * including it, the whole lap when no sector is named. Null as soon as one
 * part is missing, since a sum with a hole in it is not a time.
 */
export const sectorSum = (
  times: readonly (number | null | undefined)[],
  upToIdx: number = times.length - 1
): number | null => {
  if (!Number.isInteger(upToIdx) || upToIdx < 0 || upToIdx >= times.length) {
    return null;
  }
  let sum = 0;
  for (let index = 0; index <= upToIdx; index += 1) {
    const time = times[index];
    if (!isSectorTime(time)) return null;
    sum += time;
  }
  return sum;
};

/**
 * Offers a sector time to the best for that sector. Returns whether it was
 * taken: there was none, or this one is quicker.
 */
export const offerSectorTime = (
  bestSectorTimes: (number | null)[],
  sectorIdx: number,
  time: number
): boolean => {
  if (!isSectorTime(time) || sectorIdx < 0) return false;
  if (sectorIdx >= bestSectorTimes.length) return false;
  const best = bestSectorTimes[sectorIdx];
  if (best !== null && time >= best) return false;
  bestSectorTimes[sectorIdx] = time;
  return true;
};

/**
 * Whether a lap's sector times are quicker than the best lap's: every sector
 * of it has a time, and they add up to less, or there is no best lap yet.
 */
export const isQuickerLap = (
  lapSectorTimes: readonly (number | null)[],
  bestLapSectorTimes: readonly (number | null)[]
): boolean => {
  if (lapSectorTimes.length !== bestLapSectorTimes.length) return false;
  const lapTime = sectorSum(lapSectorTimes);
  if (lapTime === null) return false;
  const best = sectorSum(bestLapSectorTimes);
  return best === null || lapTime < best;
};

const parseTimes = (
  value: unknown,
  sectorCount: number
): (number | null)[] | null => {
  if (!Array.isArray(value) || value.length !== sectorCount) return null;
  return value.map((time) => (isSectorTime(time) ? time : null));
};

/**
 * What a stored value holds for a lap of this many sectors, or null for one
 * that is not sector bests at all or belongs to another layout. A best lap
 * with a sector missing is no lap, and reads as none.
 */
export const parseSectorBests = (
  stored: unknown,
  sectorCount: number
): SectorBests | null => {
  if (typeof stored !== 'object' || stored === null || sectorCount <= 0) {
    return null;
  }
  const { bestSectorTimes, bestLapSectorTimes } = stored as Record<
    string,
    unknown
  >;
  const bests = parseTimes(bestSectorTimes, sectorCount);
  if (!bests) return null;
  const lap = parseTimes(bestLapSectorTimes, sectorCount);
  return {
    bestSectorTimes: bests,
    bestLapSectorTimes:
      lap && sectorSum(lap) !== null
        ? lap
        : Array<number | null>(sectorCount).fill(null),
  };
};
