import type { DatabaseSync, SQLInputValue, StatementSync } from 'node:sqlite';
import type {
  LapInput,
  LapLedgerFields,
  LapLedgerInput,
  LapLibraryLap,
  LapLibrarySession,
  LapLibraryStats,
  LapLibraryStint,
  LapSessionInput,
  StintInput,
  StoredReferenceLap,
} from '../../../types/lapLibrary';
import type {
  LedgerPass,
  LedgerStint,
  LedgerStop,
  StintClosedBy,
  StintOpenedBy,
} from '../../../types/ledger';
import { MIGRATIONS, type Migration } from './schema';
import { openLapLibraryFile, type OpenOutcome } from './upgrade';

/**
 * The lap library's database: sessions, the laps driven in them, which lap
 * the delta's all-time reference is, the stints the car ran and what each
 * lap cost.
 *
 * Every call here is synchronous, because that is the only API the built-in
 * SQLite has. It is meant to be driven from the worker thread in worker.ts,
 * never from the main process loop, where a disk that stalls for a moment
 * would stall every overlay with it.
 *
 * What goes with what:
 * - A session goes when its last lap does, and takes its stints with it.
 * - A lap takes its ledger row with it, and its pin if it had one.
 * - A stint goes when the last lap driven in it does: deleted by hand or
 *   dropped by the cap. A stint is otherwise never deleted for being old;
 *   the cap counts laps, and stints follow their laps.
 */

/** How long after its last lap a session can still be rejoined. */
const SESSION_REJOIN_MS = 12 * 60 * 60 * 1000;

/** The most pit lane visits kept on a stint; the latest are the ones kept. */
const MAX_STINT_PASSES = 10;

const OPENED_BY: readonly StintOpenedBy[] = ['pitExit', 'green', 'joined'];
const CLOSED_BY: readonly StintClosedBy[] = [
  'service',
  'garage',
  'driver',
  'session',
  'disconnect',
];

/** The order every per-wheel list and group of columns is in. */
const WHEELS = ['lf', 'rf', 'lr', 'rr'] as const;
type Wheel = (typeof WHEELS)[number];

const wheelColumns = <Prefix extends string>(prefix: Prefix) =>
  WHEELS.map((wheel) => `${prefix}_${wheel}` as const);

// The columns a write sets, by name. The statements and the values bound to
// them are both built from these lists, so a value cannot land in the
// neighbouring column.
const STINT_COLUMNS = [
  'ordinal',
  'session_num',
  'driver',
  'own',
  'opened_by',
  'closed_by',
  'ended_at',
  'start_time',
  'end_time',
  'start_lap',
  'end_lap',
  'laps',
  'start_fuel',
  'end_fuel',
  'start_energy',
  'end_energy',
  ...wheelColumns('start_tread'),
  ...wheelColumns('end_tread'),
  ...wheelColumns('start_brake'),
  ...wheelColumns('end_brake'),
  ...wheelColumns('compound'),
  'best_lap',
  'avg_lap',
  'clean_laps',
  'pit_lane_time',
  'stop_time',
  'fuel_added',
  'energy_added',
  'tyres_changed',
  'brakes_changed',
  'driver_changed',
  'sim_estimate',
  'passes',
] as const;

const LEDGER_COLUMNS = [
  'session_num',
  'stint_lap',
  'start_time',
  'end_time',
  'sim_lap_time',
  'flags',
  'fuel_at_line',
  'fuel_added',
  'energy_at_line',
  'energy_added',
  ...wheelColumns('tread'),
  ...wheelColumns('tread_used'),
  ...wheelColumns('brake'),
  ...wheelColumns('brake_used'),
  ...wheelColumns('compound'),
  's1',
  's2',
  's3',
  'wetness',
  'rain',
  'position',
  'class_position',
] as const;

type ColumnValues<Column extends string> = Record<Column, SQLInputValue>;

const named = (columns: readonly string[]): string =>
  columns.map((column) => `:${column}`).join(', ');

