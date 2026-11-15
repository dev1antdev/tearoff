import type { LapHistoryPersistence } from './processors/lapHistoryRuntime';
import {
  loadLapHistory,
  rehydrateLapHistory,
  saveLapHistory,
  sealLapHistorySession,
} from './storage/lapHistoryStorage';

export interface LapHistoryArchiveOptions {
  /**
   * Whether the session id of the running source names one event and no
   * other. Asked on every call: the simulator can change while the app runs.
   */
  canArchive: () => boolean;
  logError: (message: string, error: unknown) => void;
  /** Where the files go. The app's own folder when left out. */
  storageDir?: string;
}

/**
 * The lap history's store on disk, used only for a session id that can be
 * trusted.
 *
 * A file is named after the session id, and a file found under the id of the
 * session being entered is read back as that session's own laps: that is how
 * a race survives a restart. It holds while an id names one event, which is
 * true of iRacing's SubSessionID and not of the id Tearoff derives for Le
 * Mans Ultimate, where the next race on the same server and track has the
 * same one. There the first laps of the new race were handed the crossings of
 * the race before, for every car slot that had been filled in it.
 *
 * So for such a source nothing is read, and nothing is written either: a
 * file nobody may read back is a whole field's history serialised every few
 * seconds for no one. The history itself is still recorded in memory for as
 * long as the app runs, which is all a live widget reads.
 */
export const createLapHistoryArchive = ({
  canArchive,
  logError,
  storageDir,
}: LapHistoryArchiveOptions): LapHistoryPersistence => ({
  save: (sessionId, snapshot) => {
    if (!canArchive()) return;
    saveLapHistory(sessionId, snapshot, storageDir).catch((err) =>
      logError('[LapHistory] Failed to persist lap history:', err)
    );
  },
  seal: (sessionId, snapshot) => {
    if (!canArchive()) return;
    sealLapHistorySession(sessionId, snapshot, storageDir).catch((err) =>
      logError('[LapHistory] Failed to persist lap history:', err)
    );
  },
  load: async (sessionId) => {
    if (!canArchive()) return null;
    const stored = await loadLapHistory(sessionId, storageDir);
    if (!stored) return null;
    return {
      sessionNums: Object.keys(stored.sessions).map(Number),
      apply: (target) => rehydrateLapHistory(stored, target),
    };
  },
});
