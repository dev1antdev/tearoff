import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RaceEvent, RaceLogSnapshot } from '@irdashies/types';
import {
  GlobalFlags,
  RACE_LOG_PAGE_EVENTS,
  RACE_LOG_SNAPSHOT_EVENTS,
} from '@irdashies/types';
import { ChannelBus, type RendererTarget } from '../bridge/channelBus';
import { createSessionLifecycle } from '../sessionLifecycle';
import type { RaceHistoryStore } from '../storage/lapLibrary/raceHistoryStore';
import {
  drive,
  enterPits,
  Field,
  leaveBox,
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
 * The race's log through the runtime that hosts it and the real storage:
 * the store, the lap library's client and dispatcher, and a real database
 * in a file of its own (see raceHistoryStoreFixture.ts). Everything but the
 * worker thread.
 *
 * The races are staged: a small field lapping a circuit (see
 * raceHistoryFixture.ts), with a caution or a stop put on it by hand. No
 * recording has either.
 */

const CHANNEL = 'race-log.snapshot';
const T0 = Date.UTC(2026, 10, 16, 12, 0, 0);

let file: RaceHistoryFile;
let logs: string[];
/** Wall clock, moved by the specs. */
let wall: number;

interface Running {
  runtime: RaceHistoryRuntime;
  bus: ChannelBus;
  lifecycle: ReturnType<typeof createSessionLifecycle>;
  /** Every snapshot delivered to the window that subscribed, as it then was. */
  delivered: RaceLogSnapshot[];
  subscribe: () => void;
  unsubscribe: () => void;
}

const start = (
  store: RaceHistoryStore,
  options: { bootId?: string } = {}
): Running => {
  const bus = new ChannelBus({
    now: () => wall,
    // Nothing is held back for later here: the runtime itself publishes no
    // more than once a second, which is this channel's rate.
    schedule: () => ({ cancel: () => undefined }),
  });
  const lifecycle = createSessionLifecycle();
  const runtime = new RaceHistoryRuntime(
    bus,
    lifecycle,
    { markStart: vi.fn(), markEnd: vi.fn() },
    store,
    {
      simulator: () => 'iracing',
      sessionIdsAreUnique: () => true,
      now: () => wall,
      bootId: options.bootId ?? 'run-a',
      log: (message) => logs.push(message),
      logError: (message, error) =>
        file.errors.push(`${message} ${String(error)}`),
    }
  );
  const delivered: RaceLogSnapshot[] = [];
  const target: RendererTarget = {
    id: 1,
    isDestroyed: () => false,
    isVisible: () => true,
    send: (_channel, _name, payload) =>
      delivered.push(structuredClone(payload as RaceLogSnapshot)),
  };
  return {
    runtime,
    bus,
    lifecycle,
    delivered,
    subscribe: () => bus.subscribe(target, CHANNEL),
    unsubscribe: () => bus.unsubscribe(target.id, CHANNEL),
  };
};

/** Runs a field into a runtime, with the wall clock keeping the field's. */
const run = (field: Field, running: Running, seconds: number) =>
  drive(
    field,
    {
      onFrame: (frame) => {
        wall = T0 + field.time * 1000;
        // The session is racing: the field's frames do not say.
        (frame as unknown as Record<string, unknown>).SessionState = {
          value: [4],
        };
        running.runtime.onFrame(frame);
      },
    },
    seconds
  );

const runLaps = (
  field: Field,
  running: Running,
  carIdx: number,
  laps: number
) => {
  const target = field.cars[carIdx].lap + laps;
  while (field.cars[carIdx].lap < target) run(field, running, 1);
};

/** A caution shown for a while: two events, its start and its end. */
const caution = (field: Field, running: Running, seconds: number) => {
  field.sessionFlags = GlobalFlags.Caution;
  run(field, running, seconds);
  field.sessionFlags = 0;
  run(field, running, 1);
};

/** Car 0 into its box, standing for a while, and out again. */
const stop = (field: Field, running: Running, standing = 20) => {
  enterPits(field.cars[0]);
  run(field, running, 4);
  standInBox(field.cars[0]);
  run(field, running, standing);
  leaveBox(field.cars[0]);
  run(field, running, 3);
  leavePits(field.cars[0]);
  run(field, running, 2);
};

const settle = async (store: RaceHistoryStore) => {
  await idle();
  await store.flush();
  await idle();
};

const kinds = (events: readonly RaceEvent[]) =>
  events.map((event) => event.kind);

const seqs = (events: readonly RaceEvent[]) => events.map((event) => event.seq);

beforeEach(() => {
  file = openRaceHistoryFile();
  logs = [];
  wall = T0;
});

afterEach(() => {
  file.close();
});

describe('the log of a race being driven', () => {
  it('is kept whether or not a window is looking, and read through the runtime', async () => {
    const store = file.openStore();
    const field = new Field();
    const running = start(store);
    running.runtime.onSession(field.session());

    runLaps(field, running, 0, 1);
    stop(field, running);
    caution(field, running, 30);

    expect(kinds(await running.runtime.getEvents())).toEqual([
      'pit-entry',
      'pit-exit',
      'flag',
      'flag',
    ]);
    // Nothing was published: nobody subscribed.
    expect(running.delivered).toEqual([]);
  });

  it('is stored with the rest of the race, in the batches its laps go in', async () => {
    const store = file.openStore();
    const field = new Field();
    const running = start(store);
    running.runtime.onSession(field.session());

    runLaps(field, running, 0, 1);
    stop(field, running);
    caution(field, running, 30);
    await settle(store);

    const [race] = file.db.races.list();
    const held = await running.runtime.getEvents();
    expect(held).toHaveLength(4);
    expect(file.db.races.events(race.id)).toEqual(held);
    // No write of its own: every batch that carries an event is one of the
    // race's, under the race's row or token.
    const batches = file.writes();
    expect(batches.every((batch) => batch.token === 'run-a:1')).toBe(true);
    expect(batches.flatMap((batch) => batch.events ?? [])).not.toEqual([]);
    expect(
      batches.some(
        (batch) => (batch.events ?? []).length > 0 && batch.laps.length > 0
      )
    ).toBe(true);
    expect(file.asked('raceWrite')).toBe(batches.length);
    expect(file.errors).toEqual([]);
  });

  it('stores an event again when it changes: a stop’s driver change named late', async () => {
    const store = file.openStore();
    const field = new Field();
    const running = start(store);
    running.runtime.onSession(field.session());
    runLaps(field, running, 0, 1);
    stop(field, running);
    await settle(store);
    const [race] = file.db.races.list();
    expect(file.db.races.events(race.id).at(-1)).toMatchObject({
      kind: 'pit-exit',
      driverFrom: '',
      driverTo: '',
    });

    run(field, running, 20);
    field.cars[0].name = 'Second Driver';
    running.runtime.onSession(field.session());
    run(field, running, 2);
    await settle(store);

    expect(file.db.races.events(race.id).at(-1)).toMatchObject({
      kind: 'pit-exit',
      driverFrom: 'Driver 0',
      driverTo: 'Second Driver',
    });
    expect(kinds(file.db.races.events(race.id))).toEqual([
      'pit-entry',
      'pit-exit',
    ]);
  });

  it('is asked of the file for a race that is not the one being driven', async () => {
    const store = file.openStore();
    const field = new Field();
    const running = start(store);
    running.runtime.onSession(field.session());
    runLaps(field, running, 0, 1);
    caution(field, running, 30);
    await settle(store);
    const [first] = file.db.races.list();
    const firstLog = await running.runtime.getEvents();

    // Another session: another race, with a log of its own.
    field.sessionNum = 1;
    field.cars.forEach((car) => {
      car.lap = 1;
      car.pct = 0.5;
    });
    running.runtime.onSession(field.session());
    run(field, running, 5);
    caution(field, running, 10);
    caution(field, running, 10);
    await settle(store);

    expect(kinds(await running.runtime.getEvents())).toEqual([
      'flag',
      'flag',
      'flag',
      'flag',
    ]);
    expect(await running.runtime.getEvents(first.id)).toEqual(firstLog);
    expect(await running.runtime.getEvents(first.id, 2)).toEqual([firstLog[0]]);
    // The race being driven, named by its row, is answered from memory.
    const [current] = file.db.races.list();
    expect(current.id).not.toBe(first.id);
    expect(await running.runtime.getEvents(current.id)).toHaveLength(4);
  });
});

describe('the log on its channel', () => {
  it('goes out when it changes, at most once a second, and only while a window reads it', () => {
    const field = new Field();
    const running = start(file.openStore());
    running.runtime.onSession(field.session());
    run(field, running, 5);

    running.subscribe();
    // A window that arrives is told what there is, which is nothing yet.
    expect(running.delivered).toHaveLength(1);
    expect(running.delivered[0]).toMatchObject({
      raceToken: 'run-a:1',
      events: [],
      total: 0,
    });

    // Nothing happens: nothing is said.
    run(field, running, 10);
    expect(running.delivered).toHaveLength(1);

    // Two events inside one second go out together.
    field.sessionFlags = GlobalFlags.Caution;
    run(field, running, 0.4);
    field.sessionFlags = 0;
    run(field, running, 2);
    const versions = running.delivered.map((snapshot) => snapshot.version);
    expect(new Set(versions).size).toBe(versions.length);
    expect(running.delivered.at(-1)).toMatchObject({ total: 2 });
    expect(kinds(running.delivered.at(-1)?.events ?? [])).toEqual([
      'flag',
      'flag',
    ]);
    const sent = running.delivered.length;
    expect(sent).toBeLessThanOrEqual(3);

    // With nobody reading, the log is kept and not put together.
    running.unsubscribe();
    caution(field, running, 5);
    expect(running.delivered).toHaveLength(sent);

    // And a window that comes back is brought up to date at once.
    running.subscribe();
    expect(running.delivered).toHaveLength(sent + 1);
    expect(running.delivered.at(-1)).toMatchObject({ total: 4 });
  });

  it('never sends more than a second’s worth apart, however fast events come', () => {
    const field = new Field();
    const running = start(file.openStore());
    running.runtime.onSession(field.session());
    run(field, running, 5);
    running.subscribe();
    const sentAt: number[] = [];
    const send = running.delivered.push.bind(running.delivered);
    running.delivered.push = (...snapshots) => {
      sentAt.push(wall);
      return send(...snapshots);
    };

    // A flag change every half second for half a minute.
    for (let index = 0; index < 60; index += 1) {
      field.sessionFlags = index % 2 === 0 ? GlobalFlags.Caution : 0;
      run(field, running, 0.5);
    }

    expect(sentAt.length).toBeGreaterThan(15);
    expect(sentAt.length).toBeLessThanOrEqual(31);
    for (let index = 1; index < sentAt.length; index += 1) {
      expect(sentAt[index] - sentAt[index - 1]).toBeGreaterThanOrEqual(1000);
    }
  });

  it('carries the most recent events only, and says how many there are', async () => {
    const field = new Field();
    const running = start(file.openStore());
    running.runtime.onSession(field.session());
    run(field, running, 5);
    for (let index = 0; index < 460; index += 1) {
      field.sessionFlags = index % 2 === 0 ? GlobalFlags.Caution : 0;
      run(field, running, 0.5);
    }

    running.subscribe();

    const snapshot = running.delivered.at(-1);
    expect(snapshot?.total).toBe(460);
    expect(snapshot?.events).toHaveLength(RACE_LOG_SNAPSHOT_EVENTS);
    expect(snapshot?.events.at(-1)?.seq).toBe(460);
    // The ones before are asked for, a page at a time.
    const oldest = snapshot?.events[0].seq ?? 0;
    const before = await running.runtime.getEvents(undefined, oldest);
    expect(before).toHaveLength(RACE_LOG_PAGE_EVENTS);
    expect(before.at(-1)?.seq).toBe(oldest - 1);
    expect(
      seqs(await running.runtime.getEvents(undefined, before[0].seq))
    ).toEqual(Array.from({ length: 60 }, (_, index) => index + 1));
  });

  it('is empty again when the sim goes away', () => {
    const field = new Field();
    const running = start(file.openStore());
    running.runtime.onSession(field.session());
    run(field, running, 5);
    caution(field, running, 5);
    running.subscribe();
    expect(running.delivered.at(-1)).toMatchObject({ total: 2 });

    // A moment later, so that the channel's own pace lets it through.
    wall += 1500;
    running.lifecycle._onDisconnect();

    expect(running.delivered.at(-1)).toMatchObject({
      raceToken: '',
      events: [],
      total: 0,
    });
  });
});

describe('a race carried on after a restart', () => {
  it('has its log back, and goes on numbering from where it stopped', async () => {
    const before = file.openStore();
    const field = new Field();
    const first = start(before, { bootId: 'run-a' });
    first.runtime.onSession(field.session());
    runLaps(field, first, 0, 1);
    stop(field, first);
    // The app quits under a caution.
    field.sessionFlags = GlobalFlags.Caution;
    run(field, first, 20);
    const cautionAt = (await first.runtime.getEvents()).at(-1)?.sessionTime;
    const logBefore = await first.runtime.getEvents();
    first.runtime.dispose();
    await settle(before);
    const [kept] = file.db.races.list();
    expect(file.db.races.events(kept.id)).toEqual(logBefore);
    expect(seqs(logBefore)).toEqual([1, 2, 3]);

    // Started again ten seconds later, on the same file, the caution still
    // out. Nothing was read in between.
    field.time += 10;
    const after = file.openStore();
    const second = start(after, { bootId: 'run-b' });
    second.runtime.onSession(field.session());
    run(field, second, 5);
    await idle();
    expect(logs.some((line) => line.includes('Carrying on race'))).toBe(true);

    // The file's events, and no second notice of the caution it holds.
    expect(await second.runtime.getEvents()).toEqual(logBefore);

    field.sessionFlags = 0;
    run(field, second, 2);
    stop(field, second);
    await settle(after);

    const log = await second.runtime.getEvents();
    expect(kinds(log)).toEqual([
      'pit-entry',
      'pit-exit',
      'flag',
      'flag',
      'pit-entry',
      'pit-exit',
    ]);
    expect(seqs(log)).toEqual([1, 2, 3, 4, 5, 6]);
    // The caution is measured whole, from when the first run saw it begin.
    expect(log[3]).toMatchObject({ flag: 'green', after: 'caution' });
    expect(log[3].kind === 'flag' && log[3].durationS).toBeCloseTo(
      log[3].sessionTime - (cautionAt ?? 0),
      6
    );
    // One race in the file, with one log, which is what is held.
    expect(file.db.races.list()).toHaveLength(1);
    expect(file.db.races.events(kept.id)).toEqual(log);
    expect(file.errors).toEqual([]);
  });

  it('writes what was logged before the file answered under numbers after the file’s', async () => {
    const before = file.openStore();
    const field = new Field();
    const first = start(before, { bootId: 'run-a' });
    first.runtime.onSession(field.session());
    runLaps(field, first, 0, 1);
    caution(field, first, 10);
    first.runtime.dispose();
    await settle(before);
    const [kept] = file.db.races.list();
    expect(seqs(file.db.races.events(kept.id))).toEqual([1, 2]);

    const after = file.openStore();
    const second = start(after, { bootId: 'run-b' });
    second.runtime.onSession(field.session());
    // A whole caution before the file has been asked anything: every frame
    // of it is read in one turn of the event loop.
    run(field, second, 3);
    caution(field, second, 10);
    const early = await second.runtime.getEvents();
    expect(seqs(early)).toEqual([1, 2]);
    expect(file.writes().filter((batch) => batch.token === 'run-b:1')).toEqual(
      []
    );

    await idle();
    run(field, second, 1);
    await settle(after);

    // Numbered on from the file's two, and written once, as that.
    const log = await second.runtime.getEvents();
    expect(seqs(log)).toEqual([1, 2, 3, 4]);
    expect(log.slice(2).map((event) => event.sessionTime)).toEqual(
      early.map((event) => event.sessionTime)
    );
    expect(file.db.races.events(kept.id)).toEqual(log);
    const written = file
      .writes()
      .filter((batch) => batch.token === 'run-b:1')
      .flatMap((batch) => batch.events ?? []);
    expect(seqs(written)).toEqual([3, 4]);
  });
});

describe('a source that is not the player’s own racing', () => {
  it('is logged and published, and nothing of the log is written', async () => {
    const store = file.openStore();
    const field = new Field();
    const running = start(store);
    // As for a recording played back, a replay source and demo mode.
    running.runtime.setPersisting(false);
    running.runtime.onSession(field.session());
    running.subscribe();

    runLaps(field, running, 0, 1);
    stop(field, running);
    caution(field, running, 10);
    await settle(store);

    expect(kinds(await running.runtime.getEvents())).toEqual([
      'pit-entry',
      'pit-exit',
      'flag',
      'flag',
    ]);
    expect(running.delivered.at(-1)).toMatchObject({ total: 4 });
    expect(file.asked('raceWrite')).toBe(0);
    expect(file.db.races.list()).toEqual([]);
  });

  it('has nothing written even with the runtime left storing: the store refuses for itself', async () => {
    // The guard the app builds its store with says the source is a
    // recording; the runtime was not told.
    const store = file.openStore(() => false);
    const field = new Field();
    const running = start(store);
    running.runtime.onSession(field.session());

    runLaps(field, running, 0, 1);
    stop(field, running);
    caution(field, running, 10);
    await settle(store);

    expect(await running.runtime.getEvents()).toHaveLength(4);
    expect(file.asked('raceWrite')).toBe(0);
    expect(file.db.races.list()).toEqual([]);
  });

  it('has no log stored for a session that is not a race', async () => {
    const store = file.openStore();
    const field = new Field({ sessionType: 'Practice' });
    const running = start(store);
    running.runtime.onSession(field.session());

    runLaps(field, running, 0, 1);
    stop(field, running);
    await settle(store);

    // Logged like a race, for as long as the app runs.
    expect(kinds(await running.runtime.getEvents())).toEqual([
      'pit-entry',
      'pit-exit',
    ]);
    expect(file.asked('raceWrite')).toBe(0);
  });
});

describe('the switches', () => {
  it('logs nothing while nothing wants the record, and nothing from the gap after', async () => {
    const field = new Field();
    const running = start(file.openStore());
    running.runtime.onSession(field.session());
    runLaps(field, running, 0, 1);

    running.runtime.updateEnabled(false);
    // A stop and a caution with no frame read.
    stop(field, running);
    field.sessionFlags = GlobalFlags.Caution;
    run(field, running, 10);
    expect(await running.runtime.getEvents()).toEqual([]);

    running.runtime.updateEnabled(true);
    run(field, running, 5);
    // The caution is out and the log did not know: said, as noticed late.
    // Of the stop there is nothing: it was not seen.
    expect(await running.runtime.getEvents()).toMatchObject([
      { kind: 'flag', flag: 'caution', late: true },
    ]);
  });

  it('logs nothing while an iRacing replay file is loaded', async () => {
    const field = new Field();
    const running = start(file.openStore());
    running.runtime.onSession(field.session());
    run(field, running, 5);

    running.runtime.setPaused(true);
    caution(field, running, 10);
    running.runtime.setPaused(false);
    run(field, running, 5);

    expect(await running.runtime.getEvents()).toEqual([]);
  });
});

describe('a slot another car has taken', () => {
  it('loses its events, in the file as in memory', async () => {
    const store = file.openStore();
    const field = new Field();
    const running = start(store);
    running.runtime.onSession(field.session());
    runLaps(field, running, 0, 1);
    stop(field, running);
    caution(field, running, 5);
    await settle(store);
    const [race] = file.db.races.list();
    expect(kinds(file.db.races.events(race.id))).toEqual([
      'pit-entry',
      'pit-exit',
      'flag',
      'flag',
    ]);

    // Another car in slot 0.
    field.cars[0].carNumber = '99';
    field.cars[0].carPath = 'lmp2';
    field.cars[0].name = 'The Newcomer';
    running.runtime.onSession(field.session());
    run(field, running, 2);
    await settle(store);

    expect(kinds(await running.runtime.getEvents())).toEqual(['flag', 'flag']);
    expect(file.db.races.events(race.id)).toEqual(
      await running.runtime.getEvents()
    );
  });
});
