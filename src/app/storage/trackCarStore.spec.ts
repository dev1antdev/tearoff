import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import logger from '../logger';
import {
  createTrackCarStore,
  parseTrackCarFile,
  TRACK_CAR_CAPS,
  type TrackCarStore,
  type TrackCarStoreHandle,
} from './trackCarStore';

vi.mock('electron', () => ({ app: {} }));
vi.mock('../logger', () => ({ default: { warn: vi.fn() } }));

const FILE = 'track-car-store.json';
const KEY = 'lmu|694510461|Ferrari 296 LMGT3 Evo';

let directory: string;
let filePath: string;
/** The store's clock, moved by hand. */
let now: number;
let store: TrackCarStoreHandle;

const createStore = () => createTrackCarStore(directory, () => now);
const stored = async () => JSON.parse(await fsp.readFile(filePath, 'utf8'));
const writeStored = (value: unknown) =>
  fsp.writeFile(filePath, JSON.stringify(value));
const afterWriteDelay = () =>
  new Promise((resolve) => setTimeout(resolve, 400));
const busy = () => Object.assign(new Error('busy'), { code: 'EBUSY' });
const warnings = () =>
  vi.mocked(logger.warn).mock.calls.map(([message]) => message);

beforeEach(async () => {
  directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'tearoff-track-car-'));
  filePath = path.join(directory, FILE);
  now = 1000;
  store = createStore();
  vi.mocked(logger.warn).mockClear();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await store.flush();
  // directory is the exact mkdtemp result, never a real application profile.
  await fsp.rm(directory, { recursive: true, force: true });
});

describe('parseTrackCarFile', () => {
  it('refuses anything that is not this store', () => {
    for (const value of ['x', 42, null, [], {}, { version: '1' }]) {
      expect(parseTrackCarFile(value)).toBeNull();
    }
    expect(parseTrackCarFile({ version: 1 })).toBeNull();
    expect(parseTrackCarFile({ version: 0, namespaces: {} })).toBeNull();
  });

  it('knows a file a newer build wrote from one it can read', () => {
    expect(parseTrackCarFile({ version: 2, namespaces: {} })).toBe('newer');
  });

  it('leaves out what is malformed and keeps the rest', () => {
    const parsed = parseTrackCarFile({
      version: 1,
      namespaces: {
        driveTotals: {
          good: { updatedAt: 5, value: { metresDriven: 1200 } },
          noTime: { value: 1 },
          badTime: { updatedAt: 'yesterday', value: 1 },
          noValue: { updatedAt: 5 },
          notAnEntry: 7,
          '': { updatedAt: 5, value: 1 },
        },
        brakeLimits: ['not', 'a', 'map'],
        somethingElse: { key: { updatedAt: 1, value: 1 } },
      },
    });

    expect(parsed).not.toBeNull();
    expect(parsed).not.toBe('newer');
    const entries = parsed as Exclude<typeof parsed, 'newer' | null>;
    expect([...entries.driveTotals]).toEqual([
      ['good', { updatedAt: 5, value: { metresDriven: 1200 } }],
    ]);
    expect(entries.brakeLimits.size).toBe(0);
    expect(Object.keys(entries).sort()).toEqual([
      'brakeLimits',
      'driveTotals',
      'pitService',
      'sectorBests',
    ]);
  });
});

