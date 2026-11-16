import type { DatabaseSync, SQLInputValue, StatementSync } from 'node:sqlite';
import type {
  RaceDriverChange,
  RaceEntry,
  RaceInfo,
  RaceLap,
  RaceRecords,
  RaceStint,
  RaceStintClosedBy,
  RaceStintOpenedBy,
  RaceTyre,
  RaceWriteBatch,
  RaceWriteResult,
  StoredRace,
  StoredRaceState,
} from '../../../types/raceHistory';
import type { RaceEvent } from '../../../types/raceLog';
import {
  RACE_LOG_MAX_EVENTS,
  RACE_LOG_PAGE_EVENTS,
  raceEventData,
  raceEventFrom,
} from '../../../types/raceLog';

/**
 * The history of races in the lap library's file: the race, its laps, its
 * stints, its driver changes and its log (schema version 3).
 *
 * Synchronous, like everything about the built-in SQLite, and so only ever
 * called on the library's worker thread. It shares the library's connection
 * and none of its tables.
 *
 * What goes with what: a race takes every row of it when it goes, and a
 * race goes when it is no longer among the most recent ones kept. A race's
 * log is kept to its RACE_LOG_MAX_EVENTS most recent events.
 */

const OPENED_BY: readonly RaceStintOpenedBy[] = [
  'start',
  'joined',
  'stop',
  'garage',
  'driver',
];
const CLOSED_BY: readonly RaceStintClosedBy[] = [
  'stop',
  'garage',
  'driver',
  'gap',
  'session',
];

/** The order a lap's per-wheel compounds and their columns are in. */
const WHEELS = ['lf', 'rf', 'lr', 'rr'] as const;

// The columns a write sets, by name. The statements and the values bound to
// them are both built from these lists, so a value cannot land in the
// neighbouring column.
const LAP_COLUMNS = [
  'session_time',
  'lap_time',
  's1',
  's2',
  's3',
  'position',
  'class_position',
  'class_gap',
  'flags',
  'driver',
  'energy',
  'energy_virtual',
  ...WHEELS.map((wheel) => `compound_${wheel}` as const),
] as const;

const STINT_COLUMNS = [
  'driver',
  'opened_by',
  'closed_by',
  'first_lap',
  'last_lap',
  'start_time',
  'end_time',
  'laps',
  'clean_laps',
  'avg_lap',
  'best_lap',
  'stop_lane_time',
  'stop_standing_time',
  'stop_driver_changed',
] as const;

const CHANGE_COLUMNS = [
  'session_time',
  'lap',
  'from_driver',
  'to_driver',
  'at_stop',
] as const;

const EVENT_COLUMNS = [
  'session_time',
  'time_of_day',
  'car_idx',
  'kind',
  'data',
] as const;

const RACE_COLUMNS = [
  'simulator',
  'session_key',
  'session_num',
  'session_type',
  'session_name',
  'track_id',
  'track_name',
  'track_config',
  'track_length_m',
  'updated_at',
  'session_time',
  'entries',
  'tyres',
] as const;

type ColumnValues<Column extends string> = Record<Column, SQLInputValue>;

const named = (columns: readonly string[]): string =>
  columns.map((column) => `:${column}`).join(', ');

const assignments = (columns: readonly string[]): string =>
  columns.map((column) => `${column} = excluded.${column}`).join(', ');

const UPSERT_LAP = `
  INSERT INTO race_lap (race_id, car_idx, lap, ${LAP_COLUMNS.join(', ')})
  VALUES (:race_id, :car_idx, :lap, ${named(LAP_COLUMNS)})
  ON CONFLICT (race_id, car_idx, lap) DO UPDATE SET
    ${assignments(LAP_COLUMNS)}`;

