import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RaceHistorySummarySnapshot } from '@irdashies/types';
import { ChannelBus, type RendererTarget } from '../bridge/channelBus';
import { createSessionLifecycle } from '../sessionLifecycle';
import type { LapLibraryDatabase } from '../storage/lapLibrary/LapLibraryDatabase';
import type { RaceHistoryStore } from '../storage/lapLibrary/raceHistoryStore';
import type { WorkerRequest } from '../storage/lapLibrary/workerClient';
import {
  drive,
  driveLaps,
  enterPits,
  Field,
  leavePits,
  standInBox,
} from './raceHistoryFixture';
import { RaceHistoryRuntime } from './raceHistoryRuntime';
import {
  idle,
  openRaceHistoryFile,
  type RaceHistoryFile,
} from './raceHistoryStoreFixture';

/**
 * The race history through the real storage: the runtime, the store, the
 * lap library's client and dispatcher, and a real database in a file of its
 * own (see raceHistoryStoreFixture.ts). Everything but the worker thread.
 *
 * The races are staged: a small field lapping a circuit (see
 * raceHistoryFixture.ts).
 */

const CHANNEL = 'race-history.summary';
const T0 = Date.UTC(2026, 10, 16, 12, 0, 0);

let file: RaceHistoryFile;
let db: LapLibraryDatabase;
/** Every request that crossed to the worker, in order. */
let requests: WorkerRequest[];
let errors: string[];
let logs: string[];
/** Wall clock, moved by the specs. */
let wall: number;

const openStore = (canWrite?: () => boolean): RaceHistoryStore =>
  file.openStore(canWrite);
const writes = () => file.writes();
const asked = (method: string) => file.asked(method);

interface Running {
  runtime: RaceHistoryRuntime;
  bus: ChannelBus;
  lifecycle: ReturnType<typeof createSessionLifecycle>;
  metrics: {
    markStart: ReturnType<typeof vi.fn>;
    markEnd: ReturnType<typeof vi.fn>;
  };
  /** Every summary delivered to the window that subscribed, as it then was. */
  delivered: RaceHistorySummarySnapshot[];
  subscribe: () => void;
  unsubscribe: () => void;
}

const start = (
  store: RaceHistoryStore,
  options: { bootId?: string; simulator?: string; unique?: boolean } = {}
): Running => {
  const bus = new ChannelBus({
    now: () => wall,
    // Nothing is held back for later here: the runtime itself publishes no
    // more than once a second, which is this channel's rate.
    schedule: () => ({ cancel: () => undefined }),
  });
  const lifecycle = createSessionLifecycle();
  const metrics = { markStart: vi.fn(), markEnd: vi.fn() };
  const runtime = new RaceHistoryRuntime(bus, lifecycle, metrics, store, {
    simulator: () => options.simulator ?? 'lmu',
    sessionIdsAreUnique: () => options.unique ?? false,
    now: () => wall,
    bootId: options.bootId ?? 'run-a',
    log: (message) => logs.push(message),
    logError: (message, error) => errors.push(`${message} ${String(error)}`),
  });
  const delivered: RaceHistorySummarySnapshot[] = [];
  const target: RendererTarget = {
    id: 1,
    isDestroyed: () => false,
    isVisible: () => true,
    send: (_channel, _name, payload) =>
      delivered.push(structuredClone(payload as RaceHistorySummarySnapshot)),
  };
  return {
    runtime,
    bus,
    lifecycle,
    metrics,
    delivered,
    subscribe: () => bus.subscribe(target, CHANNEL),
    unsubscribe: () => bus.unsubscribe(target.id, CHANNEL),
  };
};

/** Runs a field into a runtime, with the wall clock keeping the field's. */
const run = (field: Field, running: Running, seconds: number) =>
  drive(field, { onFrame: (frame) => feed(field, running, frame) }, seconds);

