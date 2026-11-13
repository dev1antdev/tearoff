import type {
  LapInput,
  LapLibraryLap,
  LapLibrarySession,
  LapLibraryStats,
  LapSessionInput,
  ReferenceLap,
  StoredReferenceLap,
} from '@irdashies/types';
import type { LapLibraryCaller } from './dispatch';

/**
 * The lap library as the rest of the main process uses it.
 *
 * Recording and the settings page go through it to the database on its
 * worker thread, asynchronously. The one thing that cannot wait for an
 * answer is the delta, which reads its all-time reference on the telemetry
 * path: for that the service keeps the current reference lap of every track
 * and car that has been asked about, and a revision that moves when one of
 * them changes.
 */
export interface LapLibraryService {
  /** Stores a finished lap. Returns at once; failures are logged, not thrown. */
  recordLap(session: LapSessionInput, lap: LapInput): void;
  /**
   * The all-time reference lap for a track and car, from memory. Null when
   * there is none, and on the first call for a combination, before the
   * database has answered: the revision moves when it does.
   *
   * The same object is handed back for as long as the reference is the same
   * lap.
   */
  referenceLap(
    simulator: string,
    trackId: number,
    carKey: string,
    pointsCount: number
  ): ReferenceLap | null;
  /** Moves whenever any `referenceLap` answer has changed. */
  referenceRevision(): number;

  listSessions(limit?: number, offset?: number): Promise<LapLibrarySession[]>;
  listLaps(sessionId: number): Promise<LapLibraryLap[]>;
  deleteLap(lapId: number): Promise<boolean>;
  deleteSession(sessionId: number): Promise<boolean>;
  pinReference(lapId: number): Promise<boolean>;
  unpinReference(lapId: number): Promise<boolean>;
  getStats(): Promise<LapLibraryStats>;
  /** Fires after a lap is recorded and after anything is deleted or pinned. */
  onChanged(callback: () => void): () => void;
}

export interface LapLibraryServiceOptions {
  /** The most laps kept. Past it the oldest go, references excepted. */
  maxLaps: number;
  logError: (message: string, error: unknown) => void;
}

/** How many laps are recorded between two checks of the cap. */
const PRUNE_EVERY_LAPS = 25;

interface CachedReference {
  simulator: string;
  trackId: number;
  carKey: string;
  pointsCount: number;
  /** The lap the answer below is; null for "no reference". */
  lapId: number | null;
  lap: ReferenceLap | null;
}

/** The stored curve in the shape the reference recorder works with. */
const toReferenceLap = (stored: StoredReferenceLap): ReferenceLap => {
  const pointsCount = stored.curve.pointPos.length;
  return {
    pointPos: stored.curve.pointPos,
    times: stored.curve.times,
    // Derived from the points by the recorder; not stored.
    tangents: new Float32Array(pointsCount),
    ...(stored.curve.speedsKph ? { speedsKph: stored.curve.speedsKph } : {}),
    interval: stored.curve.interval,
    pointsCount,
    startTime: 0,
    finishTime: stored.lapTime,
    lastTrackedPct: 0,
    isCleanLap: true,
  };
};

export const createLapLibraryService = (
  client: LapLibraryCaller,
  options: LapLibraryServiceOptions
): LapLibraryService => {
  const references = new Map<string, CachedReference>();
  const listeners = new Set<() => void>();
  let revision = 0;
  let lapsSincePrune = 0;

  const emitChanged = () => {
    for (const listener of listeners) {
      try {
        listener();
      } catch (error) {
        options.logError('[LapLibrary] A change listener failed:', error);
      }
    }
  };

  /** Asks the database which lap a cached reference is now. */
  const refresh = (entry: CachedReference): void => {
    client
      .call(
        'referenceLap',
        entry.simulator,
        entry.trackId,
        entry.carKey,
        entry.pointsCount
      )
      .then((stored) => {
        const lapId = stored?.lapId ?? null;
        // The same lap as before: keep the object, so nothing downstream
        // takes it for a new reference.
        if (lapId === entry.lapId) return;
        entry.lapId = lapId;
        entry.lap = stored ? toReferenceLap(stored) : null;
        revision += 1;
      })
      .catch((error: unknown) => {
        options.logError('[LapLibrary] Could not read a reference lap:', error);
      });
  };

  const refreshAll = () => {
    for (const entry of references.values()) refresh(entry);
  };

  /** Runs a change the settings page asked for, then tells everyone. */
  const mutate = async (operation: Promise<boolean>): Promise<boolean> => {
    const changed = await operation;
    if (changed) {
      refreshAll();
      emitChanged();
    }
    return changed;
  };

  const prune = () => {
    client
      .call('prune', options.maxLaps)
      .then((removed) => {
        if (removed > 0) emitChanged();
      })
      .catch((error: unknown) => {
        options.logError('[LapLibrary] Could not prune old laps:', error);
      });
  };
  // Once at the start, so a library left over the cap by an older setting is
  // brought back under it without waiting for a lap.
  prune();

  return {
    recordLap(session, lap) {
      client
        .call('recordLap', session, lap)
        .then(({ eligible }) => {
          // Only an eligible lap can displace a reference.
          if (eligible) refreshAll();
          emitChanged();
          lapsSincePrune += 1;
          if (lapsSincePrune >= PRUNE_EVERY_LAPS) {
            lapsSincePrune = 0;
            prune();
          }
        })
        .catch((error: unknown) => {
          options.logError('[LapLibrary] Could not record a lap:', error);
        });
    },

    referenceLap(simulator, trackId, carKey, pointsCount) {
      const key = `${simulator}|${trackId}|${carKey}|${pointsCount}`;
      let entry = references.get(key);
      if (!entry) {
        entry = {
          simulator,
          trackId,
          carKey,
          pointsCount,
          lapId: null,
          lap: null,
        };
        references.set(key, entry);
        refresh(entry);
      }
      return entry.lap;
    },

    referenceRevision: () => revision,

    listSessions: (limit, offset) => client.call('listSessions', limit, offset),
    listLaps: (sessionId) => client.call('listLaps', sessionId),
    deleteLap: (lapId) => mutate(client.call('deleteLap', lapId)),
    deleteSession: (sessionId) =>
      mutate(client.call('deleteSession', sessionId)),
    pinReference: (lapId) => mutate(client.call('pinReference', lapId)),
    unpinReference: (lapId) => mutate(client.call('unpinReference', lapId)),
    getStats: () => client.call('stats'),

    onChanged(callback) {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },
  };
};
