/** The most drive times kept per track, and standing times per car. */
export const PIT_LANE_TIMING_SAMPLES = 5;
/** The most cars a track keeps standing times for. */
export const PIT_LANE_TIMING_CARS = 12;

/**
 * What the player's own visits to a track's pit lane have measured. Written
 * by the main process only; the renderer's calibration updates never carry
 * it.
 */
export interface PitLaneTiming {
  /** Pit speed limit measured on the limiter, m/s. */
  speedLimitMs: number | null;
  /** Line-to-line time less standing time, s. Newest last, at most 5. */
  driveS: number[];
  /**
   * Standing time of each stop, s, per car key. Newest last, at most 5 per
   * car, at most 12 cars.
   */
  standingS: Record<string, number[]>;
}

export interface PitLaneTrackData {
  pitEntryPct: number | null;
  pitExitPct: number | null;
  /** Absent until the player has made a visit worth measuring. */
  timing?: PitLaneTiming;
}

export interface PitLaneBridge {
  getPitLaneData: (trackId: string) => Promise<PitLaneCalibration>;
  updatePitLaneData: (
    trackId: string,
    data: Partial<PitLaneTrackData>,
    revision: number,
    sourceId: string
  ) => Promise<boolean>;
  getCurrentTrackPitLaneInfo: () => Promise<CurrentTrackPitLaneInfo | null>;
  resetPitLaneData: (trackId: string) => Promise<void>;
  /** Desktop only: open the fixed calibration file in its default application. */
  openPitLaneDataFile?: () => Promise<void>;
  /** Desktop only: apply externally saved calibration edits to all overlays. */
  reloadPitLaneDataFile?: () => Promise<void>;
}

export interface PitLaneCalibration {
  trackId: string;
  /** Main-instance identity; a reconnect may start a new revision sequence. */
  sourceId: string;
  /** Reset generation. Saves from an older generation cannot restore old data. */
  revision: number;
  data: PitLaneTrackData | null;
}

export interface CurrentTrackPitLaneInfo {
  trackId: string;
  trackName: string;
  hasCalibration: boolean;
  /** Native editing workflow pauses automatic saves until a valid reload. */
  learningPaused?: boolean;
}