const runLaps = (
  field: Field,
  running: Running,
  carIdx: number,
  laps: number
) =>
  driveLaps(
    field,
    { onFrame: (frame) => feed(field, running, frame) },
    carIdx,
    laps
  );

const feed = (
  field: Field,
  running: Running,
  frame: Parameters<RaceHistoryRuntime['onFrame']>[0]
) => {
  wall = T0 + field.time * 1000;
  running.runtime.onFrame(frame);
};

beforeEach(() => {
  file = openRaceHistoryFile();
  ({ db, requests, errors } = file);
  logs = [];
  wall = T0;
});

afterEach(() => {
  file.close();
});

describe('a race being driven', () => {
  it('lets a reader in this process work from its records as they grow', () => {
    // What counts the laps on a set of tyres reads these, once a second.
    const running = start(openStore());
    const field = new Field();
    const { records } = running.runtime;
    running.runtime.onSession(field.session());
    expect(records.raceToken()).toBe('');
    expect(records.laps(0)).toEqual([]);

    runLaps(field, running, 2, 2);
    expect(records.recording()).toBe(true);
    expect(records.raceToken()).toBe('run-a:1');
    expect(records.laps(0).map((lap) => lap.lap)).toEqual([1, 2]);
    expect(records.stints(0)).toMatchObject([
      { openedBy: 'start', closedBy: null, laps: 2 },
    ]);

    // The car's counter moves with what is kept of it.
    const revision = records.revision(0);
    runLaps(field, running, 2, 1);
    expect(records.revision(0)).toBeGreaterThan(revision);
    expect(records.laps(0)).toHaveLength(3);

    // Not recording while nothing wants the record, or a replay is loaded.
    running.runtime.updateEnabled(false);
    expect(records.recording()).toBe(false);
    running.runtime.updateEnabled(true);
    expect(records.recording()).toBe(true);
    running.runtime.setPaused(true);
    expect(records.recording()).toBe(false);
  });

  it('is stored as it is made: every lap, every stint, every driver change', async () => {
    const store = openStore();
    const field = new Field({ timeLag: 2.5 });
    const running = start(store);
    running.runtime.onSession(field.session());

    runLaps(field, running, 0, 2);
    // A stop with a driver change for car 0, then a lap more for everybody.
    run(field, running, 40);
    enterPits(field.cars[0]);
    run(field, running, 5);
    standInBox(field.cars[0]);
    run(field, running, 20);
    field.cars[0].name = 'Team-Mate';
    running.runtime.onSession(field.session());
    leavePits(field.cars[0]);
    runLaps(field, running, 2, 2);
    run(field, running, 5);
    await idle();
    await store.flush();

    const [race] = await store.listRaces();
    expect(race).toMatchObject({
      simulator: 'lmu',
      sessionType: 'Race',
      trackName: 'Road America',
      cars: 3,
    });
    expect(race.entries).toHaveLength(3);
    expect(race.tyres).toEqual([
      { index: 0, name: 'Medium' },
      { index: 1, name: 'Hard' },
    ]);
    for (let carIdx = 0; carIdx < 3; carIdx += 1) {
      const kept = await store.carLaps(race.id, carIdx);
      const held = (await running.runtime.getCarLaps(carIdx)).laps;
      // What is in the file is what is held, lap for lap.
      expect(kept).toEqual(held);
      expect(kept.length).toBeGreaterThanOrEqual(3);
      expect(kept.every((lap) => lap.lapTime !== null)).toBe(true);
      expect(await store.carStints(race.id, carIdx)).toEqual(
        (await running.runtime.getCarStints(carIdx)).filter(
          (stint) => stint.laps > 0
        )
      );
    }
    expect(await store.carStints(race.id, 0)).toMatchObject([
      { driver: 'Driver 0', closedBy: 'stop', stop: { driverChanged: true } },
      { driver: 'Team-Mate', openedBy: 'stop', closedBy: null },
    ]);
    expect(await store.driverChanges(race.id)).toEqual(
      await running.runtime.getDriverChanges()
    );
    expect(await store.driverChanges(race.id)).toMatchObject([
      { carIdx: 0, from: 'Driver 0', to: 'Team-Mate', atStop: true },
    ]);
    expect(errors).toEqual([]);
  });

  it('is written in batches, not a row at a time', async () => {
    const store = openStore();
    const field = new Field({ cars: 12 });
    const running = start(store);
    running.runtime.onSession(field.session());

    runLaps(field, running, 11, 3);
    run(field, running, 3);
    await idle();
    expect(writes()).toEqual([]);
    await store.flush();

    // Thirty-six laps and twelve stints went as one write.
    expect(writes()).toHaveLength(1);
    expect(writes()[0].laps.length).toBeGreaterThanOrEqual(36);
    expect(writes()[0].stints).toHaveLength(12);
    const [race] = await store.listRaces();
    expect(race.laps).toBe(writes()[0].laps.length);
  });

  it('says on the summary where it is kept, once it is', async () => {
    const store = openStore();
    const field = new Field();
    const running = start(store);
    running.subscribe();
    running.runtime.onSession(field.session());

    runLaps(field, running, 2, 1);
    run(field, running, 3);
    await idle();
    expect(running.delivered.at(-1)).toMatchObject({ raceId: null });
    await store.flush();
    await idle();
    run(field, running, 2);

    const [race] = await store.listRaces();
    expect(running.delivered.at(-1)).toMatchObject({
      raceToken: 'run-a:1',
      raceId: race.id,
      resumed: false,
      laps: [1, 1, 1],
    });
    expect(running.runtime.currentRace()?.id).toBe(race.id);
  });

  it('keeps a practice session in memory and out of the file', async () => {
    const store = openStore();
    const field = new Field({ sessionType: 'Practice' });
    const running = start(store);
    running.runtime.onSession(field.session());

    runLaps(field, running, 2, 2);
    run(field, running, 3);
    await idle();
    await store.flush();

    // Recorded like a race and read like one.
    expect((await running.runtime.getCarLaps(1)).laps).toHaveLength(2);
    expect(await running.runtime.getCarStints(1)).toHaveLength(1);
    // But the file keeps a fixed number of races, and this is not one.
    expect(requests.map((request) => request.method)).toEqual(['status']);
    expect(await store.listRaces()).toEqual([]);
    expect(logs[0]).toContain('not stored');
  });

  it('stores the race that follows the practice, and only that', async () => {
    const store = openStore();
    const field = new Field({ sessionType: 'Practice' });
    const running = start(store);
    running.runtime.onSession(field.session());
    runLaps(field, running, 2, 1);

    field.sessionNum = 1;
    field.sessionType = 'Race';
    for (const car of field.cars) car.lap = 1;
    running.runtime.onSession(field.session());
    runLaps(field, running, 2, 2);
    run(field, running, 3);
    await idle();
    await store.flush();

    const races = await store.listRaces();
    expect(races).toHaveLength(1);
    expect(races[0]).toMatchObject({ sessionType: 'Race', sessionNum: 1 });
    expect(races[0].laps).toBe(6);
  });
});

