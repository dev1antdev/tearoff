import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RaceWriteBatch } from '../../../types/raceHistory';
import { isRecordedSource } from '../../tapeReplaySource';
import { dispatch, type LapLibraryCaller } from './dispatch';
import { LapLibraryDatabase } from './LapLibraryDatabase';
import {
  raceChange,
  raceInfo,
  raceLap,
  raceStint,
} from './raceHistoryRowsFixture';
import {
  createRaceHistoryStore,
  type RaceHistoryStoreOptions,
  type RaceWriteHead,
} from './raceHistoryStore';

/**
 * The store in front of the race tables, through the real dispatcher and a
 * real database in a file of its own under the system's temporary folder.
 * Everything but the worker thread: a stand-in answers on the next turn of
 * the event loop, with what crossed to it copied as a thread would copy it.
 */

let directory: string;
let db: LapLibraryDatabase;
/** Every call that reached the worker, in order. */
let calls: { method: string; args: unknown[] }[];
let errors: string[];

const caller = (
  options: { available?: boolean; failWrites?: number } = {}
): LapLibraryCaller => {
  let failures = options.failWrites ?? 0;
  return {
    call: (method: string, ...args: unknown[]) =>
      new Promise<unknown>((resolve, reject) => {
        // Copied at the moment of sending, as postMessage does.
        const sent = structuredClone(args);
        calls.push({ method, args: sent });
        setTimeout(() => {
          try {
            if (method === 'status' && options.available === false) {
              resolve({ available: false, reason: 'newer', message: 'newer' });
              return;
            }
            if (options.available === false) {
              throw new Error('The lap library is from a newer build');
            }
            if (method === 'raceWrite' && failures > 0) {
              failures -= 1;
              throw new Error('disk full');
            }
            resolve(structuredClone(dispatch(db, method, sent)));
          } catch (error) {
            reject(error as Error);
          }
        }, 0);
      }),
  } as unknown as LapLibraryCaller;
};

