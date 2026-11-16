import type {
  TrackElevationSource,
  TrackNote,
  TrackNoteKind,
  TrackProfileSummary,
  TrackSectorSource,
  TrackSunTimes,
} from './trackProfile';

/**
 * A track's profile as the settings window sees it: what is known of the
 * track and the driver's notes, without the heights and the line of the
 * road, which only the overlay draws.
 */
export interface TrackProfileDetails {
  /** `${simulator}:${trackId}`: what the bridge names the track by. */
  trackKey: string;
  simulator: string;
  trackId: number;
  trackName: string;
  trackLengthM: number;
  elevationSource: TrackElevationSource | null;
  /** Laps averaged into the elevation. */
  elevationLaps: number;
  sectorSource: TrackSectorSource;
  /** Sorted by distanceM. */
  notes: TrackNote[];
  /** Unix milliseconds; 0 for a track with nothing stored yet. */
  updatedAt: number;
}

/**
 * A note as the editor sends it. One without an id is new and is given one
 * where it is stored.
 */
export interface TrackNoteDraft {
  id?: string;
  distanceM: number;
  kind: TrackNoteKind;
  text: string;
  comment: string;
  pit: boolean;
}

/**
 * What the settings window can ask of the track profiles.
 *
 * A track is named by its key, `${simulator}:${trackId}`, as
 * `track-profile.snapshot` publishes it. No file path crosses: a notes file
 * to import is read by the page and sent as text, and an export comes back
 * as text for the page to save.
 */
export interface TrackProfileBridge {
  /** Every track with something stored, most recently changed first. */
  listTracks: () => Promise<TrackProfileSummary[]>;
  /**
   * A track's profile: the stored one, or an empty one for the track of the
   * running session. Null for a track that is neither.
   */
  getProfile: (trackKey: string) => Promise<TrackProfileDetails | null>;
  /**
   * Replaces a track's notes. Resolves with the notes as kept, or null when
   * they were refused.
   */
  saveNotes: (
    trackKey: string,
    notes: readonly TrackNoteDraft[]
  ) => Promise<TrackNote[] | null>;
  /**
   * Adds the notes of a notes file to the track's own. The file's header
   * says which kind they are; `kind` stands where it does not. Resolves with
   * every note of the track afterwards, or null when the text is not a notes
   * file or would take the track past its limit.
   */
  importNotes: (
    trackKey: string,
    kind: TrackNoteKind,
    fileText: string
  ) => Promise<TrackNote[] | null>;
  /** A track's notes of one kind as the text of a notes file. */
  exportNotes: (trackKey: string, kind: TrackNoteKind) => Promise<string>;
  /**
   * Forgets a track's elevation, so that the next clean lap records it
   * again. Resolves true when there was one to forget.
   */
  clearElevation: (trackKey: string) => Promise<boolean>;
  /**
   * Sets when the sun rises and sets at a track, or clears either: whole
   * minutes since midnight, 0 to 1439, or null. Resolves true when that
   * changed what is kept; false for a track that is neither stored nor the
   * running session's.
   */
  saveSunTimes: (trackKey: string, times: TrackSunTimes) => Promise<boolean>;
  /** Fires when any track's profile changes: a lap recorded, a note edited. */
  onChanged: (callback: () => void) => () => void;
}

/** A track's key as the bridge and the channel name it. */
export const trackProfileKeyOf = (simulator: string, trackId: number): string =>
  `${simulator}:${trackId}`;

const TRACK_KEY = /^([a-z][a-z0-9]{0,31}):(-?\d{1,16})$/;

/**
 * The simulator and track id a key names, or null for anything that is not
 * a key: the only form a track is accepted in from a renderer.
 */
export const parseTrackProfileKey = (
  value: unknown
): { simulator: string; trackId: number } | null => {
  if (typeof value !== 'string') return null;
  const match = TRACK_KEY.exec(value);
  if (!match) return null;
  const trackId = Number(match[2]);
  return Number.isSafeInteger(trackId)
    ? { simulator: match[1], trackId }
    : null;
};