describe('a source that is not the player’s own racing', () => {
  it('is recorded and read, and nothing of it reaches the file', async () => {
    const store = openStore();
    const field = new Field({ timeLag: 2.5 });
    const running = start(store);
    // What the app sets for a recording, a replay source and demo mode.
    running.runtime.setPersisting(false);
    running.subscribe();
    running.runtime.onSession(field.session());

    runLaps(field, running, 2, 3);
    run(field, running, 5);
    running.runtime.dispose();
    await idle();
    await store.flush();

    // Everything is there to be shown.
    expect((await running.runtime.getCarLaps(0)).laps).toHaveLength(3);
    expect(running.delivered.at(-1)).toMatchObject({
      raceId: null,
      laps: [3, 3, 3],
    });
    // Nothing was written, and the file was not so much as asked whether
    // it holds this race.
    expect(requests.map((request) => request.method)).toEqual(['status']);
    expect(await store.listRaces()).toEqual([]);
    expect(db.races.list()).toEqual([]);
  });

  it('is not carried on from the file either', async () => {
    const store = openStore();
    const field = new Field();
    const first = start(store);
    first.runtime.onSession(field.session());
    runLaps(field, first, 2, 2);
    first.runtime.dispose();
    await idle();
    await store.flush();
    expect(await store.listRaces()).toHaveLength(1);
    const kept = db.races.list();

    // The same race played back from a recording.
    const second = start(store, { bootId: 'tape' });
    second.runtime.setPersisting(false);
    second.runtime.onSession(field.session());
    runLaps(field, second, 2, 1);
    run(field, second, 2);
    second.runtime.dispose();
    await idle();
    await store.flush();

    expect(
      (await second.runtime.getCarLaps(0)).laps.map((lap) => lap.lap)
    ).toEqual([3]);
    expect(asked('raceCandidates')).toBe(1);
    expect(asked('raceLoad')).toBe(0);
    expect(db.races.list()).toEqual(kept);
  });

  it('is not written even if the runtime is left storing, where the store refuses', async () => {
    // The second guard: the store the app builds asks for itself whether
    // the source is a recording.
    const store = openStore(() => false);
    const field = new Field();
    const running = start(store);
    running.runtime.onSession(field.session());

    runLaps(field, running, 2, 2);
    run(field, running, 3);
    running.runtime.dispose();
    await idle();
    await store.flush();

    expect(asked('raceWrite')).toBe(0);
    expect(db.races.list()).toEqual([]);
  });
});