// A stint that has been closed is never opened again by a write that
// arrives late: the closed record is the last word.
const UPSERT_STINT = `
  INSERT INTO stint (key, session_id, started_at, ${STINT_COLUMNS.join(', ')})
  VALUES (:key, :session_id, :started_at, ${named(STINT_COLUMNS)})
  ON CONFLICT (key) DO UPDATE SET
    ${STINT_COLUMNS.map((column) => `${column} = excluded.${column}`).join(', ')}
  WHERE stint.closed_by IS NULL OR excluded.closed_by IS NOT NULL`;

const INSERT_LEDGER = `
  INSERT INTO lap_ledger (lap_id, stint_id, ${LEDGER_COLUMNS.join(', ')})
  VALUES (:lap_id, :stint_id, ${named(LEDGER_COLUMNS)})`;

/** A lap's own columns, its ledger's, and the key of the stint it was in. */
const LAP_COLUMNS = `
  l.id, l.session_id, l.lap_number, l.lap_time, l.completed_at, l.complete,
  l.pit, l.voided, l.own, l.incidents, l.eligible, l.fuel_used,
  l.energy_used, l.air_temp, l.track_temp,
  g.lap_id AS ledger_lap_id,
  ${LEDGER_COLUMNS.map((column) => `g.${column}`).join(', ')},
  st.key AS stint_key`;

const LAP_JOINS = `
  LEFT JOIN lap_ledger g ON g.lap_id = l.id
  LEFT JOIN stint st ON st.id = g.stint_id`;

const flag = (value: boolean): number => (value ? 1 : 0);

/** A reading, or null for anything that is not one. */
const real = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/** A count or an index, or null for anything that is not one. */
const whole = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) ? value : null;

const text = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;

/** A per-wheel list as its four columns; a short list leaves the rest null. */
const perWheel = <Prefix extends string, Value extends SQLInputValue>(
  prefix: Prefix,
  values: readonly unknown[] | undefined,
  clean: (value: unknown) => Value | null
) =>
  Object.fromEntries(
    WHEELS.map((wheel, index) => [`${prefix}_${wheel}`, clean(values?.[index])])
  ) as Record<`${Prefix}_${Wheel}`, Value | null>;

type Row = Record<string, unknown>;

const nullable = <Value>(value: unknown): Value | null =>
  (value as Value | null | undefined) ?? null;

/** Four columns back as a per-wheel list. */
const wheelsOf = <Value>(row: Row, prefix: string): (Value | null)[] =>
  WHEELS.map((wheel) => nullable<Value>(row[`${prefix}_${wheel}`]));

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

/**
 * The two pace figures of a stint that have no column, because they follow
 * from the three that do: the mean of the clean laps other than the best,
 * less the best; and the best over that mean.
 */
export const stintPace = (
  bestLap: number | null,
  avgLap: number | null,
  cleanLaps: number
): Pick<LedgerStint, 'paceDelta' | 'consistency'> => {
  if (bestLap === null || avgLap === null || cleanLaps < 2) {
    return { paceDelta: null, consistency: null };
  }
  const others = (avgLap * cleanLaps - bestLap) / (cleanLaps - 1);
  if (!(others > 0)) return { paceDelta: null, consistency: null };
  return { paceDelta: others - bestLap, consistency: bestLap / others };
};

const passOf = (value: unknown): LedgerPass | null => {
  if (!value || typeof value !== 'object') return null;
  const stationaryTime = real((value as Row).stationaryTime);
  if (stationaryTime === null) return null;
  return { pitLaneTime: real((value as Row).pitLaneTime), stationaryTime };
};

const passesOf = (values: unknown): LedgerPass[] =>
  (Array.isArray(values) ? values : [])
    .map(passOf)
    .filter((pass): pass is LedgerPass => pass !== null)
    .slice(-MAX_STINT_PASSES);

/** The passes column back as a list; anything unreadable is no passes. */
const storedPasses = (stored: unknown): LedgerPass[] => {
  try {
    return passesOf(JSON.parse(String(stored)));
  } catch {
    return [];
  }
};

