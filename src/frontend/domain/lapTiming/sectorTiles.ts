import { computeSectorColor, type SectorColor } from '@irdashies/context';
import type { SectorTimingSnapshot } from '@irdashies/types';

/**
 * What each tile of a row of sector times shows, from the sector timing
 * channel and the settings of the widget drawing it.
 *
 * A tile holds a time, not a delta. It is coloured against the player's own
 * best for that sector this session, the way Sector Delta and the track map
 * are: neither sim publishes other cars' sector times, so there is no
 * session best overall to hold it against.
 */

/** How long the lap just finished stays on the tiles at full strength. */
export const SECTOR_HOLD_SECONDS = 5;

/** Tiles drawn before the sim has said how many sectors the lap has. */
const PLACEHOLDER_SECTORS = 3;

export type SectorTileState =
  /** Driven on this lap, or the lap just finished while it is held. */
  | 'fresh'
  /** The previous lap's time, standing in until this lap's exists. */
  | 'stale'
  /** The player's best time for the sector this session. */
  | 'best'
  /** No time to show. */
  | 'none';

export interface SectorTile {
  /** Zero-based position of the sector on the lap. */
  index: number;
  /** S1 to Sn. */
  label: string;
  /** Seconds, or null when the tile has nothing to show. */
  time: number | null;
  state: SectorTileState;
  /** Against the player's best for the sector; 'default' without a time. */
  color: SectorColor;
  /** The sector had an incident in it: off the track, or a voided lap. */
  unclean: boolean;
}

export interface SectorTileOptions {
  /**
   * 'live': this lap's time once the sector is done, the previous lap's
   * until then. 'liveOnly': this lap's or nothing. 'best': the player's best
   * for each sector.
   */
  source: 'live' | 'liveOnly' | 'best';
  /**
   * 'mark' keeps a sector with an incident and flags it; 'drop' leaves it
   * out, as if it had not been driven.
   */
  incidents: 'mark' | 'drop';
  /** The most tiles in the row; a lap with more sectors shows a window. */
  max: number;
  /** The lap just finished is still held on the tiles: see sectorHoldActive. */
  holding: boolean;
  /** Fractions of the best within which a time is green, then yellow. */
  greenThreshold?: number;
  yellowThreshold?: number;
}

/**
 * Whether the lap just finished is still held on the tiles: the car is in
 * the first sector, came into it over the line, and did so less than five
 * seconds ago on the session clock.
 *
 * The last sector of a lap closes at the line, where the channel also clears
 * the current lap, so this hold is the only time its time is the latest one.
 */
export const sectorHoldActive = (
  snapshot: SectorTimingSnapshot | undefined,
  sessionTime: number
): boolean => {
  if (!snapshot || snapshot.currentSectorIdx !== 0) return false;
  // Put there by a reset to the pits or a return to the car, not driven in.
  if (!snapshot.sectorEntryValid) return false;
  const sinceEntry = sessionTime - snapshot.sectorEntryTime;
  return sinceEntry >= 0 && sinceEntry < SECTOR_HOLD_SECONDS;
};

const emptyTile = (index: number): SectorTile => ({
  index,
  label: `S${index + 1}`,
  time: null,
  state: 'none',
  color: 'default',
  unclean: false,
});

/**
 * Where the window of tiles starts on a lap with more sectors than fit.
 *
 * It follows the car: the sector being driven is the last tile, so the one
 * just completed is second from the right. While the finished lap is held it
 * shows the end of that lap instead.
 */
const windowStart = (
  sectorCount: number,
  size: number,
  currentSectorIdx: number,
  holding: boolean
): number => {
  const last = sectorCount - size;
  if (holding) return last;
  return Math.max(0, Math.min(last, currentSectorIdx - (size - 1)));
};

export const sectorTiles = (
  snapshot: SectorTimingSnapshot | undefined,
  {
    source,
    incidents,
    max,
    holding,
    greenThreshold,
    yellowThreshold,
  }: SectorTileOptions
): SectorTile[] => {
  const sectorCount = snapshot?.sectors.length ?? 0;
  if (!snapshot || sectorCount === 0) {
    return Array.from({ length: PLACEHOLDER_SECTORS }, (_, index) =>
      emptyTile(index)
    );
  }

  const view = incidents === 'drop' ? snapshot.clean : snapshot.inclusive;
  const tileAt = (index: number): SectorTile => {
    const best = view.sessionBestSectorTimes[index] ?? null;
    if (source === 'best') {
      return best === null
        ? emptyTile(index)
        : { ...emptyTile(index), time: best, state: 'best', color: 'purple' };
    }

    const current = view.currentLapSectorTimes[index] ?? null;
    const previous = view.previousLapSectorTimes[index] ?? null;
    // While the finished lap is held, it is the one on show, whole.
    const fromThisLap = !holding && current !== null;
    const time = fromThisLap
      ? current
      : holding || source === 'live'
        ? previous
        : null;
    if (time === null) return emptyTile(index);
    return {
      ...emptyTile(index),
      time,
      state: fromThisLap || holding ? 'fresh' : 'stale',
      color: computeSectorColor(time, best, greenThreshold, yellowThreshold),
      unclean:
        (fromThisLap
          ? view.currentLapSectorUnclean[index]
          : view.previousLapSectorUnclean[index]) === true,
    };
  };

  // A limit that is not a number limits nothing.
  const limit = Number.isFinite(max) ? Math.floor(max) : sectorCount;
  const size = Math.max(1, Math.min(limit, sectorCount));
  const start = windowStart(
    sectorCount,
    size,
    snapshot.currentSectorIdx,
    holding
  );
  return Array.from({ length: size }, (_, offset) => tileAt(start + offset));
};