describe('the app started again in the middle of a race', () => {
  /** A race recorded for three laps, then the app quit. */
  const before = async (field = new Field({ timeLag: 2.5 })) => {
    const store = openStore();
    const first = start(store);
    first.runtime.onSession(field.session());
    runLaps(field, first, 2, 3);
    run(field, first, 4);
    // The app quits: what is in hand is stored, and the file closed.
    first.runtime.dispose();
    await idle();
    await store.flush();
    const [race] = await store.listRaces();
    return { field, race };
  };

  it('recognises the race and carries it on in the same row', async () => {
    const { field, race } = await before();
    const store = openStore();
    const second = start(store, { bootId: 'run-b' });
    second.subscribe();
    second.runtime.onSession(field.session());

    run(field, second, 1);
    await idle();
    runLaps(field, second, 2, 2);
    run(field, second, 4);
    await idle();
    await store.flush();
    run(field, second, 2);

    // One race in the file, as before, with the new laps added to it.
    const races = await store.listRaces();
    expect(races).toHaveLength(1);
    expect(races[0]).toMatchObject({ id: race.id, startedAt: race.startedAt });
    expect(races[0].laps).toBeGreaterThan(race.laps);
    expect(
      logs.some((line) => line.includes(`Carrying on race ${race.id}`))
    ).toBe(true);
    for (let carIdx = 0; carIdx < 3; carIdx += 1) {
      const { laps, missingLaps } = await second.runtime.getCarLaps(carIdx);
      expect(laps.map((lap) => lap.lap).slice(0, 5)).toEqual([1, 2, 3, 4, 5]);
      expect(missingLaps).toEqual([]);
      expect(await store.carLaps(race.id, carIdx)).toEqual(laps);
      // No lap was missed, so the stint that was open is carried on.
      expect(await store.carStints(race.id, carIdx)).toMatchObject([
        { ordinal: 1, openedBy: 'start', closedBy: null, firstLap: 1 },
      ]);
    }
    expect(second.delivered.at(-1)).toMatchObject({
      raceToken: 'run-b:1',
      raceId: race.id,
      resumed: true,
      missingLaps: [0, 0, 0],
    });
    expect(second.runtime.currentRace()).toMatchObject({
      id: race.id,
      startedAt: race.startedAt,
    });
    expect(errors).toEqual([]);
  });

  it('reports the laps driven while it was not running as missing, and invents none', async () => {
    const { field, race } = await before();
    // Two laps with nothing running.
    while (field.cars[2].lap < 6) field.step();
    const store = openStore();
    const second = start(store, { bootId: 'run-b' });
    second.subscribe();
    second.runtime.onSession(field.session());

    run(field, second, 1);
    await idle();
    runLaps(field, second, 2, 2);
    run(field, second, 4);
    await idle();
    await store.flush();
    run(field, second, 2);

    expect(await store.listRaces()).toHaveLength(1);
    const { laps, missingLaps } = await second.runtime.getCarLaps(2);
    expect(laps.map((lap) => lap.lap)).toEqual([1, 2, 3, 6, 7]);
    expect(missingLaps).toEqual([4, 5]);
    expect(second.delivered.at(-1)).toMatchObject({
      resumed: true,
      raceId: race.id,
    });
    expect(second.delivered.at(-1)?.missingLaps[2]).toBe(2);
    // The file has exactly the laps that were seen.
    expect((await store.carLaps(race.id, 2)).map((lap) => lap.lap)).toEqual([
      1, 2, 3, 6, 7,
    ]);
    // And the stint that was open is closed there too, at its last lap.
    expect(await store.carStints(race.id, 2)).toMatchObject([
      { ordinal: 1, closedBy: 'gap', firstLap: 1, lastLap: 3 },
      { ordinal: 2, openedBy: 'joined', closedBy: null, firstLap: 6 },
    ]);
    // Read back from the file as a race that is over, the gap is the same.
    second.runtime.dispose();
    await idle();
    const later = start(store, { bootId: 'run-c' });
    expect((await later.runtime.getCarLaps(2, race.id)).missingLaps).toEqual([
      4, 5,
    ]);
  });

  it('writes no lap under a second race while the file is still being asked', async () => {
    const { field, race } = await before();
    const store = openStore();
    const second = start(store, { bootId: 'run-b' });
    second.runtime.onSession(field.session());

    // A whole lap for everybody before the stand-in worker has answered:
    // nothing awaits in between. Then the store's write falls due, still
    // before the answer: it goes to the worker ahead of the read that
    // follows the answer.
    runLaps(field, second, 2, 1);
    run(field, second, 4);
    await store.flush();
    // Nothing of this race had been handed to the store to write.
    expect(asked('raceWrite')).toBe(1);
    await idle();
    await store.flush();

    expect(await store.listRaces()).toHaveLength(1);
    expect(writes().at(-1)).toMatchObject({ raceId: race.id });
    expect((await store.carLaps(race.id, 0)).map((lap) => lap.lap)).toEqual([
      1, 2, 3, 4,
    ]);
    expect(await store.carStints(race.id, 0)).toMatchObject([
      { ordinal: 1, closedBy: null, firstLap: 1, lastLap: 4, laps: 4 },
    ]);
  });

  it('starts a new race when the entry list is another one', async () => {
    const { field, race } = await before();
    // Another car in the last slot: not the race that was kept.
    field.cars[2].carNumber = '99';
    field.cars[2].carPath = 'lmp2';
    const store = openStore();
    const second = start(store, { bootId: 'run-b' });
    second.runtime.onSession(field.session());

    run(field, second, 1);
    await idle();
    runLaps(field, second, 2, 1);
    run(field, second, 4);
    await idle();
    await store.flush();

    const races = await store.listRaces();
    expect(races).toHaveLength(2);
    expect(races[1]).toEqual(race);
    expect(races[0].id).not.toBe(race.id);
    expect(
      (await second.runtime.getCarLaps(0)).laps.map((lap) => lap.lap)
    ).toEqual([4]);
    expect(
      logs.some((line) =>
        line.includes(
          `Race ${race.id} in the file is not this one: another entry list`
        )
      )
    ).toBe(true);
  });

  it('starts a new race when a car has fewer laps than were kept', async () => {
    const { field, race } = await before();
    // The same grid at the same track, begun again.
    field.time = 30;
    for (const car of field.cars) {
      car.lap = 1;
      car.lapStartedAt = 30;
    }
    const store = openStore();
    const second = start(store, { bootId: 'run-b' });
    second.runtime.onSession(field.session());

    run(field, second, 1);
    await idle();
    runLaps(field, second, 2, 1);
    run(field, second, 4);
    await idle();
    await store.flush();

    const races = await store.listRaces();
    expect(races).toHaveLength(2);
    expect(races.map((kept) => kept.id)).toContain(race.id);
    expect(
      (await second.runtime.getCarLaps(0)).laps.map((lap) => lap.lap)
    ).toEqual([1]);
    expect(
      logs.some((line) => /has completed 0 laps and 3 were kept/.test(line))
    ).toBe(true);
    // The race that was kept is as it was.
    expect((await store.carLaps(race.id, 0)).map((lap) => lap.lap)).toEqual([
      1, 2, 3,
    ]);
  });

  it('goes by the sim’s own name for the session where it has one', async () => {
    const store = openStore();
    const field = new Field();
    const first = start(store, { simulator: 'iracing', unique: true });
    first.runtime.onSession(field.session());
    runLaps(field, first, 2, 2);
    first.runtime.dispose();
    await idle();
    await store.flush();
    const [race] = await store.listRaces();
    expect(race.sessionKey).toBe('4242:0');

    // Another event with the same cars on the same track.
    field.subSessionId = 4243;
    const other = start(store, {
      bootId: 'run-b',
      simulator: 'iracing',
      unique: true,
    });
    other.runtime.onSession(field.session());
    run(field, other, 1);
    await idle();
    runLaps(field, other, 2, 1);
    other.runtime.dispose();
    await idle();
    await store.flush();
    expect(await store.listRaces()).toHaveLength(2);

    // And the event that was kept, come back to.
    field.subSessionId = 4242;
    const back = start(store, {
      bootId: 'run-c',
      simulator: 'iracing',
      unique: true,
    });
    back.runtime.onSession(field.session());
    run(field, back, 1);
    await idle();

    expect(back.runtime.currentRace()?.id).toBe(race.id);
    expect(await store.listRaces()).toHaveLength(2);
  });

  it('carries the race on after the sim went away and came back', async () => {
    const store = openStore();
    const field = new Field({ timeLag: 2.5 });
    const running = start(store);
    running.runtime.onSession(field.session());
    runLaps(field, running, 2, 2);
    run(field, running, 4);

    // The connection drops: what is in hand is written.
    running.lifecycle._onDisconnect();
    await idle();
    const [race] = await store.listRaces();
    expect(running.runtime.currentRace()).toBeNull();
    // Nothing was said to have ended: the cars are racing on.
    expect(await store.carStints(race.id, 0)).toMatchObject([
      { closedBy: null },
    ]);

    running.lifecycle._onEnter({ replay: false });
    running.runtime.onSession(field.session());
    run(field, running, 1);
    await idle();
    runLaps(field, running, 2, 1);
    run(field, running, 4);
    await idle();
    await store.flush();

    expect(await store.listRaces()).toHaveLength(1);
    expect(running.runtime.currentRace()?.id).toBe(race.id);
    expect((await store.carLaps(race.id, 0)).map((lap) => lap.lap)).toEqual([
      1, 2, 3,
    ]);
    expect(await store.carStints(race.id, 0)).toMatchObject([
      { ordinal: 1, closedBy: null, laps: 3 },
    ]);
  });

  it('stores a lap still waiting for its time when the app quits', async () => {
    const store = openStore();
    const field = new Field({ timeLag: 2.5 });
    const running = start(store);
    running.runtime.onSession(field.session());

    runLaps(field, running, 0, 2);
    // Quit half a second after car 0's line, before the sim's time came.
    run(field, running, 0.5);
    running.runtime.dispose();
    await idle();
    await store.flush();

    const [race] = await store.listRaces();
    const laps = await store.carLaps(race.id, 0);
    expect(laps.map((lap) => lap.lap)).toEqual([1, 2]);
    expect(laps[0].lapTime).not.toBeNull();
    // Kept as it was: completed, and its time not seen.
    expect(laps[1]).toMatchObject({ lapTime: null, flags: 0 });
  });
});

