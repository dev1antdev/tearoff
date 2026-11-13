import type {
  LapDeltaReference,
  LapDeltaSnapshot,
  ReferenceLap,
  ReferenceLapsSnapshot,
  Session,
  SessionLifecycleEvent,
  Telemetry,
} from '@irdashies/types';
import type { TelemetryProcessor } from './TelemetryProcessor';
import { crossingTime, isLineCrossing, trackLengthFrom } from './lapTiming';
import { referenceLapTime, referenceTimeAt } from '@irdashies/shared';

export interface LapDeltaReferenceSource {
  snapshot(): ReferenceLapsSnapshot;
}

/**
 * Further back than this in one step is not driving: the car was returned to
 * its pit, or the sim reset it. A spin that rolls backwards stays inside it.
 */
const BACKWARD_JUMP_METERS = 50;
/** The same as a lap fraction, for a track whose length is not known. */
const BACKWARD_JUMP_PCT = 0.02;
/** Further forward than this in one step is not driving either. */
const FORWARD_JUMP_PCT = 0.25;

/** How much of the lap just driven the trend is taken over. */
const TREND_WINDOW_SECONDS = 1;
/** Less than this and the slope is mostly noise, so there is no trend yet. */
const TREND_MIN_SPAN_SECONDS = 0.3;
/** Room for the window at any frame rate this runs at. */
const TREND_CAPACITY = 128;

