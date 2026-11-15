/**
 * Where the car was when Le Mans Ultimate moved it into the next sector.
 *
 * LMU says which sector the car is in and how long each one took, but not
 * where on the lap one becomes the next, so the boundary is learned from the
 * car: it is where the car was at the moment the sim's index moved. That
 * index comes from the scoring block, written five times a second, so it
 * moves up to a fifth of a second after the car did, which at speed is a
 * dozen metres. The lap clock runs at the telemetry rate, and the sim's own
 * sector times say how far into the lap the sector began: the difference is
 * how late the index was, and the car's position that long ago is the
 * boundary: `history.positionAt(sessionTime - indexLag(...))`.
 *
 * One implementation, for the sector timer and for the track profile: both
 * place the same boundary and have to agree on it.
 */

/**
 * The longest the sim's sector index may trail the crossing it reports. LMU
 * writes the index five times a second, so it is a fifth of a second late at
 * most. A lap clock further than this from the sector times beside it is not
 * timing the same lap.
 */
export const MAX_INDEX_LAG_SECONDS = 0.5;

/** Frames of position kept to place a crossing the index reported late. */
const POSITION_HISTORY = 128;

/**
 * How long before this frame the car crossed into the sector the sim's index
 * has just moved to, in seconds; 0 where that cannot be told.
 */
export const indexLag = (
  lapClock: number | null,
  sectorStartedAt: number | null
): number => {
  if (lapClock === null || sectorStartedAt === null) return 0;
  const lag = lapClock - sectorStartedAt;
  return lag >= 0 && lag <= MAX_INDEX_LAG_SECONDS ? lag : 0;
};

/** The clock and lap fraction of the last frames, oldest overwritten first. */
export class PositionHistory {
  private readonly times = new Float64Array(POSITION_HISTORY);
  private readonly pcts = new Float64Array(POSITION_HISTORY);
  private head = 0;
  private count = 0;

  clear(): void {
    this.count = 0;
  }

  remember(time: number, lapDistPct: number): void {
    this.times[this.head] = time;
    this.pcts[this.head] = lapDistPct;
    this.head = (this.head + 1) % POSITION_HISTORY;
    if (this.count < POSITION_HISTORY) this.count += 1;
  }

  /**
   * Where the car was at a moment within the last few frames, or null when
   * that moment is not between two of them.
   */
  positionAt(time: number): number | null {
    let newer = (this.head + POSITION_HISTORY - 1) % POSITION_HISTORY;
    for (let step = 1; step < this.count; step += 1) {
      const older = (newer + POSITION_HISTORY - 1) % POSITION_HISTORY;
      const from = this.times[older];
      const to = this.times[newer];
      if (time >= from && time <= to) {
        const fromPct = this.pcts[older];
        const toPct = this.pcts[newer];
        // A step back is the line: no place to read a sector start from.
        if (toPct < fromPct) return null;
        return to > from
          ? fromPct + ((time - from) / (to - from)) * (toPct - fromPct)
          : toPct;
      }
      newer = older;
    }
    return null;
  }
}

/** One of the sim's sector times, or null where it has not set one. */
export const simTimeAt = (
  times: readonly (number | null)[] | undefined,
  index: number
): number | null => {
  const value = times?.[index];
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null;
};

/**
 * How far into the lap the sector the car has just entered began, in
 * seconds, by the sim's times for the lap in progress
 * (`LmuCurrentSectorTimes`); null where it has not set them. The first
 * sector begins with the lap.
 */
export const simSectorStartedAt = (
  currentSectorTimes: readonly (number | null)[] | undefined,
  enteredSectorIdx: number
): number | null => {
  if (enteredSectorIdx === 0) return 0;
  const first = simTimeAt(currentSectorTimes, 0);
  if (enteredSectorIdx === 1) return first;
  const second = simTimeAt(currentSectorTimes, 1);
  return first !== null && second !== null ? first + second : null;
};