describe('recording only while something wants it', () => {
  it('reads no frame while nothing does, and says which laps that cost', async () => {
    const store = openStore();
    const field = new Field();
    const running = start(store);
    running.runtime.onSession(field.session());
    runLaps(field, running, 0, 2);
    run(field, running, 3);
    running.metrics.markStart.mockClear();

    running.runtime.updateEnabled(false);
    runLaps(field, running, 0, 2);
    expect(running.metrics.markStart).not.toHaveBeenCalled();
    expect((await running.runtime.getCarLaps(0)).laps).toHaveLength(2);

    running.runtime.updateEnabled(true);
    runLaps(field, running, 0, 1);
    run(field, running, 3);

    const { laps, missingLaps } = await running.runtime.getCarLaps(0);
    expect(laps.map((lap) => lap.lap)).toEqual([1, 2, 5]);
    expect(missingLaps).toEqual([3, 4]);
    // The same race all along: nothing ended.
    expect(running.runtime.currentRace()).not.toBeNull();
    await idle();
    await store.flush();
    expect(await store.listRaces()).toHaveLength(1);
  });

  it('records nothing while a replay file is loaded', async () => {
    const store = openStore();
    const field = new Field();
    const running = start(store);
    running.runtime.onSession(field.session());
    running.runtime.setPaused(true);

    runLaps(field, running, 0, 2);

    expect(running.metrics.markStart).not.toHaveBeenCalled();
    expect(running.runtime.currentRace()).toBeNull();

    running.runtime.setPaused(false);
    runLaps(field, running, 0, 1);
    expect((await running.runtime.getCarLaps(0)).laps).toHaveLength(1);
  });

  it('never starts when it was never wanted', async () => {
    const store = openStore();
    const field = new Field();
    const running = start(store);
    running.runtime.updateEnabled(false);
    running.runtime.onSession(field.session());

    runLaps(field, running, 0, 3);
    await idle();
    await store.flush();

    expect(running.metrics.markStart).not.toHaveBeenCalled();
    expect(running.runtime.currentRace()).toBeNull();
    expect(requests.map((request) => request.method)).toEqual(['status']);
  });
});

