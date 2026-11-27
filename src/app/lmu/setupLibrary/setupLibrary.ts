import { createHash } from 'node:crypto';
import type { Dirent, Stats } from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type {
  SetupFileProblem,
  SetupFileStatus,
  SetupLibraryFile,
  SetupLibraryListing,
  SetupLibraryTrack,
} from '../../../types';
import logger from '../../logger';
import {
  setupInstallKey,
  type SetupInstallLedger,
} from '../../storage/setupInstallLedger';
import { isLmuInstall } from './lmuInstall';
import {
  SETUP_FILE_MAX_BYTES,
  classifySetupBytes,
  isSvmFileName,
  isTrackFolderName,
} from './parse';

/**
 * The library of LMU setups as the main process sees it: what the folder
 * holds, and how a file gets into the game without ever losing a save made
 * in the garage.
 *
 * The rules are in `.opencode/plans/lmu-setup-library.md` (section 6). In
 * short: a game file is Tearoff's only if Tearoff wrote it, a write never
 * clobbers a file it did not check, and an update moves the old file aside,
 * checks it again, and only then publishes the new bytes.
 */

/** A library file mtime this close to now may still be being written. */
const PENDING_WINDOW_MS = 2_000;
/** A game file larger than this is never read: it is not a setup. */
const TARGET_MAX_BYTES = 1024 * 1024;
const TRACK_FOLDER_CAP = 200;
const FILES_PER_FOLDER_CAP = 200;
const LIBRARY_FILES_CAP = 2_000;
const UNPLACED_FILES_CAP = 200;
const GAME_TRACK_FOLDERS_CAP = 500;
const SIDE_FILES_PER_PASS = 50;
const DETECTION_RETRY_MS = 60_000;

/**
 * Stands for a game file that exists but must not be read or followed (a
 * link, a directory, or one larger than a setup). It never equals a hash,
 * so it always lands in a conflict row.
 */
const UNREADABLE_TARGET = 'unreadable';

const SIDE_FILE = /^(.+\.svm)\.tearoff-\d+-\d+\.old$/i;
const STAGING_FILE = /\.tearoff-\d+-\d+\.part$/i;
const COPYFILE_EXCL = fsp.constants.COPYFILE_EXCL;

const errorCode = (error: unknown): string =>
  (error as NodeJS.ErrnoException)?.code ?? 'UNKNOWN';

const isEnoent = (error: unknown): boolean => errorCode(error) === 'ENOENT';
const isEexist = (error: unknown): boolean => errorCode(error) === 'EEXIST';

const sha256 = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex');

const samePath = (a: string, b: string): boolean =>
  process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;

const equalName = (a: string, b: string): boolean =>
  a.toLowerCase() === b.toLowerCase();

const byName = (a: string, b: string): number => {
  const lower = a.toLowerCase().localeCompare(b.toLowerCase());
  return lower !== 0 ? lower : a.localeCompare(b);
};

