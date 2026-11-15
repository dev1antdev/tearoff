/**
 * Where one car was when: its progress round the track against the session
 * clock, for as far back as a lap and more.
 *
 * It is what turns "that car is 300 m behind" into "that car is 4.2 s
 * behind": the interval between two cars is how long ago the one in front
 * was where the other is now, which is what a timing line between them
 * would read, and unlike a distance it does not shrink in every braking
 * zone and stretch again on every straight.
 *
 * Progress is in laps and never goes backwards here: a reading that is not
 * further on than the last is dropped, so both columns are sorted and can
 * be searched either way.
 *
 * Capped: 4,096 readings, which at five a second is over thirteen minutes,
 * more than a lap of any circuit raced. The oldest reading is overwritten.
 */
export const RUNNING_TRACE_CAPACITY = 4096;

export class RunningTrace {
  private readonly times: Float64Array;
  private readonly progress: Float64Array;
  private start = 0;
  private count = 0;

  constructor(private readonly capacity = RUNNING_TRACE_CAPACITY) {
    this.times = new Float64Array(capacity);
    this.progress = new Float64Array(capacity);
  }

  clear(): void {
    this.start = 0;
    this.count = 0;
  }

  get length(): number {
    return this.count;
  }

  /** Progress of the oldest reading; NaN when there is none. */
  get firstProgress(): number {
    return this.count > 0 ? this.progress[this.start] : Number.NaN;
  }

  /** Session time of the oldest reading; NaN when there is none. */
  get firstTime(): number {
    return this.count > 0 ? this.times[this.start] : Number.NaN;
  }

  /** Adds a reading. One that is not further on than the last is dropped. */
  push(time: number, progress: number): void {
    if (this.count > 0) {
      const last = (this.start + this.count - 1) % this.capacity;
      if (progress <= this.progress[last] || time <= this.times[last]) return;
    }
    if (this.count === this.capacity) {
      this.start = (this.start + 1) % this.capacity;
      this.count -= 1;
    }
    const index = (this.start + this.count) % this.capacity;
    this.times[index] = time;
    this.progress[index] = progress;
    this.count += 1;
  }

  /**
   * Session time at which the car was at `progress`, between the two
   * readings either side of it. Null outside what is on record.
   */
  timeAt(progress: number): number | null {
    return this.lookup(this.progress, this.times, progress);
  }

  /** Progress of the car at a session time. Null outside the record. */
  progressAt(time: number): number | null {
    return this.lookup(this.times, this.progress, time);
  }

  private lookup(
    keys: Float64Array,
    values: Float64Array,
    key: number
  ): number | null {
    const { count, start, capacity } = this;
    if (count < 2) return null;
    const first = start;
    const last = (start + count - 1) % capacity;
    if (key < keys[first] || key > keys[last]) return null;
    let low = 0;
    let high = count - 1;
    while (high - low > 1) {
      const middle = (low + high) >> 1;
      if (keys[(start + middle) % capacity] <= key) low = middle;
      else high = middle;
    }
    const lowIndex = (start + low) % capacity;
    const highIndex = (start + high) % capacity;
    const span = keys[highIndex] - keys[lowIndex];
    if (!(span > 0)) return values[lowIndex];
    const share = (key - keys[lowIndex]) / span;
    return values[lowIndex] + share * (values[highIndex] - values[lowIndex]);
  }
}
