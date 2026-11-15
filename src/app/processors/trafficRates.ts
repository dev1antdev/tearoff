/**
 * How fast a gap between two cars is closing, measured the way TinyPedal's
 * relative module does it and corrected for its start.
 *
 * Once a second the gap is compared with the second before. The change,
 * positive when closing, feeds three running averages that remember about
 * 15 s, 50 s and 100 s. A change of 3 s or more is two cars swapping places,
 * not closing, and is left out. When the middle average is more than 0.3
 * from the short one it is set to it, and the long one likewise to the
 * middle one, so a real change of pace is not averaged away for minutes.
 *
 * The correction is the one difference: each average is divided by
 * `1 - (1 - w)^n`, w its weight and n its samples so far, so that the first
 * minutes do not understate the rate. Uncorrected, the long average of a
 * steady rate reads 45 % of it after a minute.
 */

const SHORT_WEIGHT = 0.065;
const MIDDLE_WEIGHT = 0.02;
const LONG_WEIGHT = 0.01;
/** A change this large in one second is a swap of places. */
export const SWAP_JUMP_S = 3;
/** How far an average may sit from the quicker one before it is set to it. */
const PULL_GAP = 0.3;

export class ClosingAverages {
  private short = 0;
  private middle = 0;
  private long = 0;
  /** What is still missing from each average's weights: (1 - w)^n. */
  private shortRest = 1;
  private middleRest = 1;
  private longRest = 1;
  private previous = Number.NaN;
  private count = 0;

  /** Forgets everything: the next gap is a first reading. */
  restart(): void {
    this.short = 0;
    this.middle = 0;
    this.long = 0;
    this.shortRest = 1;
    this.middleRest = 1;
    this.longRest = 1;
    this.previous = Number.NaN;
    this.count = 0;
  }

  /**
   * One reading of the gap, seconds, taken `seconds` after the last: about
   * one, and the change is scaled to exactly one.
   */
  sample(gapS: number, seconds = 1): void {
    const previous = this.previous;
    this.previous = gapS;
    if (Number.isNaN(previous) || !(seconds > 0)) return;
    if (Math.abs(previous - gapS) >= SWAP_JUMP_S) return;
    this.feed((previous - gapS) / seconds);
  }

  /** One second's closing, seconds per second, however it was measured. */
  feed(closing: number): void {
    this.count += 1;
    // The corrected average, kept directly: a step of w / (1 - (1 - w)^n)
    // towards the reading is the same number as the plain average divided
    // by what its weights add up to so far.
    this.shortRest *= 1 - SHORT_WEIGHT;
    this.middleRest *= 1 - MIDDLE_WEIGHT;
    this.longRest *= 1 - LONG_WEIGHT;
    this.short +=
      (SHORT_WEIGHT / (1 - this.shortRest)) * (closing - this.short);
    this.middle +=
      (MIDDLE_WEIGHT / (1 - this.middleRest)) * (closing - this.middle);
    this.long += (LONG_WEIGHT / (1 - this.longRest)) * (closing - this.long);

    if (Math.abs(this.middle - this.short) > PULL_GAP) {
      this.middle = this.short;
    }
    if (Math.abs(this.long - this.middle) > PULL_GAP) this.long = this.middle;
  }

  /** Readings taken into the averages so far. */
  get samples(): number {
    return this.count;
  }

  /** Seconds closed per second over about the last quarter of a minute. */
  get shortRate(): number {
    return this.short;
  }

  get middleRate(): number {
    return this.middle;
  }

  /** The rate the table of laps to contact is worked out from. */
  get longRate(): number {
    return this.long;
  }
}

/** Seconds of readings an interval window holds. */
export const INTERVAL_WINDOW_S = 60;
const WINDOW_READINGS = INTERVAL_WINDOW_S + 1;

/**
 * The measured interval to one car behind over the last minute, a reading a
 * second: what the forecast of its arrival takes its closing rate from, and
 * what says whether that rate has been steady.
 *
 * The running averages above are for a table of laps: they are slow on
 * purpose, and a bad half-minute stays in them for minutes. A forecast in
 * seconds has to follow a car that has just cleared traffic, and has to go
 * when the car stops closing, so it reads the interval itself.
 *
 * A reading 3 s or more from the last is another car in the slot or the two
 * swapping places, and starts the window again.
 */
export class IntervalWindow {
  private readonly times = new Float64Array(WINDOW_READINGS);
  private readonly gaps = new Float64Array(WINDOW_READINGS);
  private count = 0;

  clear(): void {
    this.count = 0;
  }

  push(time: number, gapS: number): void {
    if (this.count > 0) {
      const last = this.count - 1;
      if (
        time <= this.times[last] ||
        Math.abs(gapS - this.gaps[last]) >= SWAP_JUMP_S
      ) {
        this.count = 0;
      }
    }
    if (this.count === WINDOW_READINGS) {
      this.times.copyWithin(0, 1);
      this.gaps.copyWithin(0, 1);
      this.count -= 1;
    }
    this.times[this.count] = time;
    this.gaps[this.count] = gapS;
    this.count += 1;
  }

  /** Seconds from the oldest reading to the newest. */
  get measuredS(): number {
    return this.count < 2 ? 0 : this.times[this.count - 1] - this.times[0];
  }

  /**
   * Fall of the interval per second over the last `seconds` of readings,
   * or over all there are when that is less; positive is closing.
   */
  closingOver(seconds: number): number {
    return this.closingBetween(seconds, 0);
  }

  /**
   * The same over a stretch of the window, from `olderS` seconds before the
   * newest reading to `newerS` seconds before it.
   */
  closingBetween(olderS: number, newerS: number): number {
    if (this.count < 2) return 0;
    const now = this.times[this.count - 1];
    const from = this.indexAt(now - olderS);
    const to = this.indexAt(now - newerS);
    if (to <= from) return 0;
    const span = this.times[to] - this.times[from];
    return span > 0 ? (this.gaps[from] - this.gaps[to]) / span : 0;
  }

  /** The reading nearest a session time. */
  private indexAt(time: number): number {
    let index = this.count - 1;
    while (index > 0 && this.times[index - 1] >= time) index -= 1;
    if (index > 0 && time - this.times[index - 1] < this.times[index] - time) {
      index -= 1;
    }
    return index;
  }
}

/**
 * The two gaps to one car on a lap of `lapS` seconds, from the signed time
 * to it (positive ahead): a car 5 s up the road is also a lap less 5 s
 * behind.
 */
export const wrapGaps = (
  deltaS: number,
  lapS: number
): { aheadS: number; behindS: number } =>
  deltaS > 0
    ? { aheadS: deltaS, behindS: lapS - deltaS }
    : { aheadS: deltaS + lapS, behindS: -deltaS };

/**
 * Laps of the player until two cars meet: the gap over the closing rate,
 * over the lap time. Null when the gap is not closing, when there is no lap
 * time, and when the meeting is more than `maxLaps` off.
 */
export const lapsToContact = (
  gapS: number,
  closingS: number,
  lapS: number | null,
  maxLaps: number
): number | null => {
  if (!(closingS > 0) || lapS === null || !(lapS > 0)) return null;
  const laps = gapS / closingS / lapS;
  return laps >= 0 && laps <= maxLaps ? laps : null;
};

/**
 * Whether a meeting falls inside the lap under way: no more laps off than
 * what is left of the lap of the car in front.
 */
export const meetsThisLap = (laps: number | null, pctOfLeadCar: number) =>
  laps !== null && laps <= 1 - pctOfLeadCar;
