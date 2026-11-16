import type { TrackElevationSource, TrackNote } from '../trackProfile';

/**
 * The profile of the track being driven: its height along the lap, where its
 * sectors start and the driver's notes.
 *
 * Published when the session names another track, when the stored profile
 * changes, and every 5 % of the lap that is giving the track its first
 * profile. The car's own place on it is not here: `track-state.snapshot`
 * carries the lap fraction, and times `trackLengthM` that is metres.
 */
export interface TrackProfileSnapshot {
  /** `${simulator}:${trackId}`, or null with no session. */
  trackKey: string | null;
  /** Metres; 0 when the session states none. */
  trackLengthM: number;
  /**
   * Height per 10 m bucket in metres, rounded to 0.1 and shifted so the
   * lowest point is 0. Empty until one exists.
   */
  elevationM: readonly number[];
  /** Height at the line on the same shifted scale, metres. */
  lineElevationM: number;
  /** Highest minus lowest, metres. */
  elevationRangeM: number;
  elevationSource: TrackElevationSource | null;
  /**
   * 0..1 while the lap that will become the profile is being driven; null
   * otherwise.
   */
  recordingProgress: number | null;
  /**
   * Lap fraction where each sector starts, the first 0: the stored ones
   * where the car has been seen crossing them, the session's otherwise.
   */
  sectorStartPct: readonly number[];
  /** Every note of the track, sorted by distanceM. */
  notes: readonly TrackNote[];
  /**
   * When the sun rises and sets at the track, minutes since midnight on the
   * in-game clock, as the driver entered them. Each is absent until it has
   * been set: there is no default.
   */
  sunriseMinutes?: number;
  sunsetMinutes?: number;
  sessionNum: number | null;
  version: number;
}
