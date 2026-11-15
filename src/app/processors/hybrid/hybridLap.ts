import type { HybridMotorState } from '@irdashies/types';

/**
 * The lap accounting of a hybrid battery: what a lap used and recovered, how
 * long the motor deployed, and an estimate of the lap's net change measured
 * against the last clean lap.
 *
 * The rules are TinyPedal's, described in words and written afresh; where
 * this differs it says so. Nothing here has been run against a real hybrid
 * car: no recording holds one.
 *
 * Pure and deterministic: it is fed one sample per tick and does no I/O, so
 * the per-lap ledger can keep an account of its own from the same code.
 * A tick allocates nothing; the two traces are preallocated per track.
 */

export interface HybridLapSample {
  /** Session clock, seconds. */
  sessionTime: number;
  /** Battery charge, percent 0..100. */
  chargePct: number;
  /** The motor state as the sim states it; anything but 1, 2 or 3 is none. */
  simState: number;
  /** Laps completed, which moves in the frame the lap distance wraps. */
  lapCompleted: number;
  /** Metres into the lap; negative when the position is not known. */
  lapDistM: number;
  onPitRoad: boolean;
}

/** One point of the net-change trace every this many metres. */
const SAMPLE_SPACING_M = 5;
/** A step between two ticks longer than this is a teleport, not driving. */
const TELEPORT_M = 100;
/** A step of the clock longer than this is a gap, and is not booked. */
const MAX_STEP_S = 1;
/** Ticks without the charge moving before an inferred state reads idle. */
const IDLE_AFTER_TICKS = 3;
/** Seconds after the line for which the estimate is the reference's total. */
const ESTIMATE_HOLD_S = 0.3;
/** Trace points beyond track length over spacing, for a lap run wide. */
const TRACE_SLACK = 64;

const NO_TRACE = new Float32Array(0);

const simMotorState = (state: number): HybridMotorState =>
  state === 1 || state === 2 || state === 3 ? state : 0;

export class HybridLapAccount {
  /** Percentage points used and recovered so far this lap. */
  drainLapPct = 0;
  regenLapPct = 0;
  /** The same for the last completed lap; null before one is completed. */
  drainLastLapPct: number | null = null;
  regenLastLapPct: number | null = null;
  /** Estimated net change over this whole lap; null without a reference. */
  netLapEstimatePct: number | null = null;
  /** Seconds the motor has deployed this lap. */
  deployTimeLapS = 0;
  /** Seconds since a deployment ended; null while deploying and before one. */
  sinceDeployS: number | null = null;
  /** The motor state after the fallback, and whether it was inferred. */
  motorState: HybridMotorState = 0;
  motorStateInferred = false;
  /** Session clock at the last line crossing seen; null before one. */
  lapStartTime: number | null = null;

  private lastTime: number | null = null;
  private lastCharge = 0;
  /** The next sample follows a break: it is a new baseline, not a step. */
  private interrupted = true;
  private lastLapCompleted: number | null = null;
  private inferred: HybridMotorState = 1;
  private unchangedTicks = 0;
  private wasDeploying = false;

  private capacity = 0;
  /** This lap's trace: metres into the lap, and the net change there. */
  private traceDist = NO_TRACE;
  private traceNet = NO_TRACE;
  private traceCount = 0;
  /** The reference lap's trace, and that lap's net change at the line. */
  private refDist = NO_TRACE;
  private refNet = NO_TRACE;
  private refCount = 0;
  private refTotal = 0;
  /** This lap's trace cannot be a reference: a teleport, or a gap. */
  private traceBroken = false;
  /** This lap was opened by a line crossing that was seen. */
  private lapFromLine = false;
  private pitThisLap = false;
  private lastDist = -1;

  /**
   * Sizes the traces for a track. A changed length is a different track, so
   * the trace and the reference go with it; the same length changes nothing.
   */
  setTrackLength(metres: number): void {
    const capacity =
      Number.isFinite(metres) && metres > 0
        ? Math.ceil(metres / SAMPLE_SPACING_M) + TRACE_SLACK
        : 0;
    if (capacity === this.capacity) return;
    this.capacity = capacity;
    this.traceDist = new Float32Array(capacity);
    this.traceNet = new Float32Array(capacity);
    this.refDist = new Float32Array(capacity);
    this.refNet = new Float32Array(capacity);
    this.traceCount = 0;
    this.refCount = 0;
    this.refTotal = 0;
    this.netLapEstimatePct = null;
    this.traceBroken = true;
  }

