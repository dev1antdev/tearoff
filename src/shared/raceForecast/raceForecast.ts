import { FINISH_ROUNDING_LAPS } from '../finishProjection';

/**
 * What the race forecast makes of the finish projection's figures: the lap
 * a stop falls due on, the window a stop can be made in, and the order a
 * class finishes in.
 *
 * None of it measures or costs anything. A car's laps left, the laps it has
 * in hand, the length of its stint, the stops it owes and the gap it ends
 * at are the finish projection's (`src/shared/finishProjection/` and the
 * processor that feeds it); these rules only read them. Here, where both
 * sides can reach it, so that the main process and whoever draws a forecast
 * name the same laps.
 *
 * Laps are numbered as the sims number them: lap N is complete when the
 * car's progress reaches N, and "the end of lap N" is that crossing.
 */

/**
 * The lap at the end of which a car has to stop: the last it completes on
 * what it has in hand. Never earlier than the lap under way, since that is
 * the first line it can stop at.
 */
export const stopDueLap = (progress: number, lapsInHand: number): number => {
  const nextLine = Math.floor(progress + FINISH_ROUNDING_LAPS) + 1;
  return Math.max(
    nextLine,
    Math.floor(progress + Math.max(0, lapsInHand) + FINISH_ROUNDING_LAPS)
  );
};

export interface PitWindowInput {
  /** Laps completed plus the fraction of the lap under way. */
  progress: number;
  /** Laps to the car's finish. */
  lapsLeft: number;
  /** Laps what is aboard lasts. */
  lapsInHand: number;
  /** Laps a full stint lasts. */
  stintLaps: number;
  /** Whole stops still to make. */
  stopsOwed: number;
}

export interface PitWindow {
  /** The first lap at the end of which a stop adds no stop to the race. */
  openLap: number;
  /** The last lap the car completes on what it has. */
  closeLap: number;
}

/**
 * The laps at the end of which the next stop can be made.
 *
 * It closes on the last lap what is aboard completes. It opens on the first
 * lap after which the stops owed still cover the distance: a car that stops
 * at the end of lap L and fills up has `stopsOwed` full stints for what is
 * left, so L can be no earlier than the finish less that many stints. Stop
 * before it and the race takes one stop more.
 *
 * Null where no stop is owed, or the length of a stint is not known.
 */
export const pitWindow = ({
  progress,
  lapsLeft,
  lapsInHand,
  stintLaps,
  stopsOwed,
}: PitWindowInput): PitWindow | null => {
  if (!(stopsOwed > 0) || !(stintLaps > 0)) return null;
  const closeLap = stopDueLap(progress, lapsInHand);
  const nextLine = Math.floor(progress + FINISH_ROUNDING_LAPS) + 1;
  const earliest = Math.ceil(
    progress + lapsLeft - stopsOwed * stintLaps - FINISH_ROUNDING_LAPS
  );
  return {
    openLap: Math.min(closeLap, Math.max(nextLine, earliest)),
    closeLap,
  };
};

/** A car as the order reads it. */
export interface ForecastEntrant {
  carIdx: number;
  /** Its place now; 0 where it has none. */
  classPosition: number;
  /**
   * Seconds behind the reference car at the flag; negative for a car that
   * ends ahead of it. The reference car itself is 0.
   */
  finishGapS: number;
}

/** Two gaps this close are the same gap: they are published to a tenth. */
const SAME_GAP_S = 0.05;

/**
 * The cars in the order they finish: by the gap each ends at, and where two
 * end level in the order they are in now. A car with no place now goes
 * behind one that has, level with it.
 */
export const forecastOrder = <T extends ForecastEntrant>(
  entrants: readonly T[]
): T[] => {
  const placeOf = (entrant: T): number =>
    entrant.classPosition > 0
      ? entrant.classPosition
      : Number.POSITIVE_INFINITY;
  return [...entrants].sort((a, b) => {
    const gap = a.finishGapS - b.finishGapS;
    if (Math.abs(gap) >= SAME_GAP_S) return gap;
    const place = placeOf(a) - placeOf(b);
    if (place !== 0 && !Number.isNaN(place)) return place;
    return a.carIdx - b.carIdx;
  });
};

/**
 * The cars that decide where `ownCarIdx` finishes: the two it finishes
 * between, and every car it changes places with between now and the flag.
 * `order` is the finishing order; `aheadNow` says whether a car is ahead of
 * the own one on the road now.
 */
export const forecastDeciders = <T extends ForecastEntrant>(
  order: readonly T[],
  ownCarIdx: number,
  aheadNow: (entrant: T) => boolean
): T[] => {
  const ownIndex = order.findIndex((entrant) => entrant.carIdx === ownCarIdx);
  if (ownIndex < 0) return [];
  return order.filter((entrant, index) => {
    if (index === ownIndex) return false;
    if (Math.abs(index - ownIndex) === 1) return true;
    return aheadNow(entrant) !== index < ownIndex;
  });
};

/** A forecast place as it stood when the car completed a lap. */
export interface PlaceMemoryEntry {
  lap: number;
  finish: number;
}

/**
 * The forecast place lap by lap, for "was P4 ten laps ago". Holds one entry
 * for each of the car's last `span` laps and nothing older, so it is capped
 * at `span + 1` entries however long the race runs.
 */
export class PlaceMemory {
  private entries: PlaceMemoryEntry[] = [];

  constructor(
    /** How many laps back the forecast is remembered. */
    private readonly span: number,
    /** The fewest laps back a remembered forecast is worth quoting. */
    private readonly minSpan: number
  ) {}

  /**
   * Notes the forecast for the lap the car has just completed. A lap count
   * that has gone backwards is another race, or the same one started again,
   * and what was held is dropped.
   */
  note(lapsCompleted: number, finish: number): void {
    const last = this.entries[this.entries.length - 1];
    if (last && lapsCompleted < last.lap) this.entries = [];
    // One entry a lap: the forecast as it stood when the lap was completed.
    if (last?.lap !== lapsCompleted) {
      this.entries.push({ lap: lapsCompleted, finish });
    }
    const oldest = lapsCompleted - this.span;
    while (this.entries.length > 0 && this.entries[0].lap < oldest) {
      this.entries.shift();
    }
  }

  /**
   * The forecast `span` laps ago, or the oldest held once that is at least
   * `minSpan` laps back; null before then.
   */
  was(lapsCompleted: number): { finish: number; lapsAgo: number } | null {
    const oldest = this.entries[0];
    if (!oldest) return null;
    const lapsAgo = lapsCompleted - oldest.lap;
    if (lapsAgo < this.minSpan || lapsAgo > this.span) return null;
    return { finish: oldest.finish, lapsAgo };
  }

  clear(): void {
    this.entries = [];
  }
}