const UPSERT_STINT = `
  INSERT INTO race_stint (race_id, car_idx, ordinal, ${STINT_COLUMNS.join(', ')})
  VALUES (:race_id, :car_idx, :ordinal, ${named(STINT_COLUMNS)})
  ON CONFLICT (race_id, car_idx, ordinal) DO UPDATE SET
    ${assignments(STINT_COLUMNS)}`;

const UPSERT_CHANGE = `
  INSERT INTO race_driver_change (
    race_id, car_idx, seq, ${CHANGE_COLUMNS.join(', ')}
  )
  VALUES (:race_id, :car_idx, :seq, ${named(CHANGE_COLUMNS)})
  ON CONFLICT (race_id, car_idx, seq) DO UPDATE SET
    ${assignments(CHANGE_COLUMNS)}`;

const UPSERT_EVENT = `
  INSERT INTO race_event (race_id, seq, ${EVENT_COLUMNS.join(', ')})
  VALUES (:race_id, :seq, ${named(EVENT_COLUMNS)})
  ON CONFLICT (race_id, seq) DO UPDATE SET
    ${assignments(EVENT_COLUMNS)}`;

const INSERT_RACE = `
  INSERT INTO race (token, started_at, ${RACE_COLUMNS.join(', ')})
  VALUES (:token, :started_at, ${named(RACE_COLUMNS)})`;

// A race carried on takes the token of the run that carries it on, so that
// the batches after this one find it by that.
const UPDATE_RACE = `
  UPDATE race
     SET token = :token,
         ${RACE_COLUMNS.map((column) => `${column} = :${column}`).join(', ')}
   WHERE id = :id`;

type Row = Record<string, unknown>;

const flag = (value: unknown): number => (value === true ? 1 : 0);

/** A reading, or null for anything that is not one. */
const real = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/** A count or an index, or null for anything that is not one. */
const whole = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) ? value : null;

const text = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;

const nullable = <Value>(value: unknown): Value | null =>
  (value as Value | null | undefined) ?? null;

/** A slot or a number that can be a row's key: a whole number from 0 up. */
const isKey = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const lapValues = (
  lap: RaceLap
): ColumnValues<(typeof LAP_COLUMNS)[number]> => ({
  session_time: real(lap.sessionTime) ?? 0,
  lap_time: real(lap.lapTime),
  s1: real(lap.sectors?.[0]),
  s2: real(lap.sectors?.[1]),
  s3: real(lap.sectors?.[2]),
  position: whole(lap.position),
  class_position: whole(lap.classPosition),
  class_gap: real(lap.classGap),
  flags: whole(lap.flags) ?? 0,
  driver: text(lap.driver) ?? '',
  energy: real(lap.energy),
  energy_virtual: flag(lap.energyIsVirtual),
  compound_lf: whole(lap.compounds?.[0]) ?? -1,
  compound_rf: whole(lap.compounds?.[1]) ?? -1,
  compound_lr: whole(lap.compounds?.[2]) ?? -1,
  compound_rr: whole(lap.compounds?.[3]) ?? -1,
});

const stintValues = (
  stint: RaceStint
): ColumnValues<(typeof STINT_COLUMNS)[number]> => {
  const stop = stint.stop;
  return {
    driver: text(stint.driver) ?? '',
    opened_by: OPENED_BY.includes(stint.openedBy) ? stint.openedBy : 'joined',
    closed_by:
      stint.closedBy !== null && CLOSED_BY.includes(stint.closedBy)
        ? stint.closedBy
        : null,
    first_lap: whole(stint.firstLap),
    last_lap: whole(stint.lastLap),
    start_time: real(stint.startTime) ?? 0,
    end_time: real(stint.endTime),
    laps: whole(stint.laps) ?? 0,
    clean_laps: whole(stint.cleanLaps) ?? 0,
    avg_lap: real(stint.avgLap),
    best_lap: real(stint.bestLap),
    stop_lane_time: stop ? real(stop.laneTime) : null,
    // Never null on a stop: it is how a stop is told from none.
    stop_standing_time: stop ? (real(stop.standingTime) ?? 0) : null,
    stop_driver_changed: stop ? flag(stop.driverChanged) : null,
  };
};