const store = (
  client: LapLibraryCaller = caller(),
  options: Partial<RaceHistoryStoreOptions> = {}
) =>
  createRaceHistoryStore(client, {
    maxRaces: 20,
    // Long enough that only a flush asked for writes, unless a spec says.
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

const turn = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tearoff-race-store-'));
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

describe('rows on their way into the file', () => {
  it('wait, and go together as one batch', async () => {
    const races = store();
    const race = head();

    for (let lap = 1; lap <= 5; lap += 1) {
      races.queueLap(race, raceLap(0, lap));
      races.queueLap(race, raceLap(7, lap));
    }
    races.queueStint(race, raceStint(0, 1));
    races.queueStint(race, raceStint(7, 1));
    races.queueDriverChange(race, raceChange(0, 1));
    await turn();
    // Nothing has been written for having been queued.
    expect(writes()).toEqual([]);

    await races.flush();

    expect(writes()).toHaveLength(1);
    expect(writes()[0]).toMatchObject({ raceId: null, token: 'boot1:1' });
    expect(writes()[0].laps).toHaveLength(10);
    expect(writes()[0].stints).toHaveLength(2);
    expect(writes()[0].driverChanges).toHaveLength(1);
    const [stored] = await races.listRaces();
    expect(stored).toMatchObject({ laps: 10, cars: 2 });
    expect(await races.carLaps(stored.id, 7)).toHaveLength(5);
  });

  it('go by themselves, a little after the first of them', async () => {
    const races = store(caller(), { writeIntervalMs: 15 });
    const race = head();

    races.queueLap(race, raceLap(0, 1));
    await new Promise((resolve) => setTimeout(resolve, 5));
    races.queueLap(race, raceLap(0, 2));
    expect(writes()).toEqual([]);
    await vi.waitFor(() => expect(writes()).toHaveLength(1));

    // One write for both, not one each.
    expect(writes()[0].laps).toHaveLength(2);
    // And the next row starts the clock again.
    races.queueLap(race, raceLap(0, 3));
    await vi.waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes()[1].laps).toHaveLength(1);
  });

  it('go once, as they last stood, however often they changed while waiting', async () => {
    const races = store();
    const race = head();
    const stint = raceStint(0, 1, { laps: 1, lastLap: 1 });
    const lap = raceLap(0, 1, { lapTime: null });

    races.queueLap(race, lap);
    races.queueStint(race, stint);
    // The stint grows with every lap, and the lap is given its time.
    for (let laps = 2; laps <= 6; laps += 1) {
      stint.laps = laps;
      stint.lastLap = laps;
      races.queueStint(race, stint);
    }
    lap.lapTime = 211.5;
    races.queueLap(race, lap);
    await races.flush();

    expect(writes()).toHaveLength(1);
    expect(writes()[0].laps).toEqual([{ ...lap, lapTime: 211.5 }]);
    expect(writes()[0].stints).toMatchObject([{ laps: 6, lastLap: 6 }]);
  });

  it('are written under the race’s row once it has one', async () => {
    const races = store();
    const race = head();
    const stored: [string, number][] = [];
    const stop = races.onStored((token, raceId) =>
      stored.push([token, raceId])
    );

    races.queueLap(race, raceLap(0, 1));
    await races.flush();
    races.queueLap(race, raceLap(0, 2));
    await races.flush();

    const [{ id }] = await races.listRaces();
    expect(stored).toEqual([
      ['boot1:1', id],
      ['boot1:1', id],
    ]);
    expect(writes().map((batch) => batch.raceId)).toEqual([null, id]);
    expect(await races.carLaps(id, 0)).toHaveLength(2);

    stop();
    races.queueLap(race, raceLap(0, 3));
    await races.flush();
    expect(stored).toHaveLength(2);
  });

  it('go into the row of a race carried on after a restart', async () => {
    const first = store();
    first.queueLap(head('boot1:1'), raceLap(0, 1));
    await first.flush();
    const [{ id }] = await first.listRaces();

    // Another run of the app, and the race found in the file.
    const second = store();
    const carried: RaceWriteHead = {
      token: 'boot2:1',
      info: raceInfo({ id }),
    };
    second.queueLap(carried, raceLap(0, 4));
    await second.flush();

    expect(writes().at(-1)).toMatchObject({ raceId: id, token: 'boot2:1' });
    expect(await second.listRaces()).toHaveLength(1);
    expect((await second.carLaps(id, 0)).map((lap) => lap.lap)).toEqual([1, 4]);
  });

  it('are written race by race, in the order the races began', async () => {
    const races = store();

    races.queueLap(head('boot1:1'), raceLap(0, 30));
    races.queueLap(head('boot1:2'), raceLap(0, 1));
    races.queueLap(head('boot1:1'), raceLap(0, 31));
    await races.flush();

    expect(writes().map((batch) => [batch.token, batch.laps.length])).toEqual([
      ['boot1:1', 2],
      ['boot1:2', 1],
    ]);
    expect(await races.listRaces()).toHaveLength(2);
  });

  it('bring the race’s own row up to date when only its entry list changed', async () => {
    const races = store();
    const race = head();
    races.queueLap(race, raceLap(0, 1));
    await races.flush();

    race.info = raceInfo({
      entries: [...raceInfo().entries, { ...raceInfo().entries[0], carIdx: 9 }],
    });
    races.queueInfo(race);
    await races.flush();

    expect(writes()[1]).toMatchObject({ laps: [], stints: [] });
    expect((await races.listRaces())[0].entries).toHaveLength(3);
  });

  it('let go of what was waiting for a slot another car has taken', async () => {
    const races = store();
    const race = head();
    races.queueLap(race, raceLap(0, 1));
    races.queueLap(race, raceLap(7, 1));
    races.queueLap(race, raceLap(7, 2));
    await races.flush();

    races.queueLap(race, raceLap(7, 3));
    races.queueStint(race, raceStint(7, 1));
    races.queueDriverChange(race, raceChange(7, 1));
    races.queueCarReplaced(race, 7);
    races.queueLap(race, raceLap(7, 1, { driver: 'The Newcomer' }));
    await races.flush();

    expect(writes()[1]).toMatchObject({
      replacedCars: [7],
      stints: [],
      driverChanges: [],
    });
    const [{ id }] = await races.listRaces();
    expect(await races.carLaps(id, 7)).toMatchObject([
      { lap: 1, driver: 'The Newcomer' },
    ]);
    expect(await races.carLaps(id, 0)).toHaveLength(1);
  });

  it('keep the file to as many races as it is told to', async () => {
    const races = store(caller(), { maxRaces: 3 });
    for (let index = 1; index <= 5; index += 1) {
      races.queueLap(
        {
          token: `boot${index}:1`,
          info: raceInfo({ updatedAt: raceInfo().updatedAt + index * 1000 }),
        },
        raceLap(0, 1)
      );
      await races.flush();
    }

    expect(writes().every((batch) => batch.maxRaces === 3)).toBe(true);
    expect(await races.listRaces()).toHaveLength(3);
  });
});

describe('a write that cannot be made', () => {
  it('is logged, never thrown, and does not stop the ones after it', async () => {
    const races = store(caller({ failWrites: 1 }));
    const race = head();

    races.queueLap(race, raceLap(0, 1));
    await expect(races.flush()).resolves.toBeUndefined();

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('Could not store 1 lap(s) of a race');
    expect(errors[0]).toContain('disk full');
    expect(await races.listRaces()).toEqual([]);

    races.queueLap(race, raceLap(0, 2));
    await races.flush();
    expect((await races.listRaces())[0]).toMatchObject({ laps: 1 });
  });

  it('is not tried at all while the library’s file could not be opened', async () => {
    const races = store(caller({ available: false }));
    await turn();
    await turn();

    races.queueLap(head(), raceLap(0, 1));
    races.queueStint(head(), raceStint(0, 1));
    await races.flush();

    expect(writes()).toEqual([]);
    // And every question has an empty answer rather than an error.
    expect(await races.listRaces()).toEqual([]);
    expect(await races.findCandidates('lmu', 1, 'Race')).toEqual([]);
    expect(await races.load(1)).toBeNull();
    expect(await races.carLaps(1, 0)).toEqual([]);
    expect(await races.carStints(1, 0)).toEqual([]);
    expect(await races.driverChanges(1)).toEqual([]);
    expect(await races.events(1)).toEqual([]);
    expect(calls.map((call) => call.method)).toEqual(['status']);
    expect(errors).toEqual([]);
  });

  it('answers a question the file cannot with an empty answer, and says so', async () => {
    const broken = {
      call: (method: string) =>
        method === 'status'
          ? Promise.resolve({ available: true })
          : Promise.reject(new Error('the worker exited')),
    } as unknown as LapLibraryCaller;
    const races = store(broken);

    expect(await races.listRaces()).toEqual([]);
    expect(await races.load(4)).toBeNull();
    expect(await races.carLaps(4, 0)).toEqual([]);
    expect(errors).toHaveLength(3);
    expect(errors[0]).toContain('Could not read the races kept');
  });
});

describe('a source that is not the player’s own racing', () => {
  it('has nothing written while writing is not allowed', async () => {
    let allowed = false;
    const races = store(caller(), { canWrite: () => allowed });
    const race = head();

    races.queueLap(race, raceLap(0, 1));
    races.queueStint(race, raceStint(0, 1));
    races.queueDriverChange(race, raceChange(0, 1));
    races.queueInfo(race);
    races.queueCarReplaced(race, 0);
    await races.flush();

    expect(writes()).toEqual([]);

    // Not kept for later either: what was refused is gone.
    allowed = true;
    await races.flush();
    expect(writes()).toEqual([]);
    expect(await races.listRaces()).toEqual([]);
  });

  it('has nothing written when writing stops being allowed before the write', async () => {
    let allowed = true;
    const races = store(caller(), { canWrite: () => allowed });

    races.queueLap(head(), raceLap(0, 1));
    allowed = false;
    await races.flush();

    expect(writes()).toEqual([]);
  });

  it('is a recording played back in place of a simulator, by the app’s own test', async () => {
    // The guard the app builds its store with.
    const races = store(caller(), { canWrite: () => !isRecordedSource() });
    vi.stubEnv('IRDASHIES_LMU_REPLAY', 'C:\\tapes\\race.lmudt');

    races.queueLap(head(), raceLap(0, 1));
    await races.flush();
    expect(writes()).toEqual([]);

    vi.stubEnv('IRDASHIES_LMU_REPLAY', '');
    vi.stubEnv('IRDASHIES_TELEMETRY_REPLAY', 'C:\\tapes\\race.irdt');
    races.queueLap(head(), raceLap(0, 2));
    await races.flush();
    expect(writes()).toEqual([]);

    // A capture played through the isolated SDK addon is one as well.
    vi.stubEnv('IRDASHIES_TELEMETRY_REPLAY', '');
    vi.stubEnv('IRDASHIES_IRSDK_REPLAY', '1');
    races.queueLap(head(), raceLap(0, 2));
    await races.flush();
    expect(writes()).toEqual([]);

    vi.stubEnv('IRDASHIES_IRSDK_REPLAY', '');
    races.queueLap(head(), raceLap(0, 3));
    await races.flush();
    expect(writes()).toHaveLength(1);
    expect(writes()[0].laps).toMatchObject([{ lap: 3 }]);
  });
});

describe('questions asked of the file', () => {
  it('are answered from it', async () => {
    const races = store();
    const race = head();
    races.queueLap(race, raceLap(0, 1));
    races.queueLap(race, raceLap(0, 2));
    races.queueStint(race, raceStint(0, 1));
    races.queueDriverChange(race, raceChange(0, 1));
    await races.flush();
    const [{ id }] = await races.listRaces();

    expect(await races.findCandidates('lmu', 694510461, 'Race')).toMatchObject([
      { info: { id }, lastLaps: [{ carIdx: 0, lap: 2 }] },
    ]);
    expect(await races.findCandidates('lmu', 694510461, 'Practice')).toEqual(
      []
    );
    expect(await races.load(id)).toEqual({
      laps: [raceLap(0, 1), raceLap(0, 2)],
      stints: [raceStint(0, 1)],
      driverChanges: [raceChange(0, 1)],
      events: [],
    });
    expect(await races.carStints(id, 0)).toEqual([raceStint(0, 1)]);
    expect(await races.driverChanges(id)).toEqual([raceChange(0, 1)]);
    expect(await races.load(id + 1)).toBeNull();
  });
});