describe('the summary', () => {
  it('goes out about once a second, and only when something changed', async () => {
    const store = openStore();
    // Twelve cars a few tenths apart: several laps completed in a second.
    const field = new Field({ cars: 12 });
    field.cars.forEach((car, carIdx) => {
      car.pace = 100;
      car.pct = 0.1 - carIdx * 0.002;
    });
    const running = start(store);
    running.subscribe();
    running.runtime.onSession(field.session());
    run(field, running, 5);
    const quiet = running.delivered.length;

    // Nothing happens for a while: nothing is sent.
    run(field, running, 60);
    expect(running.delivered.length).toBe(quiet);

    // Twelve cars over the line within two and a half seconds.
    runLaps(field, running, 11, 1);
    run(field, running, 3);

    const sent = running.delivered.length - quiet;
    expect(sent).toBeGreaterThanOrEqual(2);
    expect(sent).toBeLessThanOrEqual(7);
    expect(running.delivered.at(-1)?.laps).toEqual(
      Array.from({ length: 12 }, () => 1)
    );
  });

  it('is not put together while no window reads it, and is sent whole to one that arrives', async () => {
    const store = openStore();
    const field = new Field();
    const running = start(store);
    running.runtime.onSession(field.session());

    runLaps(field, running, 2, 2);
    run(field, running, 3);
    expect(running.metrics.markStart).not.toHaveBeenCalledWith(
      'raceHistoryPublication'
    );
    expect(running.delivered).toEqual([]);

    running.subscribe();

    expect(running.delivered).toHaveLength(1);
    expect(running.delivered[0]).toMatchObject({
      raceToken: 'run-a:1',
      laps: [2, 2, 2],
      stintLaps: [2, 2, 2],
      stintDriver: ['Driver 0', 'Driver 1', 'Driver 2'],
    });
  });

  it('says so when the race is let go of', async () => {
    const store = openStore();
    const field = new Field();
    const running = start(store);
    running.subscribe();
    running.runtime.onSession(field.session());
    runLaps(field, running, 2, 1);
    run(field, running, 2);

    wall += 2000;
    running.lifecycle._onDisconnect();

    expect(running.delivered.at(-1)).toMatchObject({
      raceToken: '',
      raceId: null,
      laps: [],
    });
  });
});

