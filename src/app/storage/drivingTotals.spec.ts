import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDrivingTotalsStore, drivingTotalsKey } from './drivingTotals';
import { createTrackCarStore, type TrackCarStoreHandle } from './trackCarStore';

vi.mock('electron', () => ({ app: {} }));
vi.mock('../logger', () => ({ default: { warn: vi.fn() } }));

const FILE = 'track-car-store.json';
const TRACK_ID = 694510461;
const CAR = 'Ferrari 296 LMGT3 Evo';
const KEY = `lmu|${TRACK_ID}|${CAR}`;

let directory: string;

const writeStored = (driveTotals: Record<string, unknown>) =>
  fsp.writeFile(
    path.join(directory, FILE),
    JSON.stringify({
      version: 1,
      namespaces: {
        driveTotals: Object.fromEntries(
          Object.entries(driveTotals).map(([key, value]) => [
            key,
            { updatedAt: 1, value },
          ])
        ),
      },
    })
  );

const readStored = async (): Promise<Record<string, { value: unknown }>> =>
  JSON.parse(await fsp.readFile(path.join(directory, FILE), 'utf8')).namespaces
    .driveTotals;

/** A store whose file is read only when the spec says so. */
const gatedStore = () => {
  const values = new Map<string, unknown>();
  let release: (ready: boolean) => void = () => undefined;
  const readies: Promise<boolean>[] = [];
  const store = {
    get: vi.fn((_namespace: string, key: string) => values.get(key)),
    set: vi.fn((_namespace: string, key: string, value: unknown) => {
      values.set(key, value);
    }),
    ready: vi.fn(() => {
      const waiting = new Promise<boolean>((resolve) => {
        release = resolve;
      });
      readies.push(waiting);
      return waiting;
    }),
  };
  return {
    store: store as unknown as Pick<
      TrackCarStoreHandle,
      'get' | 'set' | 'ready'
    >,
    spies: store,
    values,
    /** The read finishes: well, or not. */
    finish: async (ready: boolean) => {
      release(ready);
      await Promise.allSettled(readies);
      // What follows the answer runs a few turns on.
      for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
    },
  };
};

beforeEach(async () => {
  directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'driving-totals-'));
});

afterEach(async () => {
  await fsp.rm(directory, { recursive: true, force: true });
});

