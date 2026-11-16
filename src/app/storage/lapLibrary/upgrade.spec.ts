import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  LapCurve,
  LapInput,
  LapLedgerInput,
  LapSessionInput,
} from '../../../types/lapLibrary';
import { LapLibraryDatabase } from './LapLibraryDatabase';
import { createLapLibraryHost } from './lapLibraryHost';
import { LAP_LIBRARY_MAX_LAPS } from './lapLibraryService';
import { MIGRATIONS, SCHEMA_VERSION, type Migration } from './schema';
import { LapLibraryOpenError, readSchemaVersion } from './upgrade';

/**
 * The upgrade of a lap library an older build left behind, against real
 * files: a version 1 library made by the version 1 schema and the writers
 * the app records with, then opened by this build; and a version 2 library,
 * with its stints and its ledger, brought to version 3.
 */

/** The ladder as the build before the ledger had it: version 1, no further. */
const VERSION_1_ONLY = MIGRATIONS.slice(0, 1);
/** The ladder as the build before the race history had it. */
const VERSION_2_LADDER = MIGRATIONS.slice(0, 2);
/** Everything a version 1 file holds. */
const VERSION_1_TABLES = ['session', 'lap', 'reference_pin', 'sqlite_sequence'];
/** Everything a version 2 file holds. */
const VERSION_2_TABLES = [...VERSION_1_TABLES, 'stint', 'lap_ledger'];
/** What version 3 adds. */
const VERSION_3_TABLES = [
  'race',
  'race_lap',
  'race_stint',
  'race_driver_change',
];

/**
 * A folder holding a `laps.db` (and its -wal and -shm, if it has them) taken
 * from a real installation, to upgrade a copy of. The case is skipped
 * without it.
 */
const SAMPLE_FOLDER = process.env.IRDASHIES_LAPS_DB_SAMPLE ?? '';

/**
 * The schema each version leaves, as a digest of its CREATE statements with
 * the whitespace evened out. A step that has shipped made the files that are
 * out there: if one of these moves, a released step was edited. Put it back
 * and add a step instead.
 */
const SCHEMA_FINGERPRINTS: Record<number, string> = {
  1: 'f9e3bd0ad6cd679f',
  2: '27dbf5823c4dae37',
  3: 'ad28a40831aa503f',
};

const T0 = Date.UTC(2026, 10, 13, 16, 0, 0);
const MINUTE = 60_000;

const curve = (lapTime: number, points = 40, withSpeeds = true): LapCurve => {
  const pointPos = new Float32Array(points);
  const times = new Float32Array(points);
  const speedsKph = new Float32Array(points);
  for (let index = 0; index < points; index += 1) {
    pointPos[index] = (index + 0.37) / points;
    times[index] = pointPos[index] * lapTime;
    speedsKph[index] = 91.5 + index * 3.25 + lapTime / 7;
  }
  return {
    interval: 1 / points,
    pointPos,
    times,
    speedsKph: withSpeeds ? speedsKph : null,
  };
};

const LMU_CAR = 'Ferrari 296 LMGT3 Evo';

const lmuSession = (
  overrides: Partial<LapSessionInput> = {}
): LapSessionInput => ({
  token: 'boot1:1',
  simulator: 'lmu',
  sessionKey: '',
  trackId: 694510461,
  trackName: 'WeatherTech Raceway Laguna Seca',
  trackConfig: null,
  trackLengthM: 3590.2,
  carKey: LMU_CAR,
  carName: 'Kessel Racing #74',
  sessionType: 'Race',
  sessionName: 'Race',
  ...overrides,
});

const iracingSession = (
  overrides: Partial<LapSessionInput> = {}
): LapSessionInput => ({
  token: 'boot2:1',
  simulator: 'iracing',
  sessionKey: '48213:2',
  trackId: 18,
  trackName: 'Road America',
  trackConfig: 'Full Course',
  trackLengthM: 6413,
  carKey: 'bmwm4gt3',
  carName: 'BMW M4 GT3',
  sessionType: 'Race',
  sessionName: 'RACE',
  ...overrides,
});

let stamp = T0;
const lap = (lapTime: number, overrides: Partial<LapInput> = {}): LapInput => ({
  lapNumber: 1,
  lapTime,
  completedAt: (stamp += 90_000),
  complete: true,
  pit: false,
  voided: false,
  own: true,
  incidents: 0,
  fuelUsed: 2.4375,
  energyUsed: 0.0231,
  airTemp: 21.5,
  trackTemp: 30.25,
  curve: curve(lapTime),
  ...overrides,
});

/** The laps of the fixture that matter by name. */
interface Version1Library {
  /** Chosen by hand as the Laguna Seca reference; not the quickest. */
  pinnedLapId: number;
  pinnedCurve: LapCurve;
  /** The quickest clean lap at Laguna Seca. */
  quickestLmuLapId: number;
  /** The quickest clean lap at Road America. */
  quickestIracingLapId: number;
  /** The one lap at the Nordschleife. */
  nordschleifeLapId: number;
  sessions: number;
  laps: number;
}

/**
 * A version 1 library on disk, as an installation that has been raced with
 * would have it: both simulators, a session rejoined after a restart, a
 * pinned reference, laps with and without curves, every nullable column
 * null somewhere, text that is not ASCII, and ids that are not contiguous
 * because things were deleted.
 */