const changeValues = (
  change: RaceDriverChange
): ColumnValues<(typeof CHANGE_COLUMNS)[number]> => ({
  session_time: real(change.sessionTime) ?? 0,
  lap: whole(change.lap) ?? 0,
  from_driver: text(change.from) ?? '',
  to_driver: text(change.to) ?? '',
  at_stop: flag(change.atStop),
});

const eventValues = (
  event: RaceEvent
): ColumnValues<(typeof EVENT_COLUMNS)[number]> => ({
  session_time: event.sessionTime,
  time_of_day: event.timeOfDay,
  car_idx: event.carIdx,
  kind: event.kind,
  data: JSON.stringify(raceEventData(event)),
});

const raceValues = (
  info: RaceInfo
): ColumnValues<(typeof RACE_COLUMNS)[number]> => ({
  simulator: text(info.simulator) ?? '',
  session_key: text(info.sessionKey) ?? '',
  session_num: whole(info.sessionNum),
  session_type: text(info.sessionType),
  session_name: text(info.sessionName),
  track_id: whole(info.trackId) ?? -1,
  track_name: text(info.trackName) ?? '',
  track_config: text(info.trackConfig),
  track_length_m: real(info.trackLengthM) ?? 0,
  updated_at: whole(info.updatedAt) ?? 0,
  session_time: real(info.sessionTime) ?? 0,
  entries: JSON.stringify(entriesOf(info.entries)),
  tyres: JSON.stringify(tyresOf(info.tyres)),
});

/** The entry list as it is kept: only what an entry is made of. */
const entriesOf = (values: unknown): RaceEntry[] =>
  (Array.isArray(values) ? values : [])
    .filter(
      (entry): entry is RaceEntry =>
        !!entry && typeof entry === 'object' && isKey((entry as Row).carIdx)
    )
    .map((entry) => ({
      carIdx: entry.carIdx,
      carNumber: text(entry.carNumber) ?? '',
      car: text(entry.car) ?? '',
      classId: whole(entry.classId) ?? -1,
      className: text(entry.className) ?? '',
      teamName: text(entry.teamName) ?? '',
    }));

const tyresOf = (values: unknown): RaceTyre[] =>
  (Array.isArray(values) ? values : [])
    .filter(
      (tyre): tyre is RaceTyre =>
        !!tyre &&
        typeof tyre === 'object' &&
        isKey((tyre as Row).index) &&
        typeof (tyre as Row).name === 'string'
    )
    .map((tyre) => ({ index: tyre.index, name: tyre.name }));

/** A JSON column back as a list; anything unreadable is an empty one. */
const stored = <Item>(column: unknown, clean: (value: unknown) => Item[]) => {
  try {
    return clean(JSON.parse(String(column)));
  } catch {
    return [];
  }
};

const infoOf = (row: Row): RaceInfo & { id: number } => ({
  id: row.id as number,
  simulator: row.simulator as string,
  sessionKey: row.session_key as string,
  sessionNum: nullable<number>(row.session_num),
  sessionType: nullable<string>(row.session_type),
  sessionName: nullable<string>(row.session_name),
  trackId: row.track_id as number,
  trackName: row.track_name as string,
  trackConfig: nullable<string>(row.track_config),
  trackLengthM: row.track_length_m as number,
  startedAt: row.started_at as number,
  updatedAt: row.updated_at as number,
  sessionTime: row.session_time as number,
  entries: stored(row.entries, entriesOf),
  tyres: stored(row.tyres, tyresOf),
});

