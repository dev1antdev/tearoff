import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  LapCurve,
  LapInput,
  LapLedgerInput,
  LapSessionInput,
  StintInput,
} from '../../../types/lapLibrary';
import { LEDGER_LAP_OUT_LAP } from '../../../types/ledger';
import { LapLibraryDatabase } from './LapLibraryDatabase';
import {
  dispatch,
  type LapLibraryCaller,
  type LapLibraryOpenReport,
} from './dispatch';
import { createLapLibraryService } from './lapLibraryService';
import {
  createWorkerClient,
  type WorkerLike,
  type WorkerReply,
  type WorkerRequest,
} from './workerClient';

/**
 * The service, its client and the dispatcher, wired to a real database in
 * memory through a stand-in for the worker thread. Everything but the thread
 * itself.
 */
const curve = (lapTime: number, points = 100): LapCurve => {
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
  trackLengthM: 1000,
  carKey: 'Ferrari 296 LMGT3 Evo',
  carName: 'Kessel Racing #74',
  sessionType: 'Race',
  sessionName: 'Race',
  ...overrides,
});

let stamp = 0;
const lap = (lapTime: number, overrides: Partial<LapInput> = {}): LapInput => ({
  lapNumber: 1,
  lapTime,
  completedAt: (stamp += 1000),
  complete: true,
  pit: false,
  voided: false,
  own: true,
  incidents: 0,
  fuelUsed: null,
  energyUsed: null,
  airTemp: null,
  trackTemp: null,
  curve: curve(lapTime),
  ...overrides,
});

/** A worker thread that answers on the next turn of the event loop. */
const fakeWorker = (db: LapLibraryDatabase) => {
  const listeners = {
    message: [] as ((reply: WorkerReply) => void)[],
    error: [] as ((error: unknown) => void)[],
    exit: [] as ((code: number) => void)[],
  };
  const seen: string[] = [];
  const worker: WorkerLike = {
    postMessage(request: WorkerRequest) {
      seen.push(request.method);
      setTimeout(() => {
        let reply: WorkerReply;
        try {
          reply =
            request.method === 'close'
              ? { id: request.id, result: true }
              : {
                  id: request.id,
                  // Cloned, as a real thread boundary would.
                  result: structuredClone(
                    dispatch(db, request.method, structuredClone(request.args))
                  ),
                };
        } catch (error) {
          reply = { id: request.id, error: (error as Error).message };
        }
        for (const listener of listeners.message) listener(reply);
      }, 0);
    },
    on(event: 'message' | 'error' | 'exit', listener: never) {
      listeners[event].push(listener);
      return worker;
    },
    terminate: () => Promise.resolve(0),
  };
  return {
    worker,
    seen,
    crash: (error: Error) => {
      for (const listener of listeners.error) listener(error);
    },
  };
};

const KEY = ['lmu', 9, 'Ferrari 296 LMGT3 Evo', 100] as const;

const stintInput = (
  overrides: Partial<StintInput['stint']> = {}
): StintInput => ({
  stint: {
    id: 'run-1:1',
    ordinal: 1,
    sessionNum: 0,
    driver: 'A. Driver',
    own: true,
    openedBy: 'pitExit',
    closedBy: null,
    startTime: 100,
    endTime: null,
    startLap: 0,
    endLap: null,
    laps: 1,
    startFuel: 50,
    endFuel: null,
    startEnergy: null,
    endEnergy: null,
    startTread: [1, 1, 1, 1],
    endTread: [null, null, null, null],
    startBrake: [null, null, null, null],
    endBrake: [null, null, null, null],
    compounds: ['Medium', 'Medium', 'Medium', 'Medium'],
    bestLap: null,
    avgLap: null,
    cleanLaps: 0,
    paceDelta: null,
    consistency: null,
    passes: [],
    stop: null,
    ...overrides,
  },
  startedAt: 1000,
  endedAt: null,
});

