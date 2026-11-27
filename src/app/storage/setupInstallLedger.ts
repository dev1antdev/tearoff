import { app } from 'electron';
import fsp from 'node:fs/promises';
import path from 'node:path';
import logger from '../logger';
import { createDebouncedAtomicWriter } from './debouncedAtomicWriter';

/**
 * What Tearoff itself last wrote into a game's setup folder, so that a later
 * pass can tell its own untouched file from one the person saved over.
 *
 * A file is claimed only after Tearoff completed writing it. Keys carry the
 * simulator, the canonical Settings folder (`realpath`) and the relative
 * track folder and file name, so ownership recorded for one LMU data folder
 * never applies to another one.
 */

const FILE_NAME = 'setup-installs.json';
const FILE_VERSION = 1;
const SHA256 = /^[0-9a-f]{64}$/;

/** The most entries kept; past it, the oldest are dropped. */
export const SETUP_INSTALL_LEDGER_CAP = 5000;

export const setupInstallKey = (
  simulator: 'lmu',
  boundary: string,
  trackFolder: string,
  fileName: string,
  platform: NodeJS.Platform = process.platform
): string => {
  const root = platform === 'win32' ? boundary.toLowerCase() : boundary;
  return `${simulator}|${root}|${trackFolder.toLowerCase()}|${fileName.toLowerCase()}`;
};

interface Entry {
  sha256: string;
  installedAt: number;
}

type Entries = Map<string, Entry>;

const errorCode = (error: unknown): string =>
  (error as NodeJS.ErrnoException)?.code ?? 'UNKNOWN';

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * What a stored ledger holds, leaving out anything malformed. Null for a
 * file that is not this ledger at all, 'newer' for one a later build wrote.
 */
export const parseSetupInstallFile = (
  stored: unknown
): Entries | 'newer' | null => {
  if (!isObject(stored) || typeof stored.version !== 'number') return null;
  if (stored.version > FILE_VERSION) return 'newer';
  if (stored.version !== FILE_VERSION || !isObject(stored.entries)) {
    return null;
  }
  const entries: Entries = new Map();
  for (const [key, entry] of Object.entries(stored.entries)) {
    if (key === '' || !isObject(entry)) continue;
    const { sha256, installedAt } = entry;
    if (typeof sha256 !== 'string' || !SHA256.test(sha256)) continue;
    if (typeof installedAt !== 'number' || !Number.isFinite(installedAt)) {
      continue;
    }
    entries.set(key, { sha256, installedAt });
  }
  return entries;
};

export interface SetupInstallLedger {
  /** Resolves once the file has been read (or found missing or unreadable). */
  ready(): Promise<void>;
  /** The sha256 Tearoff last wrote for this key. */
  get(key: string): string | undefined;
  /** Records a write and schedules a debounced save. */
  set(key: string, sha256: string): void;
  flush(): Promise<void>;
}

/**
 * Keeps the ledger in memory and lets the file follow. A file from a newer
 * build, or one that cannot be read, is never written over: what this run
 * records then lives for the run only.
 */
export function createSetupInstallLedger(
  storageDir: string,
  now: () => number = Date.now
): SetupInstallLedger {
  const filePath = path.join(storageDir, FILE_NAME);
  const entries: Entries = new Map();
  let loaded = false;
  let frozen = false;
  let touched = false;
  let loading: Promise<void> | undefined;
  let loggedReadError: string | undefined;

  const writer = createDebouncedAtomicWriter({
    filePath,
    serialize: () =>
      JSON.stringify({
        version: FILE_VERSION,
        entries: Object.fromEntries(entries),
      }),
    onSuccess: () => undefined,
    onError: (error) =>
      logger.warn(
        '[Setups] Failed to write the install ledger',
        FILE_NAME,
        errorCode(error)
      ),
  });

  const load = (): Promise<void> => {
    if (loaded) return Promise.resolve();
    return (loading ??= (async () => {
      try {
        const parsed = parseSetupInstallFile(
          JSON.parse(await fsp.readFile(filePath, 'utf8'))
        );
        if (parsed === 'newer') {
          frozen = true;
          logger.warn(
            '[Setups] Install ledger written by a newer version, left as it is',
            FILE_NAME
          );
        } else if (parsed === null) {
          logger.warn(
            '[Setups] Invalid install ledger, starting empty',
            FILE_NAME
          );
        } else {
          for (const [key, entry] of parsed) {
            // What this run set while the file was being read is newer.
            if (!entries.has(key)) entries.set(key, entry);
          }
        }
      } catch (error) {
        if (error instanceof SyntaxError) {
          logger.warn('[Setups] Install ledger is not JSON', FILE_NAME);
        } else if (errorCode(error) !== 'ENOENT') {
          // Often a scanner holding the file: values this run never saw
          // cannot be trusted, so nothing is written over it.
          frozen = true;
          if (loggedReadError !== errorCode(error)) {
            loggedReadError = errorCode(error);
            logger.warn(
              '[Setups] Failed to read the install ledger',
              FILE_NAME,
              errorCode(error)
            );
          }
        }
      }
      loading = undefined;
      loaded = true;
    })());
  };

  const prune = (): void => {
    while (entries.size > SETUP_INSTALL_LEDGER_CAP) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) return;
      entries.delete(oldest);
    }
  };

  return {
    ready: load,

    get(key) {
      return entries.get(key)?.sha256;
    },

    set(key, sha256) {
      if (typeof key !== 'string' || key === '') return;
      // Deleted first so the key moves to the newest end.
      entries.delete(key);
      entries.set(key, { sha256, installedAt: now() });
      prune();
      touched = true;
      void load().then(() => {
        if (!frozen) writer.schedule();
      });
    },

    async flush() {
      if (!touched) return;
      await load();
      if (frozen) return;
      // A set made before the file was readable was never scheduled.
      writer.schedule();
      await writer.flush();
    },
  };
}

let ledger: SetupInstallLedger | undefined;

/** The installation's ledger. Its file starts loading on first use. */
export const getSetupInstallLedger = (): SetupInstallLedger => {
  if (!ledger) {
    ledger = createSetupInstallLedger(app.getPath('userData'));
    void ledger.ready();
  }
  return ledger;
};

export const flushSetupInstallLedgerOnShutdown = async (): Promise<void> => {
  await ledger?.flush();
};