const lapOf = (row: Row): RaceLap => ({
  carIdx: row.car_idx as number,
  lap: row.lap as number,
  sessionTime: row.session_time as number,
  lapTime: nullable<number>(row.lap_time),
  sectors: [
    nullable<number>(row.s1),
    nullable<number>(row.s2),
    nullable<number>(row.s3),
  ],
  position: nullable<number>(row.position),
  classPosition: nullable<number>(row.class_position),
  classGap: nullable<number>(row.class_gap),
  flags: row.flags as number,
  driver: row.driver as string,
  energy: nullable<number>(row.energy),
  energyIsVirtual: row.energy_virtual === 1,
  compounds: WHEELS.map((wheel) => row[`compound_${wheel}`] as number),
});

const stintOf = (row: Row): RaceStint => ({
  carIdx: row.car_idx as number,
  ordinal: row.ordinal as number,
  driver: row.driver as string,
  openedBy: row.opened_by as RaceStintOpenedBy,
  closedBy: nullable<RaceStintClosedBy>(row.closed_by),
  firstLap: nullable<number>(row.first_lap),
  lastLap: nullable<number>(row.last_lap),
  startTime: row.start_time as number,
  endTime: nullable<number>(row.end_time),
  laps: row.laps as number,
  cleanLaps: row.clean_laps as number,
  avgLap: nullable<number>(row.avg_lap),
  bestLap: nullable<number>(row.best_lap),
  stop:
    nullable(row.stop_standing_time) === null
      ? null
      : {
          laneTime: nullable<number>(row.stop_lane_time),
          standingTime: row.stop_standing_time as number,
          driverChanged: row.stop_driver_changed === 1,
        },
});

const changeOf = (row: Row): RaceDriverChange => ({
  carIdx: row.car_idx as number,
  seq: row.seq as number,
  sessionTime: row.session_time as number,
  lap: row.lap as number,
  from: row.from_driver as string,
  to: row.to_driver as string,
  atStop: row.at_stop === 1,
});

/** An event of the log, or null for a row that is not one. */
const eventOf = (row: Row): RaceEvent | null => {
  let data: unknown = null;
  try {
    data = JSON.parse(String(row.data));
  } catch {
    // Unreadable: the event is told by its kind alone, where that is enough.
  }
  return raceEventFrom({
    seq: row.seq,
    sessionTime: row.session_time,
    timeOfDay: row.time_of_day,
    carIdx: row.car_idx,
    kind: row.kind,
    data,
  });
};

const isEvent = (event: RaceEvent | null): event is RaceEvent => event !== null;

export class RaceHistoryTables {
  private readonly statements = new Map<string, StatementSync>();

  constructor(private readonly db: DatabaseSync) {}

  /** Lets go of the prepared statements, before the connection closes. */
  close(): void {
    this.statements.clear();
  }

