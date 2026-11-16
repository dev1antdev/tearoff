/**
 * Which cars completed a lap on a frame, read off each car's lap counter.
 *
 * One rule for everything that keeps a record per crossing: the lap history
 * the gap charts are drawn from and the race history that outlives the
 * session. A car's counter moving up is a crossing of the lap it was on. A
 * counter seen for the first time, or one that went back (a tow, a reset, a
 * session started again), is a new baseline and no crossing.
 */

/** What `take` returns for a car that did not cross the line. */
export const NO_CROSSING = -1;

export class LapCounterWatch {
  /** Last seen lap per car. -1 = no baseline yet. */
  private readonly previous: number[];

  constructor(maxCars: number) {
    this.previous = new Array<number>(maxCars).fill(-1);
  }

  /**
   * Takes a car's lap counter for this frame. Returns the lap the car was
   * on before it, which is the lap just completed, when the counter moved
   * up; NO_CROSSING otherwise.
   */
  take(carIdx: number, lap: number): number {
    const previous = this.previous[carIdx] ?? -1;
    this.previous[carIdx] = lap;
    return previous < 0 || lap <= previous ? NO_CROSSING : previous;
  }

  /**
   * Forgets the last seen lap of every car. Call it when frames resume
   * after a gap: the counters moved on meanwhile, and the first frame would
   * otherwise read as a crossing at the wrong time.
   */
  rebaseline(): void {
    this.previous.fill(-1);
  }
}
