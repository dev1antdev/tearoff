/**
 * Where the player's car points and how far it has been driven: the compass
 * heading, the drift angle, the height, the distance into the lap, and the
 * metres and seconds driven in this session and over all time.
 *
 * North is what the sim calls north. iRacing states it. Le Mans Ultimate
 * states none, so the track model's +Z axis stands for it, and whether that
 * is true north depends on how the track was modelled. The height is the
 * track model's own, not an altitude, and can be negative.
 */
export interface CruiseSnapshot {
  /** False when the player is not in a car. */
  available: boolean;
  /**
   * Compass heading, whole degrees 0..359; null when the sim gives no
   * orientation.
   */
  headingDeg: number | null;
  /**
   * Heading minus direction of travel, degrees, one decimal; positive when
   * the nose points right of the path. 0 below 1 m/s.
   */
  driftDeg: number | null;
  /**
   * Height in the track's own coordinates, whole metres; null under iRacing,
   * which states none while the car is being driven.
   */
  elevationM: number | null;
  /** Whole metres from the start/finish line. */
  lapDistanceM: number | null;
  /** Driven since this session began: metres, and seconds above 1 m/s. */
  sessionMetres: number;
  sessionSeconds: number;
  /**
   * All time on this track in this car, this session included; null until
   * the stored totals are known.
   */
  totalMetres: number | null;
  totalSeconds: number | null;
  sessionNum: number | null;
  version: number;
}