  /**
   * Writes a batch of one race's rows, making the race's own row with the
   * first. All of it or none: a batch that cannot be written leaves the
   * file as it was.
   *
   * A row whose car or number is not a whole number from 0 up is left out
   * rather than fail the rest, and so is an event that is not one this
   * build knows how to read back.
   */
  write(batch: RaceWriteBatch): RaceWriteResult {
    this.db.exec('BEGIN');
    try {
      const race = raceValues(batch.info);
      const known = (
        isKey(batch.raceId)
          ? this.statement('SELECT id FROM race WHERE id = ?').get(batch.raceId)
          : undefined
      ) as Row | undefined;
      const byToken = (known ??
        this.statement('SELECT id FROM race WHERE token = ?').get(
          batch.token
        )) as Row | undefined;

      let raceId: number;
      let removedRaces = 0;
      if (byToken) {
        raceId = byToken.id as number;
        this.statement(UPDATE_RACE).run({
          id: raceId,
          token: batch.token,
          ...race,
        });
        for (const carIdx of batch.replacedCars ?? []) {
          if (isKey(carIdx)) this.clearCar(raceId, carIdx);
        }
      } else {
        const result = this.statement(INSERT_RACE).run({
          token: batch.token,
          started_at: whole(batch.info.startedAt) ?? race.updated_at,
          ...race,
        });
        raceId = Number(result.lastInsertRowid);
        removedRaces = this.prune(batch.maxRaces, raceId);
      }

      for (const lap of batch.laps ?? []) {
        if (!isKey(lap?.carIdx) || !isKey(lap.lap)) continue;
        this.statement(UPSERT_LAP).run({
          race_id: raceId,
          car_idx: lap.carIdx,
          lap: lap.lap,
          ...lapValues(lap),
        });
      }
      for (const stint of batch.stints ?? []) {
        if (!isKey(stint?.carIdx) || !isKey(stint.ordinal)) continue;
        this.statement(UPSERT_STINT).run({
          race_id: raceId,
          car_idx: stint.carIdx,
          ordinal: stint.ordinal,
          ...stintValues(stint),
        });
      }
      for (const change of batch.driverChanges ?? []) {
        if (!isKey(change?.carIdx) || !isKey(change.seq)) continue;
        this.statement(UPSERT_CHANGE).run({
          race_id: raceId,
          car_idx: change.carIdx,
          seq: change.seq,
          ...changeValues(change),
        });
      }
      for (const seq of batch.removedEvents ?? []) {
        if (!isKey(seq)) continue;
        this.statement(
          'DELETE FROM race_event WHERE race_id = ? AND seq = ?'
        ).run(raceId, seq);
      }
      let logged = false;
      for (const event of batch.events ?? []) {
        // Through the reader's own checks: what is written is what it
        // takes, and nothing else an event may have come to carry.
        const clean = event ? raceEventFrom({ ...event, data: event }) : null;
        if (!clean) continue;
        this.statement(UPSERT_EVENT).run({
          race_id: raceId,
          seq: clean.seq,
          ...eventValues(clean),
        });
        logged = true;
      }
      if (logged) this.capEvents(raceId);
      this.db.exec('COMMIT');
      return { raceId, removedRaces };
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /** The races kept, most recent first, each with how much is kept of it. */
  list(limit = 100): StoredRace[] {
    const rows = this.statement(
      `SELECT r.*,
              (SELECT count(*) FROM race_lap l WHERE l.race_id = r.id) AS laps,
              (
                SELECT count(DISTINCT l.car_idx)
                  FROM race_lap l WHERE l.race_id = r.id
              ) AS cars
         FROM race r
        ORDER BY r.updated_at DESC, r.id DESC
        LIMIT ?`
    ).all(Math.max(1, Math.min(limit, 1000))) as Row[];
    return rows.map((row) => ({
      ...infoOf(row),
      laps: row.laps as number,
      cars: row.cars as number,
    }));
  }

  /**
   * The most recent races of a simulator, track and kind of session, each
   * with the last lap kept for every car: what is needed to tell whether
   * one of them is the race being driven now.
   */
  candidates(
    simulator: string,
    trackId: number,
    sessionType: string | null,
    limit = 3
  ): StoredRaceState[] {
    const rows = this.statement(
      `SELECT * FROM race
        WHERE simulator = ? AND track_id = ? AND session_type IS ?
        ORDER BY updated_at DESC, id DESC
        LIMIT ?`
    ).all(
      simulator,
      trackId,
      sessionType,
      Math.max(1, Math.min(limit, 20))
    ) as Row[];
    return rows.map((row) => ({
      info: infoOf(row),
      lastLaps: (
        this.statement(
          `SELECT car_idx, max(lap) AS lap FROM race_lap
            WHERE race_id = ? GROUP BY car_idx ORDER BY car_idx`
        ).all(row.id as number) as Row[]
      ).map((last) => ({
        carIdx: last.car_idx as number,
        lap: last.lap as number,
      })),
    }));
  }

  /** Everything kept of a race; null when there is no such race. */
  load(raceId: number): RaceRecords | null {
    const race = this.statement('SELECT id FROM race WHERE id = ?').get(
      raceId
    ) as Row | undefined;
    if (!race) return null;
    return {
      laps: (
        this.statement(
          'SELECT * FROM race_lap WHERE race_id = ? ORDER BY car_idx, lap'
        ).all(raceId) as Row[]
      ).map(lapOf),
      stints: (
        this.statement(
          'SELECT * FROM race_stint WHERE race_id = ? ORDER BY car_idx, ordinal'
        ).all(raceId) as Row[]
      ).map(stintOf),
      driverChanges: this.driverChanges(raceId),
      events: (
        this.statement(
          'SELECT * FROM race_event WHERE race_id = ? ORDER BY seq'
        ).all(raceId) as Row[]
      )
        .map(eventOf)
        .filter(isEvent),
    };
  }

  /** One car's laps of a race, in the order driven. */
  carLaps(raceId: number, carIdx: number): RaceLap[] {
    return (
      this.statement(
        `SELECT * FROM race_lap
          WHERE race_id = ? AND car_idx = ? ORDER BY lap`
      ).all(raceId, carIdx) as Row[]
    ).map(lapOf);
  }

  /** One car's stints of a race, oldest first. */
  carStints(raceId: number, carIdx: number): RaceStint[] {
    return (
      this.statement(
        `SELECT * FROM race_stint
          WHERE race_id = ? AND car_idx = ? ORDER BY ordinal`
      ).all(raceId, carIdx) as Row[]
    ).map(stintOf);
  }

  /** Every driver change of a race, oldest first. */
  driverChanges(raceId: number): RaceDriverChange[] {
    return (
      this.statement(
        `SELECT * FROM race_driver_change
          WHERE race_id = ? ORDER BY session_time, car_idx, seq`
      ).all(raceId) as Row[]
    ).map(changeOf);
  }

  /**
   * Events of a race's log, oldest first: the most recent `limit` numbered
   * below `before`, or the most recent of all with it left out.
   */
  events(
    raceId: number,
    before?: number,
    limit = RACE_LOG_PAGE_EVENTS
  ): RaceEvent[] {
    const rows = this.statement(
      `SELECT * FROM race_event
        WHERE race_id = ? AND seq < ?
        ORDER BY seq DESC
        LIMIT ?`
    ).all(
      raceId,
      isKey(before) ? before : Number.MAX_SAFE_INTEGER,
      Math.max(1, Math.min(isKey(limit) ? limit : 1, RACE_LOG_MAX_EVENTS))
    ) as Row[];
    return rows.reverse().map(eventOf).filter(isEvent);
  }

  /** Keeps a race's log to its most recent events. */
  private capEvents(raceId: number): void {
    this.statement(
      `DELETE FROM race_event
        WHERE race_id = ?
          AND seq NOT IN (
            SELECT seq FROM race_event
             WHERE race_id = ? ORDER BY seq DESC LIMIT ?
          )`
    ).run(raceId, raceId, RACE_LOG_MAX_EVENTS);
  }

  /** Removes everything kept for one slot of a race. */
  private clearCar(raceId: number, carIdx: number): void {
    for (const table of [
      'race_lap',
      'race_stint',
      'race_driver_change',
      'race_event',
    ]) {
      this.statement(
        `DELETE FROM ${table} WHERE race_id = ? AND car_idx = ?`
      ).run(raceId, carIdx);
    }
  }

  /**
   * Keeps the most recent `maxRaces` races and the one just made, and
   * removes the others with every row of them. Returns how many went.
   */
  private prune(maxRaces: number, keep: number): number {
    const limit = isKey(maxRaces) && maxRaces > 0 ? maxRaces : 1;
    const result = this.statement(
      `DELETE FROM race
        WHERE id != ?
          AND id NOT IN (
            SELECT id FROM race ORDER BY updated_at DESC, id DESC LIMIT ?
          )`
    ).run(keep, limit);
    return Number(result.changes);
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