const numericValue = (
  frame: Telemetry,
  key: keyof Telemetry
): number | null => {
  const value = frame[key]?.value?.[0];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

const round3 = (value: number | null): number | null =>
  value === null ? null : Math.round(value * 1000) / 1000;

/**
 * The slope of the delta over the last second, by least squares.
 *
 * A straight line through every sample in the window rather than the
 * difference between its two ends: under Le Mans Ultimate the lap fraction is
 * corrected in small steps a few times a second, and two points would turn
 * each step into a twitch of the bar.
 */
class DeltaTrend {
  private readonly times = new Float64Array(TREND_CAPACITY);
  private readonly deltas = new Float64Array(TREND_CAPACITY);
  private head = 0;
  private size = 0;

  reset(): void {
    this.head = 0;
    this.size = 0;
  }

  push(time: number, delta: number): void {
    // A paused sim repeats its clock. The same instant twice says nothing
    // about a slope, and enough of them would push the real samples out.
    const last = (this.head - 1 + TREND_CAPACITY) % TREND_CAPACITY;
    if (this.size > 0 && this.times[last] === time) {
      this.deltas[last] = delta;
      return;
    }
    this.times[this.head] = time;
    this.deltas[this.head] = delta;
    this.head = (this.head + 1) % TREND_CAPACITY;
    if (this.size < TREND_CAPACITY) this.size += 1;
  }

  /** Seconds of delta per second, or null without enough of a window. */
  slope(now: number): number | null {
    let count = 0;
    let sumT = 0;
    let sumD = 0;
    let sumTT = 0;
    let sumTD = 0;
    let oldest = now;
    for (let step = 1; step <= this.size; step += 1) {
      const index = (this.head - step + TREND_CAPACITY) % TREND_CAPACITY;
      // Measured back from now, which keeps the sums small and exact.
      const t = this.times[index] - now;
      if (t < -TREND_WINDOW_SECONDS) break;
      const d = this.deltas[index];
      count += 1;
      sumT += t;
      sumD += d;
      sumTT += t * t;
      sumTD += t * d;
      oldest = this.times[index];
    }
    if (count < 3 || now - oldest < TREND_MIN_SPAN_SECONDS) return null;
    const spread = count * sumTT - sumT * sumT;
    return spread > 0 ? (count * sumTD - sumT * sumD) / spread : null;
  }
}

const emptyReference = (): LapDeltaReference => ({
  lapTime: null,
  delta: null,
  trend: null,
});

/**
 * The player's current lap against their reference laps.
 *
 * The lap is timed from the point the lap fraction wraps, which is where the
 * reference recorder starts and stops its laps, so the two clocks agree. The
 * sim's own current-lap clock is not used: under Le Mans Ultimate it starts
 * at the timing line, which is not where the lap fraction wraps.
 *
 * A lap is only timed if it was seen from its start. On the out-lap, after a
 * return to the pits, and after the widget has been off for part of a lap,
 * there is no delta until the line is next crossed.
 */
export class LapDeltaProcessor implements TelemetryProcessor<LapDeltaSnapshot> {
  readonly channel = 'lap-delta.snapshot';
  readonly tickRateHz = 25;

  private playerCarIdx = -1;
  private backwardJumpPct = BACKWARD_JUMP_PCT;
  private enabled = true;
  private lapStart: number | null = null;
  private prevPct: number | null = null;
  private prevTime: number | null = null;
  private referenceVersion = -1;
  private sessionBestLap: ReferenceLap | null = null;
  private allTimeLap: ReferenceLap | null = null;
  private readonly sessionBestTrend = new DeltaTrend();
  private readonly allTimeTrend = new DeltaTrend();
  private latest: LapDeltaSnapshot = this.emptySnapshot();

  constructor(private readonly referenceLaps: LapDeltaReferenceSource) {}

  init(session: Session): void {
    const trackLength = trackLengthFrom(session);
    this.backwardJumpPct =
      trackLength > 0
        ? Math.min(BACKWARD_JUMP_METERS / trackLength, BACKWARD_JUMP_PCT)
        : BACKWARD_JUMP_PCT;
    const playerCarIdx = session.DriverInfo?.DriverCarIdx ?? -1;
    if (playerCarIdx === this.playerCarIdx) return;
    this.playerCarIdx = playerCarIdx;
    // A different car: its position is not a continuation of the last one's,
    // and the session best is looked up per car.
    this.referenceVersion = -1;
    this.stopTiming();
  }

  onFrame(frame: Telemetry): void {
    if (!this.enabled) return;
    const sessionTime = numericValue(frame, 'SessionTime');
    if (sessionTime === null) return;
    const sessionNum = numericValue(frame, 'SessionNum');
    if (
      this.latest.sessionNum !== null &&
      sessionNum !== null &&
      sessionNum !== this.latest.sessionNum
    ) {
      this.reset(sessionNum);
    }

    this.refreshReferences();
    const trackPct = this.playerPct(frame);
    this.advanceLapClock(trackPct, sessionTime);

    const elapsed = this.lapStart === null ? null : sessionTime - this.lapStart;
    // Written into the snapshot in place, and the version moved only when a
    // figure the widget shows has: a parked car publishes nothing.
    let changed = this.measure(
      this.sessionBestLap,
      this.sessionBestTrend,
      this.latest.sessionBest,
      trackPct,
      elapsed,
      sessionTime
    );
    changed =
      this.measure(
        this.allTimeLap,
        this.allTimeTrend,
        this.latest.allTime,
        trackPct,
        elapsed,
        sessionTime
      ) || changed;
    if (sessionNum !== this.latest.sessionNum) {
      this.latest.sessionNum = sessionNum;
      changed = true;
    }
    if (changed) this.latest.version += 1;
  }

  onLifecycle(event: SessionLifecycleEvent): void {
    this.reset(null);
    if (event.type === 'enter') this.enabled = !event.replay;
    else if (event.type === 'disconnect') this.enabled = false;
  }

  snapshot(): LapDeltaSnapshot {
    return this.latest;
  }

  /** The player's lap fraction, or null when the sim has none for them. */
  private playerPct(frame: Telemetry): number | null {
    if (this.playerCarIdx < 0) return null;
    const value = frame.CarIdxLapDistPct?.value?.[this.playerCarIdx] as unknown;
    // Exactly 0 is Le Mans Ultimate holding a car that has not reached the
    // line yet, on the grid or rolling up to the start: not a position, and
    // not somewhere a lap can be timed from.
    return typeof value === 'number' &&
      Number.isFinite(value) &&
      value > 0 &&
      value <= 1
      ? value
      : null;
  }

  private refreshReferences(): void {
    const snapshot = this.referenceLaps.snapshot();
    if (snapshot.version === this.referenceVersion) return;
    this.referenceVersion = snapshot.version;
    const sessionBest =
      snapshot.bestLaps.find(([carIdx]) => carIdx === this.playerCarIdx)?.[1] ??
      null;
    const allTime = snapshot.playerAllTimeLap ?? null;
    // A new reference is a different curve: a slope taken across the change
    // would be the gap between the two laps, not anything the car did.
    if (sessionBest !== this.sessionBestLap) this.sessionBestTrend.reset();
    if (allTime !== this.allTimeLap) this.allTimeTrend.reset();
    this.sessionBestLap = sessionBest;
    this.allTimeLap = allTime;
  }

  /** Starts, keeps or abandons the timing of the lap being driven. */
  private advanceLapClock(trackPct: number | null, sessionTime: number): void {
    const prevPct = this.prevPct;
    const prevTime = this.prevTime;
    this.prevPct = trackPct;
    this.prevTime = sessionTime;
    if (trackPct === null) {
      this.stopTiming();
      return;
    }
    if (prevPct === null || prevTime === null) return;
    // The clock ran backwards: a restart, or a replay being scrubbed.
    if (sessionTime < prevTime) {
      this.stopTiming();
      return;
    }
    if (isLineCrossing(prevPct, trackPct)) {
      // Placed exactly as the recorders place it, so this clock and the
      // curve it is read against start at the same instant.
      this.lapStart = crossingTime(prevPct, trackPct, prevTime, sessionTime);
      this.sessionBestTrend.reset();
      this.allTimeTrend.reset();
      return;
    }
    const moved = trackPct - prevPct;
    if (moved < -this.backwardJumpPct || moved > FORWARD_JUMP_PCT) {
      this.stopTiming();
    }
  }

  private stopTiming(): void {
    this.lapStart = null;
    this.prevPct = null;
    this.sessionBestTrend.reset();
    this.allTimeTrend.reset();
  }

  /**
   * One reference's reading, written into `target`. Returns whether any
   * figure in it moved.
   */
  private measure(
    lap: ReferenceLap | null,
    trend: DeltaTrend,
    target: LapDeltaReference,
    trackPct: number | null,
    elapsed: number | null,
    sessionTime: number
  ): boolean {
    const lapTime = lap ? referenceLapTime(lap) : null;
    let delta: number | null = null;
    let slope: number | null = null;
    if (lap && lapTime !== null && trackPct !== null && elapsed !== null) {
      const reference = referenceTimeAt(lap, trackPct);
      if (reference !== null) {
        delta = elapsed - reference;
        trend.push(sessionTime, delta);
        slope = trend.slope(sessionTime);
      }
    }
    const nextLapTime = round3(lapTime);
    const nextDelta = round3(delta);
    const nextTrend = round3(slope);
    if (
      nextLapTime === target.lapTime &&
      nextDelta === target.delta &&
      nextTrend === target.trend
    ) {
      return false;
    }
    target.lapTime = nextLapTime;
    target.delta = nextDelta;
    target.trend = nextTrend;
    return true;
  }

  private reset(sessionNum: number | null): void {
    this.referenceVersion = -1;
    this.sessionBestLap = null;
    this.allTimeLap = null;
    this.prevTime = null;
    this.stopTiming();
    this.latest = {
      ...this.emptySnapshot(),
      sessionNum,
      version: this.latest.version + 1,
    };
  }

  private emptySnapshot(): LapDeltaSnapshot {
    return {
      sessionBest: emptyReference(),
      allTime: emptyReference(),
      sessionNum: null,
      version: 0,
    };
  }
}
