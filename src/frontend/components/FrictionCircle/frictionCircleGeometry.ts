import type { FrictionCircleConfig } from '@irdashies/types';

/**
 * The geometry of the friction circle and the trail behind its dot. Pure, so
 * that where a reading lands can be tested without a canvas.
 */

export type FrictionCircleOrientation = FrictionCircleConfig['orientation'];

/** Shown where a figure has no reading behind it. */
export const NO_READING = '--';

export interface CirclePoint {
  /** Pixels from the centre; positive is right. */
  x: number;
  /** Pixels from the centre; positive is down, as a canvas counts. */
  y: number;
  /** The reading was longer than the scale and is drawn on the rim. */
  clamped: boolean;
}

/**
 * Where a reading is drawn, as an offset from the centre of a circle of
 * `radius` pixels whose rim stands for `scaleG`.
 *
 * `latG` is positive in a left-hand corner and `longG` positive accelerating
 * forwards. In the 'force' orientation the dot goes where the driver is
 * thrown: to the right in a left-hand corner, and up under braking, which is
 * a negative `longG` and a negative y. 'acceleration' turns both round.
 *
 * Writes into `out` and returns it, so drawing a trail allocates nothing.
 */
export const placeReading = (
  latG: number,
  longG: number,
  scaleG: number,
  radius: number,
  orientation: FrictionCircleOrientation,
  out: CirclePoint
): CirclePoint => {
  const sign = orientation === 'acceleration' ? -1 : 1;
  const scale = scaleG > 0 ? radius / scaleG : 0;
  let x = sign * latG * scale;
  let y = sign * longG * scale;
  const length = Math.hypot(x, y);
  const clamped = length > radius;
  if (clamped) {
    x = (x / length) * radius;
    y = (y / length) * radius;
  }
  // No -0: it is a different value to a strict comparison.
  out.x = x === 0 ? 0 : x;
  out.y = y === 0 ? 0 : y;
  out.clamped = clamped;
  return out;
};

/** The whole-g rings inside the rim: 1, 2 and 3 for a scale of 3.5. */
export const wholeGRings = (scaleG: number): number[] => {
  const rings: number[] = [];
  for (let g = 1; g < scaleG; g += 1) rings.push(g);
  return rings;
};

/** A magnitude to the two decimals the corners print. */
export const formatG = (value: number | null | undefined): string =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.abs(value).toFixed(2)
    : NO_READING;

/**
 * The most samples a trail holds: ten seconds, the longest the setting
 * allows, at the sixty a second the channel can reach.
 */
export const TRAIL_CAPACITY = 600;

/**
 * The last few seconds of readings, oldest first.
 *
 * A ring of fixed size, filled from the snapshots as they arrive. A sample
 * is stored only when the pair of readings has changed, so a car standing
 * still adds nothing and its trail drains away. Nothing is allocated after
 * construction.
 */
export class GTrail {
  private readonly lat: Float32Array;
  private readonly long: Float32Array;
  /** Arrival time of each sample, in the caller's seconds. */
  private readonly time: Float64Array;
  private start = 0;
  private count = 0;

  constructor(private readonly capacity = TRAIL_CAPACITY) {
    this.lat = new Float32Array(capacity);
    this.long = new Float32Array(capacity);
    this.time = new Float64Array(capacity);
  }

  get size(): number {
    return this.count;
  }

  /** Adds a reading that arrived at `now`, unless it repeats the last one. */
  push(latG: number, longG: number, now: number): void {
    if (this.count > 0) {
      const last = (this.start + this.count - 1) % this.capacity;
      if (
        this.lat[last] === Math.fround(latG) &&
        this.long[last] === Math.fround(longG)
      ) {
        return;
      }
    }
    if (this.count === this.capacity) {
      // Full: the oldest sample makes way.
      this.start = (this.start + 1) % this.capacity;
      this.count -= 1;
    }
    const index = (this.start + this.count) % this.capacity;
    this.lat[index] = latG;
    this.long[index] = longG;
    this.time[index] = now;
    this.count += 1;
  }

  /** Drops the samples that arrived more than `seconds` before `now`. */
  prune(now: number, seconds: number): void {
    while (this.count > 0 && now - this.time[this.start] > seconds) {
      this.start = (this.start + 1) % this.capacity;
      this.count -= 1;
    }
  }

  clear(): void {
    this.start = 0;
    this.count = 0;
  }

  /** The `index`-th sample, 0 being the oldest. */
  latAt(index: number): number {
    return this.lat[(this.start + index) % this.capacity];
  }

  longAt(index: number): number {
    return this.long[(this.start + index) % this.capacity];
  }

  timeAt(index: number): number {
    return this.time[(this.start + index) % this.capacity];
  }
}

/**
 * How strongly a sample of the trail is drawn: `newest` for one that has
 * just arrived, fading in a straight line to nothing at `seconds` old.
 */
export const trailOpacity = (
  age: number,
  seconds: number,
  newest = 0.6
): number => {
  if (!(seconds > 0) || age >= seconds) return 0;
  return newest * (1 - Math.max(age, 0) / seconds);
};
