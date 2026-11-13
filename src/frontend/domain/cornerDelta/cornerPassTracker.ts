/**
 * Times the player's car through each corner of the lap, from the stream of
 * positions the sim publishes.
 *
 * A corner is a stretch of the lap between two lap fractions. The tracker
 * watches the car cross its start and its end and reports the pass: how long
 * the stretch took and how fast the car was going at either end. Both
 * crossings are placed between the two frames either side of them by
 * distance, so the figures do not carry the up-to-a-frame error of taking
 * the later frame as it is.
 *
 * It keeps no lap: a corner is whole when both its ends were crossed in one
 * unbroken run of driving, wherever on the lap that was, so a corner that
 * straddles the start/finish line is timed like any other.
 */

/** Where a corner starts and ends, as lap fractions. End may be past the line. */
export interface CornerSpan {
  startPct: number;
  endPct: number;
}

export interface CornerSample {
  /** The session clock, in seconds. */
  sessionTime: number;
  /** The lap fraction, above 0 and up to 1. Anything else is no position. */
  lapDistPct: number;
  /** Metres per second. */
  speedMs: number;
  /**
   * Whether the car is being driven on the track. False in the pit lane, in
   * the garage, out of the car and during a replay.
   */
  driving: boolean;
}

/** One drive through a corner. */
export interface CornerFigures {
  /** Seconds from the corner's start to its end. */
  timeSec: number;
  /** Metres per second at the corner's start. */
  entrySpeedMs: number;
  /** Metres per second at the corner's end. */
  exitSpeedMs: number;
}

export interface CornerPass extends CornerFigures {
  /** Which of the corners handed to the tracker. */
  cornerIndex: number;
  /** The last time this corner was driven before this pass, if it was. */
  previous: CornerFigures | null;
}

export interface CornerPassTrackerOptions {
  /** Metres. Without it a step back is judged as a lap fraction alone. */
  trackLengthM?: number;
}

/**
 * Two frames further apart than this are not neighbours: the sim was paused,
 * or the stream stalled. Nothing is placed between them.
 */
const MAX_FRAME_GAP_SECONDS = 0.5;

/**
 * Further forward than this in one step is not driving. Half a second at
 * 100 m/s is fifty metres, a twentieth of the shortest circuits; past a
 * tenth of a lap the car was moved.
 */
const FORWARD_JUMP_PCT = 0.1;

/**
 * Further back than this in one step is not driving either: the car was
 * returned to its pit, or the sim reset it. A slide that rolls backwards
 * stays inside it, and so do the small corrections Le Mans Ultimate makes to
 * the lap fraction a few times a second.
 */
const BACKWARD_JUMP_METERS = 50;
/** The same as a lap fraction, for a track whose length is not known. */
const BACKWARD_JUMP_PCT = 0.02;

/**
 * Below this the car is not driving through the corner: a spin to a halt, a
 * stop, a standing start. The time would be true and would mean nothing.
 */
const MIN_VALID_SPEED_MS = 1;

/** A step never crosses more boundaries than this; a guard, not a limit. */
const MAX_CROSSINGS_PER_STEP = 8;

const NO_PASSES: readonly CornerPass[] = [];

interface OpenPass {
  cornerIndex: number;
  entryTime: number;
  entrySpeedMs: number;
  minSpeedMs: number;
}

export class CornerPassTracker {
  private readonly corners: readonly CornerSpan[];
  private readonly backwardJumpPct: number;
  /** The last frame with a position, or none since the car last left. */
  private hasPrev = false;
  private prevTime = 0;
  private prevPct = 0;
  private prevSpeed = 0;
  private open: OpenPass | null = null;
  /** Each corner as it was last driven. */
  private readonly lastPasses = new Map<number, CornerFigures>();

  constructor(
    corners: readonly CornerSpan[],
    options: CornerPassTrackerOptions = {}
  ) {
    this.corners = corners;
    const trackLengthM = options.trackLengthM ?? 0;
    this.backwardJumpPct =
      trackLengthM > 0
        ? Math.min(BACKWARD_JUMP_METERS / trackLengthM, BACKWARD_JUMP_PCT)
        : BACKWARD_JUMP_PCT;
  }

