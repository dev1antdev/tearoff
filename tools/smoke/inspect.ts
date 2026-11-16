import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  compareDumps,
  type DumpComparison,
  type TableDump,
} from './dbCompare.ts';
import { parseMainLog, summariseLog, type LogSummary } from './errors.ts';
import { snapshotTree, type TreeEntry } from './guard.ts';
import {
  compareWidgets,
  isUserData,
  readConfig,
  widgetsByProfile,
  type WidgetComparison,
  type WidgetSummary,
} from './profile.ts';

export interface DbInfo {
  file: string;
  exists: boolean;
  schemaVersion?: number;
  tables: { name: string; rows: number }[];
  integrity?: string;
  error?: string;
}

const digest = (value: unknown): string =>
  createHash('sha1')
    .update(
      JSON.stringify(value, (_key, item: unknown) =>
        typeof item === 'bigint'
          ? item.toString()
          : item instanceof Uint8Array
            ? Buffer.from(item).toString('hex')
            : item
      )
    )
    .digest('hex');

/**
 * Opens a copy of a SQLite file, never the file itself: reading a database
 * in write-ahead mode creates files beside it, and the profile has to stay
 * as the app left it.
 */
function openCopy(file: string, scratch: string): DatabaseSync {
  fs.mkdirSync(scratch, { recursive: true });
  const copy = path.join(
    scratch,
    `${createHash('sha1').update(file).digest('hex').slice(0, 10)}-${path.basename(file)}`
  );
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(`${copy}${suffix}`, { force: true });
    if (fs.existsSync(`${file}${suffix}`)) {
      fs.copyFileSync(`${file}${suffix}`, `${copy}${suffix}`);
    }
  }
  return new DatabaseSync(copy);
}

const tableNames = (db: DatabaseSync): string[] =>
  (
    db
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_stat%' ORDER BY name"
      )
      .all() as { name: string }[]
  ).map((row) => row.name);

const columnNames = (db: DatabaseSync, table: string): string[] =>
  (db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[]).map(
    (row) => row.name
  );

