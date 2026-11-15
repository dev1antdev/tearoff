/**
 * A peak that is held for a while and then let go.
 *
 * Two displays read a maximum this way. The friction circle's maxima are the
 * plain kind: the highest value of the last few seconds, gone when the hold
 * runs out. The braking best and the sustained lateral grip keep a runner-up
 * as well, so that when the best is too old to stand it is replaced by the
 * best of what came after it instead of by nothing.
 *
 * The rule, with peak `H`, runner-up `R` and the time `T` either last moved:
 *
 * - a value above `H` becomes `H`, the old `H` becomes `R`, and `T` restarts;
 * - a value between `R` and `H` becomes `R`, and `T` restarts;
 * - once the hold has run out since `T`, `H` becomes `R`, `R` is cleared and
 *   `T` restarts.
 *
 * Without a runner-up `R` stays 0, so an expired peak drops to 0 and builds
 * again from the next value offered.
 *
 * Values are magnitudes: nothing at or below 0 is ever held.
 */
export class PeakHold {
  private held = 0;
  private second = 0;
  private since = 0;

  constructor(
    /** Seconds a peak stands with nothing new to restart it. */
    private readonly holdSeconds: number,
    private readonly keepsRunnerUp = false
  ) {}

  /** The held peak; 0 when there is none. */
  get peak(): number {
    return this.held;
  }

  /** The value that replaces the peak when it expires; 0 when there is none. */
  get runnerUp(): number {
    return this.second;
  }

  /** Offers a value read at time `t`, in seconds on the caller's clock. */
  offer(value: number, t: number): void {
    if (value > this.held) {
      this.second = this.keepsRunnerUp ? this.held : 0;
      this.held = value;
      this.since = t;
    } else if (this.keepsRunnerUp && value < this.held && value > this.second) {
      this.second = value;
      this.since = t;
    }
  }

  /**
   * Lets the peak go when it has stood for longer than the hold. Called on
   * every frame, before the frame's own value is offered, so that an expired
   * peak restarts from that value and not from 0.
   */
  expire(t: number): void {
    if (t < this.since) {
      // The clock went back. Restart the hold from here rather than keep the
      // peak for as long as it takes the clock to catch up.
      this.since = t;
      return;
    }
    if (t - this.since <= this.holdSeconds) return;
    this.held = this.second;
    this.second = 0;
    this.since = t;
  }

  reset(): void {
    this.held = 0;
    this.second = 0;
    this.since = 0;
  }
}
