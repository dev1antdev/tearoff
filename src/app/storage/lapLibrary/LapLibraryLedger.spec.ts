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
  StintInput,
} from '../../../types/lapLibrary';
import {
  LEDGER_LAP_FROM_START,
  LEDGER_LAP_IN_LAP,
  LEDGER_LAP_OUT_LAP,
  LEDGER_LAP_SERVICED,
  LEDGER_LAP_VOIDED,
  LEDGER_LAP_WET,
  type LedgerStint,
} from '../../../types/ledger';
import { LapLibraryDatabase, stintPace } from './LapLibraryDatabase';

/**
 * The second version of the schema: what each lap cost, and the stints, kept
 * beside the laps. Run against a database in a file, so that what is left
 * behind after a delete can be counted through a second connection.
 */
const T0 = Date.UTC(2026, 10, 15, 13, 0, 0);

const curve = (lapTime: number, points = 20): LapCurve => {
  const pointPos = new Float32Array(points);
  const times = new Float32Array(points);
  for (let index = 0; index < points; index += 1) {
    pointPos[index] = (index + 0.3) / points;
    times[index] = pointPos[index] * lapTime;
  }
  return { interval: 1 / points, pointPos, times, speedsKph: null };
};

const session = (
  overrides: Partial<LapSessionInput> = {}
): LapSessionInput => ({
  token: 'run-1',
  simulator: 'lmu',
  sessionKey: '',
  trackId: 9,
  trackName: 'Laguna Seca',
  trackConfig: null,
  trackLengthM: 3590,
  carKey: 'Ferrari 296 LMGT3 Evo',
  carName: 'Kessel Racing #74',
  sessionType: 'Race',
  sessionName: 'Race',
  ...overrides,
});

/** An open stint, every field its own value. */
const stint = (overrides: Partial<LedgerStint> = {}): LedgerStint => ({
  id: 'run-1:1',
  ordinal: 1,
  sessionNum: 2,
  driver: 'A. Driver',
  own: true,
  openedBy: 'pitExit',
  closedBy: null,
  startTime: 139.9,
  endTime: null,
  startLap: 3,
  endLap: null,
  laps: 1,
  startFuel: 44.92,
  endFuel: 42.61,
  startEnergy: 0.45,
  endEnergy: 0.4267,
  startTread: [0.98114, 0.97987, 0.97816, 0.97707],
  endTread: [0.97622, 0.97453, 0.97315, 0.97225],
  startBrake: [36.0, 35.999, 32.0, 31.999],
  endBrake: [35.9968, 35.9959, 31.9987, 31.9984],
  compounds: ['Medium', 'Medium', 'Hard', 'Hard'],
  bestLap: null,
  avgLap: null,
  cleanLaps: 0,
  paceDelta: null,
  consistency: null,
  passes: [],
  stop: null,
  ...overrides,
});

const stintInput = (
  overrides: Partial<LedgerStint> = {},
  times: Partial<Omit<StintInput, 'stint'>> = {}
): StintInput => ({
  stint: stint(overrides),
  startedAt: T0 - 60_000,
  endedAt: null,
  ...times,
});

/** A ledger row, every field its own value so none can pass for another. */
const ledger = (overrides: Partial<LapLedgerInput> = {}): LapLedgerInput => ({
  stint: stintInput(),
  sessionNum: 2,
  stintLap: 1,
  startTime: 237.723,
  endTime: 324.394,
  simLapTime: 86.66,
  flags: LEDGER_LAP_SERVICED | LEDGER_LAP_WET,
  fuelAtLine: 42.612,
  fuelAdded: 1.25,
  energyAtLine: 0.4267,
  energyAdded: 0.0125,
  treadAtLine: [0.97622, 0.97453, 0.97315, 0.97225],
  treadUsed: [0.00492, 0.00534, 0.00501, 0.00482],
  brakeAtLine: [35.9968, 35.9959, 31.9987, 31.9984],
  brakeUsed: [0.0016, 0.0021, 0.0007, 0.0008],
  compounds: ['Medium', 'Soft', 'Hard', 'Wet'],
  sectors: [28.114, 30.502, 28.044],
  wetness: 3,
  rain: 0.125,
  position: 17,
  classPosition: 4,
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
  fuelUsed: 2.308,
  energyUsed: 0.02333,
  airTemp: 21,
  trackTemp: 30,
  curve: curve(lapTime),
  ...overrides,
});