/** A stint has to say what it is before any of it is stored. */
const assertStint = (stint: LedgerStint): void => {
  if (typeof stint?.id !== 'string' || stint.id === '') {
    throw new TypeError('A stint needs an id');
  }
  if (!OPENED_BY.includes(stint.openedBy)) {
    throw new TypeError('A stint needs a known way of opening');
  }
  if (stint.closedBy !== null && !CLOSED_BY.includes(stint.closedBy)) {
    throw new TypeError('A closed stint needs a known way of closing');
  }
};

const stintValues = ({
  stint,
  endedAt,
}: StintInput): ColumnValues<(typeof STINT_COLUMNS)[number]> => {
  const stop = stint.stop;
  return {
    ordinal: whole(stint.ordinal),
    session_num: whole(stint.sessionNum),
    driver: text(stint.driver),
    own: flag(stint.own),
    opened_by: stint.openedBy,
    closed_by: stint.closedBy,
    ended_at: whole(endedAt),
    start_time: real(stint.startTime),
    end_time: real(stint.endTime),
    start_lap: whole(stint.startLap),
    end_lap: whole(stint.endLap),
    laps: whole(stint.laps),
    start_fuel: real(stint.startFuel),
    end_fuel: real(stint.endFuel),
    start_energy: real(stint.startEnergy),
    end_energy: real(stint.endEnergy),
    ...perWheel('start_tread', stint.startTread, real),
    ...perWheel('end_tread', stint.endTread, real),
    ...perWheel('start_brake', stint.startBrake, real),
    ...perWheel('end_brake', stint.endBrake, real),
    ...perWheel('compound', stint.compounds, text),
    best_lap: real(stint.bestLap),
    avg_lap: real(stint.avgLap),
    clean_laps: whole(stint.cleanLaps),
    pit_lane_time: stop ? real(stop.pitLaneTime) : null,
    // Never null on a stop: it is how a stop is told from none.
    stop_time: stop ? (real(stop.stationaryTime) ?? 0) : null,
    fuel_added: stop ? (real(stop.fuelAdded) ?? 0) : null,
    energy_added: stop ? (real(stop.energyAdded) ?? 0) : null,
    tyres_changed: stop ? (whole(stop.tyresChanged) ?? 0) : null,
    brakes_changed: stop ? flag(stop.brakesChanged) : null,
    driver_changed: stop ? flag(stop.driverChanged) : null,
    sim_estimate: stop ? real(stop.simEstimate) : null,
    passes: JSON.stringify(passesOf(stint.passes)),
  };
};

const ledgerValues = (
  ledger: LapLedgerInput
): ColumnValues<(typeof LEDGER_COLUMNS)[number]> => ({
  session_num: whole(ledger.sessionNum),
  stint_lap: whole(ledger.stintLap),
  start_time: real(ledger.startTime),
  end_time: real(ledger.endTime),
  sim_lap_time: real(ledger.simLapTime),
  flags: whole(ledger.flags),
  fuel_at_line: real(ledger.fuelAtLine),
  fuel_added: real(ledger.fuelAdded),
  energy_at_line: real(ledger.energyAtLine),
  energy_added: real(ledger.energyAdded),
  ...perWheel('tread', ledger.treadAtLine, real),
  ...perWheel('tread_used', ledger.treadUsed, real),
  ...perWheel('brake', ledger.brakeAtLine, real),
  ...perWheel('brake_used', ledger.brakeUsed, real),
  ...perWheel('compound', ledger.compounds, text),
  s1: real(ledger.sectors?.[0]),
  s2: real(ledger.sectors?.[1]),
  s3: real(ledger.sectors?.[2]),
  wetness: whole(ledger.wetness),
  rain: real(ledger.rain),
  position: whole(ledger.position),
  class_position: whole(ledger.classPosition),
});

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

