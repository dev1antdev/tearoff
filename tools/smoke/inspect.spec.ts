import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backupsOfSchema, inspectLapLibrary, type DbInfo } from './inspect.ts';

// Every case here writes, copies and compares whole lap libraries, which
// takes seconds apiece; the default ten ran out on a loaded runner.
vi.setConfig({ testTimeout: 60_000 });

/**
 * A lap library as far as the inspection reads one: a schema number, the
 * tables of that schema, and a row or two to tell one file from another.
 */
const writeLibrary = (
  file: string,
  schema: 1 | 2 | 3,
  laps: readonly number[] = []
): void => {
  const db = new DatabaseSync(file);
  try {
    db.exec('CREATE TABLE lap (id INTEGER PRIMARY KEY, time REAL NOT NULL)');
    if (schema >= 2) {
      db.exec('CREATE TABLE stint (id INTEGER PRIMARY KEY, laps INTEGER)');
    }
    if (schema >= 3) {
      db.exec('CREATE TABLE race (id INTEGER PRIMARY KEY, token TEXT)');
    }
    const insert = db.prepare('INSERT INTO lap (time) VALUES (?)');
    for (const time of laps) insert.run(time);
    db.exec(`PRAGMA user_version = ${schema}`);
  } finally {
    db.close();
  }
};

describe('the lap library after a run on a copied profile', () => {
  let dir: string;
  let profile: string;
  let scratch: string;
  let original: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tearoff-smoke-inspect-'));
    profile = path.join(dir, 'profile');
    scratch = path.join(dir, 'scratch');
    fs.mkdirSync(profile);
    fs.mkdirSync(path.join(dir, 'original'));
    original = path.join(dir, 'original', 'laps.db');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('holds the library as it was against the backup of its own schema, not an older one the profile brought', () => {
    // A profile that was upgraded from 1 to 2 by an earlier release, and
    // from 2 to 3 by the run: two backups beside the library now.
    writeLibrary(original, 2, [86.6, 87.1]);
    writeLibrary(path.join(profile, 'laps.v1.bak.db'), 1, [90.2]);
    writeLibrary(path.join(profile, 'laps.v2.bak.db'), 2, [86.6, 87.1]);
    writeLibrary(path.join(profile, 'laps.db'), 3, [86.6, 87.1]);

    const library = inspectLapLibrary(profile, scratch, original);

    expect(library.backups.map((backup) => backup.schemaVersion)).toEqual([
      1, 2,
    ]);
    expect(library.backupsOfOriginalSchema).toBe(1);
    expect(library.backupMatchesOriginal).toEqual({
      equal: true,
      differences: [],
    });
    expect(library.rowsKept?.equal).toBe(true);
  });

  it('says so when the backup of that schema is not the library as it was', () => {
    writeLibrary(original, 2, [86.6, 87.1]);
    writeLibrary(path.join(profile, 'laps.v1.bak.db'), 1, [86.6, 87.1]);
    writeLibrary(path.join(profile, 'laps.v2.bak.db'), 2, [86.6]);
    writeLibrary(path.join(profile, 'laps.db'), 3, [86.6, 87.1]);

    const library = inspectLapLibrary(profile, scratch, original);

    expect(library.backupsOfOriginalSchema).toBe(1);
    expect(library.backupMatchesOriginal?.equal).toBe(false);
  });

  it('takes the copy that matches where an earlier attempt left another of the same schema', () => {
    // The app never writes over a copy that holds something else: it keeps
    // this state under the next free name.
    writeLibrary(original, 2, [86.6, 87.1]);
    writeLibrary(path.join(profile, 'laps.v2.bak.db'), 2, [99.9]);
    writeLibrary(path.join(profile, 'laps.v2.bak.2.db'), 2, [86.6, 87.1]);
    writeLibrary(path.join(profile, 'laps.db'), 3, [86.6, 87.1]);

    const library = inspectLapLibrary(profile, scratch, original);

    expect(library.backupsOfOriginalSchema).toBe(2);
    expect(library.backupMatchesOriginal?.equal).toBe(true);
  });

  it('counts no backup when the only one is of an older schema', () => {
    // Upgraded by the run with nothing kept of what it was: the older
    // backup is not a backup of this upgrade.
    writeLibrary(original, 2, [86.6, 87.1]);
    writeLibrary(path.join(profile, 'laps.v1.bak.db'), 1, [90.2]);
    writeLibrary(path.join(profile, 'laps.db'), 3, [86.6, 87.1]);

    const library = inspectLapLibrary(profile, scratch, original);

    expect(library.backups).toHaveLength(1);
    expect(library.backupsOfOriginalSchema).toBe(0);
    expect(library.backupMatchesOriginal).toBeUndefined();
  });

  it('compares nothing where the run upgraded nothing', () => {
    // A profile already at this build's schema: its backups are of older
    // schemas, and none of them is the library as it was.
    writeLibrary(original, 3, [86.6]);
    writeLibrary(path.join(profile, 'laps.v2.bak.db'), 2, [86.6]);
    writeLibrary(path.join(profile, 'laps.db'), 3, [86.6]);

    const library = inspectLapLibrary(profile, scratch, original);

    expect(library.backupsOfOriginalSchema).toBe(0);
    expect(library.backupMatchesOriginal).toBeUndefined();
    expect(library.rowsKept?.equal).toBe(true);
  });
});

describe('backupsOfSchema', () => {
  const backup = (
    schemaVersion: number,
    more: Partial<DbInfo> = {}
  ): DbInfo => ({
    file: `laps.v${schemaVersion}.bak.db`,
    exists: true,
    schemaVersion,
    tables: [],
    ...more,
  });

  it('keeps the readable backups of the schema asked for', () => {
    const backups = [
      backup(1),
      backup(2),
      backup(2, { error: 'file is not a database' }),
      backup(2, { exists: false }),
    ];
    expect(backupsOfSchema(backups, 2)).toEqual([backups[1]]);
    expect(backupsOfSchema(backups, 3)).toEqual([]);
    expect(backupsOfSchema(backups, undefined)).toEqual([]);
  });
});
