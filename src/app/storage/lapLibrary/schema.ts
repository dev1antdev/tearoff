import type { DatabaseSync } from 'node:sqlite';

/**
 * The lap library's schema, as a ladder: one step from each version to the
 * next. A file is brought from the version it is at to the top by running
 * the steps above it, in order (see upgrade.ts for how).
 *
 * The rules, because the file is the player's own laps and a careless step
 * loses them:
 *
 * - A step that has shipped is never edited. Files in the field were made by
 *   it, and the next step up is written against what it left. A change to
 *   the schema is a new step at the end.
 * - A step says only how to get from `from` to `to`. The runner owns the
 *   transaction, the version number and the backup: a step must not BEGIN,
 *   COMMIT or ROLLBACK, set `user_version`, or change a pragma.
 * - Steps run with foreign keys not enforced, so that a table can be rebuilt
 *   without SQLite deleting the rows that point at it. The runner refuses to
 *   commit an upgrade that leaves a reference dangling.
 * - Anything a step fails at undoes the whole upgrade, earlier steps
 *   included: a file is at the version it was found at or at the top, never
 *   in between.
 */
export interface Migration {
  /** The version a file must be at for the step to run. */
  from: number;
  /** The version it leaves the file at: always `from + 1`. */
  to: number;
  /** What the step adds, for whoever reads the log. */
  summary: string;
  up(db: DatabaseSync): void;
}

// AUTOINCREMENT, so an id is never handed out twice: a page still holding
// the id of a deleted session must not find a different one under it.
const VERSION_1 = `
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
  CREATE INDEX session_started ON session (started_at DESC);
  CREATE INDEX session_identity ON session (simulator, track_id, car_key);

  CREATE TABLE lap (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES session (id) ON DELETE CASCADE,
    lap_number INTEGER,
    lap_time REAL NOT NULL,
    completed_at INTEGER NOT NULL,
    complete INTEGER NOT NULL,
    pit INTEGER NOT NULL,
    voided INTEGER NOT NULL,
    own INTEGER NOT NULL,
    incidents INTEGER,
    eligible INTEGER NOT NULL,
    fuel_used REAL,
    energy_used REAL,
    air_temp REAL,
    track_temp REAL,
    points_count INTEGER,
    interval REAL,
    point_pos BLOB,
    times BLOB,
    speeds BLOB
  );
  CREATE INDEX lap_session ON lap (session_id, completed_at);
  CREATE INDEX lap_eligible ON lap (eligible, lap_time);

  CREATE TABLE reference_pin (
    simulator TEXT NOT NULL,
    track_id INTEGER NOT NULL,
    car_key TEXT NOT NULL,
    lap_id INTEGER NOT NULL REFERENCES lap (id) ON DELETE CASCADE,
    PRIMARY KEY (simulator, track_id, car_key)
  );
`;

// The stints the player's car ran, and what each lap cost.
//
// A stint belongs to its session and goes with it. Its service columns,
// from pit_lane_time to sim_estimate, are all null unless a service ended
// it: stop_time is the one that is never null on a stop, so it says whether
// there was one. Wheel columns are in the order LF, RF, LR, RR.
//
// A ledger row is the rest of what is known about one lap, in a table of
// its own so that the one holding the curves is not altered. It goes with
// its lap. Its stint is a link, not an owner: the row outlives the stint.
const VERSION_2 = `
  CREATE TABLE stint (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    session_id INTEGER NOT NULL REFERENCES session (id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL,
    session_num INTEGER,
    driver TEXT,
    own INTEGER NOT NULL,
    opened_by TEXT NOT NULL,
    closed_by TEXT,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    start_time REAL NOT NULL,
    end_time REAL,
    start_lap INTEGER NOT NULL,
    end_lap INTEGER,
    laps INTEGER NOT NULL,
    start_fuel REAL,
    end_fuel REAL,
    start_energy REAL,
    end_energy REAL,
    start_tread_lf REAL,
    start_tread_rf REAL,
    start_tread_lr REAL,
    start_tread_rr REAL,
    end_tread_lf REAL,
    end_tread_rf REAL,
    end_tread_lr REAL,
    end_tread_rr REAL,
    start_brake_lf REAL,
    start_brake_rf REAL,
    start_brake_lr REAL,
    start_brake_rr REAL,
    end_brake_lf REAL,
    end_brake_rf REAL,
    end_brake_lr REAL,
    end_brake_rr REAL,
    compound_lf TEXT,
    compound_rf TEXT,
    compound_lr TEXT,
    compound_rr TEXT,
    best_lap REAL,
    avg_lap REAL,
    clean_laps INTEGER NOT NULL,
    pit_lane_time REAL,
    stop_time REAL,
    fuel_added REAL,
    energy_added REAL,
    tyres_changed INTEGER,
    brakes_changed INTEGER,
    driver_changed INTEGER,
    sim_estimate REAL,
    passes TEXT NOT NULL
  );
  CREATE INDEX stint_session ON stint (session_id, started_at);

  CREATE TABLE lap_ledger (
    lap_id INTEGER PRIMARY KEY REFERENCES lap (id) ON DELETE CASCADE,
    stint_id INTEGER REFERENCES stint (id) ON DELETE SET NULL,
    session_num INTEGER,
    stint_lap INTEGER NOT NULL,
    start_time REAL NOT NULL,
    end_time REAL NOT NULL,
    sim_lap_time REAL,
    flags INTEGER NOT NULL,
    fuel_at_line REAL,
    fuel_added REAL NOT NULL,
    energy_at_line REAL,
    energy_added REAL NOT NULL,
    tread_lf REAL,
    tread_rf REAL,
    tread_lr REAL,
    tread_rr REAL,
    tread_used_lf REAL,
    tread_used_rf REAL,
    tread_used_lr REAL,
    tread_used_rr REAL,
    brake_lf REAL,
    brake_rf REAL,
    brake_lr REAL,
    brake_rr REAL,
    brake_used_lf REAL,
    brake_used_rf REAL,
    brake_used_lr REAL,
    brake_used_rr REAL,
    compound_lf TEXT,
    compound_rf TEXT,
    compound_lr TEXT,
    compound_rr TEXT,
    s1 REAL,
    s2 REAL,
    s3 REAL,
    wetness INTEGER NOT NULL,
    rain REAL NOT NULL,
    position INTEGER,
    class_position INTEGER
  );
  CREATE INDEX lap_ledger_stint ON lap_ledger (stint_id);
`;

