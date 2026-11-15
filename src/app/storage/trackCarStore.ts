import { app } from 'electron';
import fsp from 'node:fs/promises';
import path from 'node:path';
import logger from '../logger';
import { createDebouncedAtomicWriter } from './debouncedAtomicWriter';

/**
 * Small values kept per simulator, track and car that are not laps: the
 * learned and accumulated figures a processor wants back the next time the
 * same combination is driven.
 *
 * Laps and stints are not here; they are rows of the lap library. Nor is
 * anything per track only (pit lane data, track profiles have their own
 * files).
 *
 * A processor may not wait for the disk, so `get` answers from memory and
 * `set` returns at once. The file is read once, asynchronously; until that
 * has finished `get` knows only what was set in this run, and `revision`
 * moves when it has, so a reader knows to ask again.
 */
export type TrackCarNamespace =
  /** Key `simulator|trackId|carKey|layout`: best sector times. */
  | 'sectorBests'
  /** Key `simulator|trackId|carKey`: metres and seconds driven. */
  | 'driveTotals'
  /** Key `simulator|carKey|axle`: learned brake failure thickness. */
  | 'brakeLimits'
  /** Key `simulator|carKey`: the last pit service constants seen. */
  | 'pitService';

export interface TrackCarStore {
  /** The cached value, or undefined. Synchronous. */
  get<T>(namespace: TrackCarNamespace, key: string): T | undefined;
  /** Replaces the value and schedules a debounced write. */
  set<T>(namespace: TrackCarNamespace, key: string, value: T): void;
  /** Moves whenever get() may answer differently (load finished, external reset). */
  revision(): number;
}

/**
 * The most keys kept in each namespace. Past it, the keys set longest ago
 * are dropped.
 */
export const TRACK_CAR_CAPS: Readonly<Record<TrackCarNamespace, number>> = {
  sectorBests: 2000,
  driveTotals: 2000,
  brakeLimits: 500,
  pitService: 500,
};

const NAMESPACES = Object.keys(TRACK_CAR_CAPS) as TrackCarNamespace[];
const FILE_NAME = 'track-car-store.json';
const FILE_VERSION = 1;

interface Entry {
  /** When the value was last set, Unix milliseconds. */
  updatedAt: number;
  value: unknown;
}

/** Each namespace's entries, the one set longest ago first. */
type Entries = Record<TrackCarNamespace, Map<string, Entry>>;

const emptyEntries = (): Entries => ({
  sectorBests: new Map(),
  driveTotals: new Map(),
  brakeLimits: new Map(),
  pitService: new Map(),
});

const errorCode = (error: unknown): string =>
  (error as NodeJS.ErrnoException)?.code ?? 'UNKNOWN';

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNamespace = (value: unknown): value is TrackCarNamespace =>
  NAMESPACES.includes(value as TrackCarNamespace);

/**
 * What a stored file holds, leaving out anything malformed. Null for a file
 * that is not this store's at all, 'newer' for one a later build wrote.
 */
export const parseTrackCarFile = (
  stored: unknown
): Entries | 'newer' | null => {
  if (!isObject(stored) || typeof stored.version !== 'number') return null;
  if (stored.version > FILE_VERSION) return 'newer';
  if (stored.version !== FILE_VERSION || !isObject(stored.namespaces)) {
    return null;
  }
  const entries = emptyEntries();
  for (const namespace of NAMESPACES) {
    const bucket = stored.namespaces[namespace];
    if (!isObject(bucket)) continue;
    for (const [key, entry] of Object.entries(bucket)) {
      if (key === '' || !isObject(entry) || entry.value === undefined) continue;
      const { updatedAt, value } = entry;
      if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) {
        continue;
      }
      entries[namespace].set(key, { updatedAt, value });
    }
  }
  return entries;
};

/** Brings a namespace back under its cap and into oldest-first order. */
const settle = (
  namespace: TrackCarNamespace,
  bucket: Map<string, Entry>
): Map<string, Entry> =>
  new Map(
    [...bucket]
      .sort(([, a], [, b]) => a.updatedAt - b.updatedAt)
      .slice(-TRACK_CAR_CAPS[namespace])
  );

export interface TrackCarStoreHandle extends TrackCarStore {
  /** Waits for the file to be read. False when it could not be, for now. */
  ready(): Promise<boolean>;
  /**
   * While off, `set` and `clear` do nothing at all: what a tape, a replay
   * or demo mode would store is not the player's, in memory or on disk.
   */
  setPersisting(persisting: boolean): void;
  /** Forgets a namespace, or all of them. */
  clear(namespace?: TrackCarNamespace): void;
  /** Writes any pending change now. */
  flush(): Promise<void>;
}

/**
 * Keeps the values in memory and lets the file follow, once the file has
 * been read: until then nothing is written, so an early `set` cannot
 * overwrite what the file holds. A read that fails for a reason that may
 * pass is tried again at the next `set`. A file written by a newer build is
 * never written over: values set in this run are then kept for the run only.
 */