export function readDb(file: string, scratch: string): DbInfo {
  if (!fs.existsSync(file)) return { file, exists: false, tables: [] };
  let db: DatabaseSync | undefined;
  try {
    db = openCopy(file, scratch);
    const version = db.prepare('PRAGMA user_version').get() as {
      user_version: number;
    };
    const integrity = db.prepare('PRAGMA integrity_check').get() as
      Record<string, unknown> | undefined;
    const connection = db;
    return {
      file,
      exists: true,
      schemaVersion: version.user_version,
      integrity: String(Object.values(integrity ?? {})[0] ?? 'unknown'),
      tables: tableNames(connection).map((name) => ({
        name,
        rows: (
          connection.prepare(`SELECT count(*) AS n FROM "${name}"`).get() as {
            n: number;
          }
        ).n,
      })),
    };
  } catch (error) {
    return {
      file,
      exists: true,
      tables: [],
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    db?.close();
  }
}

/** Every table of a database as row digests, for comparing two files. */
export function dumpDb(
  file: string,
  scratch: string,
  onlyColumns?: ReadonlyMap<string, readonly string[]>
): Map<string, TableDump> {
  const dump = new Map<string, TableDump>();
  const db = openCopy(file, scratch);
  try {
    for (const table of tableNames(db)) {
      const columns = onlyColumns?.get(table) ?? columnNames(db, table);
      if (columns.length === 0) continue;
      const list = columns.map((column) => `"${column}"`).join(', ');
      let rows: unknown[];
      try {
        rows = db
          .prepare(`SELECT ${list} FROM "${table}" ORDER BY rowid`)
          .all();
      } catch {
        rows = db.prepare(`SELECT ${list} FROM "${table}" ORDER BY 1`).all();
      }
      dump.set(table, { columns: [...columns], rows: rows.map(digest) });
    }
  } finally {
    db.close();
  }
  return dump;
}

export interface LapLibraryInspection {
  current: DbInfo;
  backups: DbInfo[];
  /** The library as it was before the run (a copied profile only). */
  original?: DbInfo;
  /** The first backup against the original: every table, column and row. */
  backupMatchesOriginal?: DumpComparison;
  /** The original's rows, in the columns it had, against the library now. */
  rowsKept?: DumpComparison;
  /** Rows the run added. A recording is not the player's: there should be none. */
  rowsAdded: { table: string; before: number; after: number }[];
}

export function inspectLapLibrary(
  profileDir: string,
  scratch: string,
  originalDb?: string
): LapLibraryInspection {
  const current = readDb(path.join(profileDir, 'laps.db'), scratch);
  const backups = fs
    .readdirSync(profileDir)
    .filter((name) => /^laps\.v\d+\.bak(\.\d+)?\.db$/.test(name))
    .sort()
    .map((name) => readDb(path.join(profileDir, name), scratch));
  const inspection: LapLibraryInspection = { current, backups, rowsAdded: [] };
  if (!originalDb || !fs.existsSync(originalDb)) {
    inspection.rowsAdded = current.tables
      .filter((table) => table.rows > 0 && table.name !== 'sqlite_sequence')
      .map((table) => ({ table: table.name, before: 0, after: table.rows }));
    return inspection;
  }

  const original = readDb(originalDb, scratch);
  inspection.original = original;
  const before = new Map(original.tables.map((t) => [t.name, t.rows]));
  inspection.rowsAdded = current.tables
    .filter(
      (table) =>
        table.name !== 'sqlite_sequence' &&
        before.has(table.name) &&
        table.rows !== before.get(table.name)
    )
    .map((table) => ({
      table: table.name,
      before: before.get(table.name) ?? 0,
      after: table.rows,
    }));
  try {
    const originalDump = dumpDb(originalDb, scratch);
    if (backups[0]?.exists && !backups[0].error) {
      inspection.backupMatchesOriginal = compareDumps(
        originalDump,
        dumpDb(backups[0].file, scratch)
      );
    }
    if (!current.error) {
      // Only the columns the original had: an upgrade adds columns, and a
      // row that kept everything it held is a row that survived.
      const columns = new Map(
        [...originalDump].map(([table, dump]) => [table, dump.columns])
      );
      const now = dumpDb(current.file, scratch, columns);
      const kept = new Map(
        [...now].filter(([table]) => originalDump.has(table))
      );
      inspection.rowsKept = compareDumps(originalDump, kept);
    }
  } catch (error) {
    inspection.rowsKept = {
      equal: false,
      differences: [
        `could not compare: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }
  return inspection;
}

export interface FileChange {
  file: string;
  size: number;
  state: 'new' | 'changed' | 'same';
}

export interface ProfileInspection {
  log: { file: string; exists: boolean; summary: LogSummary; lines: string[] };
  lapLibrary: LapLibraryInspection;
  config: {
    parsed: boolean;
    error?: string;
    profiles: string[];
    comparison?: WidgetComparison;
  };
  /** The user's data in the profile now, against what the run started with. */
  files: FileChange[];
  trackProfiles: { name: string; size: number; isNew: boolean }[];
  /** What a recording must not leave behind, when it did. */
  shouldNotBeThere: string[];
}

export interface InspectOptions {
  profileDir: string;
  scratch: string;
  /** The profile's user data before the app ran. */
  filesBefore: ReadonlyMap<string, TreeEntry>;
  /** The widgets to hold the stored ones against. */
  widgetsBefore?: ReadonlyMap<string, WidgetSummary[]>;
  /** A pristine copy of the library the profile started with. */
  originalDb?: string;
}

const topLevel = (file: string): string => file.split(/[\\/]/)[0];

export function inspectProfile(options: InspectOptions): ProfileInspection {
  const { profileDir, scratch } = options;
  const logFile = path.join(profileDir, 'logs', 'main.log');
  const logText = fs.existsSync(logFile)
    ? fs.readFileSync(logFile, 'utf8')
    : '';
  const entries = parseMainLog(logText);

  const config = readConfig(path.join(profileDir, 'config.json'));
  const stored = widgetsByProfile(config.config);

  const after = snapshotTree(profileDir);
  const files: FileChange[] = [...after]
    .filter(([file]) => isUserData(topLevel(file)))
    .map(([file, entry]) => {
      const was = options.filesBefore.get(file);
      const state: FileChange['state'] = !was
        ? 'new'
        : was.size !== entry.size || was.mtimeMs !== entry.mtimeMs
          ? 'changed'
          : 'same';
      return { file, size: entry.size, state };
    })
    .sort((a, b) => a.file.localeCompare(b.file));

  const trackProfiles = files
    .filter((file) => topLevel(file.file) === 'track-profiles')
    .map((file) => ({
      name: file.file,
      size: file.size,
      isNew: file.state !== 'same',
    }));

  const lapLibrary = inspectLapLibrary(profileDir, scratch, options.originalDb);
  const shouldNotBeThere = [
    ...lapLibrary.rowsAdded.map(
      (table) =>
        `lap library: ${table.table} went from ${table.before} to ${table.after} rows while a recording played`
    ),
    ...trackProfiles
      .filter((file) => file.isNew)
      .map((file) => `track profile written from a recording: ${file.name}`),
    // The lap library refuses a recording's laps; these stores take them.
    ...files
      .filter(
        (file) =>
          file.state !== 'same' &&
          [
            'fuel_data.json',
            'lapTraces.json',
            'personalBestLapTimes.json',
          ].includes(file.file)
      )
      .map(
        (file) =>
          `${file.file} was written while a recording played: the recording's lap is stored as the user's`
      ),
    ...files
      .filter((file) => /\.(irdt|lmudt|ibt|dmp)$/i.test(file.file))
      .map((file) => `unexpected file: ${file.file}`),
  ];

  return {
    log: {
      file: logFile,
      exists: logText.length > 0,
      summary: summariseLog(entries),
      lines: logText.split(/\r?\n/).filter((line) => line.trim().length > 0),
    },
    lapLibrary,
    config: {
      parsed: config.parsed,
      error: config.error,
      profiles: [...stored.keys()],
      comparison: options.widgetsBefore
        ? compareWidgets(options.widgetsBefore, stored)
        : undefined,
    },
    files,
    trackProfiles,
    shouldNotBeThere,
  };
}