// The history of a race: every lap of every car, the stints each car ran
// and its driver changes. Nothing of the player's own laps is touched:
// these are four tables of their own, and a race goes with every row of it.
//
// A race is one session of one event. `token` names the run of the app that
// began it, and a race carried on after a restart keeps its row.
// `session_key` is the sim's own id for the session where that names one
// event, '' where it does not. `entries` and `tyres` are JSON: the cars in
// the slots, by which a race is known again, and what each compound index
// is called.
//
// A lap, a stint and a driver change are each one row per car and number,
// so writing one again replaces it: a lap is written when it is completed
// and again if its time comes late. They are tables without a rowid, as
// nothing refers to their rows and each is read by its key.
//
// `lap_time` is null for a lap the sim gave no time; `flags` holds the
// ledger's LEDGER_LAP_* bits. A stint's stop columns are all null unless a
// stop ended it: `stop_standing_time` is the one that is never null on a
// stop, so it says whether there was one.
const VERSION_3 = `
  CREATE TABLE race (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT NOT NULL UNIQUE,
    simulator TEXT NOT NULL,
    session_key TEXT NOT NULL,
    session_num INTEGER,
    session_type TEXT,
    session_name TEXT,
    track_id INTEGER NOT NULL,
    track_name TEXT NOT NULL,
    track_config TEXT,
    track_length_m REAL NOT NULL,
    started_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    session_time REAL NOT NULL,
    entries TEXT NOT NULL,
    tyres TEXT NOT NULL
  );
  CREATE INDEX race_updated ON race (updated_at DESC);
  CREATE INDEX race_identity ON race (simulator, track_id, session_type);

  CREATE TABLE race_lap (
    race_id INTEGER NOT NULL REFERENCES race (id) ON DELETE CASCADE,
    car_idx INTEGER NOT NULL,
    lap INTEGER NOT NULL,
    session_time REAL NOT NULL,
    lap_time REAL,
    s1 REAL,
    s2 REAL,
    s3 REAL,
    position INTEGER,
    class_position INTEGER,
    class_gap REAL,
    flags INTEGER NOT NULL,
    driver TEXT NOT NULL,
    energy REAL,
    energy_virtual INTEGER NOT NULL,
    compound_lf INTEGER NOT NULL,
    compound_rf INTEGER NOT NULL,
    compound_lr INTEGER NOT NULL,
    compound_rr INTEGER NOT NULL,
    PRIMARY KEY (race_id, car_idx, lap)
  ) WITHOUT ROWID;

  CREATE TABLE race_stint (
    race_id INTEGER NOT NULL REFERENCES race (id) ON DELETE CASCADE,
    car_idx INTEGER NOT NULL,
    ordinal INTEGER NOT NULL,
    driver TEXT NOT NULL,
    opened_by TEXT NOT NULL,
    closed_by TEXT,
    first_lap INTEGER,
    last_lap INTEGER,
    start_time REAL NOT NULL,
    end_time REAL,
    laps INTEGER NOT NULL,
    clean_laps INTEGER NOT NULL,
    avg_lap REAL,
    best_lap REAL,
    stop_lane_time REAL,
    stop_standing_time REAL,
    stop_driver_changed INTEGER,
    PRIMARY KEY (race_id, car_idx, ordinal)
  ) WITHOUT ROWID;

  CREATE TABLE race_driver_change (
    race_id INTEGER NOT NULL REFERENCES race (id) ON DELETE CASCADE,
    car_idx INTEGER NOT NULL,
    seq INTEGER NOT NULL,
    session_time REAL NOT NULL,
    lap INTEGER NOT NULL,
    from_driver TEXT NOT NULL,
    to_driver TEXT NOT NULL,
    at_stop INTEGER NOT NULL,
    PRIMARY KEY (race_id, car_idx, seq)
  ) WITHOUT ROWID;
`;

/** Every step there has ever been, lowest first. Add to the end only. */
export const MIGRATIONS: readonly Migration[] = [
  {
    from: 0,
    to: 1,
    summary: 'sessions, their laps, and the pinned reference lap',
    up: (db) => db.exec(VERSION_1),
  },
  {
    from: 1,
    to: 2,
    summary: 'stints and the per-lap ledger',
    up: (db) => db.exec(VERSION_2),
  },
  {
    from: 2,
    to: 3,
    summary: 'the history of a race: the laps, stints and drivers of every car',
    up: (db) => db.exec(VERSION_3),
  },
];

/** The version this build reads and writes. */
export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].to;