/** The ledger half of a row read with LAP_COLUMNS; null for a lap without. */
const ledgerOf = (row: Row): LapLedgerFields | null => {
  if (nullable(row.ledger_lap_id) === null) return null;
  return {
    stintId: nullable<string>(row.stint_key),
    sessionNum: nullable<number>(row.session_num),
    stintLap: row.stint_lap as number,
    startTime: row.start_time as number,
    endTime: row.end_time as number,
    simLapTime: nullable<number>(row.sim_lap_time),
    flags: row.flags as number,
    fuelAtLine: nullable<number>(row.fuel_at_line),
    fuelAdded: row.fuel_added as number,
    energyAtLine: nullable<number>(row.energy_at_line),
    energyAdded: row.energy_added as number,
    treadAtLine: wheelsOf<number>(row, 'tread'),
    treadUsed: wheelsOf<number>(row, 'tread_used'),
    brakeAtLine: wheelsOf<number>(row, 'brake'),
    brakeUsed: wheelsOf<number>(row, 'brake_used'),
    compounds: wheelsOf<string>(row, 'compound'),
    sectors: [
      nullable<number>(row.s1),
      nullable<number>(row.s2),
      nullable<number>(row.s3),
    ],
    wetness: row.wetness as number,
    rain: row.rain as number,
    position: nullable<number>(row.position),
    classPosition: nullable<number>(row.class_position),
  };
};

const lapOf = (
  row: Row,
  reference: { lapId: number; pinned: boolean } | null
): LapLibraryLap => ({
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
  ledger: ledgerOf(row),
});

const stopOf = (row: Row): LedgerStop | null =>
  nullable(row.stop_time) === null
    ? null
    : {
        pitLaneTime: nullable<number>(row.pit_lane_time),
        stationaryTime: row.stop_time as number,
        fuelAdded: nullable<number>(row.fuel_added) ?? 0,
        energyAdded: nullable<number>(row.energy_added) ?? 0,
        tyresChanged: nullable<number>(row.tyres_changed) ?? 0,
        brakesChanged: row.brakes_changed === 1,
        driverChanged: row.driver_changed === 1,
        simEstimate: nullable<number>(row.sim_estimate),
      };

const stintOf = (row: Row): LapLibraryStint => {
  const bestLap = nullable<number>(row.best_lap);
  const avgLap = nullable<number>(row.avg_lap);
  const cleanLaps = row.clean_laps as number;
  return {
    rowId: row.id as number,
    sessionId: row.session_id as number,
    startedAt: row.started_at as number,
    endedAt: nullable<number>(row.ended_at),
    id: row.key as string,
    ordinal: row.ordinal as number,
    sessionNum: nullable<number>(row.session_num),
    driver: nullable<string>(row.driver),
    own: row.own === 1,
    openedBy: row.opened_by as StintOpenedBy,
    closedBy: nullable<StintClosedBy>(row.closed_by),
    startTime: row.start_time as number,
    endTime: nullable<number>(row.end_time),
    startLap: row.start_lap as number,
    endLap: nullable<number>(row.end_lap),
    laps: row.laps as number,
    startFuel: nullable<number>(row.start_fuel),
    endFuel: nullable<number>(row.end_fuel),
    startEnergy: nullable<number>(row.start_energy),
    endEnergy: nullable<number>(row.end_energy),
    startTread: wheelsOf<number>(row, 'start_tread'),
    endTread: wheelsOf<number>(row, 'end_tread'),
    startBrake: wheelsOf<number>(row, 'start_brake'),
    endBrake: wheelsOf<number>(row, 'end_brake'),
    compounds: wheelsOf<string>(row, 'compound'),
    bestLap,
    avgLap,
    cleanLaps,
    ...stintPace(bestLap, avgLap, cleanLaps),
    passes: storedPasses(row.passes),
    stop: stopOf(row),
  };
};

/** What `recordLap` says of the lap it stored. */
export interface RecordedLap {
  sessionId: number;
  lapId: number;
  /** Fit to be a reference. */
  eligible: boolean;
  /**
   * Why the lap's ledger was not stored, when it came with one that could
   * not be. The lap itself is stored all the same.
   */
  ledgerError: string | null;
}

export interface LapLibraryDatabaseOptions {
  /**
   * The schema ladder to bring the file up. Only a spec passes anything but
   * the real one: a shorter ladder to make a file as an older build left
   * it, or a step that fails.
   */
  migrations?: readonly Migration[];
}

export class LapLibraryDatabase {
  private readonly db: DatabaseSync;
  private readonly statements = new Map<string, StatementSync>();

