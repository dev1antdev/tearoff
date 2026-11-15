import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { LapLibraryUnavailableReason } from '../../../types/lapLibrary';
import type { Migration } from './schema';

/**
 * Opening the lap library's file, and bringing it up to this build's schema.
 *
 * The file is the player's own laps, so the order here is the point:
 *
 * 1. A file from a newer build is found out by reading its version through a
 *    read-only connection, and refused. A connection that could write would
 *    fold the file's log into it on closing; this one cannot, so the file
 *    and its log are left byte for byte as they were.
 * 2. A file that holds anything is copied beside itself before a step runs,
 *    once its log has been folded in so the copy is whole, and with the
 *    write lock held so nothing can change under the copy.
 * 3. Every step runs in one transaction with the version it leaves. If
 *    anything fails the transaction is rolled back, and the file is as it
 *    was found: same version, same rows.
 *
 * The file calls here are synchronous, like everything about the built-in
 * SQLite. They run on the library's worker thread, once, as it opens.
 */

/** Why the library could not be opened, in a form the app can act on. */
export class LapLibraryOpenError extends Error {
  constructor(
    readonly reason: LapLibraryUnavailableReason,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'LapLibraryOpenError';
  }
}

export interface OpenOutcome {
  /** The version the file is at now. */
  schemaVersion: number;
  /** The version a file with something in it was found at; null if current. */
  upgradedFrom: number | null;
  /** The name of the copy kept of the file as it was found, beside it. */
  backupName: string | null;
}

/** How much of a file is compared at a time. */
const COMPARE_CHUNK_BYTES = 64 * 1024;
/** More copies of one version than this is something gone wrong. */
const MAX_BACKUPS_PER_VERSION = 99;

const userVersion = (db: DatabaseSync): number =>
  (db.prepare('PRAGMA user_version').get() as { user_version: number })
    .user_version;

const topOf = (migrations: readonly Migration[]): number =>
  migrations[migrations.length - 1].to;

/** A ladder with a missing or doubled rung would skip or repeat a step. */
const assertLadder = (migrations: readonly Migration[]): void => {
  if (migrations.length === 0) throw new Error('The schema ladder is empty');
  migrations.forEach((step, index) => {
    if (step.from !== index || step.to !== index + 1) {
      throw new Error(
        `The schema ladder is out of order at step ${index}: ${step.from} to ${step.to}`
      );
    }
  });
};

/**
 * An error's text without the folder the library is kept in: that is under
 * the user's own name, and this text goes to the log.
 */
const describe = (error: unknown, file: string | null): string => {
  const text = error instanceof Error ? error.message : String(error);
  if (file === null || !path.isAbsolute(file)) return text;
  const folder = path.dirname(file);
  return text.replaceAll(`${folder}${path.sep}`, '').replaceAll(folder, '');
};

const newerThanThisBuild = (found: number, known: number) =>
  new LapLibraryOpenError(
    'newer',
    `The lap library is at schema ${found}, newer than this build understands (${known}); it has been left as it is`
  );

/**
 * The version a database file is at, read without changing the file: not
 * its contents, and not its log either.
 */
export const readSchemaVersion = (file: string): number => {
  const probe = new DatabaseSync(file, { readOnly: true });
  try {
    return userVersion(probe);
  } finally {
    probe.close();
  }
};

const sameBytes = (first: string, second: string): boolean => {
  const a = fs.openSync(first, 'r');
  try {
    const b = fs.openSync(second, 'r');
    try {
      if (fs.fstatSync(a).size !== fs.fstatSync(b).size) return false;
      const bufferA = Buffer.allocUnsafe(COMPARE_CHUNK_BYTES);
      const bufferB = Buffer.allocUnsafe(COMPARE_CHUNK_BYTES);
      for (;;) {
        const readA = fs.readSync(a, bufferA, 0, COMPARE_CHUNK_BYTES, null);
        const readB = fs.readSync(b, bufferB, 0, COMPARE_CHUNK_BYTES, null);
        if (readA !== readB) return false;
        if (readA === 0) return true;
        if (bufferA.compare(bufferB, 0, readB, 0, readA) !== 0) return false;
      }
    } finally {
      fs.closeSync(b);
    }
  } finally {
    fs.closeSync(a);
  }
};

/**
 * Keeps a copy of the file as it is, beside it: `laps.v1.bak.db` for
 * `laps.db` at version 1. Returns the copy's name.
 *
 * A copy that is already there is never written over. If it holds exactly
 * what the file holds now, it is the copy. If it holds something else -- an
 * earlier state of the library, from an upgrade that was tried before -- it
 * stays, and this state is kept under the next free name
 * (`laps.v1.bak.2.db`).
 */
const keepCopy = (file: string, version: number): string => {
  const { dir, name, ext } = path.parse(file);
  for (let count = 1; count <= MAX_BACKUPS_PER_VERSION; count += 1) {
    const copy = path.join(
      dir,
      `${name}.v${version}.bak${count === 1 ? '' : `.${count}`}${ext}`
    );
    const taken = fs.statSync(copy, { throwIfNoEntry: false });
    if (taken) {
      if (taken.isFile() && sameBytes(file, copy)) return path.basename(copy);
      continue;
    }
    // Fails rather than replace a file that appeared since the check.
    fs.copyFileSync(file, copy, fs.constants.COPYFILE_EXCL);
    if (!sameBytes(file, copy)) {
      // Not a backup, and it must not be taken for one next time.
      fs.rmSync(copy, { force: true });
      throw new Error('the backup copy does not match the file');
    }
    return path.basename(copy);
  }
  throw new Error(
    `there are already ${MAX_BACKUPS_PER_VERSION} backups of schema ${version}`
  );
};

