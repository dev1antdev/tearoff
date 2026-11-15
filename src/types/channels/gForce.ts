/** Standard gravity, m/s2: what one g is. */
export const STANDARD_GRAVITY = 9.80665;

/**
 * The player's car on the friction circle: lateral and longitudinal
 * acceleration in g, with their held maxima.
 *
 * Both sims. iRacing's two readings include gravity and Le Mans Ultimate's do
 * not, so on banking and gradients the iRacing reading is offset by the
 * slope's share of 1 g.
 */
export interface GForceSnapshot {
  /** False out of the car and until both accelerations have been read. */
  available: boolean;
  /** g, to 0.01; positive = accelerating to the left (a left-hand corner). */
  latG: number;
  /** g, to 0.01; positive = accelerating forwards, so braking is negative. */
  longG: number;
  /** Highest lateral magnitude of the last 5 s, g, to 0.01. */
  maxLatG: number;
  /**
   * Highest longitudinal magnitude of the last 5 s, braking or accelerating,
   * g, to 0.01.
   */
  maxLongG: number;
  /** Rolling best of the smoothed lateral magnitude, g, to 0.01. */
  sustainedLatG: number;
  sessionNum: number | null;
  version: number;
}
