import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSectorBestsStore } from './sectorBestsStore';
import { createTrackCarStore, type TrackCarStoreHandle } from './trackCarStore';

vi.mock('electron', () => ({ app: {} }));
vi.mock('../logger', () => ({ default: { warn: vi.fn() } }));

const KEY = 'lmu|694510461|Ferrari 296 LMGT3 Evo|sim3';
const BESTS = {
  bestSectorTimes: [32.461, 35.07, 18.851],
  bestLapSectorTimes: [32.739, 35.07, 18.851],
};

let directory: string;
let store: TrackCarStoreHandle;

beforeEach(async () => {
  directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'tearoff-sectors-'));
  store = createTrackCarStore(directory);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await store.flush();
  // directory is the exact mkdtemp result, never a real application profile.
  await fsp.rm(directory, { recursive: true, force: true });
});

describe('the store of all-time sector bests', () => {
  it('cannot say what it holds until its file has been read', async () => {
    const sectorBests = createSectorBestsStore(store);
    const before = sectorBests.revision();

    expect(sectorBests.load(KEY)).toBeUndefined();

    await store.ready();
    // Read, and nothing kept: an answer, and a revision that says so.
    expect(sectorBests.load(KEY)).toBeNull();
    expect(sectorBests.revision()).toBeGreaterThan(before);
  });

  it('hands back what was saved, and says when it has changed', async () => {
    const sectorBests = createSectorBestsStore(store);
    await store.ready();
    const before = sectorBests.revision();

    sectorBests.save(KEY, BESTS);

    expect(sectorBests.load(KEY)).toEqual(BESTS);
    expect(sectorBests.revision()).toBeGreaterThan(before);
    expect(sectorBests.load(`${KEY}-other`)).toBeNull();
  });

  it('keeps them for the next run', async () => {
    const sectorBests = createSectorBestsStore(store);
    await store.ready();
    sectorBests.save(KEY, BESTS);
    await store.flush();

    const next = createTrackCarStore(directory);
    const reopened = createSectorBestsStore(next);
    expect(reopened.load(KEY)).toBeUndefined();
    await next.ready();

    expect(reopened.load(KEY)).toEqual(BESTS);
  });

  it('keeps them among the sector bests, apart from the other values', async () => {
    const sectorBests = createSectorBestsStore(store);
    await store.ready();
    sectorBests.save(KEY, BESTS);

    expect(store.get('sectorBests', KEY)).toEqual(BESTS);
    expect(store.get('driveTotals', KEY)).toBeUndefined();
  });

  it('asks again when the file could not be read at first', async () => {
    vi.spyOn(fsp, 'readFile').mockRejectedValueOnce(
      Object.assign(new Error('busy'), { code: 'EBUSY' })
    );
    const sectorBests = createSectorBestsStore(store);
    expect(await store.ready()).toBe(false);

    // Still no answer, and asking is what has it read again.
    expect(sectorBests.load(KEY)).toBeUndefined();
    await store.ready();

    expect(sectorBests.load(KEY)).toBeNull();
  });
});