let directory: string;
let file: string;
let db: LapLibraryDatabase;

/** Counts rows through a connection of its own, past the library's API. */
const count = (table: string, where = '1'): number => {
  const raw = new DatabaseSync(file, { readOnly: true });
  try {
    return (
      raw
        .prepare(`SELECT count(*) AS n FROM ${table} WHERE ${where}`)
        .get() as {
        n: number;
      }
    ).n;
  } finally {
    raw.close();
  }
};

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tearoff-laps-ledger-'));
  file = path.join(directory, 'laps.db');
  db = new LapLibraryDatabase(file);
  stamp = T0;
});

afterEach(() => {
  db.close();
  // The exact mkdtemp result, never a real application folder.
  fs.rmSync(directory, { recursive: true, force: true });
});

describe('lap ledger: storing', () => {
  it('keeps what a lap cost beside the lap, field for field', () => {
    const recorded = db.recordLap(session(), lap(86.671, { ledger: ledger() }));

    expect(recorded.ledgerError).toBeNull();
    const [listed] = db.listLaps(recorded.sessionId);
    expect(listed.ledger).toEqual({
      stintId: 'run-1:1',
      sessionNum: 2,
      stintLap: 1,
      startTime: 237.723,
      endTime: 324.394,
      simLapTime: 86.66,
      flags: LEDGER_LAP_SERVICED | LEDGER_LAP_WET,
      fuelAtLine: 42.612,
      fuelAdded: 1.25,
      energyAtLine: 0.4267,
      energyAdded: 0.0125,
      treadAtLine: [0.97622, 0.97453, 0.97315, 0.97225],
      treadUsed: [0.00492, 0.00534, 0.00501, 0.00482],
      brakeAtLine: [35.9968, 35.9959, 31.9987, 31.9984],
      brakeUsed: [0.0016, 0.0021, 0.0007, 0.0008],
      compounds: ['Medium', 'Soft', 'Hard', 'Wet'],
      sectors: [28.114, 30.502, 28.044],
      wetness: 3,
      rain: 0.125,
      position: 17,
      classPosition: 4,
    });
    // The lap's own row is what it always was.
    expect(listed).toMatchObject({
      id: recorded.lapId,
      lapTime: 86.671,
      fuelUsed: 2.308,
      energyUsed: 0.02333,
      eligible: true,
      isReference: true,
    });
  });

  it('lists a lap recorded without a ledger as having none', () => {
    const recorded = db.recordLap(session(), lap(90));

    expect(recorded.ledgerError).toBeNull();
    expect(db.listLaps(recorded.sessionId)[0].ledger).toBeNull();
    expect(count('lap_ledger')).toBe(0);
    expect(count('stint')).toBe(0);
  });

  it('keeps what is unknown as unknown, not as zero', () => {
    const { sessionId } = db.recordLap(
      session(),
      lap(90, {
        ledger: ledger({
          stint: null,
          sessionNum: null,
          simLapTime: null,
          fuelAtLine: null,
          energyAtLine: null,
          // A sim that reports no brake discs, and no tread on the rears.
          treadAtLine: [0.9, 0.9, null, null],
          treadUsed: [null, null, null, null],
          brakeAtLine: [],
          brakeUsed: [],
          compounds: [null, null, null, null],
          sectors: [28.1, null, null],
          position: null,
          classPosition: null,
        }),
      })
    );

    expect(db.listLaps(sessionId)[0].ledger).toMatchObject({
      stintId: null,
      sessionNum: null,
      simLapTime: null,
      fuelAtLine: null,
      energyAtLine: null,
      treadAtLine: [0.9, 0.9, null, null],
      treadUsed: [null, null, null, null],
      brakeAtLine: [null, null, null, null],
      brakeUsed: [null, null, null, null],
      compounds: [null, null, null, null],
      sectors: [28.1, null, null],
      position: null,
      classPosition: null,
    });
  });

  it('keeps the lap when its ledger cannot be stored', () => {
    // A count that is not a number has no place in the row. The lap, with
    // its curve, is worth more than the row.
    const recorded = db.recordLap(
      session(),
      lap(86.5, { ledger: ledger({ stintLap: Number.NaN }) })
    );

    expect(recorded.ledgerError).toMatch(/stint_lap/);
    expect(recorded.eligible).toBe(true);
    const [listed] = db.listLaps(recorded.sessionId);
    expect(listed.lapTime).toBe(86.5);
    expect(listed.ledger).toBeNull();
    expect(db.referenceLap('lmu', 9, 'Ferrari 296 LMGT3 Evo')?.lapId).toBe(
      recorded.lapId
    );
    // Nothing of the ledger is left half written: not the stint either.
    expect(count('lap_ledger')).toBe(0);
    expect(count('stint')).toBe(0);
    // And the next lap is stored whole.
    const next = db.recordLap(session(), lap(87, { ledger: ledger() }));
    expect(next.ledgerError).toBeNull();
    expect(db.listLaps(next.sessionId)[1].ledger?.stintId).toBe('run-1:1');
  });

  it('keeps the lap when its stint is not one', () => {
    const recorded = db.recordLap(
      session(),
      lap(86.5, {
        ledger: ledger({
          stint: stintInput({ openedBy: 'teleport' as never }),
        }),
      })
    );

    expect(recorded.ledgerError).toMatch(/known way of opening/);
    expect(db.listLaps(recorded.sessionId)).toHaveLength(1);
    expect(count('stint')).toBe(0);
  });
});

