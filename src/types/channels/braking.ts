/** One completed braking zone. */
export interface BrakingZone {
  /** Highest deceleration in the zone, g, to 0.01. */
  peakG: number;
  /** (entry speed - exit speed) / duration, g, to 0.01. */
  averageG: number;
  /** Metres covered from brake application to release, to 1. */
  distanceM: number;
  /** Seconds from application to release, to 0.01. */
  durationS: number;
  /** Speed at application, m/s, to 0.1. */
  entrySpeed: number;
  /** Speed at release, m/s, to 0.1. */
  exitSpeed: number;
  /** Seconds the ABS was working in the zone, to 0.1. */
  absS: number;
  /**
   * peakG minus the rolling best as it stood when the zone began, g, to
   * 0.01.
   */
  deltaG: number;
  /** SessionTime at release; identifies the zone. */
  endedAt: number;
}

/** The braking zone in progress. */
export interface BrakingLiveZone {
  /** Highest deceleration so far, g, to 0.01. */
  peakG: number;
  /** Metres covered since the brake went on, to 1. */
  distanceM: number;
  /** Seconds since the brake went on, to 0.1. */
  durationS: number;
  /** Speed at application, m/s, to 0.1. */
  entrySpeed: number;
}

/**
 * How hard the player's car is being stopped: the braking zone in progress,
 * the last one completed, and the bests they are measured against.
 *
 * Both sims; wheel lock times under Le Mans Ultimate only, where the sim
 * publishes how fast each wheel turns.
 */
export interface BrakingSnapshot {
  /**
   * False out of the car and before the first frame with an acceleration
   * reading.
   */
  available: boolean;
  /** The zone in progress, or null between zones. */
  live: BrakingLiveZone | null;
  /** The last zone that qualified; null until one has. */
  last: BrakingZone | null;
  /**
   * Rolling best peak, g, to 0.01; 0 when there is none. Frozen while a zone
   * is live.
   */
  referenceG: number;
  /**
   * Best peak since the session began or the car last left the garage, g, to
   * 0.01.
   */
  sessionBestG: number;
  /** Zones that qualified since the last reset. */
  zoneCount: number;
  /**
   * Seconds a wheel of the axle was locked under braking on the lap in
   * progress, [front, rear], to 0.1. Null when the sim publishes no wheel
   * rotation (iRacing).
   */
  lockS: readonly number[] | null;
  sessionNum: number | null;
  version: number;
}
