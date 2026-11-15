/**
 * What is known about a circuit as a function of the distance into the lap:
 * how high it is, where its centreline runs, where its sectors start, and
 * the driver's own notes. One record per simulator and track, built from the
 * laps the user drives.
 */

/** The file layout this build reads and writes. */
export const TRACK_PROFILE_VERSION = 1;

/** Metres of track a profile's bucket covers: the lap curve's spacing. */
export const TRACK_PROFILE_SPACING_M = 10;

/**
 * The most buckets a profile may hold: 50 km of track. The longest lap
 * either sim has is half that.
 */
export const TRACK_PROFILE_MAX_POINTS = 5000;

/** The most notes kept for one track. */
export const TRACK_NOTE_LIMIT = 500;
export const TRACK_NOTE_TEXT_LENGTH = 120;
export const TRACK_NOTE_COMMENT_LENGTH = 500;

/** The longest note file accepted for import, in characters. */
export const TRACK_NOTE_FILE_LENGTH = 1_024_000;

export type TrackNoteKind = 'track' | 'pace';

export interface TrackNote {
  /** Generated when the note is created, stable across edits. */
  id: string;
  /** Metres from where the lap fraction wraps; 0 <= d < trackLengthM. */
  distanceM: number;
  kind: TrackNoteKind;
  /** At most 120 characters. */
  text: string;
  /** At most 500 characters; '\n' is a line break. */
  comment: string;
  /** Shown only while the car is on pit road (TinyPedal's #pit tag). */
  pit: boolean;
}

/**
 * Where an elevation profile came from: the car's own height as LMU states
 * it, the car's vertical speed added up round a lap under iRacing (a shape,
 * less exact, with 0 at the line), or a TinyPedal track map found on disk.
 */
export type TrackElevationSource = 'recorded' | 'integrated' | 'tinypedal';

/**
 * Where the sector starts came from: the session states them (iRacing), the
 * car was seen crossing them (LMU), or neither yet.
 */
export type TrackSectorSource = 'session' | 'learned' | 'nominal';

export interface TrackProfile {
  version: 1;
  /** 'iracing' or 'lmu'. */
  simulator: string;
  trackId: number;
  trackName: string;
  trackLengthM: number;
  /** ceil(trackLengthM / 10): the lap-curve bucket count. */
  pointsCount: number;
  /**
   * Metres per bucket. LMU: world Y as published, on the track model's own
   * datum. iRacing: integrated, 0 at the line.
   */
  elevationM: number[] | null;
  elevationSource: TrackElevationSource | null;
  /** Laps averaged into elevationM (LMU 1, iRacing up to 3). */
  elevationLaps: number;
  /** LMU only: world X per bucket, metres. */
  xM: number[] | null;
  /** LMU only: world Z per bucket, metres. */
  zM: number[] | null;
  /**
   * Lap fraction where each sector starts; the first is 0. Empty while
   * nothing better than the session's own is known.
   */
  sectorStartPct: number[];
  sectorSource: TrackSectorSource;
  /** Kept sorted by distanceM. */
  notes: TrackNote[];
  /** Unix milliseconds. */
  updatedAt: number;
}

/** Which track a lap or a profile belongs to. */
export interface TrackProfileKey {
  simulator: string;
  trackId: number;
  trackName: string;
  trackLengthM: number;
  pointsCount: number;
}

/**
 * One clean lap of the player's, sampled for the profile: whole, driven by
 * the player from line to line, with no pit road, no jump and not voided.
 * Whether it changes the stored profile is the store's to say.
 */
export interface TrackProfileLap {
  /** How the heights were come by. */
  source: Extract<TrackElevationSource, 'recorded' | 'integrated'>;
  /** Metres per bucket, at the frame that first landed in each. */
  elevationM: Float32Array;
  /** World X and Z per bucket, or null where the sim states no position. */
  xM: Float32Array | null;
  zM: Float32Array | null;
  /**
   * How far the lap fails to close, metres, never negative. Recorded: the
   * height at the end against the height at the start. Integrated: what the
   * sum came to at the line before it was taken out along the lap.
   */
  closureM: number;
  /**
   * Where the sectors start, as lap fractions with the first at 0, or null
   * where the lap could not say.
   */
  sectorStartPct: number[] | null;
  sectorSource: Extract<TrackSectorSource, 'session' | 'learned'> | null;
}

/**
 * What a lap of a track would still be good for: 'first' when it would give
 * the track its elevation, 'more' when it would only add to what is there
 * (the sector starts, another lap into the mean), 'none' when the profile is
 * settled and nothing needs sampling.
 */
export type TrackProfileDemand = 'first' | 'more' | 'none';

/** One stored track, for a list to choose from. */
export interface TrackProfileSummary {
  simulator: string;
  trackId: number;
  trackName: string;
  trackLengthM: number;
  elevationSource: TrackElevationSource | null;
  notes: number;
  updatedAt: number;
}
