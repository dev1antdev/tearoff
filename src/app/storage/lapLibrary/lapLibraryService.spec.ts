import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  LapCurve,
  LapInput,
  LapSessionInput,
} from '../../../types/lapLibrary';
import { LapLibraryDatabase } from './LapLibraryDatabase';
import { dispatch } from './dispatch';
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

let db: LapLibraryDatabase;
const logError = vi.fn();

const setup = (maxLaps = 5000) => {
  const thread = fakeWorker(db);
  const client = createWorkerClient(thread.worker);
  const service = createLapLibraryService(client, { maxLaps, logError });
  return { service, client, ...thread };
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
  stamp = Date.UTC(2026, 10, 13, 16, 0, 0);
});

afterEach(() => {
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