  /**
   * Says the samples stopped for a while: a pause, a stale frame, the driver
   * out of the car. The next sample starts a new baseline and books nothing.
   */
  interrupt(): void {
    this.interrupted = true;
  }

  /** Back to nothing, as on a return to the garage. The track is kept. */
  reset(): void {
    this.drainLapPct = 0;
    this.regenLapPct = 0;
    this.drainLastLapPct = null;
    this.regenLastLapPct = null;
    this.netLapEstimatePct = null;
    this.deployTimeLapS = 0;
    this.sinceDeployS = null;
    this.motorState = 0;
    this.motorStateInferred = false;
    this.lapStartTime = null;
    this.lastTime = null;
    this.lastCharge = 0;
    this.interrupted = true;
    this.lastLapCompleted = null;
    this.inferred = 1;
    this.unchangedTicks = 0;
    this.wasDeploying = false;
    this.traceCount = 0;
    this.refCount = 0;
    this.refTotal = 0;
    this.traceBroken = false;
    this.lapFromLine = false;
    this.pitThisLap = false;
    this.lastDist = -1;
  }

  step(sample: HybridLapSample): void {
    let step =
      this.lastTime === null ? null : sample.sessionTime - this.lastTime;
    // The clock has not moved: the same moment again, with nothing to add.
    if (step === 0) return;
    // The clock stepped back, which is a new session or a restart.
    if (step !== null && step < 0) {
      this.reset();
      step = null;
    }
    const continuous = !this.interrupted && step !== null && step <= MAX_STEP_S;
    // Whatever happened in a gap was not seen, so the lap it fell in is not
    // one to measure the next against.
    if (step !== null && step > MAX_STEP_S) this.traceBroken = true;
    this.interrupted = false;
    this.lastTime = sample.sessionTime;

    // The line first, so that this tick's change is the new lap's.
    if (this.lastLapCompleted !== null) {
      if (sample.lapCompleted > this.lastLapCompleted) {
        this.closeLap(sample.sessionTime, continuous);
      } else if (sample.lapCompleted < this.lastLapCompleted) {
        // The count went back: not a lap, and not one seen from its line.
        this.traceBroken = true;
        this.lapFromLine = false;
      }
    }
    this.lastLapCompleted = sample.lapCompleted;

    const charge = sample.chargePct;
    if (continuous) {
      const previous = this.lastCharge;
      // Three steps are not booked, as TinyPedal leaves them out: one from
      // exactly 0, one that lands on 0 and one that lands on 100. A charge
      // that reads 0 for a frame at a reset would otherwise book the whole
      // battery as used, then as recovered.
      if (charge < previous) {
        if (previous !== 0 && charge > 0) this.drainLapPct += previous - charge;
        this.inferred = 2;
        this.unchangedTicks = 0;
      } else if (charge > previous) {
        if (previous !== 0 && charge < 100) {
          this.regenLapPct += charge - previous;
        }
        this.inferred = 3;
        this.unchangedTicks = 0;
      } else {
        this.unchangedTicks += 1;
        if (this.unchangedTicks >= IDLE_AFTER_TICKS) this.inferred = 1;
      }
    } else {
      this.inferred = 1;
      this.unchangedTicks = 0;
    }
    this.lastCharge = charge;

    // The sim's state where it gives one. Where it gives none and there is
    // a charge, the state the charge implies.
    const stated = simMotorState(sample.simState);
    this.motorStateInferred = stated === 0 && charge > 0;
    this.motorState =
      stated !== 0 ? stated : this.motorStateInferred ? this.inferred : 0;

    // The time since the last tick belongs to the state the motor was in
    // then, so a deployment is timed from the tick it starts to the tick it
    // is seen to have ended.
    const deploying = this.motorState === 2;
    if (continuous && step !== null) {
      if (this.wasDeploying) this.deployTimeLapS += step;
      else if (this.sinceDeployS !== null) this.sinceDeployS += step;
    }
    if (deploying && !this.wasDeploying) this.sinceDeployS = null;
    else if (!deploying && this.wasDeploying) this.sinceDeployS = 0;
    this.wasDeploying = deploying;

    this.trace(sample);
  }