describe('track and car store', () => {
  it('has nothing without a file, and writes none', async () => {
    expect(await store.ready()).toBe(true);
    expect(store.get('driveTotals', KEY)).toBeUndefined();
    await store.flush();
    await expect(fsp.access(filePath)).rejects.toThrow();
  });

  it('answers at once with what was set, and saves it', async () => {
    store.set('driveTotals', KEY, { metresDriven: 3590, secondsDriven: 86.7 });
    // No waiting for the disk: a processor reads on the telemetry path.
    expect(store.get('driveTotals', KEY)).toEqual({
      metresDriven: 3590,
      secondsDriven: 86.7,
    });

    await store.flush();

    expect(await stored()).toEqual({
      version: 1,
      namespaces: {
        sectorBests: {},
        driveTotals: {
          [KEY]: {
            updatedAt: 1000,
            value: { metresDriven: 3590, secondsDriven: 86.7 },
          },
        },
        brakeLimits: {},
        pitService: {},
      },
    });
  });

  it('reads back in a later run what an earlier one stored', async () => {
    store.set('sectorBests', `${KEY}|sim3`, { best: [28.1, 30.5, 28] });
    store.set('brakeLimits', 'lmu|Ferrari 296 LMGT3 Evo|front', 24.5);
    store.set('pitService', 'lmu|Ferrari 296 LMGT3 Evo', { fuelRate: 2.1 });
    await store.flush();

    const later = createStore();
    // Not known until the file has been read.
    expect(later.get('brakeLimits', 'lmu|Ferrari 296 LMGT3 Evo|front')).toBe(
      undefined
    );
    await later.ready();

    expect(later.get('sectorBests', `${KEY}|sim3`)).toEqual({
      best: [28.1, 30.5, 28],
    });
    expect(later.get('brakeLimits', 'lmu|Ferrari 296 LMGT3 Evo|front')).toBe(
      24.5
    );
    expect(later.get('pitService', 'lmu|Ferrari 296 LMGT3 Evo')).toEqual({
      fuelRate: 2.1,
    });
  });

  it('keeps each namespace and each key apart', () => {
    store.set('driveTotals', KEY, 1);
    store.set('sectorBests', KEY, 2);
    store.set('driveTotals', `${KEY}x`, 3);

    expect(store.get('driveTotals', KEY)).toBe(1);
    expect(store.get('sectorBests', KEY)).toBe(2);
    expect(store.get('driveTotals', `${KEY}x`)).toBe(3);
    expect(store.get('pitService', KEY)).toBeUndefined();
  });

  it('moves the revision whenever an answer may have changed', async () => {
    const start = store.revision();

    store.set('driveTotals', KEY, 1);
    const afterSet = store.revision();
    expect(afterSet).toBeGreaterThan(start);

    await store.ready();
    const afterLoad = store.revision();
    expect(afterLoad).toBeGreaterThan(afterSet);

    store.clear('driveTotals');
    const afterClear = store.revision();
    expect(afterClear).toBeGreaterThan(afterLoad);
    // Asking changes nothing.
    store.get('driveTotals', KEY);
    expect(store.revision()).toBe(afterClear);
  });

  it('tells a reader that waited for the file that it has arrived', async () => {
    await writeStored({
      version: 1,
      namespaces: { driveTotals: { [KEY]: { updatedAt: 5, value: 42 } } },
    });
    const reader: Pick<TrackCarStore, 'get' | 'revision'> = store;
    const seen = reader.revision();
    expect(reader.get('driveTotals', KEY)).toBeUndefined();

    await store.ready();

    expect(reader.revision()).not.toBe(seen);
    expect(reader.get('driveTotals', KEY)).toBe(42);
  });

  it('keeps what was set while the file loaded over what the file held', async () => {
    await writeStored({
      version: 1,
      namespaces: {
        driveTotals: {
          [KEY]: { updatedAt: 5, value: 100 },
          other: { updatedAt: 6, value: 7 },
        },
      },
    });

    // Before the read has finished.
    store.set('driveTotals', KEY, 250);
    await store.flush();

    expect(store.get('driveTotals', KEY)).toBe(250);
    expect(store.get('driveTotals', 'other')).toBe(7);
    expect((await stored()).namespaces.driveTotals).toEqual({
      other: { updatedAt: 6, value: 7 },
      [KEY]: { updatedAt: 1000, value: 250 },
    });
  });

  it('does not save over the file before it has loaded', async () => {
    const original = {
      version: 1,
      namespaces: { driveTotals: { other: { updatedAt: 6, value: 7 } } },
    };
    await writeStored(original);
    const readFile = fsp.readFile.bind(fsp);
    let finishLoading: (() => void) | undefined;
    vi.spyOn(fsp, 'readFile').mockImplementationOnce((async (
      ...args: Parameters<typeof fsp.readFile>
    ) => {
      await new Promise<void>((resolve) => {
        finishLoading = resolve;
      });
      return readFile(...args);
    }) as typeof fsp.readFile);

    store.set('driveTotals', KEY, 250);
    // Well past the write delay, with the file still loading.
    await afterWriteDelay();
    expect(await stored()).toEqual(original);

    finishLoading?.();
    await store.flush();
    expect(Object.keys((await stored()).namespaces.driveTotals)).toEqual([
      'other',
      KEY,
    ]);
  });

  it('stores a copy: changing the object afterwards changes nothing', async () => {
    const totals = { metresDriven: 100, laps: [1, 2] };
    store.set('driveTotals', KEY, totals);

    totals.metresDriven = 999;
    totals.laps.push(3);

    expect(store.get('driveTotals', KEY)).toEqual({
      metresDriven: 100,
      laps: [1, 2],
    });
  });

  it('keeps a value as it will be read back from the file', async () => {
    store.set('driveTotals', KEY, {
      metresDriven: 100,
      skipped: undefined,
      notANumber: Number.NaN,
    });

    const inMemory = store.get('driveTotals', KEY);
    await store.flush();
    const later = createStore();
    await later.ready();

    expect(inMemory).toEqual({ metresDriven: 100, notANumber: null });
    expect(later.get('driveTotals', KEY)).toEqual(inMemory);
  });

  it('ignores a value that cannot be stored, a namespace it does not have, and an empty key', async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const revision = store.revision();

    store.set('driveTotals', KEY, circular);
    store.set('driveTotals', KEY, undefined);
    store.set('driveTotals', '', 1);
    store.set('lapTimes' as never, KEY, 1);

    expect(store.get('driveTotals', KEY)).toBeUndefined();
    expect(store.get('lapTimes' as never, KEY)).toBeUndefined();
    expect(store.revision()).toBe(revision);
    await store.flush();
    await expect(fsp.access(filePath)).rejects.toThrow();
  });

  it('drops the keys set longest ago beyond the cap of a namespace', async () => {
    const cap = TRACK_CAR_CAPS.brakeLimits;
    expect(cap).toBe(500);
    for (let index = 0; index < cap + 3; index += 1) {
      now += 1;
      store.set('brakeLimits', `car-${index}`, index);
    }
    // Setting a key again makes it the newest.
    now += 1;
    store.set('brakeLimits', 'car-3', 'again');
    now += 1;
    store.set('brakeLimits', 'one-more', 1);

    expect(store.get('brakeLimits', 'car-0')).toBeUndefined();
    expect(store.get('brakeLimits', 'car-2')).toBeUndefined();
    expect(store.get('brakeLimits', 'car-3')).toBe('again');
    expect(store.get('brakeLimits', 'car-4')).toBeUndefined();
    expect(store.get('brakeLimits', 'car-5')).toBe(5);
    await store.flush();
    expect(Object.keys((await stored()).namespaces.brakeLimits)).toHaveLength(
      cap
    );
    // Other namespaces have their own count.
    expect(TRACK_CAR_CAPS).toEqual({
      sectorBests: 2000,
      driveTotals: 2000,
      brakeLimits: 500,
      pitService: 500,
    });
  });

  it('brings a file that is over the cap back under it, oldest first', async () => {
    const cap = TRACK_CAR_CAPS.pitService;
    await writeStored({
      version: 1,
      namespaces: {
        pitService: Object.fromEntries(
          // Written in no particular order: the time decides, not the place.
          Array.from({ length: cap + 2 }, (_, index) => [
            `car-${index}`,
            { updatedAt: (index * 7919) % (cap + 2), value: index },
          ])
        ),
      },
    });

    await store.ready();

    const oldest = [0, 1].map((time) =>
      Array.from({ length: cap + 2 }, (_, index) => index).find(
        (index) => (index * 7919) % (cap + 2) === time
      )
    );
    for (const index of oldest) {
      expect(store.get('pitService', `car-${index}`)).toBeUndefined();
    }
    store.set('pitService', 'new', 1);
    await store.flush();
    expect(Object.keys((await stored()).namespaces.pitService)).toHaveLength(
      cap
    );
  });

  it('stores nothing while it is not persisting, in memory or on disk', async () => {
    store.set('driveTotals', KEY, 100);
    await store.flush();

    // A tape, a replay or demo mode.
    store.setPersisting(false);
    const revision = store.revision();
    store.set('driveTotals', KEY, 5);
    store.set('driveTotals', 'tape', 1);
    store.clear();

    expect(store.get('driveTotals', KEY)).toBe(100);
    expect(store.get('driveTotals', 'tape')).toBeUndefined();
    expect(store.revision()).toBe(revision);
    await afterWriteDelay();
    expect(Object.keys((await stored()).namespaces.driveTotals)).toEqual([KEY]);

    store.setPersisting(true);
    store.set('driveTotals', KEY, 200);
    expect(store.get('driveTotals', KEY)).toBe(200);
  });

  it('forgets a namespace, or everything, on disk as well', async () => {
    store.set('driveTotals', KEY, 100);
    store.set('brakeLimits', 'front', 24);
    await store.flush();

    store.clear('driveTotals');
    await store.flush();

    expect(store.get('driveTotals', KEY)).toBeUndefined();
    expect(store.get('brakeLimits', 'front')).toBe(24);
    expect((await stored()).namespaces).toMatchObject({
      driveTotals: {},
      brakeLimits: { front: { value: 24 } },
    });

    store.clear();
    await store.flush();
    expect(store.get('brakeLimits', 'front')).toBeUndefined();
    expect((await stored()).namespaces.brakeLimits).toEqual({});
  });

  it('forgets what the file held when cleared while it loads', async () => {
    await writeStored({
      version: 1,
      namespaces: {
        driveTotals: { [KEY]: { updatedAt: 5, value: 100 } },
        brakeLimits: { front: { updatedAt: 5, value: 24 } },
      },
    });

    store.clear('driveTotals');
    await store.flush();

    expect(store.get('driveTotals', KEY)).toBeUndefined();
    expect(store.get('brakeLimits', 'front')).toBe(24);
    expect((await stored()).namespaces.driveTotals).toEqual({});
  });

  it('starts over from a file that is not JSON, or not this store', async () => {
    await fsp.writeFile(filePath, '{not json');
    store.set('driveTotals', KEY, 1);
    await store.flush();
    expect((await stored()).namespaces.driveTotals[KEY].value).toBe(1);
    expect(warnings()).toContain('[TrackCarStore] Invalid JSON');

    await writeStored({ some: 'other file' });
    const other = createStore();
    expect(await other.ready()).toBe(true);
    expect(warnings()).toContain('[TrackCarStore] Invalid file');
  });

  it('leaves a file from a newer version as it is', async () => {
    const newer = {
      version: 2,
      namespaces: { driveTotals: { [KEY]: { updatedAt: 5, value: 100 } } },
      somethingNew: true,
    };
    await writeStored(newer);

    expect(await store.ready()).toBe(true);
    // Not read as if it were understood.
    expect(store.get('driveTotals', KEY)).toBeUndefined();
    // Values of this run are kept for the run.
    store.set('driveTotals', KEY, 7);
    expect(store.get('driveTotals', KEY)).toBe(7);
    await afterWriteDelay();
    await store.flush();

    expect(await stored()).toEqual(newer);
    expect(warnings()).toContain(
      '[TrackCarStore] Written by a newer version, left as it is'
    );
  });

  it('tries a failed read again, and keeps what it set meanwhile', async () => {
    // A scanner holding the file at startup.
    await writeStored({
      version: 1,
      namespaces: { driveTotals: { other: { updatedAt: 6, value: 7 } } },
    });
    vi.spyOn(fsp, 'readFile').mockRejectedValueOnce(busy());
    store.set('driveTotals', KEY, 250);
    await afterWriteDelay();
    expect(Object.keys((await stored()).namespaces.driveTotals)).toEqual([
      'other',
    ]);
    expect(logger.warn).toHaveBeenCalledWith(
      '[TrackCarStore] Failed to read',
      FILE,
      'EBUSY'
    );

    // The next set reads it again, and this time it works.
    store.set('driveTotals', 'third', 1);
    await store.flush();

    expect(Object.keys((await stored()).namespaces.driveTotals)).toEqual([
      'other',
      KEY,
      'third',
    ]);
  });

  it('leaves a file it cannot read alone, and says what was not saved', async () => {
    // A directory in its place never reads; it may hold values this run
    // never saw.
    await fsp.mkdir(filePath);
    store.set('driveTotals', KEY, 1);

    expect(await store.ready()).toBe(false);
    await store.flush();

    expect((await fsp.stat(filePath)).isDirectory()).toBe(true);
    expect(warnings()).toContain('[TrackCarStore] Not saved: could not read');
    // Still answered from memory for the rest of the run.
    expect(store.get('driveTotals', KEY)).toBe(1);
    // Logged once, however often it is tried.
    await store.ready();
    expect(
      warnings().filter((message) => message.includes('Failed to read'))
    ).toHaveLength(1);
  });

  it('never throws into the caller for a write that fails', async () => {
    store.set('driveTotals', KEY, 1);
    await store.ready();
    vi.spyOn(fsp, 'writeFile').mockRejectedValue(
      Object.assign(new Error('full'), { code: 'ENOSPC' })
    );

    store.set('driveTotals', KEY, 2);
    await expect(store.flush()).resolves.toBeUndefined();

    expect(store.get('driveTotals', KEY)).toBe(2);
    expect(logger.warn).toHaveBeenCalledWith(
      '[TrackCarStore] Failed to write',
      FILE,
      'ENOSPC'
    );
    vi.mocked(fsp.writeFile).mockRestore();
  });
});
