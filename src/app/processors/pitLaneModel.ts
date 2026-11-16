import type { PitLaneTiming, ReferenceLap } from '@irdashies/types';
import {
  PIT_LANE_TIMING_CARS,
  PIT_LANE_TIMING_SAMPLES,
} from '@irdashies/types';
import { referenceLapTime, referenceTimeAt } from '@irdashies/shared';

/**
 * The arithmetic of a pit lane: how long it is, how long it takes to drive,
 * what the same stretch costs on the racing line, and how its speed limit
 * and its two lines are learned. Pure, so each rule is tested on its own;
 * `PitStopEstimateProcessor` is what feeds it frames.
 */

/** A measured limit outside these is a misreading, m/s (29 to 144 km/h). */
const LIMIT_MIN_MS = 8;
const LIMIT_MAX_MS = 40;
/** Samples on the limiter, in a row, before the speed is taken as the limit. */
const LIMIT_SAMPLES = 5;
/** A sample may be this much faster than the one before it, m/s. */
const LIMIT_MAX_RISE_MS = 0.1;
/** Flat out on the limiter: throttle above, brake below. */
const LIMIT_MIN_THROTTLE = 0.95;
const LIMIT_MAX_BRAKE = 0.01;
/** Slower than this the car is not driving down the lane. */
const LIMIT_MIN_SPEED_MS = 1;
/** Two samples further apart than this are not one run on the limiter, s. */
const LIMIT_MAX_SAMPLE_GAP_S = 0.5;

/**
 * An entry seen with the car already in the first fifth of the lap, and
 * still there a tick before, was seen after the lap wrapped: the line is
 * near the end of the lap and the position before it was missed.
 */
const WRAPPED_ENTRY_PCT = 0.2;

/** The fraction of a lap from one point forward to another, 0..1. */
export const lapFractionBetween = (fromPct: number, toPct: number): number => {
  const span = (((toPct - fromPct) % 1) + 1) % 1;
  return span;
};

/**
 * Metres of pit lane between the two lines, across the start line where
 * the lane spans it. Null until both lines and the track length are known.
 */
export const pitLaneLengthM = (
  entryPct: number | null,
  exitPct: number | null,
  trackLengthM: number
): number | null => {
  if (entryPct === null || exitPct === null || !(trackLengthM > 0)) return null;
  return lapFractionBetween(entryPct, exitPct) * trackLengthM;
};

/** Lane length over the limit, as TinyPedal has it. Null without either. */
export const driveAtLimitS = (
  lengthM: number | null,
  speedLimitMs: number | null
): number | null =>
  lengthM !== null && speedLimitMs !== null && speedLimitMs > 0
    ? lengthM / speedLimitMs
    : null;

/** The middle value, or the mean of the middle two; null of nothing. */
export const median = (values: readonly number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
};

/**
 * What a stretch of the lap costs on the racing line, in seconds.
 *
 * Read off the reference lap where there is one -- the lap's own time
 * between the two points, scaled to the present pace -- and otherwise the
 * stretch's share of the lap at that pace. Null without a pace, or without
 * a lap time to scale by.
 */
export const trackTimeBetweenS = (
  fromPct: number,
  toPct: number,
  paceS: number | null,
  reference: ReferenceLap | null | undefined
): number | null => {
  if (paceS === null || !(paceS > 0)) return null;
  const share = lapFractionBetween(fromPct, toPct);
  if (reference) {
    const lapTime = referenceLapTime(reference);
    const from = referenceTimeAt(reference, fromPct);
    const to = referenceTimeAt(reference, toPct);
    if (lapTime !== null && from !== null && to !== null) {
      let seconds = to - from;
      // The stretch crosses the line, or the two readings sit a hair the
      // wrong way round for a stretch that is nearly the whole lap.
      if (seconds < 0 || (seconds === 0 && share > 0.5)) seconds += lapTime;
      return (seconds * paceS) / lapTime;
    }
  }
  return share * paceS;
};

/** One reading of the car in the pit lane, for the limit to be read off. */
export interface LimiterSample {
  sessionTime: number;
  onPitRoad: boolean;
  limiterOn: boolean;
  /** Raw pedals, 0..1. */
  throttle: number;
  brake: number;
  /** m/s. */
  speed: number;
}

/**
 * Reads the pit speed limit off the limiter, by TinyPedal's rule restated
 * for samples a fifth of a second apart: in the lane with the limiter on,
 * flat on the throttle and off the brake, the car holds one speed, and that
 * speed is the limit. Five samples in a row, each no slower than the one
 * before and less than 0.1 m/s faster, between 8 and 40 m/s.
 *
 * The first sample of a run has nothing before it to be compared with; it
 * opens the run, and the four after it settle it.
 */
export class PitSpeedLimitMeter {
  private run = 0;
  private lastSpeed = 0;
  private lastTime = Number.NEGATIVE_INFINITY;

  reset(): void {
    this.run = 0;
    this.lastTime = Number.NEGATIVE_INFINITY;
  }

