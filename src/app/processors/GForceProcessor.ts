import {
  STANDARD_GRAVITY,
  type GForceSnapshot,
  type Session,
  type SessionLifecycleEvent,
  type Telemetry,
} from '@irdashies/types';
import type { TelemetryProcessor } from './TelemetryProcessor';
import { ImpactClock } from './impactClock';
import { PeakHold } from './peakHold';

/** Seconds the two maxima stand with nothing higher. */
const MAX_HOLD_S = 5;
/** Seconds the sustained lateral best stands. */
const SUSTAINED_HOLD_S = 30;
/** Time constant of the smoothed lateral magnitude, seconds. */
const SUSTAINED_TAU_S = 0.05;
/** The most one sample may sit above the smoothed value, g. */
const SUSTAINED_MAX_STEP_G = 0.2;
/** A longer step than this between frames is a gap, not a step. */
const MAX_STEP_S = 0.25;

type Frame = Record<string, { value?: unknown[] } | undefined>;

const number = (frame: Frame, key: string): number | undefined => {
  const value = frame[key]?.value?.[0];
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
};

const flag = (frame: Frame, key: string): boolean =>
  frame[key]?.value?.[0] === true;

/** To the hundredth of a g the widget prints. */
const round = (value: number): number => {
  const rounded = Math.round(value * 100) / 100;
  // -0 and 0 are different values to a strict comparison.
  return rounded === 0 ? 0 : rounded;
};

/**
 * Publishes the player's lateral and longitudinal acceleration in g, for the
 * friction circle.
 *
 * Both sims publish the two accelerations under the same names and signs:
 * positive to the left and forwards. The maxima are kept here rather than in
 * the widget so that they are taken from every frame the processor sees, not
 * from the snapshots a window happened to be sent.
 *
 * An impact reads as several g for a frame or two (a kerb strike on the
 * recorded Le Mans Ultimate race reaches 11). For two seconds after one the
 * maxima and the sustained best are not raised; the live reading still shows
 * it.
 */
export class GForceProcessor implements TelemetryProcessor<GForceSnapshot> {
  readonly channel = 'g-force.snapshot';
  // An input-style channel (R5.3): the dot is animated, like the pedals.
  readonly tickRateHz = 60;

  private readonly maxLat = new PeakHold(MAX_HOLD_S);
  private readonly maxLong = new PeakHold(MAX_HOLD_S);
  private readonly sustained = new PeakHold(SUSTAINED_HOLD_S, true);
  private readonly impacts = new ImpactClock();
  /** Smoothed lateral magnitude, g. */
  private smoothedLat = 0;
  private lastTime: number | undefined;
  private wasInGarage = false;

  private readonly latest: GForceSnapshot = {
    available: false,
    latG: 0,
    longG: 0,
    maxLatG: 0,
    maxLongG: 0,
    sustainedLatG: 0,
    sessionNum: null,
    version: 0,
  };

  /**
   * Deliberately does nothing: the host calls this on every session publish,
   * and nothing here depends on session data.
   */
  init(session: Session): void {
    void session;
  }

  onFrame(telemetry: Telemetry): void {
    const frame = telemetry as unknown as Frame;
    const t = number(frame, 'SessionTime');
    if (t === undefined) return;

    const inGarage = flag(frame, 'IsInGarage');
    if (inGarage && !this.wasInGarage) this.clear();
    this.wasInGarage = inGarage;

    const dt =
      this.lastTime === undefined
        ? 0
        : Math.min(Math.max(t - this.lastTime, 0), MAX_STEP_S);
    this.lastTime = t;

    const recentlyHit = this.impacts.observe(telemetry, t);
    // Before this frame's readings are offered, so that a maximum that has
    // run out restarts from them and not from 0.
    this.maxLat.expire(t);
    this.maxLong.expire(t);
    this.sustained.expire(t);

    const latAccel = number(frame, 'LatAccel');
    const longAccel = number(frame, 'LongAccel');
    const available =
      latAccel !== undefined &&
      longAccel !== undefined &&
      flag(frame, 'IsOnTrack');

    let latG = 0;
    let longG = 0;
    if (available) {
      latG = latAccel / STANDARD_GRAVITY;
      longG = longAccel / STANDARD_GRAVITY;
      const latMagnitude = Math.abs(latG);

      // A sample may lift the average by 0.2 g at most, so a spike cannot.
      const input = Math.min(
        latMagnitude,
        this.smoothedLat + SUSTAINED_MAX_STEP_G
      );
      this.smoothedLat +=
        (1 - Math.exp(-dt / SUSTAINED_TAU_S)) * (input - this.smoothedLat);

      if (!recentlyHit) {
        this.maxLat.offer(latMagnitude, t);
        this.maxLong.offer(Math.abs(longG), t);
        this.sustained.offer(this.smoothedLat, t);
      }
    } else {
      // Out of the car nothing is cornering: the average does not wait at
      // its last value for the driver to come back.
      this.smoothedLat = 0;
    }

    let changed = false;
    const sessionNum = number(frame, 'SessionNum') ?? null;
    if (sessionNum !== null && sessionNum !== this.latest.sessionNum) {
      this.latest.sessionNum = sessionNum;
      changed = true;
    }
    if (available !== this.latest.available) {
      this.latest.available = available;
      changed = true;
    }
    changed = this.set('latG', round(latG)) || changed;
    changed = this.set('longG', round(longG)) || changed;
    changed = this.set('maxLatG', round(this.maxLat.peak)) || changed;
    changed = this.set('maxLongG', round(this.maxLong.peak)) || changed;
    changed = this.set('sustainedLatG', round(this.sustained.peak)) || changed;
    if (changed) this.latest.version += 1;
  }

  onLifecycle(event: SessionLifecycleEvent): void {
    if (event.type === 'enter') return;
    this.clear();
    this.wasInGarage = false;
    this.latest.latG = 0;
    this.latest.longG = 0;
    this.latest.maxLatG = 0;
    this.latest.maxLongG = 0;
    this.latest.sustainedLatG = 0;
    if (event.type === 'disconnect') {
      this.latest.available = false;
      this.latest.sessionNum = null;
    }
    this.latest.version += 1;
  }

  /**
   * The host stops sending frames while no window shows the channel. The
   * maxima are kept; the step to the first frame after is not one.
   */
  pause(): void {
    this.lastTime = undefined;
  }

  snapshot(): GForceSnapshot {
    return this.latest;
  }

  /** Zeroes the maxima, the average and the hold. */
  private clear(): void {
    this.maxLat.reset();
    this.maxLong.reset();
    this.sustained.reset();
    this.impacts.reset();
    this.smoothedLat = 0;
    this.lastTime = undefined;
  }

  private set(
    key: 'latG' | 'longG' | 'maxLatG' | 'maxLongG' | 'sustainedLatG',
    value: number
  ): boolean {
    if (this.latest[key] === value) return false;
    this.latest[key] = value;
    return true;
  }
}