export function createTrackCarStore(
  storageDir: string,
  now: () => number = Date.now
): TrackCarStoreHandle {
  const filePath = path.join(storageDir, FILE_NAME);
  const entries = emptyEntries();
  let revision = 0;
  let persisting = true;
  let loaded = false;
  /** The file is a newer build's: read nothing from it, write nothing to it. */
  let frozen = false;
  let loading: Promise<boolean> | undefined;
  /** Something was set or cleared in this run, so there is something to save. */
  let touched = false;
  /** Namespaces cleared before the file was read: its values for them go too. */
  const clearedEarly = new Set<TrackCarNamespace>();
  /** The last read failure logged, so a retry at every set logs it once. */
  let loggedReadError: string | undefined;

  const writer = createDebouncedAtomicWriter({
    filePath,
    serialize: () =>
      JSON.stringify({
        version: FILE_VERSION,
        namespaces: Object.fromEntries(
          NAMESPACES.map((namespace) => [
            namespace,
            Object.fromEntries(entries[namespace]),
          ])
        ),
      }),
    onSuccess: () => undefined,
    onError: (error) =>
      logger.warn(
        '[TrackCarStore] Failed to write',
        FILE_NAME,
        errorCode(error)
      ),
  });

  /** Whether the file has been read, reading it if not. */
  const load = (): Promise<boolean> => {
    if (loaded) return Promise.resolve(true);
    return (loading ??= (async () => {
      let stored: Entries | null = null;
      try {
        const parsed = parseTrackCarFile(
          JSON.parse(await fsp.readFile(filePath, 'utf8'))
        );
        if (parsed === 'newer') {
          frozen = true;
          logger.warn(
            '[TrackCarStore] Written by a newer version, left as it is',
            FILE_NAME
          );
        } else if (parsed === null) {
          logger.warn('[TrackCarStore] Invalid file', FILE_NAME);
        } else {
          stored = parsed;
        }
      } catch (error) {
        if (error instanceof SyntaxError) {
          logger.warn('[TrackCarStore] Invalid JSON', FILE_NAME);
        } else if (errorCode(error) !== 'ENOENT') {
          // Often a scanner holding the file for a moment. It may hold
          // values this run never saw, so wait for a read that works.
          if (loggedReadError !== errorCode(error)) {
            loggedReadError = errorCode(error);
            logger.warn(
              '[TrackCarStore] Failed to read',
              FILE_NAME,
              errorCode(error)
            );
          }
          loading = undefined;
          return false;
        }
      }
      loading = undefined;
      if (stored) {
        // What was set while the file was being read is newer than the
        // file, and wins.
        for (const namespace of NAMESPACES) {
          if (clearedEarly.has(namespace)) continue;
          entries[namespace] = settle(
            namespace,
            new Map([...stored[namespace], ...entries[namespace]])
          );
        }
      }
      loaded = true;
      revision += 1;
      return true;
    })());
  };

  const save = (): void => {
    touched = true;
    if (loaded) {
      if (!frozen) writer.schedule();
      return;
    }
    void load().then((ok) => {
      if (ok && !frozen) writer.schedule();
    });
  };

  return {
    get<T>(namespace: TrackCarNamespace, key: string): T | undefined {
      if (!isNamespace(namespace)) return undefined;
      return entries[namespace].get(key)?.value as T | undefined;
    },

    set<T>(namespace: TrackCarNamespace, key: string, value: T): void {
      if (!persisting || !isNamespace(namespace)) return;
      if (typeof key !== 'string' || key === '') return;
      let plain: unknown;
      try {
        // Kept as it will be read back: what JSON cannot carry is dropped
        // now, not at the next start, and a later change to the caller's
        // object does not change what is stored.
        const json = JSON.stringify(value);
        plain = json === undefined ? undefined : JSON.parse(json);
      } catch {
        plain = undefined;
      }
      if (plain === undefined) {
        logger.warn('[TrackCarStore] A value could not be stored', namespace);
        return;
      }
      const bucket = entries[namespace];
      // Deleted first so the key moves to the newest end.
      bucket.delete(key);
      bucket.set(key, { updatedAt: now(), value: plain });
      const oldest = bucket.keys().next().value;
      if (bucket.size > TRACK_CAR_CAPS[namespace] && oldest !== undefined) {
        bucket.delete(oldest);
      }
      revision += 1;
      save();
    },

    revision: () => revision,

    ready: load,

    setPersisting(next) {
      persisting = next;
    },

    clear(namespace) {
      if (!persisting) return;
      if (namespace !== undefined && !isNamespace(namespace)) return;
      for (const cleared of namespace ? [namespace] : NAMESPACES) {
        entries[cleared] = new Map();
        if (!loaded) clearedEarly.add(cleared);
      }
      revision += 1;
      save();
    },

    async flush() {
      if (!touched) return;
      if (!(await load())) {
        logger.warn('[TrackCarStore] Not saved: could not read', FILE_NAME);
        return;
      }
      if (frozen) return;
      // Scheduled here as well: a set made while the file could not be read
      // was never scheduled, and this is the last chance to save it.
      writer.schedule();
      await writer.flush();
    },
  };
}

let store: TrackCarStoreHandle | undefined;

/** The installation's store. Its file starts loading on first use. */
export const getTrackCarStore = (): TrackCarStoreHandle => {
  if (!store) {
    store = createTrackCarStore(app.getPath('userData'));
    void store.ready();
  }
  return store;
};

export const flushTrackCarStoreOnShutdown = async (): Promise<void> => {
  await store?.flush();
};