describe('a race that is over, read from the file', () => {
  it('gives its laps, stints and driver changes by its id', async () => {
    const store = openStore();
    const field = new Field();
    const first = start(store);
    first.runtime.onSession(field.session());
    runLaps(field, first, 2, 2);
    field.cars[1].name = 'Team-Mate';
    first.runtime.onSession(field.session());
    runLaps(field, first, 2, 1);
    run(field, first, 3);
    first.runtime.dispose();
    await idle();
    await store.flush();
    const [race] = await store.listRaces();

    // Another run, in another session altogether.
    const later = start(store, { bootId: 'run-b' });

    expect(await later.runtime.listRaces()).toEqual([race]);
    const { laps, missingLaps, revision } = await later.runtime.getCarLaps(
      1,
      race.id
    );
    expect(laps.map((lap) => lap.lap)).toEqual([1, 2, 3]);
    expect(missingLaps).toEqual([]);
    expect(revision).toBe(0);
    expect(await later.runtime.getCarStints(1, race.id)).toMatchObject([
      { driver: 'Driver 1', closedBy: 'driver' },
      { driver: 'Team-Mate', closedBy: null },
    ]);
    expect(await later.runtime.getDriverChanges(race.id)).toMatchObject([
      { carIdx: 1, from: 'Driver 1', to: 'Team-Mate' },
    ]);
    // With no race being recorded, leaving the id out has nothing to give.
    expect(await later.runtime.getCarLaps(1)).toEqual({
      laps: [],
      missingLaps: [],
      revision: 0,
    });
    expect(await later.runtime.getCarLaps(1, race.id + 5)).toEqual({
      laps: [],
      missingLaps: [],
      revision: 0,
    });
  });

  it('hands out copies: what a reader does to them changes nothing kept', async () => {
    const store = openStore();
    const field = new Field();
    const running = start(store);
    running.runtime.onSession(field.session());
    runLaps(field, running, 2, 1);
    run(field, running, 3);

    const first = await running.runtime.getCarLaps(0);
    first.laps[0].lapTime = -5;
    (first.laps[0].sectors as (number | null)[])[0] = 999;
    const stints = await running.runtime.getCarStints(0);
    stints[0].laps = 400;

    expect((await running.runtime.getCarLaps(0)).laps[0].lapTime).not.toBe(-5);
    expect((await running.runtime.getCarLaps(0)).laps[0].sectors[0]).toBeNull();
    expect((await running.runtime.getCarStints(0))[0].laps).toBe(1);
  });
});
