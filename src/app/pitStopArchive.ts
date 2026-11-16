import type { PitStopPersistence } from './processors/pitStopRuntime';
import type { PitStopHistoryStore } from './storage/pitStopHistory';

export interface PitStopArchiveOptions {
  /**
   * Whether the session id of the running source names one event and no
   * other. Asked on every call: the simulator can change while the app runs.
   */
  canArchive: () => boolean;
  /** The store on disk, asked for when first needed. */
  store: () => PitStopHistoryStore;
}

/**
 * The pit stops' store on disk, used only for a session id that can be
 * trusted.
 *
 * Stops are filed under the session's id, and stops found under the id of
 * the session being entered are put back as that session's own: that is how
 * they survive a restart. It holds while an id names one event, which is
 * true of iRacing's SubSessionID and not of the id Tearoff derives for Le
 * Mans Ultimate, where the next race on the same server and track has the
 * same one. While the Gantry was the only reason stops were recorded this
 * could not matter, since it is hidden under Le Mans Ultimate. With the Pit
 * Wall a reason too they are recorded there, and without this the first
 * laps of a race would be shown the stops of the race before.
 *
 * So for such a source nothing is read, and nothing is written either, as
 * the lap history does for the same reason. The stops are still recorded
 * in memory for as long as the app runs, which is all a live widget reads.
 */
export const createPitStopArchive = ({
  canArchive,
  store,
}: PitStopArchiveOptions): PitStopPersistence => ({
  load: async (key) => {
    if (!canArchive()) return null;
    const history = store();
    await history.load();
    return history.get(key);
  },
  save: (key, stops) => {
    if (!canArchive()) return;
    store().save(key, stops);
  },
});