describe('stints: storing', () => {
  it('stores the stint a lap was driven in with the lap', () => {
    const { sessionId } = db.recordLap(
      session(),
      lap(86.671, { ledger: ledger() })
    );

    expect(db.listStints(sessionId)).toEqual([
      {
        rowId: 1,
        sessionId,
        startedAt: T0 - 60_000,
        endedAt: null,
        ...stint(),
      },
    ]);
  });

  it('brings the stint up to date with each of its laps', () => {
    db.recordLap(session(), lap(86.671, { ledger: ledger() }));
    const { sessionId } = db.recordLap(
      session(),
      lap(86.5, {
        ledger: ledger({
          stintLap: 2,
          stint: stintInput({
            laps: 2,
            endFuel: 40.3,
            bestLap: 86.5,
            avgLap: 86.5855,
            cleanLaps: 2,
          }),
        }),
      })
    );

    const stints = db.listStints(sessionId);
    expect(stints).toHaveLength(1);
    expect(stints[0]).toMatchObject({
      rowId: 1,
      laps: 2,
      endFuel: 40.3,
      bestLap: 86.5,
      cleanLaps: 2,
    });
    // Both laps are in it.
    expect(
      db.listLaps(sessionId).map((row) => [row.ledger?.stintId, row.lapTime])
    ).toEqual([
      ['run-1:1', 86.671],
      ['run-1:1', 86.5],
    ]);
  });

  it('does not keep a stint whose session has no lap yet', () => {
    // A session has a row once it has a lap; until then there is nowhere to
    // keep its stint, and nothing to lose: it comes with its first lap.
    expect(db.upsertStint(session(), stintInput({ laps: 0 }))).toBeNull();

    expect(count('stint')).toBe(0);
    expect(db.stats()).toEqual({ sessions: 0, laps: 0 });

    const { sessionId } = db.recordLap(
      session(),
      lap(86.671, { ledger: ledger() })
    );
    expect(db.listStints(sessionId)).toHaveLength(1);
  });

  it('stores a stint as it opens, once its session has a lap', () => {
    const { sessionId } = db.recordLap(
      session(),
      lap(86.671, { ledger: ledger() })
    );

    const rowId = db.upsertStint(
      session(),
      stintInput(
        { id: 'run-1:2', ordinal: 2, laps: 0, startTime: 900 },
        { startedAt: T0 + 600_000 }
      )
    );

    expect(rowId).toBe(2);
    expect(
      db.listStints(sessionId).map((row) => [row.id, row.laps, row.closedBy])
    ).toEqual([
      ['run-1:1', 1, null],
      ['run-1:2', 0, null],
    ]);
  });

  it('records how a stint ended, and the stop that ended it', () => {
    const { sessionId } = db.recordLap(
      session(),
      lap(86.671, { ledger: ledger() })
    );
    const closed = stint({
      closedBy: 'service',
      endTime: 1500.25,
      endLap: 19,
      laps: 16,
      bestLap: 86.216,
      avgLap: 86.6,
      cleanLaps: 12,
      passes: [
        { pitLaneTime: 31.2, stationaryTime: 0 },
        { pitLaneTime: null, stationaryTime: 6.1 },
      ],
      stop: {
        pitLaneTime: 58.4,
        stationaryTime: 22.3,
        fuelAdded: 40.5,
        energyAdded: 0.55,
        tyresChanged: 3,
        brakesChanged: true,
        driverChanged: false,
        simEstimate: 21.9,
      },
    });

    // A different session object: a stint already stored is found by its
    // own id, whatever session the caller thinks is current by then.
    const rowId = db.upsertStint(session({ token: 'run-2' }), {
      stint: closed,
      startedAt: T0 + 999,
      endedAt: T0 + 1_500_000,
    });

    expect(rowId).toBe(1);
    const [stored] = db.listStints(sessionId);
    expect(stored).toMatchObject({
      ...closed,
      rowId: 1,
      sessionId,
      // When it opened does not move.
      startedAt: T0 - 60_000,
      endedAt: T0 + 1_500_000,
      paceDelta: expect.closeTo(0.4189, 3),
      consistency: expect.closeTo(0.99516, 4),
    });
  });

  it('tells a stint that ended in a stop from one that did not', () => {
    const { sessionId } = db.recordLap(
      session(),
      lap(86.671, { ledger: ledger() })
    );

    db.upsertStint(
      session(),
      stintInput({ closedBy: 'garage', endTime: 500 }, { endedAt: T0 + 5 })
    );
    expect(db.listStints(sessionId)[0].stop).toBeNull();

    // A stop where nothing took any time is still a stop.
    db.upsertStint(
      session(),
      stintInput(
        {
          closedBy: 'service',
          stop: {
            pitLaneTime: null,
            stationaryTime: 0,
            fuelAdded: 0,
            energyAdded: 0,
            tyresChanged: 0,
            brakesChanged: false,
            driverChanged: true,
            simEstimate: null,
          },
        },
        { endedAt: T0 + 6 }
      )
    );
    expect(db.listStints(sessionId)[0].stop).toEqual({
      pitLaneTime: null,
      stationaryTime: 0,
      fuelAdded: 0,
      energyAdded: 0,
      tyresChanged: 0,
      brakesChanged: false,
      driverChanged: true,
      simEstimate: null,
    });
  });

  it('drops a stint that closes without a lap', () => {
    const { sessionId } = db.recordLap(
      session(),
      lap(86.671, { ledger: ledger() })
    );
    const second = { id: 'run-1:2', ordinal: 2, laps: 0 };
    db.upsertStint(session(), stintInput(second));
    expect(db.listStints(sessionId)).toHaveLength(2);

    // Out of the pits and straight back to the garage.
    expect(
      db.upsertStint(session(), stintInput({ ...second, closedBy: 'garage' }))
    ).toBeNull();

    expect(db.listStints(sessionId).map((row) => row.id)).toEqual(['run-1:1']);
    // One that was never stored is not stored for closing either.
    expect(
      db.upsertStint(
        session(),
        stintInput({ id: 'run-1:3', laps: 0, closedBy: 'session' })
      )
    ).toBeNull();
    expect(count('stint')).toBe(1);
  });

  it('never opens a closed stint again', () => {
    const { sessionId } = db.recordLap(
      session(),
      lap(86.671, { ledger: ledger() })
    );
    db.upsertStint(
      session(),
      stintInput({ closedBy: 'session', laps: 3, endFuel: 30 })
    );

    // A write from while it was open, arriving late.
    db.upsertStint(session(), stintInput({ laps: 2, endFuel: 35 }));
    db.recordLap(
      session(),
      lap(87, { ledger: ledger({ stint: stintInput({ laps: 2 }) }) })
    );

    expect(db.listStints(sessionId)[0]).toMatchObject({
      closedBy: 'session',
      laps: 3,
      endFuel: 30,
    });
    // The late lap is still filed under it.
    expect(db.listLaps(sessionId)[1].ledger?.stintId).toBe('run-1:1');
  });

  it('refuses a stint that does not say what it is', () => {
    db.recordLap(session(), lap(86.671, { ledger: ledger() }));

    expect(() => db.upsertStint(session(), stintInput({ id: '' }))).toThrow(
      /needs an id/
    );
    expect(() =>
      db.upsertStint(session(), stintInput({ closedBy: 'bored' as never }))
    ).toThrow(/known way of closing/);
  });

  it('keeps the latest ten pit lane visits of a stint', () => {
    const { sessionId } = db.recordLap(
      session(),
      lap(86.671, { ledger: ledger() })
    );
    const passes = Array.from({ length: 13 }, (_, index) => ({
      pitLaneTime: 30 + index,
      stationaryTime: index,
    }));

    db.upsertStint(session(), stintInput({ passes }));

    expect(db.listStints(sessionId)[0].passes).toEqual(passes.slice(3));
  });

  it('lists the stints of a session in the order they were driven', () => {
    const { sessionId } = db.recordLap(
      session(),
      lap(86.671, { ledger: ledger() })
    );
    // After a restart the ordinals start again; the time does not.
    db.upsertStint(
      session(),
      stintInput({ id: 'run-2:1', ordinal: 1 }, { startedAt: T0 + 3_600_000 })
    );
    db.upsertStint(
      session(),
      stintInput({ id: 'run-1:2', ordinal: 2 }, { startedAt: T0 + 1_800_000 })
    );
    db.recordLap(
      session({ token: 'elsewhere', trackId: 10 }),
      lap(80, {
        ledger: ledger({ stint: stintInput({ id: 'elsewhere:1' }) }),
      })
    );

    expect(db.listStints(sessionId).map((row) => row.id)).toEqual([
      'run-1:1',
      'run-1:2',
      'run-2:1',
    ]);
    expect(db.listStints(404)).toEqual([]);
  });
});

