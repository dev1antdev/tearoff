/**
 * The player's wheels and the attitude of the chassis. Le Mans Ultimate only.
 *
 * Wheels are LF, RF, LR, RR. Each field is null while the sim does not
 * publish what it is built from, so "withheld" never reads as zero.
 */
export interface WheelDynamicsSnapshot {
  /** False until the wheel block has been read, out of the car, and under iRacing. */
  available: boolean;
  /** mm above the road at each corner, LF RF LR RR, to 0.1. Null when the sim publishes none. */
  rideHeightMm: readonly number[] | null;
  /** Damper position, mm, to 0.1. */
  suspensionPositionMm: readonly number[] | null;
  /**
   * Each wheel's share of the load on all four, 0..1, to 0.001.
   *
   * An estimate whenever `loadSource` is `suspensionForce`: that is the
   * pushrod load, which leaves out the unsprung mass and is scaled by each
   * axle's motion ratio. The split between the left and right wheel of an
   * axle is sound; the split between front and rear is approximate.
   */
  loadShare: readonly number[] | null;
  /** Which reading loadShare was built from. */
  loadSource: 'tyreLoad' | 'suspensionForce' | null;
  /** The sum of the four loads behind loadShare, N, to 10. */
  loadTotalN: number | null;
  /** How far each tyre is squashed, mm, to 0.1; 0 with the wheel in the air. */
  tyreDeflectionMm: readonly number[] | null;
  /** Degrees, smoothed, to 0.01; negative = top of the wheel leaning in. */
  camberDeg: readonly number[] | null;
  /** Degrees, smoothed, to 0.01; positive = toe-in on every wheel. Fronts include steering. */
  toeDeg: readonly number[] | null;
  /** Left minus right toe per axle, degrees, smoothed: [front, rear]; positive = toe-in. */
  toeTotalDeg: readonly number[] | null;
  /** Mean rear minus mean front ride height, mm, smoothed, to 0.1; positive = nose down. */
  rakeMm: number | null;
  /** Right minus left ride height per axle, mm, smoothed, to 0.1: [front, rear]. */
  rollMm: readonly number[] | null;
  /** The front axle's part of the two roll figures, 0..1, slow-smoothed, to 0.001. */
  rollShareFront: number | null;
  sessionNum: number | null;
  version: number;
}