  /** What opening the file took: its version, and any upgrade it was given. */
  readonly opened: OpenOutcome;

  /**
   * Opens the library, bringing its file up to this build's schema first.
   * Throws a `LapLibraryOpenError` if the file is from a newer build, cannot
   * be upgraded or cannot be read; the file is then left as it was found.
   *
   * @param file A path, or ':memory:' for a database that is not kept.
   */
  constructor(file: string, options: LapLibraryDatabaseOptions = {}) {
    const { db, outcome } = openLapLibraryFile(
      file,
      options.migrations ?? MIGRATIONS
    );
    this.db = db;
    this.opened = outcome;
  }

  close(): void {
    this.statements.clear();
    this.db.close();
  }

  /**
   * Stores a lap, creating its session's row with the first one, and its
   * ledger row and stint when it comes with them. Returns the ids, and
   * whether the lap is fit to be a reference.
   */
  recordLap(session: LapSessionInput, lap: LapInput): RecordedLap {
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
      const lapId = Number(result.lastInsertRowid);
      this.statement('UPDATE session SET last_lap_at = ? WHERE id = ?').run(
        lap.completedAt,
        sessionId
      );
      const ledgerError = lap.ledger
        ? this.storeLedger(sessionId, lapId, lap.ledger)
        : null;
      this.db.exec('COMMIT');
      return { sessionId, lapId, eligible, ledgerError };
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /**
   * Stores a stint, or brings the one already stored up to date: called as
   * a stint opens and again as it closes.
   *
   * A stint is kept under its session, and a session has a row only once it
   * has a lap. So a stint that opens before the first lap of its session is
   * not stored by this call: it arrives with that lap instead (see
   * `LapLedgerInput.stint`), and from then on this call finds it. Nothing
   * is lost by that, because a stint with no lap is not kept at all: one
   * that closes without a lap is dropped, here, if it was ever stored.
   *
   * Returns the stint's row id, or null when the library keeps no row for
   * it.
   */
  upsertStint(session: LapSessionInput, input: StintInput): number | null {
    assertStint(input.stint);
    const known = this.statement(
      'SELECT id, session_id FROM stint WHERE key = ?'
    ).get(input.stint.id) as Row | undefined;
    if (input.stint.closedBy !== null && !(input.stint.laps > 0)) {
      if (!known || this.dropStintIfEmpty(known.id as number)) return null;
    }
    const sessionId = known
      ? known.session_id
      : (
          this.statement('SELECT id FROM session WHERE token = ?').get(
            session.token
          ) as Row | undefined
        )?.id;
    if (sessionId === undefined) return null;
    return this.storeStint(sessionId as number, input);
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
      `SELECT ${LAP_COLUMNS}
         FROM lap l ${LAP_JOINS}
        WHERE l.session_id = ?
        ORDER BY l.completed_at, l.id`
    ).all(sessionId) as Row[];
    return rows.map((row) => lapOf(row, reference));
  }

  /** A session's stints in the order they were driven. */
  listStints(sessionId: number): LapLibraryStint[] {
    const rows = this.statement(
      `SELECT * FROM stint WHERE session_id = ? ORDER BY started_at, id`
    ).all(sessionId) as Row[];
    return rows.map(stintOf);
  }

  /**
   * The latest laps that have a ledger row, for one track and car, newest
   * first: what a per-lap rate for that combination is worked out from.
   *
   * @param limit How many laps at most.
   * @param withoutFlags LEDGER_LAP_* bits; a lap with any of them is left
   *   out. All of the bits that make a lap unclean, and the wet one, give
   *   the clean dry laps.
   */
  recentLedgerLaps(
    simulator: string,
    trackId: number,
    carKey: string,
    limit: number,
    withoutFlags = 0
  ): LapLibraryLap[] {
    const reference = this.referenceLapId(simulator, trackId, carKey);
    const rows = this.statement(
      `SELECT ${LAP_COLUMNS}
         FROM lap l
         JOIN session s ON s.id = l.session_id ${LAP_JOINS}
        WHERE s.simulator = ? AND s.track_id = ? AND s.car_key = ?
          AND g.lap_id IS NOT NULL
          AND (g.flags & ?) = 0
        ORDER BY l.completed_at DESC, l.id DESC
        LIMIT ?`
    ).all(
      simulator,
      trackId,
      carKey,
      withoutFlags,
      Math.max(1, Math.min(limit, 1000))
    ) as Row[];
    return rows.map((row) => lapOf(row, reference));
  }