  /**
   * Takes the next frame. Returns the corners the car completed between the
   * frame before and this one: none on almost every frame, one at a corner's
   * end.
   */
  push(sample: CornerSample): readonly CornerPass[] {
    const { sessionTime, lapDistPct, speedMs } = sample;
    if (
      !sample.driving ||
      !Number.isFinite(sessionTime) ||
      !Number.isFinite(speedMs) ||
      // Exactly 0 is Le Mans Ultimate holding a car that has not reached the
      // line yet: not a position.
      !(lapDistPct > 0) ||
      lapDistPct > 1
    ) {
      this.interrupt();
      return NO_PASSES;
    }

    const hadPrev = this.hasPrev;
    const prevTime = this.prevTime;
    const prevPct = this.prevPct;
    const prevSpeed = this.prevSpeed;
    this.hasPrev = true;
    this.prevTime = sessionTime;
    this.prevPct = lapDistPct;
    this.prevSpeed = speedMs;
    if (!hadPrev) return NO_PASSES;

    const elapsed = sessionTime - prevTime;
    if (elapsed < 0) {
      // The clock ran backwards: the session was restarted. What was driven
      // before it is not what the next corner should be measured against.
      this.open = null;
      this.lastPasses.clear();
      return NO_PASSES;
    }
    if (elapsed > MAX_FRAME_GAP_SECONDS) {
      this.open = null;
      return NO_PASSES;
    }

    // The shortest way round from the last frame to this one.
    let moved = lapDistPct - prevPct;
    if (moved < -0.5) moved += 1;
    else if (moved > 0.5) moved -= 1;

    if (moved < -this.backwardJumpPct || moved > FORWARD_JUMP_PCT) {
      this.open = null;
      return NO_PASSES;
    }
    if (this.open && speedMs < this.open.minSpeedMs) {
      this.open.minSpeedMs = speedMs;
    }
    // Standing still or rolling back crosses nothing. The corner being
    // driven stays open: its end is still ahead.
    if (!(moved > 0)) return NO_PASSES;

    let passes: CornerPass[] | null = null;
    // How far into this step the last boundary handled was, so two that
    // share a point are taken in the order the car met them.
    let from = 0;
    let abutting = false;
    for (let guard = 0; guard < MAX_CROSSINGS_PER_STEP; guard += 1) {
      if (this.open) {
        const corner = this.corners[this.open.cornerIndex];
        const offset = forward(corner.endPct, prevPct);
        if (!(offset > from) || offset > moved) break;
        const at = offset / moved;
        const pass = this.close(
          this.open,
          prevTime + at * elapsed,
          prevSpeed + at * (speedMs - prevSpeed)
        );
        this.open = null;
        if (pass) (passes ??= []).push(pass);
        from = offset;
        abutting = true;
        continue;
      }

      // The next corner to start inside what is left of this step. One that
      // starts exactly where the last one ended is entered at that point.
      let nextIndex = -1;
      let nextOffset = Number.POSITIVE_INFINITY;
      for (let index = 0; index < this.corners.length; index += 1) {
        const corner = this.corners[index];
        if (!(corner.startPct !== corner.endPct)) continue;
        const offset = forward(corner.startPct, prevPct);
        if (offset > moved || offset >= nextOffset) continue;
        if (abutting ? offset < from : offset <= from) continue;
        nextIndex = index;
        nextOffset = offset;
      }
      if (nextIndex < 0) break;
      const at = nextOffset / moved;
      const entrySpeedMs = prevSpeed + at * (speedMs - prevSpeed);
      this.open = {
        cornerIndex: nextIndex,
        entryTime: prevTime + at * elapsed,
        entrySpeedMs,
        minSpeedMs: Math.min(entrySpeedMs, speedMs),
      };
      from = nextOffset;
      abutting = false;
    }
    return passes ?? NO_PASSES;
  }

  /**
   * The car's position is no longer known, or it is not being driven. The
   * corner it was in is dropped; what was driven before is kept.
   */
  interrupt(): void {
    this.hasPrev = false;
    this.open = null;
  }

  /** Forgets everything, as for a new session. */
  reset(): void {
    this.interrupt();
    this.lastPasses.clear();
  }

  private close(
    open: OpenPass,
    exitTime: number,
    exitSpeedMs: number
  ): CornerPass | null {
    const timeSec = exitTime - open.entryTime;
    const minSpeedMs = Math.min(open.minSpeedMs, exitSpeedMs);
    // Negated so a NaN fails closed.
    if (!(timeSec > 0) || !(minSpeedMs > MIN_VALID_SPEED_MS)) return null;

    const figures: CornerFigures = {
      timeSec,
      entrySpeedMs: open.entrySpeedMs,
      exitSpeedMs,
    };
    const previous = this.lastPasses.get(open.cornerIndex) ?? null;
    this.lastPasses.set(open.cornerIndex, figures);
    return { ...figures, cornerIndex: open.cornerIndex, previous };
  }
}

/**
 * How far ahead of `fromPct` a point on the lap is, going forwards, as a lap
 * fraction above 0 and up to 1. A point the car is standing on is a lap away:
 * it was crossed on the step that arrived there.
 */
const forward = (pct: number, fromPct: number): number => {
  const ahead = pct - fromPct;
  return ahead > 0 ? ahead : ahead + 1;
};