const readDir = async (dir: string): Promise<Dirent[] | null> => {
  try {
    return await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
};

const isDirectory = async (dir: string): Promise<boolean> => {
  try {
    return (await fsp.stat(dir)).isDirectory();
  } catch {
    return false;
  }
};

const lstatOrNull = async (target: string): Promise<Stats | null> => {
  try {
    return await fsp.lstat(target);
  } catch {
    return null;
  }
};

const removeQuietly = async (filePath: string): Promise<void> => {
  try {
    await fsp.unlink(filePath);
  } catch {
    // Already gone, or held by the game: recovery resolves it next pass.
  }
};

export type InstallDecision =
  'copy' | 'none' | 'update' | 'conflict-changed' | 'conflict-foreign';

/** The decision table of the plan, section 6.2. Pure. */
export function decideInstall(input: {
  librarySha: string;
  /** null when the game has no file under this name. */
  targetSha: string | null;
  ledgerSha: string | undefined;
}): InstallDecision {
  const { librarySha, targetSha, ledgerSha } = input;
  if (targetSha === null) return 'copy';
  if (targetSha === librarySha) return 'none';
  if (ledgerSha !== undefined) {
    return targetSha === ledgerSha ? 'update' : 'conflict-changed';
  }
  return 'conflict-foreign';
}

const statusFor = (decision: InstallDecision): SetupFileStatus => {
  switch (decision) {
    case 'none':
      return { kind: 'installed' };
    case 'copy':
    case 'update':
      return { kind: 'ready' };
    case 'conflict-changed':
      return { kind: 'conflict', reason: 'changed-in-game' };
    case 'conflict-foreign':
      return { kind: 'conflict', reason: 'not-from-tearoff' };
  }
};

type LibraryFileState =
  | { kind: 'invalid'; problem: SetupFileProblem }
  | { kind: 'pending' }
  | { kind: 'ok'; bytes: Buffer; sha: string; vehicleClass: string };

/**
 * Reads a library file once. The bytes read, their hash and their car are
 * what a write in the same pass uses, so the file is never reopened to
 * publish it. A file that changes while it is read waits for the next pass.
 */
const readLibraryFile = async (
  filePath: string,
  nowMs: number
): Promise<LibraryFileState> => {
  let first: Stats;
  try {
    first = await fsp.stat(filePath);
  } catch {
    return { kind: 'invalid', problem: 'unreadable' };
  }
  if (!first.isFile()) return { kind: 'invalid', problem: 'unreadable' };
  if (first.size > SETUP_FILE_MAX_BYTES) {
    return { kind: 'invalid', problem: 'too-large' };
  }
  if (first.mtimeMs > nowMs - PENDING_WINDOW_MS) return { kind: 'pending' };

  let bytes: Buffer;
  try {
    bytes = await fsp.readFile(filePath);
  } catch {
    return { kind: 'invalid', problem: 'unreadable' };
  }
  let second: Stats;
  try {
    second = await fsp.stat(filePath);
  } catch {
    return { kind: 'pending' };
  }
  if (
    second.size !== first.size ||
    second.mtimeMs !== first.mtimeMs ||
    bytes.length !== first.size
  ) {
    return { kind: 'pending' };
  }

  const classified = classifySetupBytes(bytes);
  if (!classified.ok) {
    return { kind: 'invalid', problem: classified.problem };
  }
  return {
    kind: 'ok',
    bytes,
    sha: sha256(bytes),
    vehicleClass: classified.vehicleClass,
  };
};

/** The game's file under a name, or why it must not be decided on. */
const readTarget = async (target: string): Promise<string | null> => {
  let info: Stats;
  try {
    info = await fsp.lstat(target);
  } catch (error) {
    return isEnoent(error) ? null : UNREADABLE_TARGET;
  }
  if (!info.isFile() || info.isSymbolicLink()) return UNREADABLE_TARGET;
  if (info.size > TARGET_MAX_BYTES) return UNREADABLE_TARGET;
  try {
    return sha256(await fsp.readFile(target));
  } catch {
    return UNREADABLE_TARGET;
  }
};

const stamp = (date: Date): string => {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
};

export interface SetupLibraryOptions {
  libraryRoot: string;
  ledger: SetupInstallLedger;
  /** The folder the person chose, read at each use; may be stale. */
  getChosenGameFolder: () => string | undefined;
  detectGameFolder: () => Promise<string | null>;
  now?: () => number;
  /** Seams for the specs, so a write can be interrupted between its steps. */
  hooks?: SetupLibraryHooks;
}

export interface SetupLibraryHooks {
  /** After a decision, before a new file is published. */
  beforePublish?: (target: string) => Promise<void> | void;
  /** Before an owned file is moved aside (another writer may change it). */
  beforeRename?: (target: string) => Promise<void> | void;
  /** After an owned file was moved aside, before it is checked again. */
  afterRename?: (aside: string, target: string) => Promise<void> | void;
}

export interface SyncResult {
  copied: number;
  updated: number;
  conflicts: number;
  errors: number;
  /** False when the track folder could not be resolved in the game. */
  resolved: boolean;
}

export interface SetupLibrary {
  /** Read-only. Never creates folders or writes files. */
  getListing(sessionTrackFolder: string | null): Promise<SetupLibraryListing>;
  /**
   * Installs a library track folder's setups per section 6.2.
   * `createGameFolder`: create `Settings/<track folder>` when the game has
   * no matching folder (auto path only).
   */
  syncTrack(
    trackFolder: string,
    options: { createGameFolder: boolean }
  ): Promise<SyncResult>;
  /** Overwrites the game copy of one library file and records it. */
  replace(
    trackFolder: string,
    fileName: string
  ): Promise<'replaced' | 'refused'>;
  /** Forget a cached Steam detection (after the chosen folder changed). */
  resetGameFolderCache(): void;
  /**
   * Refuses any further `syncTrack` / `replace`; a write already in flight
   * still finishes. Called at shutdown before the queue is drained, so a
   * request that was waiting on a scan cannot start a new write afterwards.
   */
  close(): void;
  /** Resolves when every queued `syncTrack` / `replace` has finished. */
  drain(): Promise<void>;
}

interface ResolvedGame {
  root: string;
  source: 'chosen' | 'steam';
}

interface SettingsView {
  settingsRoot: string;
  boundary: string;
  trackFolders: string[];
}

export function createSetupLibrary(options: SetupLibraryOptions): SetupLibrary {
  const { libraryRoot, ledger } = options;
  const now = options.now ?? Date.now;
  const hooks = options.hooks;

  let detected: { at: number; root: string | null } | undefined;
  const warnedChosen = new Set<string>();
  const warnedRedirect = new Set<string>();
  /** Warnings already written, so a pass does not repeat them every tick. */
  const loggedConflicts = new Map<string, Set<string>>();
  const loggedFailures = new Map<string, Set<string>>();
  /** The last write failure of each file, cleared by the next success. */
  const writeErrors = new Map<string, string>();
  let asideCounter = 0;
  let stagingCounter = 0;
  let closed = false;
  let tail: Promise<void> = Promise.resolve();

  const queue = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = tail.then(operation, operation);
    tail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  };

  const logConflict = (
    key: string,
    fileName: string,
    decision: InstallDecision,
    targetSha: string | null
  ): void => {
    const seen = loggedConflicts.get(key) ?? new Set<string>();
    const marker = `${decision}:${targetSha ?? ''}`;
    if (seen.has(marker)) return;
    seen.add(marker);
    loggedConflicts.set(key, seen);
    logger.warn(
      decision === 'conflict-changed'
        ? `[Setups] Changed in the game, left as it is: ${fileName}`
        : `[Setups] Another file has this name, left as it is: ${fileName}`
    );
  };

  const logFailure = (key: string, fileName: string, code: string): void => {
    const seen = loggedFailures.get(key) ?? new Set<string>();
    if (seen.has(code)) return;
    seen.add(code);
    loggedFailures.set(key, seen);
    logger.warn(`[Setups] Could not copy ${fileName}: ${code}`);
  };

  const resolveGame = async (): Promise<ResolvedGame | null> => {
    const chosen = options.getChosenGameFolder();
    if (chosen) {
      if (await isLmuInstall(chosen)) return { root: chosen, source: 'chosen' };
      if (!warnedChosen.has(chosen)) {
        warnedChosen.add(chosen);
        logger.warn(
          '[Setups] The chosen Le Mans Ultimate folder is not a game folder'
        );
      }
    }
    const cached = detected;
    if (
      cached &&
      (cached.root !== null || now() - cached.at < DETECTION_RETRY_MS)
    ) {
      return cached.root ? { root: cached.root, source: 'steam' } : null;
    }
    const root = await options.detectGameFolder();
    detected = { at: now(), root };
    return root ? { root, source: 'steam' } : null;
  };

  const openSettings = async (root: string): Promise<SettingsView | null> => {
    const configured = path.join(root, 'UserData', 'player', 'Settings');
    let boundary: string;
    try {
      boundary = await fsp.realpath(configured);
    } catch {
      return null;
    }
    // Every later operation of the pass uses the canonical folder, so
    // repointing a junction after this point cannot redirect a write that
    // was checked against this boundary.
    const entries = (await readDir(boundary)) ?? [];
    const trackFolders = entries
      .filter((entry) => entry.isDirectory() && isTrackFolderName(entry.name))
      .map((entry) => entry.name)
      .sort(byName)
      .slice(0, GAME_TRACK_FOLDERS_CAP);
    return { settingsRoot: boundary, boundary, trackFolders };
  };

  /**
   * The game's Settings folder, created on the automatic path when the
   * profile has `UserData/player` but no `Settings` directory yet (a profile
   * restored without its saved setups). Only that one folder is created;
   * the track folder is created when there is something to install.
   */
  const settingsFor = async (
    root: string,
    allowCreate: boolean
  ): Promise<SettingsView | null> => {
    const existing = await openSettings(root);
    if (existing) return existing;
    if (!allowCreate) return null;
    const player = path.join(root, 'UserData', 'player');
    if (!(await isDirectory(player))) return null;
    try {
      await fsp.mkdir(path.join(player, 'Settings'));
    } catch (error) {
      if (!isEexist(error)) {
        logger.warn(
          '[Setups] Could not create the game setup folder',
          errorCode(error)
        );
        return null;
      }
    }
    return openSettings(root);
  };

  /**
   * Whether a track folder is a real folder directly below the canonical
   * Settings folder. A link is refused even when it resolves inside
   * Settings: it would let one track's name stand for another track's
   * folder, and ownership recorded under the name would then apply to the
   * wrong files. A folder that does not exist yet is where it would be
   * created.
   */
  const withinBoundary = async (
    dir: string,
    boundary: string
  ): Promise<boolean> => {
    let info: Stats;
    try {
      info = await fsp.lstat(dir);
    } catch (error) {
      return isEnoent(error);
    }
    if (!info.isDirectory() || info.isSymbolicLink()) return false;
    try {
      return samePath(path.dirname(await fsp.realpath(dir)), boundary);
    } catch {
      return false;
    }
  };

  const warnRedirect = (folder: string): void => {
    if (warnedRedirect.has(folder)) return;
    warnedRedirect.add(folder);
    logger.warn(
      `[Setups] The game's ${folder} folder points outside its setup folder, so nothing is installed there`
    );
  };

  /** The game's own name for a library track folder, or null. */
  const gameFolderFor = async (
    settings: SettingsView | null,
    folder: string,
    sessionTrackFolder: string | null
  ): Promise<string | null> => {
    if (!settings) return null;
    const candidate =
      settings.trackFolders.find((name) => equalName(name, folder)) ??
      (sessionTrackFolder &&
      equalName(sessionTrackFolder, folder) &&
      isTrackFolderName(sessionTrackFolder)
        ? sessionTrackFolder
        : null);
    if (!candidate) return null;
    const dir = path.join(settings.settingsRoot, candidate);
    if (!(await withinBoundary(dir, settings.boundary))) {
      warnRedirect(folder);
      return null;
    }
    return candidate;
  };

  const describeFile = async (
    filePath: string,
    fileName: string,
    gameFolder: string | null,
    settings: SettingsView | null
  ): Promise<SetupLibraryFile> => {
    const state = await readLibraryFile(filePath, now());
    if (state.kind === 'invalid') {
      return {
        fileName,
        vehicleClass: null,
        status: { kind: 'invalid', problem: state.problem },
      };
    }
    if (state.kind === 'pending') {
      return { fileName, vehicleClass: null, status: { kind: 'pending' } };
    }
    if (!settings || !gameFolder) {
      return {
        fileName,
        vehicleClass: state.vehicleClass,
        status: { kind: 'ready' },
      };
    }
    const key = setupInstallKey('lmu', settings.boundary, gameFolder, fileName);
    const targetSha = await readTarget(
      path.join(settings.settingsRoot, gameFolder, fileName)
    );
    const decision = decideInstall({
      librarySha: state.sha,
      targetSha,
      ledgerSha: ledger.get(key),
    });
    const failure = writeErrors.get(key);
    const status: SetupFileStatus =
      failure !== undefined && (decision === 'copy' || decision === 'update')
        ? { kind: 'error', code: failure }
        : statusFor(decision);
    return { fileName, vehicleClass: state.vehicleClass, status };
  };

  const getListing = async (
    sessionTrackFolder: string | null
  ): Promise<SetupLibraryListing> => {
    await ledger.ready();
    const game = await resolveGame();
    const settings = game ? await openSettings(game.root) : null;

    const rootEntries = await readDir(libraryRoot);
    const libraryExists = rootEntries !== null;
    let truncated = false;

    const tracks: SetupLibraryTrack[] = [];
    let unplacedFiles: string[] = [];
    let remaining = LIBRARY_FILES_CAP;

    if (rootEntries) {
      const folders = rootEntries
        .filter((entry) => entry.isDirectory() && isTrackFolderName(entry.name))
        .map((entry) => entry.name)
        .sort(byName);
      if (folders.length > TRACK_FOLDER_CAP) truncated = true;

      for (const folder of folders.slice(0, TRACK_FOLDER_CAP)) {
        if (remaining <= 0) {
          truncated = true;
          break;
        }
        const dirPath = path.join(libraryRoot, folder);
        const entries = (await readDir(dirPath)) ?? [];
        const names = entries
          .filter((entry) => entry.isFile() && isSvmFileName(entry.name))
          .map((entry) => entry.name)
          .sort(byName);
        const limit = Math.min(remaining, FILES_PER_FOLDER_CAP);
        if (names.length > limit) truncated = true;
        const gameFolder = await gameFolderFor(
          settings,
          folder,
          sessionTrackFolder
        );
        const files: SetupLibraryFile[] = [];
        for (const fileName of names.slice(0, limit)) {
          files.push(
            await describeFile(
              path.join(dirPath, fileName),
              fileName,
              gameFolder,
              settings
            )
          );
        }
        remaining -= files.length;
        tracks.push({ folder, gameFolder, files });
      }

      unplacedFiles = rootEntries
        .filter((entry) => entry.isFile() && isSvmFileName(entry.name))
        .map((entry) => entry.name)
        .sort(byName);
      if (unplacedFiles.length > UNPLACED_FILES_CAP) {
        truncated = true;
        unplacedFiles = unplacedFiles.slice(0, UNPLACED_FILES_CAP);
      }
    }

    return {
      libraryFolder: libraryRoot,
      libraryExists,
      gameFolder: game?.root ?? null,
      gameFolderSource: game?.source ?? null,
      gameTrackFolders: settings?.trackFolders ?? [],
      tracks,
      unplacedFiles,
      truncated,
    };
  };

  /**
   * Publishes complete bytes under a free name. The bytes are written to a
   * staging file first and then linked into place, so a reader never sees a
   * half-written setup and a name that already exists is never replaced.
   * Hard links are not available on every file system, so an exclusive
   * create is the fallback; recovery repairs a torn one.
   */
  const publishNew = async (
    target: string,
    bytes: Buffer
  ): Promise<'published' | 'exists'> => {
    stagingCounter += 1;
    const staging = `${target}.tearoff-${process.pid}-${stagingCounter}.part`;
    try {
      await fsp.writeFile(staging, bytes);
    } catch (error) {
      await removeQuietly(staging);
      throw error;
    }
    try {
      await fsp.link(staging, target);
    } catch (error) {
      await removeQuietly(staging);
      if (isEexist(error)) return 'exists';
      try {
        await fsp.writeFile(target, bytes, { flag: 'wx' });
        return 'published';
      } catch (fallbackError) {
        if (isEexist(fallbackError)) return 'exists';
        throw fallbackError;
      }
    }
    await removeQuietly(staging);
    return 'published';
  };

  const asidePath = (target: string): string => {
    asideCounter += 1;
    return `${target}.tearoff-${process.pid}-${asideCounter}.old`;
  };

  /**
   * Copies the moved-aside file to a `(kept …).svm` the garage lists.
   * Returns whether that copy exists afterwards; the side file is left where
   * it is, so the caller decides when it may go.
   */
  const copyAsideToVisible = async (
    aside: string,
    target: string
  ): Promise<boolean> => {
    const dir = path.dirname(target);
    const name = path.basename(target);
    const stem = name.replace(/\.svm$/i, '');
    const base = `${stem} (kept ${stamp(new Date())})`;
    for (let attempt = 1; attempt <= 99; attempt += 1) {
      const candidate = path.join(
        dir,
        attempt === 1 ? `${base}.svm` : `${base}-${attempt}.svm`
      );
      try {
        await fsp.copyFile(aside, candidate, COPYFILE_EXCL);
        logger.warn(
          '[Setups] A game file was kept as',
          path.basename(candidate)
        );
        return true;
      } catch (error) {
        if (!isEexist(error)) {
          logger.warn(
            '[Setups] Could not keep a copy of the game file',
            name,
            errorCode(error)
          );
          return false;
        }
      }
    }
    logger.warn('[Setups] Could not keep a copy of the game file', name);
    return false;
  };

  /** Keeps the moved-aside file in the garage, under a name LMU lists. */
  const keepAside = async (aside: string, target: string): Promise<void> => {
    if (await copyAsideToVisible(aside, target)) {
      await removeQuietly(aside);
    }
  };

  /**
   * Puts a moved-aside file back under its name without needing room for a
   * second copy of it: a hard link and an unlink of the side file cost no
   * data space, so a full volume cannot keep the save hidden. Where links
   * are unavailable, the copy is the fallback; if that fails too the side
   * file stays for recovery. Returns whether the side file was resolved.
   */
  const restoreAside = async (
    aside: string,
    target: string
  ): Promise<boolean> => {
    try {
      await fsp.link(aside, target);
      await removeQuietly(aside);
      return true;
    } catch (error) {
      if (isEexist(error)) {
        await keepAside(aside, target);
        return true;
      }
    }
    try {
      await fsp.copyFile(aside, target, COPYFILE_EXCL);
      await removeQuietly(aside);
      return true;
    } catch (error) {
      if (isEexist(error)) {
        await keepAside(aside, target);
        return true;
      }
      // Left in place: recovery resolves it on the next pass.
      logger.warn(
        '[Setups] Could not restore a game file from its side copy',
        path.basename(target),
        errorCode(error)
      );
      return false;
    }
  };

  /** Replaces an owned file: move it aside, check it again, then publish. */
  const replaceOwned = async (
    target: string,
    bytes: Buffer,
    ownedSha: string
  ): Promise<'published' | 'exists' | 'changed'> => {
    await hooks?.beforeRename?.(target);
    const aside = asidePath(target);
    await fsp.rename(target, aside);

    let movedSha: string;
    try {
      movedSha = sha256(await fsp.readFile(aside));
    } catch (error) {
      await restoreAside(aside, target);
      throw error;
    }
    await hooks?.afterRename?.(aside, target);
    if (movedSha !== ownedSha) {
      await restoreAside(aside, target);
      return 'changed';
    }

    let published: 'published' | 'exists';
    try {
      published = await publishNew(target, bytes);
    } catch (error) {
      await restoreAside(aside, target);
      throw error;
    }
    if (published === 'exists') {
      await removeQuietly(aside);
      return 'exists';
    }
    await removeQuietly(aside);
    return 'published';
  };

  /**
   * The manual Replace. The person agreed to overwrite the name, but what
   * stood there is not destroyed: unless it is Tearoff's own untouched
   * bytes, a `(kept …).svm` copy is made *before* the replacement is
   * published. If that copy cannot be made, nothing is replaced and the
   * original goes back.
   */
  const replaceAt = async (
    target: string,
    bytes: Buffer,
    ownedSha: string | undefined
  ): Promise<'published' | 'exists' | 'no-backup'> => {
    const aside = asidePath(target);
    try {
      await fsp.rename(target, aside);
    } catch (error) {
      if (isEnoent(error)) return publishNew(target, bytes);
      throw error;
    }

    let movedSha: string | null;
    try {
      movedSha = sha256(await fsp.readFile(aside));
    } catch {
      movedSha = null;
    }

    const own =
      movedSha !== null && ownedSha !== undefined && movedSha === ownedSha;
    if (!own && !(await copyAsideToVisible(aside, target))) {
      await restoreAside(aside, target);
      return 'no-backup';
    }

    let published: 'published' | 'exists';
    try {
      published = await publishNew(target, bytes);
    } catch (error) {
      await restoreAside(aside, target);
      throw error;
    }
    await removeQuietly(aside);
    return published;
  };

  /**
   * Resolves side files an interrupted update left behind (plan 6.6).
   *
   * A side file is kept unless it can be shown that the file now standing
   * under the name is the one that was being published: its bytes must equal
   * the library file's. `wx` makes creation exclusive, not atomic, so a
   * process killed mid-publish leaves a torn file behind, and the side file
   * is then the last good setup.
   */
  const recoverSideFiles = async (
    trackDir: string,
    gameFolder: string,
    boundary: string,
    librarySha: (fileName: string) => Promise<string | null>
  ): Promise<void> => {
    const entries = (await readDir(trackDir)) ?? [];
    for (const entry of entries) {
      if (entry.isFile() && STAGING_FILE.test(entry.name)) {
        await removeQuietly(path.join(trackDir, entry.name));
      }
    }
    const sides = entries
      .filter((entry) => entry.isFile() && SIDE_FILE.test(entry.name))
      .slice(0, SIDE_FILES_PER_PASS);
    for (const entry of sides) {
      // Re-checked before every side file: a directory swapped for a link
      // since the pass began is not written through.
      if (!(await withinBoundary(trackDir, boundary))) {
        warnRedirect(gameFolder);
        return;
      }
      const match = SIDE_FILE.exec(entry.name);
      if (!match) continue;
      const aside = path.join(trackDir, entry.name);
      const target = path.join(trackDir, match[1]);

      if ((await lstatOrNull(target)) === null) {
        await restoreAside(aside, target);
        continue;
      }

      let asideSha: string;
      try {
        asideSha = sha256(await fsp.readFile(aside));
      } catch {
        continue;
      }
      const key = setupInstallKey('lmu', boundary, gameFolder, match[1]);
      const owned = ledger.get(key);
      if (owned !== undefined && asideSha === owned) {
        const expected = await librarySha(match[1]);
        if (expected !== null && (await readTarget(target)) === expected) {
          await removeQuietly(aside);
          continue;
        }
      }
      await keepAside(aside, target);
    }
  };

  const emptyResult = (): SyncResult => ({
    copied: 0,
    updated: 0,
    conflicts: 0,
    errors: 0,
    resolved: true,
  });

  const findLibraryFolder = async (
    trackFolder: string
  ): Promise<string | null> => {
    const entries = (await readDir(libraryRoot)) ?? [];
    const folder = entries.find(
      (entry) =>
        entry.isDirectory() &&
        isTrackFolderName(entry.name) &&
        equalName(entry.name, trackFolder)
    );
    return folder?.name ?? null;
  };

  /** The hash of a library file, or null when it is not readable right now. */
  const libraryShaIn = async (
    folder: string,
    fileName: string
  ): Promise<string | null> => {
    const state = await readLibraryFile(
      path.join(libraryRoot, folder, fileName),
      now()
    );
    return state.kind === 'ok' ? state.sha : null;
  };

  /**
   * Resolves side files of a track's game folder even when the library no
   * longer holds that track: an interrupted update must be repaired when
   * the driver returns to the track, whatever the library looks like now.
   */
  const recoverExistingTrack = async (trackFolder: string): Promise<void> => {
    const game = await resolveGame();
    if (!game) return;
    const settings = await openSettings(game.root);
    if (!settings) return;
    const gameFolder = settings.trackFolders.find((name) =>
      equalName(name, trackFolder)
    );
    if (!gameFolder) return;
    const trackDir = path.join(settings.settingsRoot, gameFolder);
    if (!(await withinBoundary(trackDir, settings.boundary))) {
      warnRedirect(trackFolder);
      return;
    }
    await recoverSideFiles(
      trackDir,
      gameFolder,
      settings.boundary,
      async () => null
    );
  };

  const syncTrackInner = async (
    trackFolder: string,
    { createGameFolder }: { createGameFolder: boolean }
  ): Promise<SyncResult> => {
    const result = emptyResult();
    await ledger.ready();
    if (!isTrackFolderName(trackFolder)) return { ...result, resolved: false };

    const folder = await findLibraryFolder(trackFolder);
    if (!folder) {
      await recoverExistingTrack(trackFolder);
      return result;
    }

    const game = await resolveGame();
    if (!game) return { ...result, resolved: false };
    const settings = await settingsFor(game.root, createGameFolder);
    if (!settings) return { ...result, resolved: false };

    let gameFolder = settings.trackFolders.find((name) =>
      equalName(name, trackFolder)
    );
    if (!gameFolder) {
      const player = await isDirectory(
        path.join(game.root, 'UserData', 'player')
      );
      if (!createGameFolder || !player) return { ...result, resolved: false };
      gameFolder = trackFolder;
      try {
        await fsp.mkdir(path.join(settings.settingsRoot, gameFolder), {
          recursive: true,
        });
      } catch (error) {
        logger.warn(
          '[Setups] Could not create the game track folder',
          trackFolder,
          errorCode(error)
        );
        return { ...result, resolved: false };
      }
    }

    const trackDir = path.join(settings.settingsRoot, gameFolder);
    if (!(await withinBoundary(trackDir, settings.boundary))) {
      warnRedirect(folder);
      return { ...result, resolved: false };
    }

    await recoverSideFiles(trackDir, gameFolder, settings.boundary, (name) =>
      libraryShaIn(folder, name)
    );

    const dirPath = path.join(libraryRoot, folder);
    const names = ((await readDir(dirPath)) ?? [])
      .filter((entry) => entry.isFile() && isSvmFileName(entry.name))
      .map((entry) => entry.name)
      .sort(byName);

    for (const fileName of names.slice(0, FILES_PER_FOLDER_CAP)) {
      const state = await readLibraryFile(path.join(dirPath, fileName), now());
      if (state.kind !== 'ok') continue;

      const key = setupInstallKey(
        'lmu',
        settings.boundary,
        gameFolder,
        fileName
      );
      const target = path.join(trackDir, fileName);
      const targetSha = await readTarget(target);
      const decision = decideInstall({
        librarySha: state.sha,
        targetSha,
        ledgerSha: ledger.get(key),
      });

      if (decision === 'none') {
        writeErrors.delete(key);
        continue;
      }
      if (decision === 'conflict-changed' || decision === 'conflict-foreign') {
        result.conflicts += 1;
        logConflict(key, fileName, decision, targetSha);
        continue;
      }

      try {
        if (decision === 'copy') {
          await hooks?.beforePublish?.(target);
          // The folder was validated once for this pass; it is checked again
          // immediately before the write, so a swap made while the pass runs
          // is refused rather than written through.
          if (!(await withinBoundary(trackDir, settings.boundary))) {
            warnRedirect(folder);
            return { ...result, resolved: false };
          }
          const published = await publishNew(target, state.bytes);
          if (published === 'exists') {
            result.conflicts += 1;
            continue;
          }
          ledger.set(key, state.sha);
          writeErrors.delete(key);
          result.copied += 1;
        } else {
          if (!(await withinBoundary(trackDir, settings.boundary))) {
            warnRedirect(folder);
            return { ...result, resolved: false };
          }
          const outcome = await replaceOwned(
            target,
            state.bytes,
            ledger.get(key) ?? ''
          );
          if (outcome === 'published') {
            ledger.set(key, state.sha);
            writeErrors.delete(key);
            result.updated += 1;
          } else {
            result.conflicts += 1;
          }
        }
      } catch (error) {
        const code = errorCode(error);
        writeErrors.set(key, code);
        result.errors += 1;
        logFailure(key, fileName, code);
      }
    }

    if (result.copied > 0 || result.updated > 0) {
      logger.info(
        `[Setups] ${folder}: copied ${result.copied}, updated ${result.updated}`
      );
    }
    return result;
  };

  const logRefused = (key: string, fileName: string): void => {
    const seen = loggedFailures.get(`refused:${key}`) ?? new Set<string>();
    if (seen.has('1')) return;
    seen.add('1');
    loggedFailures.set(`refused:${key}`, seen);
    logger.warn(
      `[Setups] A newer game save appeared, left as it is: ${fileName}`
    );
  };

  const logNoBackup = (key: string, fileName: string): void => {
    const seen = loggedFailures.get(`no-backup:${key}`) ?? new Set<string>();
    if (seen.has('1')) return;
    seen.add('1');
    loggedFailures.set(`no-backup:${key}`, seen);
    logger.warn(
      `[Setups] Could not keep a copy of the game's setup, so nothing was replaced: ${fileName}`
    );
  };

  const replaceInner = async (
    trackFolder: string,
    fileName: string
  ): Promise<'replaced' | 'refused'> => {
    await ledger.ready();
    if (!isTrackFolderName(trackFolder) || !isSvmFileName(fileName)) {
      return 'refused';
    }
    const folder = await findLibraryFolder(trackFolder);
    if (!folder) return 'refused';

    const state = await readLibraryFile(
      path.join(libraryRoot, folder, fileName),
      now()
    );
    if (state.kind !== 'ok') return 'refused';

    const game = await resolveGame();
    if (!game) return 'refused';
    const settings = await openSettings(game.root);
    if (!settings) return 'refused';
    const gameFolder = settings.trackFolders.find((name) =>
      equalName(name, trackFolder)
    );
    if (!gameFolder) return 'refused';

    const trackDir = path.join(settings.settingsRoot, gameFolder);
    if (!(await withinBoundary(trackDir, settings.boundary))) {
      warnRedirect(folder);
      return 'refused';
    }
    await recoverSideFiles(trackDir, gameFolder, settings.boundary, (name) =>
      libraryShaIn(folder, name)
    );

    const target = path.join(trackDir, fileName);
    const info = await lstatOrNull(target);
    if (
      info &&
      (info.isSymbolicLink() || info.isDirectory() || !info.isFile())
    ) {
      return 'refused';
    }

    const key = setupInstallKey('lmu', settings.boundary, gameFolder, fileName);
    try {
      const outcome = await replaceAt(target, state.bytes, ledger.get(key));
      if (outcome === 'exists') {
        logRefused(key, fileName);
        return 'refused';
      }
      if (outcome === 'no-backup') {
        logNoBackup(key, fileName);
        return 'refused';
      }
      ledger.set(key, state.sha);
      writeErrors.delete(key);
      logger.info(`[Setups] ${folder}: replaced ${fileName}`);
      return 'replaced';
    } catch (error) {
      const code = errorCode(error);
      writeErrors.set(key, code);
      logFailure(key, fileName, code);
      return 'refused';
    }
  };

  return {
    getListing: (sessionTrackFolder) => getListing(sessionTrackFolder),

    syncTrack: (trackFolder, syncOptions) =>
      closed
        ? Promise.resolve({ ...emptyResult(), resolved: false })
        : queue(() => syncTrackInner(trackFolder, syncOptions)),

    replace: (trackFolder, fileName) =>
      closed
        ? Promise.resolve('refused')
        : queue(() => replaceInner(trackFolder, fileName)),

    resetGameFolderCache() {
      detected = undefined;
      warnedChosen.clear();
      warnedRedirect.clear();
    },

    close() {
      closed = true;
    },

    drain: () => tail,
  };
}
