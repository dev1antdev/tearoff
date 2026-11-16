import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RaceWriteBatch } from '../../../types/raceHistory';
import type { RacePitExitEvent } from '../../../types/raceLog';
import { isRecordedSource } from '../../tapeReplaySource';
import { dispatch, type LapLibraryCaller } from './dispatch';
import { LapLibraryDatabase } from './LapLibraryDatabase';
import { raceEvent, raceInfo, raceLap } from './raceHistoryRowsFixture';
import {
  createRaceHistoryStore,
  type RaceHistoryStoreOptions,
  type RaceWriteHead,
} from './raceHistoryStore';

/**
 * The race's log on its way into the file and back: the store in front of
 * the race tables, through the real dispatcher and a real database in a
 * file of its own under the system's temporary folder. Everything but the
 * worker thread: a stand-in answers on the next turn of the event loop,
 * with what crossed to it copied as a thread would copy it.
 */

let directory: string;
let db: LapLibraryDatabase;
/** Every call that reached the worker, in order. */
let calls: { method: string; args: unknown[] }[];
let errors: string[];

const caller = (): LapLibraryCaller =>
  ({
    call: (method: string, ...args: unknown[]) =>
      new Promise<unknown>((resolve, reject) => {
        // Copied at the moment of sending, as postMessage does.
        const sent = structuredClone(args);
        calls.push({ method, args: sent });
        setTimeout(() => {
          try {
            resolve(structuredClone(dispatch(db, method, sent)));
          } catch (error) {
            reject(error as Error);
          }
        }, 0);
      }),
  }) as unknown as LapLibraryCaller;

const store = (options: Partial<RaceHistoryStoreOptions> = {}) =>
  createRaceHistoryStore(caller(), {
    maxRaces: 20,
    // Long enough that only a flush asked for writes.
    writeIntervalMs: 60_000,
    logError: (message, error) => errors.push(`${message} ${String(error)}`),
    ...options,
  });

const head = (token = 'boot1:1'): RaceWriteHead => ({
  token,
  info: raceInfo(),
});

const writes = (): RaceWriteBatch[] =>
  calls
    .filter((call) => call.method === 'raceWrite')
    .map((call) => call.args[0] as RaceWriteBatch);

const exit = (seq: number): RacePitExitEvent => ({
  seq,
  sessionTime: seq * 60.5,
  timeOfDay: null,
  carIdx: 7,
  kind: 'pit-exit',
  standingTime: 31.5,
  laneTime: 58.25,
  driverFrom: '',
  driverTo: '',
});

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tearoff-race-log-'));
  db = new LapLibraryDatabase(path.join(directory, 'laps.db'));
  calls = [];
  errors = [];
});