describe('stintPace', () => {
  it('works the pace figures out from the best, the mean and the count', () => {
    // Clean laps of 86, 87 and 88: the others average 87.5.
    const { paceDelta, consistency } = stintPace(86, 87, 3);

    expect(paceDelta).toBeCloseTo(1.5, 9);
    expect(consistency).toBeCloseTo(86 / 87.5, 9);
  });

  it('has none without a second clean lap to compare with', () => {
    expect(stintPace(86, 86, 1)).toEqual({
      paceDelta: null,
      consistency: null,
    });
    expect(stintPace(null, null, 0)).toEqual({
      paceDelta: null,
      consistency: null,
    });
    expect(stintPace(86, null, 4)).toEqual({
      paceDelta: null,
      consistency: null,
    });
  });
});

describe('lap ledger and stints: deleting', () => {
  /** Two stints of two laps each in one session. */
  const twoStints = () => {
    const first = stintInput({ id: 'run-1:1' });
    const second = stintInput(
      { id: 'run-1:2', ordinal: 2 },
      { startedAt: T0 + 500_000 }
    );
    const ids = [first, first, second, second].map(
      (input, index) =>
        db.recordLap(
          session(),
          lap(90 + index, { ledger: ledger({ stint: input }) })
        ).lapId
    );
    return { ids, sessionId: db.listSessions()[0].id };
  };

  it('takes the ledger row with a deleted lap, and leaves the rest', () => {
    const { ids, sessionId } = twoStints();

    expect(db.deleteLap(ids[0])).toBe(true);

    expect(count('lap_ledger')).toBe(3);
    expect(count('lap_ledger', `lap_id = ${ids[0]}`)).toBe(0);
    // Its stint still has a lap, so it stays.
    expect(db.listStints(sessionId).map((row) => row.id)).toEqual([
      'run-1:1',
      'run-1:2',
    ]);
  });

  it('takes a stint with the last of its laps', () => {
    const { ids, sessionId } = twoStints();

    db.deleteLap(ids[0]);
    db.deleteLap(ids[1]);

    expect(db.listStints(sessionId).map((row) => row.id)).toEqual(['run-1:2']);
    expect(db.listLaps(sessionId).map((row) => row.ledger?.stintId)).toEqual([
      'run-1:2',
      'run-1:2',
    ]);
  });

  it('takes the session, and so every stint, with its last lap', () => {
    const { ids } = twoStints();
    // A stint that opened and has no lap yet goes with the session too.
    db.upsertStint(session(), stintInput({ id: 'run-1:3', laps: 0 }));

    for (const id of ids) db.deleteLap(id);

    expect(db.stats()).toEqual({ sessions: 0, laps: 0 });
    expect(count('stint')).toBe(0);
    expect(count('lap_ledger')).toBe(0);
  });

  it('takes everything with a deleted session', () => {
    const { sessionId } = twoStints();
    const other = db.recordLap(
      session({ token: 'other', trackId: 10 }),
      lap(80, { ledger: ledger({ stint: stintInput({ id: 'other:1' }) }) })
    );
    db.pinReference(other.lapId);

    expect(db.deleteSession(sessionId)).toBe(true);

    expect(db.stats()).toEqual({ sessions: 1, laps: 1 });
    expect(count('lap_ledger')).toBe(1);
    expect(count('stint')).toBe(1);
    expect(db.listStints(other.sessionId).map((row) => row.id)).toEqual([
      'other:1',
    ]);
    expect(db.listLaps(other.sessionId)[0].ledger?.stintId).toBe('other:1');
  });

  it('keeps a lap whose stint is gone', () => {
    const { ids, sessionId } = twoStints();
    // Past the library's own calls: the link is not what keeps the row.
    const raw = new DatabaseSync(file);
    raw.exec("DELETE FROM stint WHERE key = 'run-1:1'");
    raw.close();

    const laps = db.listLaps(sessionId);
    expect(laps.map((row) => row.id)).toEqual(ids);
    expect(laps[0].ledger).toMatchObject({ stintId: null, stintLap: 1 });
    expect(laps[2].ledger?.stintId).toBe('run-1:2');
  });
});