  /** The limit, m/s to 0.01, on the sample that settles it; else null. */
  sample(reading: LimiterSample): number | null {
    const held =
      reading.onPitRoad &&
      reading.limiterOn &&
      reading.throttle > LIMIT_MIN_THROTTLE &&
      reading.brake < LIMIT_MAX_BRAKE &&
      reading.speed > LIMIT_MIN_SPEED_MS;
    if (!held) {
      this.run = 0;
      return null;
    }
    const elapsed = reading.sessionTime - this.lastTime;
    const rise = reading.speed - this.lastSpeed;
    const follows =
      this.run > 0 &&
      elapsed > 0 &&
      elapsed <= LIMIT_MAX_SAMPLE_GAP_S &&
      rise >= 0 &&
      rise < LIMIT_MAX_RISE_MS;
    this.run = follows ? this.run + 1 : 1;
    this.lastSpeed = reading.speed;
    this.lastTime = reading.sessionTime;
    if (this.run < LIMIT_SAMPLES) return null;
    // Settled. The next run starts afresh, so a limit is not given again on
    // every sample for as long as the car holds it.
    this.run = 0;
    return reading.speed >= LIMIT_MIN_MS && reading.speed <= LIMIT_MAX_MS
      ? Math.round(reading.speed * 100) / 100
      : null;
  }
}

/** One car on two neighbouring frames, for a line to be read off it. */
export interface LineCrossing {
  wasOnPitRoad: boolean;
  isOnPitRoad: boolean;
  /** Its track surface on the earlier frame was the pit stall. */
  wasInStall: boolean;
  /** Lap fractions on the two frames; negative for a car with no place. */
  previousPct: number;
  currentPct: number;
}

/**
 * Where the pit entry line is, from a car that has just gone onto pit road;
 * null when the frames do not show one.
 *
 * The rule of the renderer's `detectPitTransitions`: a car leaving its stall
 * goes onto pit road too and is not an entry, and an entry seen only after
 * the lap wrapped is dropped. The line lies between the two frames, so its
 * place is taken as the middle of them, which matters at five frames a
 * second where it does not at twenty-five.
 */
export const pitEntryFrom = (crossing: LineCrossing): number | null => {
  if (crossing.wasOnPitRoad || !crossing.isOnPitRoad) return null;
  if (crossing.wasInStall) return null;
  const { previousPct, currentPct } = crossing;
  if (!(currentPct >= 0)) return null;
  if (!(previousPct >= 0)) {
    return currentPct < WRAPPED_ENTRY_PCT ? null : currentPct;
  }
  if (previousPct < WRAPPED_ENTRY_PCT && currentPct < WRAPPED_ENTRY_PCT) {
    return null;
  }
  // Either side of the start line: the frame before is the one on the lap
  // the line belongs to.
  if (currentPct < previousPct) return previousPct;
  return (previousPct + currentPct) / 2;
};

/** Where the pit exit line is, from a car that has just left pit road. */
export const pitExitFrom = (crossing: LineCrossing): number | null => {
  if (!crossing.wasOnPitRoad || crossing.isOnPitRoad) return null;
  const { previousPct, currentPct } = crossing;
  if (!(currentPct >= 0)) return null;
  if (!(previousPct >= 0) || currentPct < previousPct) return currentPct;
  return (previousPct + currentPct) / 2;
};

export const emptyPitLaneTiming = (): PitLaneTiming => ({
  speedLimitMs: null,
  driveS: [],
  standingS: {},
});

const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * The timings with one more stop in them: its drive time at the end of the
 * track's list and its standing time at the end of the car's, each list
 * kept to its last five and the cars to the last twelve that stopped. A new
 * object; the one given is left as it was.
 */
export const withStopSample = (
  timing: PitLaneTiming | undefined,
  carKey: string | null,
  driveS: number,
  standingS: number
): PitLaneTiming => {
  const base = timing ?? emptyPitLaneTiming();
  const cars = Object.entries(base.standingS).filter(([car]) => car !== carKey);
  if (carKey !== null && carKey !== '') {
    cars.push([
      carKey,
      [...(base.standingS[carKey] ?? []), round2(standingS)].slice(
        -PIT_LANE_TIMING_SAMPLES
      ),
    ]);
  }
  return {
    speedLimitMs: base.speedLimitMs,
    driveS: [...base.driveS, round2(Math.max(0, driveS))].slice(
      -PIT_LANE_TIMING_SAMPLES
    ),
    standingS: Object.fromEntries(cars.slice(-PIT_LANE_TIMING_CARS)),
  };
};

/** The timings with a newly measured limit. A new object. */
export const withSpeedLimit = (
  timing: PitLaneTiming | undefined,
  speedLimitMs: number
): PitLaneTiming => ({
  ...(timing ?? emptyPitLaneTiming()),
  speedLimitMs,
});

/**
 * A session's pit speed limit in m/s, from the text it is given as
 * ("60.00 kph", "45 mph"); null when it states none.
 */
export const parsePitSpeedLimitMs = (
  text: string | undefined
): number | null => {
  if (!text) return null;
  const value = Number.parseFloat(text);
  if (!Number.isFinite(value) || value <= 0) return null;
  return /mph/i.test(text) ? value * 0.44704 : value / 3.6;
};