const ledger = (overrides: Partial<LapLedgerInput> = {}): LapLedgerInput => ({
  stint: stintInput(),
  sessionNum: 0,
  stintLap: 1,
  startTime: 100,
  endTime: 190,
  simLapTime: null,
  flags: 0,
  fuelAtLine: 47.6,
  fuelAdded: 0,
  energyAtLine: null,
  energyAdded: 0,
  treadAtLine: [0.99, 0.99, 0.99, 0.99],
  treadUsed: [0.01, 0.01, 0.01, 0.01],
  brakeAtLine: [null, null, null, null],
  brakeUsed: [null, null, null, null],
  compounds: ['Medium', 'Medium', 'Medium', 'Medium'],
  sectors: [30, 30, 30],
  wetness: 1,
  rain: 0,
  position: 5,
  classPosition: 2,
  ...overrides,
});

let db: LapLibraryDatabase;
const logError = vi.fn();
const logInfo = vi.fn();

const setup = (maxLaps = 5000) => {
  const thread = fakeWorker(db);
  const client = createWorkerClient(thread.worker);
  const service = createLapLibraryService(client, {
    maxLaps,
    logError,
    logInfo,
  });
  return { service, client, ...thread };
};

/** A library whose file answered `status` this way and nothing else. */
const setupWithStatus = (report: Partial<LapLibraryOpenReport> | Error) => {
  const asked: string[] = [];
  const caller: LapLibraryCaller = {
    call: ((method: string) => {
      asked.push(method);
      if (method === 'status' && !(report instanceof Error)) {
        return Promise.resolve({
          available: true,
          reason: null,
          message: null,
          schemaVersion: 2,
          upgradedFrom: null,
          backupName: null,
          ...report,
        });
      }
      if (method === 'prune') return Promise.resolve(0);
      return Promise.reject(
        report instanceof Error ? report : new Error(String(report.message))
      );
    }) as LapLibraryCaller['call'],
  };
  const service = createLapLibraryService(caller, {
    maxLaps: 5000,
    logError,
    logInfo,
  });
  return { service, asked };
};