describe('lap ledger and stints: the cap', () => {
  it('drops the oldest laps with their ledger rows, then the stints left empty', () => {
    // Three stints of two laps, each lap slower than the one before, so the
    // very first is the reference and is passed over.
    const ids: number[] = [];
    for (let index = 0; index < 6; index += 1) {
      const ordinal = Math.floor(index / 2) + 1;
      ids.push(
        db.recordLap(
          session(),
          lap(90 + index, {
            ledger: ledger({
              stint: stintInput(
                { id: `run-1:${ordinal}`, ordinal },
                { startedAt: T0 + ordinal }
              ),
            }),
          })
        ).lapId
      );
    }
    const sessionId = db.listSessions()[0].id;

    expect(db.prune(2)).toBe(4);

    expect(db.listLaps(sessionId).map((row) => row.id)).toEqual([
      ids[0],
      ids[5],
    ]);
    expect(count('lap_ledger')).toBe(2);
    // The second stint lost both laps; the first keeps the reference.
    expect(db.listStints(sessionId).map((row) => row.id)).toEqual([
      'run-1:1',
      'run-1:3',
    ]);
  });

  it('leaves an open stint with no lap yet alone', () => {
    for (let index = 0; index < 4; index += 1) {
      db.recordLap(session(), lap(90 + index, { ledger: ledger() }));
    }
    const sessionId = db.listSessions()[0].id;
    db.upsertStint(session(), stintInput({ id: 'run-1:2', laps: 0 }));

    db.prune(2);

    expect(db.listStints(sessionId).map((row) => row.id)).toEqual([
      'run-1:1',
      'run-1:2',
    ]);
  });

  it('takes a session left with no laps, and its stints', () => {
    db.recordLap(
      session({ token: 'old' }),
      lap(95, { ledger: ledger({ stint: stintInput({ id: 'old:1' }) }) })
    );
    db.recordLap(
      session({ token: 'old' }),
      lap(96, { ledger: ledger({ stint: stintInput({ id: 'old:1' }) }) })
    );
    for (let index = 0; index < 3; index += 1) {
      db.recordLap(
        session({ token: 'new' }),
        lap(80 + index, {
          ledger: ledger({ stint: stintInput({ id: 'new:1' }) }),
        })
      );
    }

    // The reference is the 80 in the new session: both old laps can go.
    expect(db.prune(3)).toBe(2);

    expect(db.stats()).toEqual({ sessions: 1, laps: 3 });
    expect(count('stint')).toBe(1);
    expect(count('stint', "key = 'new:1'")).toBe(1);
  });
});