afterEach(() => {
  db.close();
  // The exact mkdtemp result, never a real application folder.
  fs.rmSync(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe('events on their way into the file', () => {
  it('wait, and go in the batch the laps go in', async () => {
    const races = store();
    const race = head();

    races.queueLap(race, raceLap(0, 1));
    races.queueEvent(race, raceEvent(1));
    races.queueEvent(race, raceEvent(2, 7));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(writes()).toEqual([]);

    await races.flush();

    expect(writes()).toHaveLength(1);
    expect(writes()[0].laps).toHaveLength(1);
    expect(writes()[0].events).toEqual([raceEvent(1), raceEvent(2, 7)]);
    const [{ id }] = await races.listRaces();
    expect(await races.events(id)).toEqual([raceEvent(1), raceEvent(2, 7)]);
    expect((await races.load(id))?.events).toHaveLength(2);
  });

  it('go once, as they last stood: a stop given its driver change while waiting', async () => {
    const races = store();
    const race = head();
    const stop = exit(3);

    races.queueEvent(race, stop);
    stop.driverFrom = 'A. Petrov';
    stop.driverTo = 'M. Ivanov';
    races.queueEvent(race, stop);
    await races.flush();

    expect(writes()[0].events).toEqual([
      { ...exit(3), driverFrom: 'A. Petrov', driverTo: 'M. Ivanov' },
    ]);
  });

  it('are written again when they change after they went', async () => {
    const races = store();
    const race = head();
    const stop = exit(3);
    races.queueEvent(race, stop);
    await races.flush();

    stop.driverFrom = 'A. Petrov';
    stop.driverTo = 'M. Ivanov';
    races.queueEvent(race, stop);
    await races.flush();

    const [{ id }] = await races.listRaces();
    expect(await races.events(id)).toEqual([
      { ...exit(3), driverFrom: 'A. Petrov', driverTo: 'M. Ivanov' },
    ]);
  });

  it('are not written at all when they went at the cap while waiting', async () => {
    const races = store();
    const race = head();
    races.queueEvent(race, raceEvent(1));
    races.queueEvent(race, raceEvent(2));
    await races.flush();

    races.queueEvent(race, raceEvent(3));
    races.queueEvent(race, raceEvent(4));
    // One that is in the file, and one that never got there.
    races.queueEventsRemoved(race, [1, 3]);
    await races.flush();

    expect(writes()[1]).toMatchObject({
      events: [raceEvent(4)],
      removedEvents: [1, 3],
    });
    const [{ id }] = await races.listRaces();
    expect((await races.events(id)).map((event) => event.seq)).toEqual([2, 4]);
  });

  it('are written after all when an event comes back under a number that went', async () => {
    // Not something the log does, but the two lists must not disagree.
    const races = store();
    const race = head();
    races.queueEvent(race, raceEvent(1));
    races.queueEventsRemoved(race, [1]);
    races.queueEvent(race, raceEvent(1, 7));
    await races.flush();

    expect(writes()[0]).toMatchObject({
      events: [raceEvent(1, 7)],
      removedEvents: [],
    });
  });

  it('are let go of with the rest that was waiting for a slot another car has taken', async () => {
    const races = store();
    const race = head();
    races.queueEvent(race, raceEvent(1, 0));
    races.queueEvent(race, raceEvent(2, 7));
    await races.flush();

    races.queueEvent(race, raceEvent(3, 7));
    races.queueEvent(race, raceEvent(4, 0));
    races.queueCarReplaced(race, 7);
    races.queueEvent(race, raceEvent(5, 7));
    await races.flush();

    expect(writes()[1]).toMatchObject({
      replacedCars: [7],
      events: [raceEvent(4, 0), raceEvent(5, 7)],
    });
    const [{ id }] = await races.listRaces();
    // What the file held of the car that left went as well.
    expect(
      (await races.events(id)).map((event) => [event.seq, event.carIdx])
    ).toEqual([
      [1, 0],
      [4, 0],
      [5, 7],
    ]);
  });
});

describe('a source that is not the player’s own racing', () => {
  it('has no event written while writing is not allowed', async () => {
    let allowed = false;
    const races = store({ canWrite: () => allowed });
    const race = head();

    races.queueEvent(race, raceEvent(1));
    races.queueEventsRemoved(race, [1]);
    await races.flush();
    expect(writes()).toEqual([]);

    // Not kept for later either: what was refused is gone.
    allowed = true;
    await races.flush();
    expect(writes()).toEqual([]);
  });

  it('has no event written when writing stops being allowed before the write', async () => {
    let allowed = true;
    const races = store({ canWrite: () => allowed });

    races.queueEvent(head(), raceEvent(1));
    allowed = false;
    await races.flush();

    expect(writes()).toEqual([]);
  });

  it('is a recording played back in place of a simulator, by the app’s own test', async () => {
    // The guard the app builds its store with.
    const races = store({ canWrite: () => !isRecordedSource() });

    for (const variable of [
      'IRDASHIES_LMU_REPLAY',
      'IRDASHIES_TELEMETRY_REPLAY',
    ]) {
      vi.stubEnv(variable, 'C:\\tapes\\race.tape');
      races.queueEvent(head(), raceEvent(1));
      await races.flush();
      expect(writes(), variable).toEqual([]);
      vi.stubEnv(variable, '');
    }
    // A capture played through the isolated SDK addon is one as well.
    vi.stubEnv('IRDASHIES_IRSDK_REPLAY', '1');
    races.queueEvent(head(), raceEvent(2));
    await races.flush();
    expect(writes()).toEqual([]);

    vi.stubEnv('IRDASHIES_IRSDK_REPLAY', '');
    races.queueEvent(head(), raceEvent(3));
    await races.flush();
    expect(writes()).toHaveLength(1);
    expect(writes()[0].events).toEqual([raceEvent(3)]);
  });
});

describe('a race’s log asked of the file', () => {
  it('is answered a page at a time, oldest first', async () => {
    const races = store();
    const race = head();
    for (let seq = 1; seq <= 250; seq += 1) {
      races.queueEvent(race, raceEvent(seq));
    }
    await races.flush();
    const [{ id }] = await races.listRaces();

    const latest = await races.events(id);
    const before = await races.events(id, latest[0].seq);

    expect([latest[0].seq, latest.at(-1)?.seq]).toEqual([51, 250]);
    expect([before[0].seq, before.at(-1)?.seq]).toEqual([1, 50]);
    expect(await races.events(id + 1)).toEqual([]);
  });

  it('is an empty answer, and said so, when the file cannot give it', async () => {
    const broken = {
      call: (method: string) =>
        method === 'status'
          ? Promise.resolve({ available: true })
          : Promise.reject(new Error('the worker exited')),
    } as unknown as LapLibraryCaller;
    const races = createRaceHistoryStore(broken, {
      maxRaces: 20,
      logError: (message, error) => errors.push(`${message} ${String(error)}`),
    });

    expect(await races.events(4)).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('Could not read a race’s log');
  });
});
