import { DatabaseSync, type StatementSync } from 'node:sqlite';
import type {
  LapInput,
  LapLibraryLap,
  LapLibrarySession,
  LapLibraryStats,
  LapSessionInput,
  StoredReferenceLap,
} from '../../../types/lapLibrary';

/**
 * The lap library's database: sessions, the laps driven in them, and which
 * lap the delta's all-time reference is.
 *
 * Every call here is synchronous, because that is the only API the built-in
 * SQLite has. It is meant to be driven from the worker thread in worker.ts,
 * never from the main process loop, where a disk that stalls for a moment
 * would stall every overlay with it.
 */

/** How long after its last lap a session can still be rejoined. */
const SESSION_REJOIN_MS = 12 * 60 * 60 * 1000;

const SCHEMA_VERSION = 1;

// AUTOINCREMENT, so an id is never handed out twice: a page still holding
// the id of a deleted session must not find a different one under it.
const SCHEMA = `
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

const flag = (value: boolean): number => (value ? 1 : 0);

const blobOf = (values: Float32Array | null): Uint8Array | null =>
  values
    ? new Uint8Array(values.buffer, values.byteOffset, values.byteLength)
    : null;

/** A copy, so the floats are aligned and nothing points into SQLite's buffer. */
const floatsOf = (blob: unknown): Float32Array | null => {
  if (!(blob instanceof Uint8Array) || blob.byteLength % 4 !== 0) return null;
  return new Float32Array(
    blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength)
  );
};

/** A lap is fit to be a reference only if nothing about it is in doubt. */
export const isEligibleLap = (lap: LapInput): boolean =>
  lap.complete &&
  lap.curve !== null &&
  !lap.pit &&
  !lap.voided &&
  lap.own &&
  (lap.incidents === null || lap.incidents === 0);

type Row = Record<string, unknown>;

const sessionOf = (row: Row): LapLibrarySession => ({
  id: row.id as number,
  simulator: row.simulator as string,
  startedAt: row.started_at as number,
  trackId: row.track_id as number,
  trackName: row.track_name as string,
  trackConfig: (row.track_config as string | null) ?? null,
  trackLengthM: row.track_length_m as number,
  carKey: row.car_key as string,
  carName: row.car_name as string,
  sessionType: (row.session_type as string | null) ?? null,
  sessionName: (row.session_name as string | null) ?? null,
  lapCount: row.lap_count as number,
  bestLapTime: (row.best_lap_time as number | null) ?? null,
});

export class LapLibraryDatabase {
  private readonly db: DatabaseSync;
  private readonly statements = new Map<string, StatementSync>();

  /** @param file A path, or ':memory:' for a database that is not kept. */
  constructor(file: string) {
    this.db = new DatabaseSync(file);
    // Write-ahead logging with NORMAL sync: a commit is appended to the log
    // without waiting for the disk, which is what makes a lap cost a tenth of
    // a millisecond. A power cut can lose the last laps, never corrupt the
    // file.
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA synchronous = NORMAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    try {
      this.migrate();
    } catch (error) {
      // Left open, the handle would keep the file locked for as long as the
      // process lives.
      this.db.close();
      throw error;
    }
  }

  close(): void {
    this.statements.clear();
    this.db.close();
  }

  /**
   * Stores a lap, creating its session's row with the first one. Returns the
   * ids, and whether the lap is fit to be a reference.
   */
  recordLap(
    session: LapSessionInput,
    lap: LapInput
  ): { sessionId: number; lapId: number; eligible: boolean } {
    const eligible = isEligibleLap(lap);
    this.db.exec('BEGIN');
    try {
      const sessionId = this.sessionRow(session, lap.completedAt);
      const curve = lap.complete ? lap.curve : null;
      const result = this.statement(
        `INSERT INTO lap (
           session_id, lap_number, lap_time, completed_at, complete, pit,
           voided, own, incidents, eligible, fuel_used, energy_used, air_temp,
           track_temp, points_count, interval, point_pos, times, speeds
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        sessionId,
        lap.lapNumber,
        lap.lapTime,
        lap.completedAt,
        flag(lap.complete && curve !== null),
        flag(lap.pit),
        flag(lap.voided),
        flag(lap.own),
        lap.incidents,
        flag(eligible),
        lap.fuelUsed,
        lap.energyUsed,
        lap.airTemp,
        lap.trackTemp,
        curve ? curve.pointPos.length : null,
        curve ? curve.interval : null,
        blobOf(curve ? curve.pointPos : null),
        blobOf(curve ? curve.times : null),
        blobOf(curve ? curve.speedsKph : null)
      );
      this.statement('UPDATE session SET last_lap_at = ? WHERE id = ?').run(
        lap.completedAt,
        sessionId
      );
      this.db.exec('COMMIT');
      return { sessionId, lapId: Number(result.lastInsertRowid), eligible };
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /** Sessions, most recent first, each with its lap count and best lap. */
  listSessions(limit = 200, offset = 0): LapLibrarySession[] {
    const rows = this.statement(
      `SELECT s.*,
              count(l.id) AS lap_count,
              min(
                CASE WHEN l.complete = 1 AND l.voided = 0 THEN l.lap_time END
              ) AS best_lap_time
         FROM session s
         LEFT JOIN lap l ON l.session_id = s.id
        GROUP BY s.id
        ORDER BY s.started_at DESC, s.id DESC
        LIMIT ? OFFSET ?`
    ).all(Math.max(1, Math.min(limit, 1000)), Math.max(0, offset)) as Row[];
    return rows.map(sessionOf);
  }

  /** A session's laps in the order they were driven. */
  listLaps(sessionId: number): LapLibraryLap[] {
    const session = this.statement(
      'SELECT simulator, track_id, car_key FROM session WHERE id = ?'
    ).get(sessionId) as Row | undefined;
    if (!session) return [];
    const reference = this.referenceLapId(
      session.simulator as string,
      session.track_id as number,
      session.car_key as string
    );
    const rows = this.statement(
      `SELECT id, session_id, lap_number, lap_time, completed_at, complete,
              pit, voided, own, incidents, eligible, fuel_used, energy_used,
              air_temp, track_temp
         FROM lap
        WHERE session_id = ?
        ORDER BY completed_at, id`
    ).all(sessionId) as Row[];
    return rows.map((row) => ({
      id: row.id as number,
      sessionId: row.session_id as number,
      lapNumber: (row.lap_number as number | null) ?? null,
      lapTime: row.lap_time as number,
      completedAt: row.completed_at as number,
      complete: row.complete === 1,
      pit: row.pit === 1,
      voided: row.voided === 1,
      own: row.own === 1,
      incidents: (row.incidents as number | null) ?? null,
      eligible: row.eligible === 1,
      fuelUsed: (row.fuel_used as number | null) ?? null,
      energyUsed: (row.energy_used as number | null) ?? null,
      airTemp: (row.air_temp as number | null) ?? null,
      trackTemp: (row.track_temp as number | null) ?? null,
      isReference: reference?.lapId === row.id,
      isPinned: reference?.lapId === row.id && reference?.pinned === true,
    }));
  }

  deleteLap(lapId: number): boolean {
    const session = this.statement(
      'SELECT session_id FROM lap WHERE id = ?'
    ).get(lapId) as Row | undefined;
    if (!session) return false;
    // Together or not at all: the lap gone and its session left behind with
    // none would be listed as an empty session.
    this.db.exec('BEGIN');
    try {
      this.statement('DELETE FROM lap WHERE id = ?').run(lapId);
      // A session with no laps left is nothing to list.
      this.statement(
        `DELETE FROM session
          WHERE id = ? AND NOT EXISTS (SELECT 1 FROM lap WHERE session_id = ?)`
      ).run(session.session_id as number, session.session_id as number);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return true;
  }

  deleteSession(sessionId: number): boolean {
    const result = this.statement('DELETE FROM session WHERE id = ?').run(
      sessionId
    );
    return Number(result.changes) > 0;
  }

  /**
   * Makes a lap the reference for its track and car. Only a lap with a curve
   * can be one; it need not be eligible, since choosing it by hand is the
   * player saying it counts.
   */
  pinReference(lapId: number): boolean {
    const row = this.statement(
      `SELECT s.simulator, s.track_id, s.car_key, l.complete
         FROM lap l JOIN session s ON s.id = l.session_id
        WHERE l.id = ?`
    ).get(lapId) as Row | undefined;
    if (!row || row.complete !== 1) return false;
    this.statement(
      `INSERT INTO reference_pin (simulator, track_id, car_key, lap_id)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (simulator, track_id, car_key)
       DO UPDATE SET lap_id = excluded.lap_id`
    ).run(
      row.simulator as string,
      row.track_id as number,
      row.car_key as string,
      lapId
    );
    return true;
  }

  /** Removes the pin on that lap's track and car, whichever lap holds it. */
  unpinReference(lapId: number): boolean {
    const row = this.statement(
      `SELECT s.simulator, s.track_id, s.car_key
         FROM lap l JOIN session s ON s.id = l.session_id
        WHERE l.id = ?`
    ).get(lapId) as Row | undefined;
    if (!row) return false;
    const result = this.statement(
      `DELETE FROM reference_pin
        WHERE simulator = ? AND track_id = ? AND car_key = ?`
    ).run(
      row.simulator as string,
      row.track_id as number,
      row.car_key as string
    );
    return Number(result.changes) > 0;
  }

  /**
   * The lap the delta's all-time reference is for a track and car: the one
   * pinned by hand, otherwise the quickest eligible lap.
   *
   * @param pointsCount When given, only a lap with that many points will do.
   *   A lap recorded against a different track length has a different number
   *   and cannot be read at this one's distances.
   */
  referenceLap(
    simulator: string,
    trackId: number,
    carKey: string,
    pointsCount?: number
  ): StoredReferenceLap | null {
    const found = this.referenceLapId(simulator, trackId, carKey, pointsCount);
    if (!found) return null;
    const row = this.statement(
      `SELECT lap_time, interval, point_pos, times, speeds
         FROM lap WHERE id = ?`
    ).get(found.lapId) as Row | undefined;
    const pointPos = floatsOf(row?.point_pos);
    const times = floatsOf(row?.times);
    if (!row || !pointPos || !times || pointPos.length !== times.length) {
      return null;
    }
    return {
      lapId: found.lapId,
      lapTime: row.lap_time as number,
      pinned: found.pinned,
      curve: {
        interval: row.interval as number,
        pointPos,
        times,
        speedsKph: floatsOf(row.speeds),
      },
    };
  }

  stats(): LapLibraryStats {
    const row = this.statement(
      `SELECT (SELECT count(*) FROM session) AS sessions,
              (SELECT count(*) FROM lap) AS laps`
    ).get() as Row;
    return { sessions: row.sessions as number, laps: row.laps as number };
  }

  /**
   * Keeps the library to `maxLaps`, dropping the oldest laps first. A lap
   * that is a reference -- pinned, or the quickest eligible one for its track
   * and car -- is never dropped: it is the one lap of its kind worth more
   * than its age. Returns how many laps went.
   */
  prune(maxLaps: number): number {
    const { laps } = this.stats();
    const excess = laps - maxLaps;
    if (excess <= 0) return 0;
    const result = this.statement(
      `DELETE FROM lap
        WHERE id IN (
          SELECT l.id
            FROM lap l JOIN session s ON s.id = l.session_id
           WHERE l.id NOT IN (SELECT lap_id FROM reference_pin)
             AND l.id NOT IN (
               SELECT b.id FROM lap b JOIN session bs ON bs.id = b.session_id
                WHERE b.eligible = 1
                  AND bs.simulator = s.simulator
                  AND bs.track_id = s.track_id
                  AND bs.car_key = s.car_key
                ORDER BY b.lap_time, b.id
                LIMIT 1
             )
           ORDER BY l.completed_at, l.id
           LIMIT ?
        )`
    ).run(excess);
    this.db.exec(
      `DELETE FROM session
        WHERE NOT EXISTS (SELECT 1 FROM lap WHERE lap.session_id = session.id)`
    );
    return Number(result.changes);
  }

  /** Which lap is the reference for a track and car, and whether by hand. */
  private referenceLapId(
    simulator: string,
    trackId: number,
    carKey: string,
    pointsCount?: number
  ): { lapId: number; pinned: boolean } | null {
    const pinned = this.statement(
      `SELECT l.id, l.points_count
         FROM reference_pin p JOIN lap l ON l.id = p.lap_id
        WHERE p.simulator = ? AND p.track_id = ? AND p.car_key = ?`
    ).get(simulator, trackId, carKey) as Row | undefined;
    if (
      pinned &&
      (pointsCount === undefined || pinned.points_count === pointsCount)
    ) {
      return { lapId: pinned.id as number, pinned: true };
    }
    const quickest = (
      pointsCount === undefined
        ? this.statement(
            `SELECT l.id
               FROM lap l JOIN session s ON s.id = l.session_id
              WHERE l.eligible = 1
                AND s.simulator = ? AND s.track_id = ? AND s.car_key = ?
              ORDER BY l.lap_time, l.id
              LIMIT 1`
          ).get(simulator, trackId, carKey)
        : this.statement(
            `SELECT l.id
               FROM lap l JOIN session s ON s.id = l.session_id
              WHERE l.eligible = 1 AND l.points_count = ?
                AND s.simulator = ? AND s.track_id = ? AND s.car_key = ?
              ORDER BY l.lap_time, l.id
              LIMIT 1`
          ).get(pointsCount, simulator, trackId, carKey)
    ) as Row | undefined;
    return quickest ? { lapId: quickest.id as number, pinned: false } : null;
  }

  /** The row a lap's session is kept in, made or rejoined as needed. */
  private sessionRow(session: LapSessionInput, now: number): number {
    const known = this.statement('SELECT id FROM session WHERE token = ?').get(
      session.token
    ) as Row | undefined;
    if (known) return known.id as number;

    // The same session of the sim, seen again after the app was restarted:
    // carry on in its row rather than list it twice.
    if (session.sessionKey !== '') {
      const earlier = this.statement(
        `SELECT id FROM session
          WHERE simulator = ? AND session_key = ? AND track_id = ?
            AND car_key = ? AND last_lap_at >= ?
          ORDER BY last_lap_at DESC
          LIMIT 1`
      ).get(
        session.simulator,
        session.sessionKey,
        session.trackId,
        session.carKey,
        now - SESSION_REJOIN_MS
      ) as Row | undefined;
      if (earlier) {
        this.statement('UPDATE session SET token = ? WHERE id = ?').run(
          session.token,
          earlier.id as number
        );
        return earlier.id as number;
      }
    }

    const result = this.statement(
      `INSERT INTO session (
         token, simulator, session_key, started_at, last_lap_at, track_id,
         track_name, track_config, track_length_m, car_key, car_name,
         session_type, session_name
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      session.token,
      session.simulator,
      session.sessionKey,
      now,
      now,
      session.trackId,
      session.trackName,
      session.trackConfig,
      session.trackLengthM,
      session.carKey,
      session.carName,
      session.sessionType,
      session.sessionName
    );
    return Number(result.lastInsertRowid);
  }

  private migrate(): void {
    const { user_version: version } = this.db
      .prepare('PRAGMA user_version')
      .get() as { user_version: number };
    if (version === SCHEMA_VERSION) return;
    if (version > SCHEMA_VERSION) {
      // Written by a newer build. Reading it with this schema would be
      // guessing, and writing to it could damage it.
      throw new Error(
        `Lap library schema ${version} is newer than this build understands (${SCHEMA_VERSION})`
      );
    }
    this.db.exec('BEGIN');
    try {
      this.db.exec(SCHEMA);
      this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /** Statements are prepared once and kept: the same few run for every lap. */
  private statement(sql: string): StatementSync {
    let statement = this.statements.get(sql);
    if (!statement) {
      statement = this.db.prepare(sql);
      this.statements.set(sql, statement);
    }
    return statement;
  }
}