const buildVersion1Library = (file: string): Version1Library => {
  stamp = T0;
  const db = new LapLibraryDatabase(file, { migrations: VERSION_1_ONLY });

  // A Le Mans Ultimate race.
  db.recordLap(
    lmuSession(),
    lap(97.823, { pit: true, complete: false, curve: null })
  );
  db.recordLap(lmuSession(), lap(86.512, { lapNumber: 2 }));
  const quickestLmu = db.recordLap(lmuSession(), lap(86.216, { lapNumber: 3 }));
  db.recordLap(lmuSession(), lap(85.902, { lapNumber: 4, voided: true }));
  db.recordLap(lmuSession(), lap(86.744, { lapNumber: 5, own: false }));
  db.recordLap(
    lmuSession(),
    lap(87.031, { lapNumber: 6, incidents: null, fuelUsed: null })
  );

  // Practice at the same track in the same car, another evening.
  stamp += 26 * 60 * MINUTE;
  const practice = lmuSession({
    token: 'boot1:2',
    sessionType: 'Practice',
    sessionName: 'Practice',
  });
  db.recordLap(practice, lap(87.42));
  const pinnedCurve = curve(86.671);
  const pinned = db.recordLap(
    practice,
    lap(86.671, { lapNumber: 2, curve: pinnedCurve })
  );
  const deletedLater = db.recordLap(practice, lap(87.015, { lapNumber: 3 }));
  db.pinReference(pinned.lapId);

  // An iRacing race, carried on in the same session after a restart.
  stamp += 3 * 60 * MINUTE;
  db.recordLap(
    iracingSession(),
    lap(139.735, {
      lapNumber: 2,
      energyUsed: null,
      fuelUsed: 3.41,
      incidents: 1,
    })
  );
  const quickestIracing = db.recordLap(
    iracingSession(),
    lap(131.301, { lapNumber: 3, energyUsed: null, fuelUsed: 3.36 })
  );
  db.recordLap(
    iracingSession(),
    lap(129.284, {
      lapNumber: 4,
      energyUsed: null,
      fuelUsed: 3.39,
      incidents: 2,
    })
  );
  const restarted = iracingSession({ token: 'boot3:1' });
  db.recordLap(
    restarted,
    lap(132.118, {
      lapNumber: 5,
      energyUsed: null,
      curve: curve(132.118, 40, false),
    })
  );
  db.recordLap(restarted, lap(133.5, { lapNumber: 6, energyUsed: null }));

  // A session that is deleted below, so the ids after it are not contiguous.
  const doomed = db.recordLap(
    iracingSession({ token: 'boot3:2', sessionKey: '', trackId: 99 }),
    lap(70.5)
  );
  db.recordLap(
    iracingSession({ token: 'boot3:2', sessionKey: '', trackId: 99 }),
    lap(70.1)
  );

  // A test session: no identity, nothing known about the lap but its time.
  const nordschleife = db.recordLap(
    iracingSession({
      token: 'boot4:1',
      sessionKey: '',
      trackId: 252,
      trackName: 'Nürburgring Nordschleife',
      trackConfig: 'Industriefahrten',
      trackLengthM: 20832,
      carKey: 'porsche992rgt3',
      carName: "Porsche 911 GT3 R (992) 'Grello'",
      sessionType: null,
      sessionName: null,
    }),
    lap(487.906, {
      lapNumber: null,
      incidents: null,
      fuelUsed: null,
      energyUsed: null,
      airTemp: null,
      trackTemp: null,
      curve: curve(487.906, 2084),
    })
  );
  db.close();

  // Deleted the way the Laps page deletes: the rows go, the ids are not
  // handed out again.
  const raw = new DatabaseSync(file);
  raw.prepare('DELETE FROM session WHERE id = ?').run(doomed.sessionId);
  raw.prepare('DELETE FROM lap WHERE id = ?').run(deletedLater.lapId);
  raw.close();

  return {
    pinnedLapId: pinned.lapId,
    pinnedCurve,
    quickestLmuLapId: quickestLmu.lapId,
    quickestIracingLapId: quickestIracing.lapId,
    nordschleifeLapId: nordschleife.lapId,
    sessions: 4,
    laps: 14,
  };
};

type Dump = Record<string, Record<string, unknown>[]>;

/**
 * Every row of the tables, each value beside the storage class SQLite holds
 * it in, blobs as hex. Two dumps that are equal are the same data down to
 * the byte: the same integers, the same doubles, the same text, the same
 * blobs.
 */
const dump = (file: string, tables = VERSION_1_TABLES): Dump => {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return Object.fromEntries(
      tables.map((table) => {
        const columns = (
          db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
        ).map((column) => column.name);
        const rows = db
          .prepare(
            `SELECT rowid AS "(rowid)", ${columns
              .map(
                (column) => `typeof(${column}) AS "${column}:type", ${column}`
              )
              .join(', ')} FROM ${table} ORDER BY rowid`
          )
          .all() as Record<string, unknown>[];
        return [
          table,
          rows.map((row) =>
            Object.fromEntries(
              Object.entries(row).map(([column, value]) => [
                column,
                value instanceof Uint8Array
                  ? `x'${Buffer.from(value).toString('hex')}'`
                  : value,
              ])
            )
          ),
        ];
      })
    );
  } finally {
    db.close();
  }
};

interface SchemaRow {
  type: string;
  name: string;
  tbl_name: string;
  sql: string | null;
}

/** What the file's schema is, statement by statement, whitespace evened out. */
const schemaOf = (file: string, tables?: readonly string[]): SchemaRow[] => {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return (
      db
        .prepare(
          'SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY type, name'
        )
        .all() as unknown as SchemaRow[]
    )
      .filter((row) => !tables || tables.includes(row.tbl_name))
      .map((row) => ({
        ...row,
        sql: row.sql === null ? null : row.sql.replace(/\s+/g, ' ').trim(),
      }));
  } finally {
    db.close();
  }
};

/** Short enough to be read whole in a failure message. */
const fingerprint = (file: string): string =>
  crypto
    .createHash('sha256')
    .update(JSON.stringify(schemaOf(file)))
    .digest('hex')
    .slice(0, 16);