describe('driving totals', () => {
  it('names a total by simulator, track and car', () => {
    expect(drivingTotalsKey('lmu', TRACK_ID, CAR)).toBe(KEY);
  });

  describe('on the track-and-car store', () => {
    it('answers with what the file holds, once it has been read', async () => {
      await writeStored({ [KEY]: { metres: 123_456, seconds: 4321 } });
      const store = createTrackCarStore(directory);
      const totals = createDrivingTotalsStore(store);

      // Asked before the read is done: not known.
      expect(totals.load('lmu', TRACK_ID, CAR)).toBeNull();
      await store.ready();
      await Promise.resolve();

      expect(totals.load('lmu', TRACK_ID, CAR)).toEqual({
        metres: 123_456,
        seconds: 4321,
      });
      // A track and car never driven: nothing, not unknown.
      expect(totals.load('lmu', TRACK_ID, 'Oreca 07')).toEqual({
        metres: 0,
        seconds: 0,
      });
      expect(totals.load('iracing', TRACK_ID, CAR)).toEqual({
        metres: 0,
        seconds: 0,
      });
    });

    it('adds to what is stored and writes it to the file', async () => {
      await writeStored({ [KEY]: { metres: 1000, seconds: 60 } });
      const store = createTrackCarStore(directory);
      const totals = createDrivingTotalsStore(store);
      await store.ready();
      await Promise.resolve();

      totals.add('lmu', TRACK_ID, CAR, 1500, 30);
      totals.add('lmu', TRACK_ID, CAR, 25, 0.5);
      totals.add('lmu', TRACK_ID, 'Oreca 07', 8, 0.16);

      expect(totals.load('lmu', TRACK_ID, CAR)).toEqual({
        metres: 2525,
        seconds: 90.5,
      });
      await store.flush();
      const stored = await readStored();
      expect(stored[KEY].value).toEqual({ metres: 2525, seconds: 90.5 });
      expect(stored[`lmu|${TRACK_ID}|Oreca 07`].value).toEqual({
        metres: 8,
        seconds: 0.16,
      });
    });

    it('does not write over the file with what was driven before it was read', async () => {
      await writeStored({ [KEY]: { metres: 1000, seconds: 60 } });
      const store = createTrackCarStore(directory);
      const totals = createDrivingTotalsStore(store);

      // Driven in the first seconds of the app, before the file is in.
      totals.add('lmu', TRACK_ID, CAR, 40, 2);
      totals.add('lmu', TRACK_ID, CAR, 10, 1);
      expect(totals.load('lmu', TRACK_ID, CAR)).toBeNull();
      await store.ready();
      await Promise.resolve();

      expect(totals.load('lmu', TRACK_ID, CAR)).toEqual({
        metres: 1050,
        seconds: 63,
      });
      await store.flush();
      expect((await readStored())[KEY].value).toEqual({
        metres: 1050,
        seconds: 63,
      });
    });

    it('starts from nothing where there is no file', async () => {
      const store = createTrackCarStore(directory);
      const totals = createDrivingTotalsStore(store);
      await store.ready();
      await Promise.resolve();

      expect(totals.load('lmu', TRACK_ID, CAR)).toEqual({
        metres: 0,
        seconds: 0,
      });
      totals.add('lmu', TRACK_ID, CAR, 9816.6, 240);
      await store.flush();
      expect((await readStored())[KEY].value).toEqual({
        metres: 9816.6,
        seconds: 240,
      });
    });

    it('reads an entry left in another shape as nothing driven', async () => {
      await writeStored({
        [KEY]: { metres: 'far', seconds: -5 },
        [`lmu|${TRACK_ID}|Oreca 07`]: 12,
      });
      const store = createTrackCarStore(directory);
      const totals = createDrivingTotalsStore(store);
      await store.ready();
      await Promise.resolve();

      expect(totals.load('lmu', TRACK_ID, CAR)).toEqual({
        metres: 0,
        seconds: 0,
      });
      expect(totals.load('lmu', TRACK_ID, 'Oreca 07')).toEqual({
        metres: 0,
        seconds: 0,
      });
    });
  });

  describe('what it is handed', () => {
    it('never takes a total down', async () => {
      const { store, values, finish } = gatedStore();
      const totals = createDrivingTotalsStore(store);
      await finish(true);

      totals.add('lmu', TRACK_ID, CAR, 100, 10);
      totals.add('lmu', TRACK_ID, CAR, -50, -5);
      totals.add('lmu', TRACK_ID, CAR, Number.NaN, Number.POSITIVE_INFINITY);

      expect(values.get(KEY)).toEqual({ metres: 100, seconds: 10 });
    });

    it('writes nothing for nothing driven', async () => {
      const { store, spies, finish } = gatedStore();
      const totals = createDrivingTotalsStore(store);
      await finish(true);

      totals.add('lmu', TRACK_ID, CAR, 0, 0);

      expect(spies.set).not.toHaveBeenCalled();
    });

    it('keeps the metres of a crawl, which have no seconds', async () => {
      const { store, values, finish } = gatedStore();
      const totals = createDrivingTotalsStore(store);
      await finish(true);

      totals.add('lmu', TRACK_ID, CAR, 0.08, 0);

      expect(values.get(KEY)).toEqual({ metres: 0.08, seconds: 0 });
    });
  });

  describe('while the file cannot be read', () => {
    it('knows nothing, sets nothing, and asks again after a while', async () => {
      const { store, spies, values, finish } = gatedStore();
      const totals = createDrivingTotalsStore(store);
      expect(spies.ready).toHaveBeenCalledTimes(1);
      totals.add('lmu', TRACK_ID, CAR, 40, 2);
      await finish(false);

      expect(totals.load('lmu', TRACK_ID, CAR)).toBeNull();
      expect(spies.set).not.toHaveBeenCalled();
      // Not on every frame that asks: fifty are passed over.
      for (let call = 0; call < 49; call += 1) {
        totals.load('lmu', TRACK_ID, CAR);
      }
      expect(spies.ready).toHaveBeenCalledTimes(1);
      totals.load('lmu', TRACK_ID, CAR);
      expect(spies.ready).toHaveBeenCalledTimes(2);

      // This time the read works, and what waited is added to the file's.
      values.set(KEY, { metres: 1000, seconds: 60 });
      await finish(true);
      expect(totals.load('lmu', TRACK_ID, CAR)).toEqual({
        metres: 1040,
        seconds: 62,
      });
    });

    it('asks once at a time', () => {
      const { store, spies } = gatedStore();
      const totals = createDrivingTotalsStore(store);
      totals.load('lmu', TRACK_ID, CAR);
      totals.load('lmu', TRACK_ID, CAR);
      totals.add('lmu', TRACK_ID, CAR, 1, 1);

      expect(spies.ready).toHaveBeenCalledTimes(1);
    });
  });
});