  /** The line: this lap's totals become last lap's, and the trace turns over. */
  private closeLap(sessionTime: number, seen: boolean): void {
    // A lap is one to measure the next against only if it was driven from
    // the line, on the track, without a teleport.
    if (
      this.lapFromLine &&
      !this.traceBroken &&
      !this.pitThisLap &&
      this.traceCount >= 2
    ) {
      const dist = this.refDist;
      const net = this.refNet;
      this.refDist = this.traceDist;
      this.refNet = this.traceNet;
      this.refCount = this.traceCount;
      this.refTotal = this.regenLapPct - this.drainLapPct;
      this.traceDist = dist;
      this.traceNet = net;
    }
    this.drainLastLapPct = this.drainLapPct;
    this.regenLastLapPct = this.regenLapPct;
    this.drainLapPct = 0;
    this.regenLapPct = 0;
    // A deployment in progress across the line counts on from zero.
    this.deployTimeLapS = 0;
    this.traceCount = 0;
    this.traceBroken = false;
    this.pitThisLap = false;
    // A crossing that fell inside a gap was not seen.
    this.lapFromLine = seen;
    this.lapStartTime = sessionTime;
    this.lastDist = -1;
  }

  /** Records this lap's net change by distance, and estimates its total. */
  private trace(sample: HybridLapSample): void {
    if (sample.onPitRoad) this.pitThisLap = true;
    const net = this.regenLapPct - this.drainLapPct;
    const dist = sample.lapDistM;

    if (dist < 0 || this.capacity === 0) {
      // Nowhere to put a point, so nothing to measure the next lap against.
      this.traceBroken = true;
    } else {
      if (this.lastDist >= 0 && Math.abs(dist - this.lastDist) > TELEPORT_M) {
        this.traceBroken = true;
      }
      this.lastDist = dist;
      // Only while the car has shown a motor state: a point taken before
      // there is one records a battery nobody has seen move.
      if (!this.traceBroken && this.motorState !== 0) {
        const count = this.traceCount;
        if (
          count === 0 ||
          dist - this.traceDist[count - 1] >= SAMPLE_SPACING_M
        ) {
          if (count < this.capacity) {
            this.traceDist[count] = dist;
            this.traceNet[count] = net;
            this.traceCount = count + 1;
          } else {
            this.traceBroken = true;
          }
        }
      }
    }

    if (this.refCount < 2) return;
    // The reference lap's total, moved by how far this lap is ahead of or
    // behind it at the same place. TinyPedal starts from the last lap's
    // total instead, which is the same number whenever the last lap is the
    // reference, and a different lap's when it was an in-lap.
    const sinceLine =
      this.lapStartTime === null
        ? Number.POSITIVE_INFINITY
        : sample.sessionTime - this.lapStartTime;
    const difference =
      dist < 0 || sinceLine < ESTIMATE_HOLD_S
        ? 0
        : net - this.referenceNetAt(dist);
    this.netLapEstimatePct = this.refTotal + difference;
  }

  /** The reference lap's net change at a distance, between its two points. */
  private referenceNetAt(dist: number): number {
    const last = this.refCount - 1;
    if (dist <= this.refDist[0]) return this.refNet[0];
    if (dist >= this.refDist[last]) return this.refNet[last];
    let low = 0;
    let high = last;
    while (high - low > 1) {
      const middle = (low + high) >> 1;
      if (this.refDist[middle] <= dist) low = middle;
      else high = middle;
    }
    const span = this.refDist[high] - this.refDist[low];
    if (span <= 0) return this.refNet[low];
    const share = (dist - this.refDist[low]) / span;
    return this.refNet[low] + share * (this.refNet[high] - this.refNet[low]);
  }
}