  deleteLap(lapId: number): boolean {
    const lap = this.statement(
      `SELECT l.session_id, g.stint_id
         FROM lap l LEFT JOIN lap_ledger g ON g.lap_id = l.id
        WHERE l.id = ?`
    ).get(lapId) as Row | undefined;
    if (!lap) return false;
    // Together or not at all: the lap gone and its session left behind with
    // none would be listed as an empty session.
    this.db.exec('BEGIN');
    try {
      this.statement('DELETE FROM lap WHERE id = ?').run(lapId);
      if (typeof lap.stint_id === 'number') this.dropStintIfEmpty(lap.stint_id);
      // A session with no laps left is nothing to list.
      this.statement(
        `DELETE FROM session
          WHERE id = ? AND NOT EXISTS (SELECT 1 FROM lap WHERE session_id = ?)`
      ).run(lap.session_id as number, lap.session_id as number);
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
   *
   * The ledger rows of the laps go with them, then any stint left without a
   * lap, then any session left without one.
   */
  prune(maxLaps: number): number {
    const excess = this.stats().laps - maxLaps;
    if (excess <= 0) return 0;
    this.db.exec('BEGIN');
    try {
      const doomed = this.statement(
        `SELECT l.id, g.stint_id
           FROM lap l
           JOIN session s ON s.id = l.session_id
           LEFT JOIN lap_ledger g ON g.lap_id = l.id
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
          LIMIT ?`
      ).all(excess) as Row[];
      const stints = new Set<number>();
      for (const lap of doomed) {
        this.statement('DELETE FROM lap WHERE id = ?').run(lap.id as number);
        if (typeof lap.stint_id === 'number') stints.add(lap.stint_id);
      }
      for (const stintId of stints) this.dropStintIfEmpty(stintId);
      this.db.exec(
        `DELETE FROM session
          WHERE NOT EXISTS (SELECT 1 FROM lap WHERE lap.session_id = session.id)`
      );
      this.db.exec('COMMIT');
      return doomed.length;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /**
   * Stores the ledger row of a lap just inserted, and its stint. Its own
   * savepoint inside the lap's transaction: a ledger that cannot be stored
   * is undone by itself and reported, and the lap is still committed.
   */
  private storeLedger(
    sessionId: number,
    lapId: number,
    ledger: LapLedgerInput
  ): string | null {
    this.db.exec('SAVEPOINT ledger');
    try {
      const stintId = ledger.stint
        ? this.storeStint(sessionId, ledger.stint)
        : null;
      this.statement(INSERT_LEDGER).run({
        lap_id: lapId,
        stint_id: stintId,
        ...ledgerValues(ledger),
      });
      this.db.exec('RELEASE ledger');
      return null;
    } catch (error) {
      this.db.exec('ROLLBACK TO ledger');
      this.db.exec('RELEASE ledger');
      return error instanceof Error ? error.message : String(error);
    }
  }

  /** Writes a stint under a session, new or known. Returns its row id. */
  private storeStint(sessionId: number, input: StintInput): number {
    assertStint(input.stint);
    this.statement(UPSERT_STINT).run({
      key: input.stint.id,
      session_id: sessionId,
      started_at: whole(input.startedAt),
      ...stintValues(input),
    });
    const row = this.statement('SELECT id FROM stint WHERE key = ?').get(
      input.stint.id
    ) as Row;
    return row.id as number;
  }

  /** Removes a stint that no lap is left of. True if it went. */
  private dropStintIfEmpty(stintId: number): boolean {
    const result = this.statement(
      `DELETE FROM stint
        WHERE id = ?
          AND NOT EXISTS (SELECT 1 FROM lap_ledger WHERE stint_id = ?)`
    ).run(stintId, stintId);
    return Number(result.changes) > 0;
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
