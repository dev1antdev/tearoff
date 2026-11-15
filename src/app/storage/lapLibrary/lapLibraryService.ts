import type {
  LapInput,
  LapLibraryLap,
  LapLibrarySession,
  LapLibraryStats,
  LapLibraryStatus,
  LapLibraryStint,
  LapSessionInput,
  ReferenceLap,
  StintInput,
  StoredReferenceLap,
} from '@irdashies/types';
import type { LapLibraryCaller, LapLibraryOpenReport } from './dispatch';

/**
 * The most laps the library keeps. A lap is a few kilobytes at a short
 * circuit and about thirty at the Nordschleife, so this is tens of megabytes
 * at the outside. The reference lap of each track and car is never dropped.
 *
 * It is the cap on everything else the library holds as well: a lap's
 * ledger row goes with the lap, a stint goes with the last of its laps, and
 * a session with the last of its own.
 */
export const LAP_LIBRARY_MAX_LAPS = 5000;

/**
 * The lap library as the rest of the main process uses it.
 *
 * Recording and the settings page go through it to the database on its
 * worker thread, asynchronously. The one thing that cannot wait for an
 * answer is the delta, which reads its all-time reference on the telemetry
 * path: for that the service keeps the current reference lap of every track
 * and car that has been asked about, and a revision that moves when one of
 * them changes.
 *
 * When the library's file could not be opened -- it is from a newer build,
 * or could not be upgraded or read -- the service says so once in the log
 * and through `getStatus`, records nothing, and refuses the rest.
 */
export interface LapLibraryService {
  /**
   * Stores a finished lap, with its ledger row and stint when it carries
   * them. Returns at once; failures are logged, not thrown.
   */
  recordLap(session: LapSessionInput, lap: LapInput): void;
  /**
   * Stores a stint, or brings the stored one up to date: for when a stint
   * opens and when it closes. Returns at once; failures are logged.
   *
   * A stint whose session has no lap yet is not stored by this: it reaches
   * the library with its first lap, through `LapInput.ledger.stint`. One
   * that closes without a lap is not kept.
   */
  upsertStint(session: LapSessionInput, stint: StintInput): void;
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
  /** A session's laps in the order driven, each with its ledger row if any. */
  listLaps(sessionId: number): Promise<LapLibraryLap[]>;
  /** A session's stints in the order driven. */
  listStints(sessionId: number): Promise<LapLibraryStint[]>;
  /**
   * The latest laps with a ledger row for a track and car, newest first,
   * leaving out any lap with one of the `withoutFlags` bits (LEDGER_LAP_*).
   * What a per-lap baseline for the combination is worked out from.
   */
  recentLedgerLaps(
    simulator: string,
    trackId: number,
    carKey: string,
    limit: number,
    withoutFlags?: number
  ): Promise<LapLibraryLap[]>;
  deleteLap(lapId: number): Promise<boolean>;
  deleteSession(sessionId: number): Promise<boolean>;
  pinReference(lapId: number): Promise<boolean>;
  unpinReference(lapId: number): Promise<boolean>;
  getStats(): Promise<LapLibraryStats>;
  /** Whether the library is in use, and why not when it is not. */
  getStatus(): Promise<LapLibraryStatus>;
  /**
   * Fires after a lap or a stint is stored and after anything is deleted or
   * pinned.
   */
  onChanged(callback: () => void): () => void;
}

export interface LapLibraryServiceOptions {
  /** The most laps kept. Past it the oldest go, references excepted. */
  maxLaps: number;
  logError: (message: string, error: unknown) => void;
  logInfo?: (message: string) => void;
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

  /** How the library's file opened. Settles once and never rejects. */
  const opened: Promise<LapLibraryOpenReport> = client
    .call('status')
    .catch((error: unknown) => ({
      // No answer at all: the thread could not be started, or died.
      available: false,
      reason: 'unreadable' as const,
      message: error instanceof Error ? error.message : String(error),
      schemaVersion: null,
      upgradedFrom: null,
      backupName: null,
    }));
  /** True once the file is known not to have opened. */
  let down = false;
  void opened.then((report) => {
    if (!report.available) {
      down = true;
      // Said once here, rather than once for every lap that is not kept.
      options.logError(
        '[LapLibrary] The lap library is not in use and laps are not being recorded:',
        report.message
      );
      return;
    }
    if (report.upgradedFrom !== null) {
      options.logInfo?.(
        `[LapLibrary] Upgraded the lap library from schema ${report.upgradedFrom} to ${report.schemaVersion}` +
          (report.backupName
            ? `; the file as it was is kept beside it as ${report.backupName}`
            : '')
      );
    }
    // Once at the start, so a library left over the cap by an older setting
    // is brought back under it without waiting for a lap.
    prune();
  });

  return {
    recordLap(session, lap) {
      if (down) return;
      client
        .call('recordLap', session, lap)
        .then(({ eligible, ledgerError }) => {
          if (ledgerError !== null) {
            options.logError(
              '[LapLibrary] A lap was stored without its ledger:',
              ledgerError
            );
          }
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

    upsertStint(session, stint) {
      if (down) return;
      client
        .call('upsertStint', session, stint)
        .then((rowId) => {
          if (rowId !== null) emitChanged();
        })
        .catch((error: unknown) => {
          options.logError('[LapLibrary] Could not store a stint:', error);
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
    listStints: (sessionId) => client.call('listStints', sessionId),
    recentLedgerLaps: (simulator, trackId, carKey, limit, withoutFlags) =>
      client.call(
        'recentLedgerLaps',
        simulator,
        trackId,
        carKey,
        limit,
        withoutFlags
      ),
    deleteLap: (lapId) => mutate(client.call('deleteLap', lapId)),
    deleteSession: (sessionId) =>
      mutate(client.call('deleteSession', sessionId)),
    pinReference: (lapId) => mutate(client.call('pinReference', lapId)),
    unpinReference: (lapId) => mutate(client.call('unpinReference', lapId)),
    getStats: () => client.call('stats'),
    getStatus: () =>
      opened.then(({ available, reason }) => ({ available, reason })),

    onChanged(callback) {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },
  };
};