/** Folds the write-ahead log into the file, so the file alone is whole. */
const foldLogIntoFile = (db: DatabaseSync): void => {
  const result = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get() as
    { busy: number } | undefined;
  if (!result || result.busy !== 0) {
    throw new Error('the file is in use by another program');
  }
};

const logIsEmpty = (file: string): boolean =>
  (fs.statSync(`${file}-wal`, { throwIfNoEntry: false })?.size ?? 0) === 0;

/** Every row that points at a row that is not there, as comparable text. */
const danglingReferences = (db: DatabaseSync): Set<string> =>
  new Set(
    (
      db.prepare('PRAGMA foreign_key_check').all() as Record<string, unknown>[]
    ).map((row) => `${row.table}|${row.rowid}|${row.parent}|${row.fkid}`)
  );

const hasAnything = (db: DatabaseSync): boolean =>
  (db.prepare('SELECT count(*) AS n FROM sqlite_schema').get() as { n: number })
    .n > 0;

/**
 * Runs the steps, all of them in one transaction: they are all committed or
 * all rolled back. With a file to keep, it is copied first. Returns the
 * copy's name.
 *
 * @param keep The file to copy before the first step, or null for a
 *   database with nothing in it yet, or one that is not in a file.
 */
const climb = (
  db: DatabaseSync,
  keep: string | null,
  found: number,
  steps: readonly Migration[]
): string | null => {
  if (keep !== null) foldLogIntoFile(db);
  // Off for the steps: with it on, rebuilding a table would delete every
  // row that refers to it. It cannot be changed inside a transaction.
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    // The write lock from here to the commit: nothing else can change the
    // file between the copy and the steps.
    db.exec('BEGIN IMMEDIATE');
    try {
      if (userVersion(db) !== found) {
        throw new Error('the file was changed by another program');
      }
      let backupName: string | null = null;
      if (keep !== null) {
        // Something written since the log was folded in would be missing
        // from the copy.
        if (!logIsEmpty(keep)) {
          throw new Error('the file is in use by another program');
        }
        backupName = keepCopy(keep, found);
      }
      const danglingBefore = danglingReferences(db);
      for (const step of steps) {
        step.up(db);
        if (!db.isTransaction) {
          throw new Error(
            `the step to schema ${step.to} ended the upgrade's transaction`
          );
        }
        db.exec(`PRAGMA user_version = ${step.to}`);
      }
      for (const reference of danglingReferences(db)) {
        if (!danglingBefore.has(reference)) {
          throw new Error(
            `the upgrade left a row pointing at nothing (${reference})`
          );
        }
      }
      db.exec('COMMIT');
      return backupName;
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw error;
    }
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
};

/**
 * Brings an open database up the ladder. Either every step above its
 * version is applied, or none is.
 *
 * @param file The file the database is in, to back it up; null for one that
 *   is not in a file.
 */
export const upgradeSchema = (
  db: DatabaseSync,
  file: string | null,
  migrations: readonly Migration[]
): OpenOutcome => {
  assertLadder(migrations);
  const top = topOf(migrations);
  const found = userVersion(db);
  if (found === top) {
    return { schemaVersion: top, upgradedFrom: null, backupName: null };
  }
  if (found > top) throw newerThanThisBuild(found, top);

  try {
    if (found < 0) throw new Error(`there is no schema ${found}`);
    // A file that holds anything is kept as it is before it is touched. One
    // that holds nothing is being made, not upgraded.
    const hadAnything = found > 0 || hasAnything(db);
    const backupName = climb(
      db,
      hadAnything ? file : null,
      found,
      migrations.slice(found)
    );
    return {
      schemaVersion: top,
      upgradedFrom: hadAnything ? found : null,
      backupName,
    };
  } catch (error) {
    throw new LapLibraryOpenError(
      'upgrade',
      `The lap library could not be brought from schema ${found} to ${top}, and is unchanged: ${describe(error, file)}`,
      { cause: error }
    );
  }
};

/**
 * Opens the lap library's database, at this build's schema.
 *
 * Throws a `LapLibraryOpenError` when it cannot; the file is then as it was
 * found, and the connection is closed.
 *
 * @param file A path, or ':memory:' for a database that is not kept.
 */
export const openLapLibraryFile = (
  file: string,
  migrations: readonly Migration[]
): { db: DatabaseSync; outcome: OpenOutcome } => {
  const onDisk = file !== ':memory:';
  if (onDisk && fs.existsSync(file)) {
    let found: number;
    try {
      found = readSchemaVersion(file);
    } catch (error) {
      throw new LapLibraryOpenError(
        'unreadable',
        `The lap library could not be read: ${describe(error, file)}`,
        { cause: error }
      );
    }
    // Before a connection that can write is ever opened on it.
    if (found > topOf(migrations)) {
      throw newerThanThisBuild(found, topOf(migrations));
    }
  }

  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(file);
    // Write-ahead logging with NORMAL sync: a commit is appended to the log
    // without waiting for the disk, which is what makes a lap cost a tenth of
    // a millisecond. A power cut can lose the last laps, never corrupt the
    // file.
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = NORMAL');
    db.exec('PRAGMA foreign_keys = ON');
    return { db, outcome: upgradeSchema(db, onDisk ? file : null, migrations) };
  } catch (error) {
    // Left open, the handle would keep the file locked for as long as the
    // process lives.
    try {
      db?.close();
    } catch {
      // Nothing more can be done for a connection that will not close.
    }
    if (error instanceof LapLibraryOpenError) throw error;
    throw new LapLibraryOpenError(
      'unreadable',
      `The lap library could not be opened: ${describe(error, file)}`,
      { cause: error }
    );
  }
};
