/**
 * The lap library: every lap the player completes, grouped by the session it
 * was driven in. Shared by the main process, which records and stores it, and
 * the settings page that lists it.
 */

/** One session as the library lists it. */
export interface LapLibrarySession {
  id: number;
  /** 'iracing' or 'lmu'. A string so a new sim needs no change here. */
  simulator: string;
  /** When the first lap of the session was recorded, Unix milliseconds. */
  startedAt: number;
  trackId: number;
  trackName: string;
  trackConfig: string | null;
  trackLengthM: number;
  /** The car model the laps are kept under. */
  carKey: string;
  /** The car as the sim names it for display. */
  carName: string;
  /** 'Practice', 'Qualify', 'Race'... as the sim words it. */
  sessionType: string | null;
  sessionName: string | null;
  lapCount: number;
  /** The quickest complete lap in the session, pit laps included. */
  bestLapTime: number | null;
}

/** One lap as the library lists it. The curves are fetched separately. */
export interface LapLibraryLap {
  id: number;
  sessionId: number;
  /** The sim's own lap number, where it reports one. */
  lapNumber: number | null;
  /** Seconds, from line to line. */
  lapTime: number;
  /** Unix milliseconds. */
  completedAt: number;
  /** A point every ten metres was sampled, so the lap can serve as a reference. */
  complete: boolean;
  /** The car was on pit road at some point: an in-lap or an out-lap. */
  pit: boolean;
  /** The sim voided the lap, as Le Mans Ultimate does for track limits. */
  voided: boolean;
  /** The player was at the wheel for all of it. */
  own: boolean;
  /** Incident points picked up on the lap; null where the sim counts none. */
  incidents: number | null;
  /**
   * Fit to be a reference: complete, not a pit lap, not voided, the player's
   * own, and without an incident.
   */
  eligible: boolean;
  /** Litres burned on the lap; null without a reading at both ends. */
  fuelUsed: number | null;
  /** Virtual energy spent on the lap, as a fraction of the budget. */
  energyUsed: number | null;
  airTemp: number | null;
  trackTemp: number | null;
  /** The lap the delta's all-time reference is, for its track and car. */
  isReference: boolean;
  /** Chosen as that reference by hand rather than by being the quickest. */
  isPinned: boolean;
}

export interface LapLibraryStats {
  sessions: number;
  laps: number;
}

/** The session a lap belongs to, as the recorder knows it. */
export interface LapSessionInput {
  /**
   * Names one run of one session by the recorder. Laps sharing it go into
   * the same row; a restart of the app makes a new one.
   */
  token: string;
  simulator: string;
  /**
   * The sim's own identity for the session, or '' when it has none worth
   * trusting. With one, laps recorded after a restart of the app rejoin the
   * session they belong to.
   */
  sessionKey: string;
  trackId: number;
  trackName: string;
  trackConfig: string | null;
  trackLengthM: number;
  carKey: string;
  carName: string;
  sessionType: string | null;
  sessionName: string | null;
}

export interface LapInput {
  lapNumber: number | null;
  lapTime: number;
  /** Unix milliseconds. */
  completedAt: number;
  complete: boolean;
  pit: boolean;
  voided: boolean;
  own: boolean;
  incidents: number | null;
  fuelUsed: number | null;
  energyUsed: number | null;
  airTemp: number | null;
  trackTemp: number | null;
  /** The curve: only present on a complete lap. */
  curve: LapCurve | null;
}

/** Time and speed against distance, a point every ten metres. */
export interface LapCurve {
  /** Lap fraction between points. */
  interval: number;
  /** Lap fraction each point was sampled at. */
  pointPos: Float32Array;
  /** Seconds into the lap at each point. */
  times: Float32Array;
  /** km/h at each point, where it was recorded. */
  speedsKph: Float32Array | null;
}

/** A lap fit to measure another against, with what identifies it. */
export interface StoredReferenceLap {
  lapId: number;
  lapTime: number;
  /** Chosen by hand, so a quicker lap does not displace it. */
  pinned: boolean;
  curve: LapCurve;
}

/** What the settings page can ask of the library. */
export interface LapLibraryBridge {
  /** Sessions, most recent first. */
  listSessions: (
    limit?: number,
    offset?: number
  ) => Promise<LapLibrarySession[]>;
  /** A session's laps in the order they were driven. */
  listLaps: (sessionId: number) => Promise<LapLibraryLap[]>;
  deleteLap: (lapId: number) => Promise<boolean>;
  /** Deletes a session and every lap in it. */
  deleteSession: (sessionId: number) => Promise<boolean>;
  /** Makes a lap the all-time reference for its track and car. */
  pinReference: (lapId: number) => Promise<boolean>;
  /** Hands the reference for that lap's track and car back to the quickest lap. */
  unpinReference: (lapId: number) => Promise<boolean>;
  getStats: () => Promise<LapLibraryStats>;
  /** Fires when a lap is recorded or anything is deleted or pinned. */
  onChanged: (callback: () => void) => () => void;
}