const countRows = (file: string, table: string, where = '1'): number => {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return (
      db.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${where}`).get() as {
        n: number;
      }
    ).n;
  } finally {
    db.close();
  }
};

/** A lap's ledger row, two laps to a stint, as the app's recorder writes it. */
const ledgerFor = (index: number): LapLedgerInput => {
  // Two laps to a stint, so that stints come and go at the cap too.
  const ordinal = Math.floor(index / 2) + 1;
  return {
    stint: {
      stint: {
        id: `boot9:1:${ordinal}`,
        ordinal,
        sessionNum: 0,
        driver: null,
        own: true,
        openedBy: 'pitExit',
        closedBy: null,
        startTime: ordinal * 400,
        endTime: null,
        startLap: (ordinal - 1) * 2,
        endLap: null,
        laps: (index % 2) + 1,
        startFuel: 50,
        endFuel: null,
        startEnergy: null,
        endEnergy: null,
        startTread: [1, 1, 1, 1],
        endTread: [],
        startBrake: [],
        endBrake: [],
        compounds: ['Medium', 'Medium', 'Medium', 'Medium'],
        bestLap: null,
        avgLap: null,
        cleanLaps: 0,
        paceDelta: null,
        consistency: null,
        passes: [],
        stop: null,
      },
      startedAt: T0 + ordinal,
      endedAt: null,
    },
    sessionNum: 0,
    stintLap: (index % 2) + 1,
    startTime: index * 200,
    endTime: index * 200 + 200,
    simLapTime: null,
    flags: 0,
    fuelAtLine: 40,
    fuelAdded: 0,
    energyAtLine: null,
    energyAdded: 0,
    treadAtLine: [0.9, 0.9, 0.9, 0.9],
    treadUsed: [0.001, 0.001, 0.001, 0.001],
    brakeAtLine: [],
    brakeUsed: [],
    compounds: ['Medium', 'Medium', 'Medium', 'Medium'],
    sectors: [60, 70, 70],
    wetness: 1,
    rain: 0,
    position: null,
    classPosition: null,
  };
};

let directory: string;
let file: string;

/** What is in the folder, apart from SQLite's own side files. */
const listing = (folder = directory): string[] =>
  fs
    .readdirSync(folder)
    .filter((name) => !/-(wal|shm)$/.test(name))
    .sort();

const backupFile = (name = 'laps.v1.bak.db') => path.join(directory, name);

/** Opens the file as this build does, and closes it again. */
const openAndClose = (target = file) => {
  const db = new LapLibraryDatabase(target);
  const { opened } = db;
  db.close();
  return opened;
};

const openError = (run: () => unknown): LapLibraryOpenError => {
  try {
    run();
  } catch (error) {
    if (error instanceof LapLibraryOpenError) return error;
    throw error;
  }
  throw new Error('Expected the lap library to refuse to open');
};

/** A step from 1 to 2 that does the real work, then more, then fails. */
const failingHalfWay: Migration = {
  from: 1,
  to: 2,
  summary: 'the real step, then damage, then a failure',
  up(db) {
    MIGRATIONS[1].up(db);
    db.exec('DELETE FROM lap');
    db.exec("UPDATE session SET track_name = 'overwritten'");
    db.exec('DROP TABLE reference_pin');
    throw new Error('injected failure');
  },
};

/** A step past the top of this build's ladder, as a later build would add. */
const toVersion4: Migration = {
  from: 3,
  to: 4,
  summary: 'something a later build needs',
  up: (db) => db.exec('CREATE TABLE from_the_future (id INTEGER PRIMARY KEY)'),
};

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tearoff-laps-upgrade-'));
  file = path.join(directory, 'laps.db');
});

afterEach(() => {
  // The exact mkdtemp result, never a real application folder.
  fs.rmSync(directory, { recursive: true, force: true });
});

describe('the schema ladder', () => {
  it('has one step from each version to the next, from nothing', () => {
    MIGRATIONS.forEach((step, index) => {
      expect([step.from, step.to]).toEqual([index, index + 1]);
    });
    expect(SCHEMA_VERSION).toBe(MIGRATIONS.length);
    expect(SCHEMA_VERSION).toBe(3);
  });

  it.each(MIGRATIONS.map((step) => step.to))(
    'leaves version %i with the schema it was released with',
    (version) => {
      new LapLibraryDatabase(file, {
        migrations: MIGRATIONS.slice(0, version),
      }).close();

      expect(readSchemaVersion(file)).toBe(version);
      // Undefined here means a new step whose schema is not pinned yet.
      expect(fingerprint(file)).toBe(SCHEMA_FINGERPRINTS[version]);
    }
  );

  it('refuses a ladder with a rung missing', () => {
    const error = openError(
      () =>
        new LapLibraryDatabase(file, {
          migrations: [MIGRATIONS[0], MIGRATIONS[1], toVersion4],
        })
    );

    expect(error.message).toMatch(/out of order/);
  });
});

describe('a new lap library', () => {
  it('is made at the current version, with nothing to back up', () => {
    const opened = openAndClose();

    expect(opened).toEqual({
      schemaVersion: SCHEMA_VERSION,
      upgradedFrom: null,
      backupName: null,
    });
    expect(readSchemaVersion(file)).toBe(SCHEMA_VERSION);
    expect(listing()).toEqual(['laps.db']);
  });

  it('is the same schema as a version 1 library upgraded', () => {
    openAndClose();
    const upgraded = path.join(directory, 'upgraded.db');
    new LapLibraryDatabase(upgraded, { migrations: VERSION_1_ONLY }).close();
    openAndClose(upgraded);

    expect(schemaOf(upgraded)).toEqual(schemaOf(file));
  });
});

describe('upgrading a version 1 lap library', () => {
  it('starts from a file as version 1 left it', () => {
    const library = buildVersion1Library(file);

    expect(readSchemaVersion(file)).toBe(1);
    expect(schemaOf(file).map((row) => row.name)).not.toContain('stint');
    expect(countRows(file, 'session')).toBe(library.sessions);
    expect(countRows(file, 'lap')).toBe(library.laps);
    expect(countRows(file, 'reference_pin')).toBe(1);
    expect(countRows(file, 'session', "simulator = 'lmu'")).toBe(2);
    expect(countRows(file, 'session', "simulator = 'iracing'")).toBe(2);
    // Ids were handed out to rows that are gone.
    expect(dump(file).sqlite_sequence).toMatchObject([
      { name: 'session', seq: 5 },
      { name: 'lap', seq: 17 },
    ]);
  });

  it('keeps every row and every column', () => {
    buildVersion1Library(file);
    const before = dump(file);
    const schemaBefore = schemaOf(file, VERSION_1_TABLES);

    const opened = openAndClose();

    // Both steps above it in one go: there is no stop at version 2.
    expect(opened).toEqual({
      schemaVersion: 3,
      upgradedFrom: 1,
      backupName: 'laps.v1.bak.db',
    });
    expect(readSchemaVersion(file)).toBe(3);
    expect(dump(file)).toEqual(before);
    // The tables themselves are as they were, not rebuilt.
    expect(schemaOf(file, VERSION_1_TABLES)).toEqual(schemaBefore);
    // And the new ones are there, empty.
    for (const table of ['stint', 'lap_ledger', ...VERSION_3_TABLES]) {
      expect(countRows(file, table), table).toBe(0);
    }
  });

  it('reads the upgraded library as the laps that were recorded', () => {
    const library = buildVersion1Library(file);

    const db = new LapLibraryDatabase(file);
    try {
      expect(db.stats()).toEqual({
        sessions: library.sessions,
        laps: library.laps,
      });
      const sessions = db.listSessions();
      expect(sessions.map((session) => session.trackName)).toEqual([
        'Nürburgring Nordschleife',
        'Road America',
        'WeatherTech Raceway Laguna Seca',
        'WeatherTech Raceway Laguna Seca',
      ]);
      // The session rejoined after a restart is still one session.
      expect(sessions[1]).toMatchObject({ lapCount: 5, bestLapTime: 129.284 });
      const laps = sessions.flatMap((session) => db.listLaps(session.id));
      expect(laps).toHaveLength(library.laps);
      // No lap from before the ledger has one.
      expect(laps.every((row) => row.ledger === null)).toBe(true);
      expect(db.listStints(sessions[0].id)).toEqual([]);

      // The pin still holds against the quicker lap.
      const reference = db.referenceLap('lmu', 694510461, LMU_CAR);
      expect(reference?.lapId).toBe(library.pinnedLapId);
      expect(reference?.pinned).toBe(true);
      expect(reference?.lapTime).toBe(86.671);
      expect(reference?.curve.pointPos).toEqual(library.pinnedCurve.pointPos);
      expect(reference?.curve.times).toEqual(library.pinnedCurve.times);
      expect(reference?.curve.speedsKph).toEqual(library.pinnedCurve.speedsKph);
      expect(db.referenceLap('iracing', 18, 'bmwm4gt3')?.lapId).toBe(
        library.quickestIracingLapId
      );
      expect(
        db.referenceLap('iracing', 252, 'porsche992rgt3')?.curve.times
      ).toEqual(curve(487.906, 2084).times);
    } finally {
      db.close();
    }
  });

  it('carries on recording into the upgraded library', () => {
    buildVersion1Library(file);
    const db = new LapLibraryDatabase(file);
    try {
      // The practice session's token is still known: the lap joins it.
      const practice = lmuSession({ token: 'boot1:2' });
      const before = db.listSessions().length;
      const recorded = db.recordLap(practice, lap(86.1, { lapNumber: 4 }));

      expect(db.listSessions()).toHaveLength(before);
      expect(db.listLaps(recorded.sessionId).map((row) => row.lapTime)).toEqual(
        [87.42, 86.671, 86.1]
      );
      // An id is still never handed out twice.
      expect(recorded.lapId).toBe(18);
    } finally {
      db.close();
    }
  });

  it('backs the file up beside itself before changing it', () => {
    buildVersion1Library(file);
    const original = fs.readFileSync(file);
    const before = dump(file);

    openAndClose();

    expect(listing()).toEqual(['laps.db', 'laps.v1.bak.db']);
    // The copy is the file as it was found, to the byte.
    expect(fs.readFileSync(backupFile()).equals(original)).toBe(true);
    // And is a version 1 library that opens on its own.
    expect(readSchemaVersion(backupFile())).toBe(1);
    expect(dump(backupFile())).toEqual(before);
  });

  it('does nothing when the file is opened a second time', () => {
    buildVersion1Library(file);
    openAndClose();
    const upgraded = fs.readFileSync(file);
    const backup = fs.readFileSync(backupFile());
    const backupWritten = fs.statSync(backupFile()).mtimeMs;

    const opened = openAndClose();

    expect(opened).toEqual({
      schemaVersion: 3,
      upgradedFrom: null,
      backupName: null,
    });
    expect(fs.readFileSync(file).equals(upgraded)).toBe(true);
    expect(listing()).toEqual(['laps.db', 'laps.v1.bak.db']);
    expect(fs.readFileSync(backupFile()).equals(backup)).toBe(true);
    expect(fs.statSync(backupFile()).mtimeMs).toBe(backupWritten);
  });

  it('upgrades a file whose last writes are still in its log', () => {
    // As a crash leaves it: the file and its write-ahead log, copied from
    // under an open connection, most of the laps only in the log.
    const live = path.join(directory, 'live.db');
    const writer = new LapLibraryDatabase(live, { migrations: VERSION_1_ONLY });
    writer.recordLap(lmuSession(), lap(86.512));
    const pinned = writer.recordLap(lmuSession(), lap(86.9, { lapNumber: 2 }));
    writer.pinReference(pinned.lapId);
    writer.recordLap(iracingSession(), lap(131.301));
    fs.copyFileSync(live, file);
    fs.copyFileSync(`${live}-wal`, `${file}-wal`);
    writer.close();
    expect(fs.statSync(`${file}-wal`).size).toBeGreaterThan(0);
    const expected = dump(live);

    const opened = openAndClose();

    expect(opened.upgradedFrom).toBe(1);
    expect(readSchemaVersion(file)).toBe(3);
    expect(dump(file)).toEqual(expected);
    // The copy holds all of it by itself: taken somewhere with no log
    // beside it, it is the whole version 1 library.
    const alone = path.join(directory, 'elsewhere');
    fs.mkdirSync(alone);
    fs.copyFileSync(backupFile(), path.join(alone, 'restored.db'));
    expect(readSchemaVersion(path.join(alone, 'restored.db'))).toBe(1);
    expect(dump(path.join(alone, 'restored.db'))).toEqual(expected);
  });
});

/** What a version 2 library holds, by name. */
interface Version2Library {
  sessions: number;
  laps: number;
  stints: number;
  ledgerRows: number;
}

/**
 * A version 2 library on disk, as an installation that raced before the
 * ledger and after it would have it: the version 1 library above, brought
 * to version 2 by the build that added the ledger, then a race with a
 * ledger row for every lap and a stint for every two. The copy that build
 * kept of the version 1 file is beside it, as it would be.
 */
const buildVersion2Library = (target: string): Version2Library => {
  const library = buildVersion1Library(target);
  const db = new LapLibraryDatabase(target, { migrations: VERSION_2_LADDER });
  const leMans = lmuSession({
    token: 'boot7:1',
    trackId: 1234,
    trackName: 'Circuit de la Sarthe',
  });
  stamp = T0 + 30 * 24 * 60 * MINUTE;
  const LAPS = 9;
  for (let index = 0; index < LAPS; index += 1) {
    const recorded = db.recordLap(
      leMans,
      lap(index === 4 ? 213.4 : 216 + (index % 3), {
        lapNumber: index + 1,
        ledger: ledgerFor(index),
      })
    );
    if (recorded.ledgerError !== null) throw new Error(recorded.ledgerError);
  }
  db.close();
  return {
    sessions: library.sessions + 1,
    laps: library.laps + LAPS,
    stints: Math.ceil(LAPS / 2),
    ledgerRows: LAPS,
  };
};

/** A step from 2 to 3 that does the real work, then more, then fails. */
const failingAtThree: Migration = {
  from: 2,
  to: 3,
  summary: 'the real step, then damage, then a failure',
  up(db) {
    MIGRATIONS[2].up(db);
    db.exec(
      "INSERT INTO race_lap SELECT 1, 1, id, 0, 0, 0, 0, 0, 0, 0, 0, 0, '', 0, 0, 0, 0, 0, 0 FROM lap"
    );
    db.exec('DELETE FROM lap_ledger');
    db.exec("UPDATE stint SET driver = 'overwritten'");
    db.exec('DROP TABLE reference_pin');
    throw new Error('injected failure');
  },
};

describe('upgrading a version 2 lap library', () => {
  it('starts from a file as version 2 left it', () => {
    const library = buildVersion2Library(file);

    expect(readSchemaVersion(file)).toBe(2);
    expect(fingerprint(file)).toBe(SCHEMA_FINGERPRINTS[2]);
    const names = schemaOf(file).map((row) => row.name);
    for (const table of VERSION_3_TABLES) expect(names).not.toContain(table);
    expect(countRows(file, 'session')).toBe(library.sessions);
    expect(countRows(file, 'lap')).toBe(library.laps);
    expect(countRows(file, 'stint')).toBe(library.stints);
    expect(countRows(file, 'lap_ledger')).toBe(library.ledgerRows);
    expect(countRows(file, 'reference_pin')).toBe(1);
    // The copy the build before kept of the version 1 file is still there.
    expect(listing()).toEqual(['laps.db', 'laps.v1.bak.db']);
  });

  it('keeps every row and every column, and adds the race tables empty', () => {
    buildVersion2Library(file);
    const before = dump(file, VERSION_2_TABLES);
    const schemaBefore = schemaOf(file, VERSION_2_TABLES);

    const opened = openAndClose();

    expect(opened).toEqual({
      schemaVersion: 3,
      upgradedFrom: 2,
      backupName: 'laps.v2.bak.db',
    });
    expect(readSchemaVersion(file)).toBe(3);
    expect(dump(file, VERSION_2_TABLES)).toEqual(before);
    // The player's tables are as they were, not rebuilt.
    expect(schemaOf(file, VERSION_2_TABLES)).toEqual(schemaBefore);
    for (const table of VERSION_3_TABLES) {
      expect(countRows(file, table), table).toBe(0);
    }
    expect(fingerprint(file)).toBe(SCHEMA_FINGERPRINTS[3]);
  });

  it('ends up as a library made by this build is', () => {
    buildVersion2Library(file);
    openAndClose();
    const fresh = path.join(directory, 'fresh.db');
    openAndClose(fresh);

    expect(schemaOf(file)).toEqual(schemaOf(fresh));
  });

  it('backs the file up beside itself before changing it, and leaves the older copy alone', () => {
    buildVersion2Library(file);
    const original = fs.readFileSync(file);
    const olderCopy = fs.readFileSync(backupFile());
    const before = dump(file, VERSION_2_TABLES);

    openAndClose();

    expect(listing()).toEqual(['laps.db', 'laps.v1.bak.db', 'laps.v2.bak.db']);
    // The copy is the file as it was found, to the byte.
    const copy = backupFile('laps.v2.bak.db');
    expect(fs.readFileSync(copy).equals(original)).toBe(true);
    expect(fs.readFileSync(backupFile()).equals(olderCopy)).toBe(true);
    // And is a version 2 library that the build before opens on its own.
    expect(readSchemaVersion(copy)).toBe(2);
    expect(dump(copy, VERSION_2_TABLES)).toEqual(before);
    const alone = path.join(directory, 'elsewhere');
    fs.mkdirSync(alone);
    fs.copyFileSync(copy, path.join(alone, 'laps.db'));
    const restored = new LapLibraryDatabase(path.join(alone, 'laps.db'), {
      migrations: VERSION_2_LADDER,
    });
    try {
      expect(restored.opened).toEqual({
        schemaVersion: 2,
        upgradedFrom: null,
        backupName: null,
      });
      expect(restored.stats().laps).toBe(before.lap.length);
    } finally {
      restored.close();
    }
  });

  it('reads the upgraded library as the laps, stints and ledger that were recorded', () => {
    const library = buildVersion2Library(file);

    const db = new LapLibraryDatabase(file);
    try {
      expect(db.stats()).toEqual({
        sessions: library.sessions,
        laps: library.laps,
      });
      const [leMans] = db.listSessions();
      expect(leMans.trackName).toBe('Circuit de la Sarthe');
      const laps = db.listLaps(leMans.id);
      expect(laps).toHaveLength(library.ledgerRows);
      expect(laps.every((row) => row.ledger !== null)).toBe(true);
      expect(laps[4]).toMatchObject({ lapTime: 213.4, isReference: true });
      expect(db.listStints(leMans.id).map((stint) => stint.id)).toEqual([
        'boot9:1:1',
        'boot9:1:2',
        'boot9:1:3',
        'boot9:1:4',
        'boot9:1:5',
      ]);
      // The pin from version 1 still holds.
      expect(db.referenceLap('lmu', 694510461, LMU_CAR)?.pinned).toBe(true);
      // And no race is kept yet.
      expect(db.races.list()).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('carries on recording the player’s laps, and takes a race, in the upgraded library', () => {
    const library = buildVersion2Library(file);
    const db = new LapLibraryDatabase(file);
    try {
      const recorded = db.recordLap(
        lmuSession({ token: 'boot7:1', trackId: 1234 }),
        lap(215.2, { lapNumber: 10, ledger: ledgerFor(9) })
      );
      expect(recorded.ledgerError).toBeNull();
      expect(db.stats().laps).toBe(library.laps + 1);

      const { raceId } = db.races.write({
        raceId: null,
        token: 'boot8:1',
        info: {
          id: null,
          simulator: 'lmu',
          sessionKey: '',
          sessionNum: 10,
          sessionType: 'Race',
          sessionName: 'Race',
          trackId: 1234,
          trackName: 'Circuit de la Sarthe',
          trackConfig: null,
          trackLengthM: 13626,
          startedAt: T0,
          updatedAt: T0 + MINUTE,
          sessionTime: 240,
          entries: [],
          tyres: [],
        },
        laps: [
          {
            carIdx: 3,
            lap: 1,
            sessionTime: 233.5,
            lapTime: 213.9,
            sectors: [70.1, 80.2, 63.6],
            position: 2,
            classPosition: 1,
            classGap: 0,
            flags: 0,
            driver: 'A Driver',
            energy: 0.71,
            energyIsVirtual: true,
            compounds: [0, 0, 1, 1],
          },
        ],
        stints: [],
        driverChanges: [],
        replacedCars: [],
        maxRaces: 20,
      });

      expect(db.races.carLaps(raceId, 3)).toHaveLength(1);
      // The race's laps are not the player's: the lap library's own counts
      // and its cap do not see them.
      expect(db.stats().laps).toBe(library.laps + 1);
    } finally {
      db.close();
    }
  });

  it('does nothing when the file is opened a second time', () => {
    buildVersion2Library(file);
    openAndClose();
    const upgraded = fs.readFileSync(file);
    const backupWritten = fs.statSync(backupFile('laps.v2.bak.db')).mtimeMs;

    const opened = openAndClose();

    expect(opened).toEqual({
      schemaVersion: 3,
      upgradedFrom: null,
      backupName: null,
    });
    expect(fs.readFileSync(file).equals(upgraded)).toBe(true);
    expect(listing()).toEqual(['laps.db', 'laps.v1.bak.db', 'laps.v2.bak.db']);
    expect(fs.statSync(backupFile('laps.v2.bak.db')).mtimeMs).toBe(
      backupWritten
    );
  });

  it('upgrades a file whose last laps are still in its log', () => {
    // As a crash leaves it: the file and its write-ahead log, copied from
    // under an open connection.
    const live = path.join(directory, 'live.db');
    buildVersion2Library(live);
    const writer = new LapLibraryDatabase(live, {
      migrations: VERSION_2_LADDER,
    });
    writer.recordLap(
      lmuSession({ token: 'boot7:1', trackId: 1234 }),
      lap(214.8, { lapNumber: 10, ledger: ledgerFor(9) })
    );
    fs.copyFileSync(live, file);
    fs.copyFileSync(`${live}-wal`, `${file}-wal`);
    writer.close();
    expect(fs.statSync(`${file}-wal`).size).toBeGreaterThan(0);
    const expected = dump(live, VERSION_2_TABLES);

    const opened = openAndClose();

    expect(opened.upgradedFrom).toBe(2);
    expect(dump(file, VERSION_2_TABLES)).toEqual(expected);
    // The copy holds all of it by itself, the lap from the log included.
    expect(dump(backupFile('laps.v2.bak.db'), VERSION_2_TABLES)).toEqual(
      expected
    );
  });

  describe('when the step fails', () => {
    const failed = () =>
      openError(
        () =>
          new LapLibraryDatabase(file, {
            migrations: [...VERSION_2_LADDER, failingAtThree],
          })
      );

    it('leaves the file at version 2 with everything in it', () => {
      buildVersion2Library(file);
      const original = fs.readFileSync(file);
      const before = dump(file, VERSION_2_TABLES);
      const schemaBefore = schemaOf(file);

      const error = failed();

      expect(error.reason).toBe('upgrade');
      expect(error.message).toContain('injected failure');
      expect(error.message).toContain('from schema 2 to 3');
      expect(readSchemaVersion(file)).toBe(2);
      // Nothing the step did before it failed is there: not the race
      // tables or the rows put in them, not the ledger rows it deleted or
      // the stints it changed, not the table it dropped.
      expect(schemaOf(file)).toEqual(schemaBefore);
      expect(dump(file, VERSION_2_TABLES)).toEqual(before);
      // The copy was taken before the step ran, and is the file as found.
      expect(listing()).toEqual([
        'laps.db',
        'laps.v1.bak.db',
        'laps.v2.bak.db',
      ]);
      expect(
        fs.readFileSync(backupFile('laps.v2.bak.db')).equals(original)
      ).toBe(true);
    });

    it('leaves a library the build before still opens and records into', () => {
      const library = buildVersion2Library(file);
      failed();

      const older = new LapLibraryDatabase(file, {
        migrations: VERSION_2_LADDER,
      });
      try {
        expect(older.opened).toEqual({
          schemaVersion: 2,
          upgradedFrom: null,
          backupName: null,
        });
        expect(older.stats()).toEqual({
          sessions: library.sessions,
          laps: library.laps,
        });
        const recorded = older.recordLap(
          lmuSession({ token: 'boot7:1', trackId: 1234 }),
          lap(215.2, { lapNumber: 10, ledger: ledgerFor(9) })
        );
        expect(recorded.ledgerError).toBeNull();
        expect(older.stats().laps).toBe(library.laps + 1);
      } finally {
        older.close();
      }
    });

    it('leaves the app without a library, and the file untouched, rather than a half-made one', () => {
      buildVersion2Library(file);
      const original = fs.readFileSync(file);

      const host = createLapLibraryHost(file, {
        migrations: [...VERSION_2_LADDER, failingAtThree],
      });

      expect(host.handle({ id: 1, method: 'status', args: [] })).toMatchObject({
        result: { available: false, reason: 'upgrade', schemaVersion: null },
      });
      // Nothing is recorded and no race is written while it is so.
      expect(
        host.handle({
          id: 2,
          method: 'recordLap',
          args: [lmuSession(), lap(86)],
        })
      ).toEqual({ id: 2, error: expect.stringContaining('injected failure') });
      expect(host.handle({ id: 3, method: 'raceList', args: [] })).toEqual({
        id: 3,
        error: expect.stringContaining('injected failure'),
      });
      host.handle({ id: 4, method: 'close', args: [] });
      expect(fs.readFileSync(file).equals(original)).toBe(true);
    });

    it('is upgraded by the working step afterwards, from the same copy', () => {
      buildVersion2Library(file);
      const original = fs.readFileSync(file);
      const before = dump(file, VERSION_2_TABLES);
      failed();

      const opened = openAndClose();

      // The copy from the first try is this same file: it is the backup,
      // and there is still only the one of version 2.
      expect(opened).toEqual({
        schemaVersion: 3,
        upgradedFrom: 2,
        backupName: 'laps.v2.bak.db',
      });
      expect(listing()).toEqual([
        'laps.db',
        'laps.v1.bak.db',
        'laps.v2.bak.db',
      ]);
      expect(
        fs.readFileSync(backupFile('laps.v2.bak.db')).equals(original)
      ).toBe(true);
      expect(dump(file, VERSION_2_TABLES)).toEqual(before);
      for (const table of VERSION_3_TABLES) {
        expect(countRows(file, table), table).toBe(0);
      }
    });
  });
});

describe('an upgrade that fails', () => {
  it('leaves the file at version 1 with its data when a step fails half way', () => {
    buildVersion1Library(file);
    const original = fs.readFileSync(file);
    const before = dump(file);
    const schemaBefore = schemaOf(file);

    const error = openError(
      () =>
        new LapLibraryDatabase(file, {
          migrations: [MIGRATIONS[0], failingHalfWay],
        })
    );

    expect(error.reason).toBe('upgrade');
    expect(error.message).toContain('injected failure');
    expect(error.message).toContain('from schema 1 to 2');
    expect(readSchemaVersion(file)).toBe(1);
    // Nothing the step did before it failed is there: not the new tables,
    // not the rows it deleted or changed, not the table it dropped.
    expect(schemaOf(file)).toEqual(schemaBefore);
    expect(dump(file)).toEqual(before);
    // The copy was taken before the step ran, and is the file as found.
    expect(listing()).toEqual(['laps.db', 'laps.v1.bak.db']);
    expect(fs.readFileSync(backupFile()).equals(original)).toBe(true);
  });

  it('leaves a library that can still be opened, and upgraded later', () => {
    buildVersion1Library(file);
    const before = dump(file);
    const original = fs.readFileSync(file);
    openError(
      () =>
        new LapLibraryDatabase(file, {
          migrations: [MIGRATIONS[0], failingHalfWay],
        })
    );

    // The build with the working step.
    const opened = openAndClose();

    // The copy from the first try is this same file: it is the backup, and
    // there is still only the one.
    expect(opened).toEqual({
      schemaVersion: 3,
      upgradedFrom: 1,
      backupName: 'laps.v1.bak.db',
    });
    expect(listing()).toEqual(['laps.db', 'laps.v1.bak.db']);
    expect(fs.readFileSync(backupFile()).equals(original)).toBe(true);
    expect(dump(file)).toEqual(before);
  });

  it('undoes the steps before it too: a file is never left in between', () => {
    buildVersion1Library(file);
    const before = dump(file);
    const schemaBefore = schemaOf(file);

    const error = openError(
      () =>
        new LapLibraryDatabase(file, {
          migrations: [
            ...MIGRATIONS,
            {
              ...toVersion4,
              up(db) {
                toVersion4.up(db);
                throw new Error('the last step failed');
              },
            },
          ],
        })
    );

    expect(error.reason).toBe('upgrade');
    // Not version 2 or 3, though those steps ran clean.
    expect(readSchemaVersion(file)).toBe(1);
    expect(schemaOf(file)).toEqual(schemaBefore);
    expect(dump(file)).toEqual(before);
  });

  it('refuses an upgrade that leaves a row pointing at nothing', () => {
    buildVersion1Library(file);
    const before = dump(file);

    const error = openError(
      () =>
        new LapLibraryDatabase(file, {
          migrations: [
            MIGRATIONS[0],
            {
              from: 1,
              to: 2,
              summary: 'loses a session and leaves its laps behind',
              up: (db) =>
                db.exec(
                  'DELETE FROM session WHERE id = (SELECT min(id) FROM session)'
                ),
            },
          ],
        })
    );

    expect(error.reason).toBe('upgrade');
    expect(error.message).toMatch(/pointing at nothing/);
    expect(readSchemaVersion(file)).toBe(1);
    expect(dump(file)).toEqual(before);
  });

  it('refuses a step that ends the transaction itself', () => {
    buildVersion1Library(file);

    const error = openError(
      () =>
        new LapLibraryDatabase(file, {
          migrations: [
            MIGRATIONS[0],
            {
              from: 1,
              to: 2,
              summary: 'commits on its own',
              up: (db) => db.exec('COMMIT'),
            },
          ],
        })
    );

    expect(error.reason).toBe('upgrade');
    expect(readSchemaVersion(file)).toBe(1);
  });

  it('says what went wrong without the folder the library is in', () => {
    buildVersion1Library(file);

    // The folder is under the user's name, and the text goes to the log.
    const error = openError(
      () =>
        new LapLibraryDatabase(file, {
          migrations: [
            MIGRATIONS[0],
            {
              from: 1,
              to: 2,
              summary: 'fails the way a file call does, naming the file',
              up: () => {
                throw new Error(
                  `EPERM: operation not permitted, open '${file}'`
                );
              },
            },
          ],
        })
    );

    expect(error.message).toContain("open 'laps.db'");
    expect(error.message).not.toContain(directory);
  });
});

describe('a step that rebuilds a table', () => {
  /** The way SQLite has a column dropped or retyped: a new table, copied into. */
  const rebuildSession: Migration = {
    from: 3,
    to: 4,
    summary: 'rebuilds the session table',
    up(db) {
      db.exec(`
        CREATE TABLE session_new AS SELECT * FROM session;
        DROP TABLE session;
        CREATE TABLE session (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          token TEXT NOT NULL UNIQUE,
          simulator TEXT NOT NULL,
          session_key TEXT NOT NULL,
          started_at INTEGER NOT NULL,
          last_lap_at INTEGER NOT NULL,
          track_id INTEGER NOT NULL,
          track_name TEXT NOT NULL,
          track_config TEXT,
          track_length_m REAL NOT NULL,
          car_key TEXT NOT NULL,
          car_name TEXT NOT NULL,
          session_type TEXT,
          session_name TEXT
        );
        INSERT INTO session SELECT * FROM session_new;
        DROP TABLE session_new;
      `);
    },
  };

  it('does not take the rows that point at it', () => {
    // With foreign keys enforced, dropping the session table would delete
    // every lap in the library.
    const library = buildVersion1Library(file);
    const laps = dump(file).lap;

    const db = new LapLibraryDatabase(file, {
      migrations: [...MIGRATIONS, rebuildSession],
    });
    db.close();

    expect(readSchemaVersion(file)).toBe(4);
    expect(dump(file).lap).toEqual(laps);
    expect(countRows(file, 'reference_pin')).toBe(1);
    expect(countRows(file, 'session')).toBe(library.sessions);
  });

  it('has foreign keys enforced again once it is done', () => {
    buildVersion1Library(file);
    const db = new LapLibraryDatabase(file, {
      migrations: [...MIGRATIONS, rebuildSession],
    });
    try {
      const [session] = db.listSessions();

      expect(db.deleteSession(session.id)).toBe(true);

      // Its laps went with it.
      expect(db.listLaps(session.id)).toEqual([]);
      expect(db.stats().laps).toBe(13);
    } finally {
      db.close();
    }
  });
});

describe('the backup of an older file', () => {
  it('is never written over: a different one already there is kept, and another made', () => {
    buildVersion1Library(file);
    const original = fs.readFileSync(file);
    // A copy from an upgrade tried before, when the library held less.
    const earlier = Buffer.from('an earlier state of the library');
    fs.writeFileSync(backupFile(), earlier);

    const opened = openAndClose();

    expect(opened.backupName).toBe('laps.v1.bak.2.db');
    expect(listing()).toEqual([
      'laps.db',
      'laps.v1.bak.2.db',
      'laps.v1.bak.db',
    ]);
    expect(fs.readFileSync(backupFile()).equals(earlier)).toBe(true);
    expect(
      fs.readFileSync(backupFile('laps.v1.bak.2.db')).equals(original)
    ).toBe(true);
  });

  it('passes over a name that something other than a file has taken', () => {
    buildVersion1Library(file);
    const original = fs.readFileSync(file);
    fs.mkdirSync(backupFile());

    const opened = openAndClose();

    expect(opened.backupName).toBe('laps.v1.bak.2.db');
    expect(
      fs.readFileSync(backupFile('laps.v1.bak.2.db')).equals(original)
    ).toBe(true);
    expect(fs.statSync(backupFile()).isDirectory()).toBe(true);
  });

  it('is named for the version the file was at', () => {
    new LapLibraryDatabase(file).close();
    const before = fs.readFileSync(file);

    const db = new LapLibraryDatabase(file, {
      migrations: [...MIGRATIONS, toVersion4],
    });
    db.close();

    expect(db.opened).toEqual({
      schemaVersion: 4,
      upgradedFrom: 3,
      backupName: 'laps.v3.bak.db',
    });
    expect(fs.readFileSync(backupFile('laps.v3.bak.db')).equals(before)).toBe(
      true
    );
  });
});

describe('a lap library from a newer build', () => {
  const buildVersion4Library = (target: string) => {
    const db = new LapLibraryDatabase(target, {
      migrations: [...MIGRATIONS, toVersion4],
    });
    db.recordLap(lmuSession(), lap(86.512));
    db.recordLap(iracingSession(), lap(131.301));
    return db;
  };

  it('is refused and left untouched', () => {
    buildVersion4Library(file).close();
    const original = fs.readFileSync(file);
    const filesBefore = listing();

    const error = openError(() => new LapLibraryDatabase(file));

    expect(error.reason).toBe('newer');
    expect(error.message).toMatch(/schema 4, newer than this build/);
    expect(fs.readFileSync(file).equals(original)).toBe(true);
    // Not backed up either: there was nothing to protect it from.
    expect(listing()).toEqual(filesBefore);
    expect(listing()).toEqual(['laps.db']);
    expect(readSchemaVersion(file)).toBe(4);
  });

  it('is not changed by being refused again and again', () => {
    buildVersion4Library(file).close();
    const original = fs.readFileSync(file);

    for (let start = 0; start < 3; start += 1) {
      openError(() => new LapLibraryDatabase(file));
    }

    expect(fs.readFileSync(file).equals(original)).toBe(true);
    // The newer build still opens it, with everything in it.
    const newer = new LapLibraryDatabase(file, {
      migrations: [...MIGRATIONS, toVersion4],
    });
    expect(newer.stats()).toEqual({ sessions: 2, laps: 2 });
    newer.close();
  });

  it('does not have its log folded into it', () => {
    // The newer build crashed, or is still running: its last laps are only
    // in the log. A connection that could write would move them into the
    // file on closing, which is a change to a file this build may not make.
    const live = path.join(directory, 'live.db');
    const writer = buildVersion4Library(live);
    fs.copyFileSync(live, file);
    fs.copyFileSync(`${live}-wal`, `${file}-wal`);
    writer.close();
    const original = fs.readFileSync(file);
    const log = fs.readFileSync(`${file}-wal`);
    expect(log.length).toBeGreaterThan(0);

    const error = openError(() => new LapLibraryDatabase(file));

    expect(error.reason).toBe('newer');
    expect(fs.readFileSync(file).equals(original)).toBe(true);
    expect(fs.readFileSync(`${file}-wal`).equals(log)).toBe(true);
    expect(listing()).toEqual(['laps.db', 'live.db']);
  });

  it('leaves the library unavailable, with the reason, and records nothing', () => {
    buildVersion4Library(file).close();
    const original = fs.readFileSync(file);

    const host = createLapLibraryHost(file);

    expect(host.handle({ id: 1, method: 'status', args: [] })).toEqual({
      id: 1,
      result: {
        available: false,
        reason: 'newer',
        message: expect.stringMatching(/newer than this build/),
        schemaVersion: null,
        upgradedFrom: null,
        backupName: null,
      },
    });
    expect(
      host.handle({
        id: 2,
        method: 'recordLap',
        args: [lmuSession(), lap(86)],
      })
    ).toEqual({ id: 2, error: expect.stringMatching(/newer than this build/) });
    expect(host.handle({ id: 3, method: 'listSessions', args: [] })).toEqual({
      id: 3,
      error: expect.stringMatching(/newer than this build/),
    });
    expect(host.handle({ id: 4, method: 'close', args: [] })).toEqual({
      id: 4,
      result: true,
    });
    expect(fs.readFileSync(file).equals(original)).toBe(true);
  });
});

describe('a file that is not a lap library', () => {
  it('is refused as before, and neither changed nor copied', () => {
    const junk = Buffer.alloc(8192, 0x41);
    fs.writeFileSync(file, junk);

    const error = openError(() => new LapLibraryDatabase(file));

    expect(error.reason).toBe('unreadable');
    expect(fs.readFileSync(file).equals(junk)).toBe(true);
    expect(listing()).toEqual(['laps.db']);
    expect(
      createLapLibraryHost(file).handle({ id: 1, method: 'status', args: [] })
    ).toMatchObject({ result: { available: false, reason: 'unreadable' } });
  });
});

describe('the worker host', () => {
  it('reports an upgrade it made, and then serves the library', () => {
    const library = buildVersion1Library(file);

    const host = createLapLibraryHost(file);

    expect(host.handle({ id: 1, method: 'status', args: [] })).toEqual({
      id: 1,
      result: {
        available: true,
        reason: null,
        message: null,
        schemaVersion: 3,
        upgradedFrom: 1,
        backupName: 'laps.v1.bak.db',
      },
    });
    expect(host.handle({ id: 2, method: 'stats', args: [] })).toEqual({
      id: 2,
      result: { sessions: library.sessions, laps: library.laps },
    });
    host.handle({ id: 3, method: 'close', args: [] });
    expect(host.handle({ id: 4, method: 'stats', args: [] })).toEqual({
      id: 4,
      error: 'The lap library is closed',
    });
  });

  it('reports a failed upgrade as the reason the library is unavailable', () => {
    buildVersion1Library(file);

    const host = createLapLibraryHost(file, {
      migrations: [MIGRATIONS[0], failingHalfWay],
    });

    expect(host.handle({ id: 1, method: 'status', args: [] })).toMatchObject({
      result: { available: false, reason: 'upgrade' },
    });
    expect(host.handle({ id: 2, method: 'stats', args: [] })).toEqual({
      id: 2,
      error: expect.stringContaining('injected failure'),
    });
  });
});

describe('the cap on an upgraded library', () => {
  it('still drops the oldest laps first at 5,000, and the new tables follow', () => {
    expect(LAP_LIBRARY_MAX_LAPS).toBe(5000);
    const library = buildVersion1Library(file);
    const db = new LapLibraryDatabase(file);
    try {
      // 5,000 laps since the upgrade, each with its ledger row, at a track
      // of their own. The fourth is the quickest: that combination's
      // reference.
      const leMans = lmuSession({
        token: 'boot9:1',
        trackId: 1234,
        trackName: 'Circuit de la Sarthe',
      });
      stamp = T0 + 400 * 24 * 60 * MINUTE;
      const added: number[] = [];
      for (let index = 0; index < LAP_LIBRARY_MAX_LAPS; index += 1) {
        const recorded = db.recordLap(
          leMans,
          lap(index === 3 ? 199 : 205 + (index % 9), {
            lapNumber: index + 1,
            curve: curve(205, 4),
            ledger: ledgerFor(index),
          })
        );
        expect(recorded.ledgerError).toBeNull();
        added.push(recorded.lapId);
      }
      expect(db.stats().laps).toBe(LAP_LIBRARY_MAX_LAPS + library.laps);
      expect(countRows(file, 'stint')).toBe(LAP_LIBRARY_MAX_LAPS / 2);

      const removed = db.prune(LAP_LIBRARY_MAX_LAPS);

      // As many as it was over by.
      expect(removed).toBe(library.laps);
      expect(db.stats().laps).toBe(LAP_LIBRARY_MAX_LAPS);
      // The version 1 laps were the oldest, so they went first: all but the
      // references, which are never dropped.
      const keptOld = [
        library.quickestLmuLapId,
        library.pinnedLapId,
        library.quickestIracingLapId,
        library.nordschleifeLapId,
      ].sort((a, b) => a - b);
      const survivors = db
        .listSessions()
        .flatMap((session) => db.listLaps(session.id))
        .map((row) => row.id)
        .filter((id) => id < added[0]);
      expect(survivors.sort((a, b) => a - b)).toEqual(keptOld);
      // Ten old laps went; the other four were the oldest of the new ones,
      // passing over the reference.
      const leMansLaps = db
        .listLaps(db.listSessions()[0].id)
        .map((row) => row.id);
      expect(leMansLaps.slice(0, 3)).toEqual([added[3], added[5], added[6]]);
      expect(leMansLaps).toHaveLength(LAP_LIBRARY_MAX_LAPS - 4);

      // The ledger rows went with their laps, and only theirs.
      expect(countRows(file, 'lap_ledger')).toBe(LAP_LIBRARY_MAX_LAPS - 4);
      expect(
        countRows(file, 'lap_ledger', 'lap_id NOT IN (SELECT id FROM lap)')
      ).toBe(0);
      // The first stint lost both its laps and went. The second kept the
      // reference lap, the third its second lap: both stay.
      const stints = db
        .listStints(db.listSessions()[0].id)
        .map((stint) => stint.id);
      expect(stints.slice(0, 2)).toEqual(['boot9:1:2', 'boot9:1:3']);
      expect(stints).toHaveLength(LAP_LIBRARY_MAX_LAPS / 2 - 1);
      expect(
        countRows(
          file,
          'stint',
          'NOT EXISTS (SELECT 1 FROM lap_ledger WHERE stint_id = stint.id)'
        )
      ).toBe(0);
      // Sessions are still only ever dropped when empty.
      expect(db.stats().sessions).toBe(library.sessions + 1);
      // At the cap, nothing more goes.
      expect(db.prune(LAP_LIBRARY_MAX_LAPS)).toBe(0);
    } finally {
      db.close();
    }
  }, 60_000);
});

describe.skipIf(!SAMPLE_FOLDER || !fs.existsSync(SAMPLE_FOLDER))(
  'a library taken from a real installation',
  () => {
    it('is upgraded with everything in it, and backed up', () => {
      // A copy of the folder, so the sample itself is never opened.
      const folder = path.join(directory, 'sample');
      fs.cpSync(SAMPLE_FOLDER, folder, { recursive: true });
      const sample = path.join(folder, 'laps.db');
      const original = fs.readFileSync(sample);
      const hadLog =
        (fs.statSync(`${sample}-wal`, { throwIfNoEntry: false })?.size ?? 0) >
        0;
      const found = readSchemaVersion(sample);
      const before = dump(sample);
      const schemaBefore = schemaOf(sample, VERSION_1_TABLES);

      // What is in the field is what the first step of the ladder makes.
      expect(found).toBe(1);
      const fresh = path.join(directory, 'fresh.db');
      new LapLibraryDatabase(fresh, { migrations: VERSION_1_ONLY }).close();
      expect(schemaOf(sample)).toEqual(schemaOf(fresh));

      const opened = openAndClose(sample);

      expect(opened).toEqual({
        schemaVersion: SCHEMA_VERSION,
        upgradedFrom: 1,
        backupName: 'laps.v1.bak.db',
      });
      expect(readSchemaVersion(sample)).toBe(SCHEMA_VERSION);
      expect(dump(sample)).toEqual(before);
      expect(schemaOf(sample, VERSION_1_TABLES)).toEqual(schemaBefore);
      // It ends up as a library made by this build is.
      openAndClose(file);
      expect(schemaOf(sample)).toEqual(schemaOf(file));
      const backup = path.join(folder, 'laps.v1.bak.db');
      expect(readSchemaVersion(backup)).toBe(1);
      expect(dump(backup)).toEqual(before);
      // With no log to fold in, the copy is the file to the byte.
      if (!hadLog) expect(fs.readFileSync(backup).equals(original)).toBe(true);
      // And it goes on to work as a library.
      const db = new LapLibraryDatabase(sample);
      db.recordLap(lmuSession(), lap(86.512));
      expect(db.stats().laps).toBe(before.lap.length + 1);
      db.close();
    });
  }
);