describe('lap ledger: the latest laps of a track and car', () => {
  const UNCLEAN =
    LEDGER_LAP_IN_LAP |
    LEDGER_LAP_OUT_LAP |
    LEDGER_LAP_VOIDED |
    LEDGER_LAP_FROM_START;

  it('lists them newest first, across sessions, up to a limit', () => {
    db.recordLap(session(), lap(91, { ledger: ledger({ flags: 0 }) }));
    db.recordLap(session(), lap(92, { ledger: ledger({ flags: 0 }) }));
    db.recordLap(
      session({ token: 'run-2' }),
      lap(93, { ledger: ledger({ flags: 0, stint: null }) })
    );

    const key = ['lmu', 9, 'Ferrari 296 LMGT3 Evo'] as const;
    expect(db.recentLedgerLaps(...key, 10).map((row) => row.lapTime)).toEqual([
      93, 92, 91,
    ]);
    expect(db.recentLedgerLaps(...key, 2).map((row) => row.lapTime)).toEqual([
      93, 92,
    ]);
    // With everything a rate is worked out from.
    expect(db.recentLedgerLaps(...key, 1)[0]).toMatchObject({
      lapTime: 93,
      fuelUsed: 2.308,
      energyUsed: 0.02333,
      ledger: { treadUsed: [0.00492, 0.00534, 0.00501, 0.00482] },
    });
  });

  it('leaves out laps with any of the flags named', () => {
    db.recordLap(session(), lap(91, { ledger: ledger({ flags: 0 }) }));
    db.recordLap(
      session(),
      lap(92, { ledger: ledger({ flags: LEDGER_LAP_OUT_LAP }) })
    );
    db.recordLap(
      session(),
      lap(93, { ledger: ledger({ flags: LEDGER_LAP_WET }) })
    );
    db.recordLap(
      session(),
      lap(94, { ledger: ledger({ flags: LEDGER_LAP_VOIDED | LEDGER_LAP_WET }) })
    );

    const key = ['lmu', 9, 'Ferrari 296 LMGT3 Evo'] as const;
    const times = (flags?: number) =>
      db.recentLedgerLaps(...key, 10, flags).map((row) => row.lapTime);
    expect(times()).toEqual([94, 93, 92, 91]);
    expect(times(UNCLEAN)).toEqual([93, 91]);
    expect(times(UNCLEAN | LEDGER_LAP_WET)).toEqual([91]);
  });

  it('keeps to the simulator, track and car asked for, and to laps with a ledger', () => {
    db.recordLap(session(), lap(91, { ledger: ledger({ flags: 0 }) }));
    // From before the ledger: no row to work a rate out from.
    db.recordLap(session(), lap(90));
    db.recordLap(
      session({ token: 'b', simulator: 'iracing' }),
      lap(80, { ledger: ledger({ flags: 0, stint: null }) })
    );
    db.recordLap(
      session({ token: 'c', trackId: 10 }),
      lap(81, { ledger: ledger({ flags: 0, stint: null }) })
    );
    db.recordLap(
      session({ token: 'd', carKey: 'Porsche 963' }),
      lap(82, { ledger: ledger({ flags: 0, stint: null }) })
    );

    const times = (...key: [string, number, string]) =>
      db.recentLedgerLaps(...key, 10).map((row) => row.lapTime);
    expect(times('lmu', 9, 'Ferrari 296 LMGT3 Evo')).toEqual([91]);
    expect(times('iracing', 9, 'Ferrari 296 LMGT3 Evo')).toEqual([80]);
    expect(times('lmu', 10, 'Ferrari 296 LMGT3 Evo')).toEqual([81]);
    expect(times('lmu', 9, 'Porsche 963')).toEqual([82]);
    expect(times('lmu', 11, 'Ferrari 296 LMGT3 Evo')).toEqual([]);
  });
});