/** Lets every queued request and reply run. */
const settle = async () => {
  for (let turn = 0; turn < 6; turn += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

beforeEach(() => {
  db = new LapLibraryDatabase(':memory:');
  logError.mockReset();
  logInfo.mockReset();
  stamp = Date.UTC(2026, 10, 13, 16, 0, 0);
});

afterEach(async () => {
  // Whatever a service still has on its way is answered first: a request
  // that reached the database after it closed would be logged as a failure
  // in the middle of the next test.
  await settle();
  db.close();
});

describe('lap library service: recording', () => {
  it('stores a lap and announces the change', async () => {
    const { service } = setup();
    const changed = vi.fn();
    service.onChanged(changed);

    service.recordLap(session(), lap(90));
    await settle();

    expect(await service.getStats()).toEqual({ sessions: 1, laps: 1 });
    expect(changed).toHaveBeenCalledOnce();
    const [listed] = await service.listSessions();
    expect((await service.listLaps(listed.id))[0].lapTime).toBe(90);
  });

  it('carries the curve across the thread boundary intact', async () => {
    const { service } = setup();
    const sent = curve(90);

    service.recordLap(session(), lap(90, { curve: sent }));
    service.referenceLap(...KEY);
    await settle();

    const reference = service.referenceLap(...KEY);
    expect(reference?.pointPos).toEqual(sent.pointPos);
    expect(reference?.times).toEqual(sent.times);
  });

  it('logs a lap that could not be stored instead of throwing', async () => {
    const { service } = setup();
    db.close();
    db = new LapLibraryDatabase(':memory:');

    // The closed database refuses the insert.
    expect(() => service.recordLap(session(), lap(90))).not.toThrow();
    await settle();

    expect(logError).toHaveBeenCalled();
  });

  it('stops telling a listener that has unsubscribed', async () => {
    const { service } = setup();
    const changed = vi.fn();
    const unsubscribe = service.onChanged(changed);
    unsubscribe();

    service.recordLap(session(), lap(90));
    await settle();

    expect(changed).not.toHaveBeenCalled();
  });

  it('keeps the library under its cap', async () => {
    const { service } = setup(30);

    for (let index = 0; index < 60; index += 1) {
      service.recordLap(session(), lap(90 + index));
    }
    await settle();
    await settle();

    // Checked every 25 laps, so it sits at the cap after the last check.
    const { laps } = await service.getStats();
    expect(laps).toBeLessThanOrEqual(40);
    expect(laps).toBeGreaterThanOrEqual(30);
  });
});

describe('lap library service: the ledger and the stints', () => {
  it('carries a lap with its ledger and stint across the thread boundary', async () => {
    const { service } = setup();
    const changed = vi.fn();
    service.onChanged(changed);

    service.recordLap(session(), lap(90, { ledger: ledger() }));
    await settle();

    expect(logError).not.toHaveBeenCalled();
    expect(changed).toHaveBeenCalledOnce();
    const [listed] = await service.listSessions();
    const [stored] = await service.listLaps(listed.id);
    expect(stored.ledger).toMatchObject({
      stintId: 'run-1:1',
      fuelAtLine: 47.6,
      treadUsed: [0.01, 0.01, 0.01, 0.01],
      sectors: [30, 30, 30],
    });
    expect(await service.listStints(listed.id)).toMatchObject([
      { id: 'run-1:1', rowId: 1, sessionId: listed.id, laps: 1, startFuel: 50 },
    ]);
  });

  it('brings a stint up to date when it closes, and announces it', async () => {
    const { service } = setup();
    service.recordLap(session(), lap(90, { ledger: ledger() }));
    await settle();
    const changed = vi.fn();
    service.onChanged(changed);

    service.upsertStint(session(), {
      ...stintInput({ closedBy: 'garage', endTime: 400, endLap: 1 }),
      endedAt: 5000,
    });
    await settle();

    expect(changed).toHaveBeenCalledOnce();
    const [listed] = await service.listSessions();
    expect(await service.listStints(listed.id)).toMatchObject([
      { closedBy: 'garage', endTime: 400, endedAt: 5000 },
    ]);
  });

  it('tells nobody of a stint the library does not keep', async () => {
    const { service } = setup();
    const changed = vi.fn();
    service.onChanged(changed);

    // Its session has no lap yet.
    service.upsertStint(session(), stintInput({ laps: 0 }));
    await settle();

    expect(changed).not.toHaveBeenCalled();
    expect(logError).not.toHaveBeenCalled();
    expect(await service.getStats()).toEqual({ sessions: 0, laps: 0 });
  });

  it('logs a stint that could not be stored instead of throwing', async () => {
    const { service } = setup();

    expect(() =>
      service.upsertStint(session(), stintInput({ id: '' }))
    ).not.toThrow();
    await settle();

    expect(logError).toHaveBeenCalledWith(
      '[LapLibrary] Could not store a stint:',
      expect.any(Error)
    );
  });

  it('keeps a lap whose ledger could not be stored, and says so', async () => {
    const { service } = setup();

    service.recordLap(
      session(),
      lap(90, { ledger: ledger({ flags: Number.NaN }) })
    );
    await settle();

    expect(await service.getStats()).toEqual({ sessions: 1, laps: 1 });
    expect(logError).toHaveBeenCalledWith(
      '[LapLibrary] A lap was stored without its ledger:',
      expect.stringContaining('flags')
    );
  });

  it('lists the latest ledger laps of a track and car', async () => {
    const { service } = setup();
    service.recordLap(session(), lap(91, { ledger: ledger() }));
    service.recordLap(
      session(),
      lap(92, { ledger: ledger({ flags: LEDGER_LAP_OUT_LAP }) })
    );
    service.recordLap(session(), lap(93, { ledger: ledger() }));
    await settle();

    const recent = await service.recentLedgerLaps(
      'lmu',
      9,
      'Ferrari 296 LMGT3 Evo',
      5,
      LEDGER_LAP_OUT_LAP
    );

    expect(recent.map((row) => row.lapTime)).toEqual([93, 91]);
  });
});

describe('lap library service: a library that could not be opened', () => {
  it('says the library is in use when it is', async () => {
    const { service } = setup();

    expect(await service.getStatus()).toEqual({
      available: true,
      reason: null,
    });
    expect(logError).not.toHaveBeenCalled();
    expect(logInfo).not.toHaveBeenCalled();
  });

  it('says why not, once, and records nothing', async () => {
    const { service, asked } = setupWithStatus({
      available: false,
      reason: 'newer',
      message: 'The lap library is at schema 3, newer than this build',
      schemaVersion: null,
    });

    expect(await service.getStatus()).toEqual({
      available: false,
      reason: 'newer',
    });
    for (let index = 0; index < 5; index += 1) {
      service.recordLap(session(), lap(90));
      service.upsertStint(session(), stintInput());
    }
    await settle();

    // Nothing was asked of the file after it said what it was: no lap, no
    // stint, and no pruning of a library this build may not touch.
    expect(asked).toEqual(['status']);
    expect(logError).toHaveBeenCalledExactlyOnceWith(
      '[LapLibrary] The lap library is not in use and laps are not being recorded:',
      'The lap library is at schema 3, newer than this build'
    );
    // The page still gets a refusal it can show, not a hang.
    await expect(service.listSessions()).rejects.toThrow(/newer/);
  });

  it('treats a thread that never started as a library that could not be read', async () => {
    const { service } = setupWithStatus(new Error('Cannot find module'));

    expect(await service.getStatus()).toEqual({
      available: false,
      reason: 'unreadable',
    });
    expect(() => service.recordLap(session(), lap(90))).not.toThrow();
    expect(logError).toHaveBeenCalledExactlyOnceWith(
      '[LapLibrary] The lap library is not in use and laps are not being recorded:',
      'Cannot find module'
    );
  });

  it('notes an upgrade and where the old file was kept', async () => {
    const { service, asked } = setupWithStatus({
      upgradedFrom: 1,
      backupName: 'laps.v1.bak.db',
    });
    await settle();

    expect(await service.getStatus()).toEqual({
      available: true,
      reason: null,
    });
    expect(logInfo).toHaveBeenCalledExactlyOnceWith(
      '[LapLibrary] Upgraded the lap library from schema 1 to 2; the file as it was is kept beside it as laps.v1.bak.db'
    );
    // And then carries on as usual, starting with the cap.
    expect(asked).toEqual(['status', 'prune']);
  });
});

describe('lap library service: the reference lap', () => {
  it('has none on the first ask, then answers once the database has', async () => {
    const { service } = setup();
    service.recordLap(session(), lap(90));
    await settle();
    const before = service.referenceRevision();

    // Read on the telemetry path: it cannot wait for a thread.
    expect(service.referenceLap(...KEY)).toBeNull();
    await settle();

    const reference = service.referenceLap(...KEY);
    expect(reference?.finishTime).toBe(90);
    expect(reference?.startTime).toBe(0);
    expect(reference?.pointsCount).toBe(100);
    expect(reference?.isCleanLap).toBe(true);
    expect(service.referenceRevision()).toBeGreaterThan(before);
  });

  it('hands back the same object while the reference is the same lap', async () => {
    const { service } = setup();
    service.recordLap(session(), lap(90));
    service.referenceLap(...KEY);
    await settle();
    const first = service.referenceLap(...KEY);
    const revision = service.referenceRevision();

    // A slower lap changes nothing about the reference.
    service.recordLap(session(), lap(93));
    await settle();

    expect(service.referenceLap(...KEY)).toBe(first);
    expect(service.referenceRevision()).toBe(revision);
  });

  it('moves to a quicker lap as soon as it is recorded', async () => {
    const { service } = setup();
    service.recordLap(session(), lap(90));
    service.referenceLap(...KEY);
    await settle();
    const revision = service.referenceRevision();

    service.recordLap(session(), lap(88));
    await settle();

    expect(service.referenceLap(...KEY)?.finishTime).toBe(88);
    expect(service.referenceRevision()).toBeGreaterThan(revision);
  });

  it('does not ask the database again for a lap that cannot be a reference', async () => {
    const { service, seen } = setup();
    service.referenceLap(...KEY);
    await settle();
    const asked = seen.filter((method) => method === 'referenceLap').length;

    service.recordLap(session(), lap(80, { pit: true }));
    await settle();

    expect(seen.filter((method) => method === 'referenceLap')).toHaveLength(
      asked
    );
    expect(service.referenceLap(...KEY)).toBeNull();
  });

  it('follows a lap being deleted', async () => {
    const { service } = setup();
    service.recordLap(session(), lap(92));
    service.recordLap(session(), lap(90));
    service.referenceLap(...KEY);
    await settle();
    const [listed] = await service.listSessions();
    const quick = (await service.listLaps(listed.id)).find(
      (row) => row.lapTime === 90
    );

    expect(await service.deleteLap(quick?.id ?? -1)).toBe(true);
    await settle();

    expect(service.referenceLap(...KEY)?.finishTime).toBe(92);
  });

  it('has none again when the last lap is deleted', async () => {
    const { service } = setup();
    service.recordLap(session(), lap(90));
    service.referenceLap(...KEY);
    await settle();
    const [listed] = await service.listSessions();
    const revision = service.referenceRevision();

    await service.deleteSession(listed.id);
    await settle();

    expect(service.referenceLap(...KEY)).toBeNull();
    expect(service.referenceRevision()).toBeGreaterThan(revision);
  });

  it('follows a lap being chosen by hand, and released', async () => {
    const { service } = setup();
    service.recordLap(session(), lap(92));
    service.recordLap(session(), lap(90));
    service.referenceLap(...KEY);
    await settle();
    const [listed] = await service.listSessions();
    const slow = (await service.listLaps(listed.id)).find(
      (row) => row.lapTime === 92
    );

    await service.pinReference(slow?.id ?? -1);
    await settle();
    expect(service.referenceLap(...KEY)?.finishTime).toBe(92);

    await service.unpinReference(slow?.id ?? -1);
    await settle();
    expect(service.referenceLap(...KEY)?.finishTime).toBe(90);
  });

  it('keeps each track, car and track length apart', async () => {
    const { service } = setup();
    service.recordLap(session(), lap(90));
    service.recordLap(session({ token: 'b', trackId: 10 }), lap(80));
    service.referenceLap(...KEY);
    service.referenceLap('lmu', 10, KEY[2], 100);
    service.referenceLap('lmu', 9, KEY[2], 120);
    await settle();

    expect(service.referenceLap(...KEY)?.finishTime).toBe(90);
    expect(service.referenceLap('lmu', 10, KEY[2], 100)?.finishTime).toBe(80);
    // No lap of that length on this track.
    expect(service.referenceLap('lmu', 9, KEY[2], 120)).toBeNull();
  });

  it('says nothing changed, and tells nobody, when a delete finds nothing', async () => {
    const { service } = setup();
    const changed = vi.fn();
    service.onChanged(changed);

    expect(await service.deleteLap(404)).toBe(false);
    expect(await service.pinReference(404)).toBe(false);

    expect(changed).not.toHaveBeenCalled();
  });
});

describe('lap library worker client', () => {
  it('refuses a method that is not on the list', async () => {
    const { client } = setup();

    await expect(
      (client.call as (method: string) => Promise<unknown>)('constructor')
    ).rejects.toThrow(/Unknown lap library method/);
  });

  it('refuses everything pending and everything after when the thread dies', async () => {
    const { service, client, crash } = setup();
    await settle();

    const pending = client.call('stats');
    crash(new Error('out of memory'));

    await expect(pending).rejects.toThrow('out of memory');
    await expect(service.listSessions()).rejects.toThrow('out of memory');
    // Recording still does not throw into the telemetry path.
    expect(() => service.recordLap(session(), lap(90))).not.toThrow();
  });

  it('refuses calls after it is closed', async () => {
    const { client } = setup();
    await settle();

    await client.close();

    await expect(client.call('stats')).rejects.toThrow(/closed/);
  });
});
