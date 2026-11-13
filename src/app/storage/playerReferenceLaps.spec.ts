import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { ReferenceLap } from '../../types';

const { directory } = vi.hoisted(() => ({
  directory: `${process.env.TEMP ?? process.env.TMPDIR ?? '/tmp'}/tearoff-player-reference-${process.pid}`,
}));
vi.mock('electron', () => ({ app: { getPath: () => directory } }));
vi.mock('../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  __resetForTests,
  flushPlayerReferenceLapsOnShutdown,
  getPlayerReferenceLap,
  loadPlayerReferenceLaps,
  savePlayerReferenceLap,
} from './playerReferenceLaps';
import { getStorageStatus, reportStorageResult } from './storageStatus';

const file = path.join(directory, 'playerReferenceLaps.json');

const lap = (lapTime: number, startTime = 0): ReferenceLap => ({
  startTime,
  finishTime: startTime + lapTime,
  times: new Float32Array([0.1, lapTime / 2, lapTime - 0.1]),
  pointPos: new Float32Array([0.001, 0.5, 0.999]),
  tangents: new Float32Array([1, 2, 3]),
  speedsKph: new Float32Array([100, 200, 150]),
  interval: 1 / 3,
  pointsCount: 3,
  lastTrackedPct: 0.999,
  isCleanLap: true,
});

beforeEach(async () => {
  __resetForTests();
  reportStorageResult('playerReferenceLaps');
  await fsp.mkdir(directory, { recursive: true });
});

afterEach(async () => {
  __resetForTests();
  vi.restoreAllMocks();
  await fsp.rm(directory, { recursive: true, force: true });
});

describe('playerReferenceLaps', () => {
  it('returns nothing for a combination never saved', () => {
    expect(getPlayerReferenceLap('lmu', 1, 'Ferrari 296 LMGT3')).toBeNull();
  });

  it('keeps a lap per simulator, track and car', () => {
    savePlayerReferenceLap('lmu', 1, 'Ferrari 296 LMGT3', lap(98.5));
    savePlayerReferenceLap('lmu', 1, 'Porsche 963', lap(88.2));
    savePlayerReferenceLap('lmu', 2, 'Ferrari 296 LMGT3', lap(121));
    savePlayerReferenceLap('iracing', 1, 'Ferrari 296 LMGT3', lap(99));

    const lapTime = (simulator: string, trackId: number, car: string) => {
      const found = getPlayerReferenceLap(simulator, trackId, car);
      return found ? found.finishTime - found.startTime : null;
    };
    expect(lapTime('lmu', 1, 'Ferrari 296 LMGT3')).toBe(98.5);
    expect(lapTime('lmu', 1, 'Porsche 963')).toBe(88.2);
    expect(lapTime('lmu', 2, 'Ferrari 296 LMGT3')).toBe(121);
    expect(lapTime('iracing', 1, 'Ferrari 296 LMGT3')).toBe(99);
  });

  it('stores the lap time, not the session clock it was set at', () => {
    // A lap set 40 minutes into a session is still a 98.5 s lap in the next.
    savePlayerReferenceLap('lmu', 1, 'car', lap(98.5, 2400));

    const found = getPlayerReferenceLap('lmu', 1, 'car');

    expect(found?.startTime).toBe(0);
    expect(found?.finishTime).toBeCloseTo(98.5, 4);
  });

  it('hands back typed arrays, with tangents left for the recorder', () => {
    savePlayerReferenceLap('lmu', 1, 'car', lap(98.5));

    const found = getPlayerReferenceLap('lmu', 1, 'car');

    expect(found?.pointPos).toBeInstanceOf(Float32Array);
    expect(found?.times).toBeInstanceOf(Float32Array);
    expect(found?.pointsCount).toBe(3);
    expect(Array.from(found?.tangents ?? [])).toEqual([0, 0, 0]);
    // The speed trace is not kept: nothing reads it back from an old lap.
    expect(found?.speedsKph).toBeUndefined();
  });

  it('survives a restart', async () => {
    savePlayerReferenceLap('lmu', 1, 'car', lap(98.5));
    await flushPlayerReferenceLapsOnShutdown();

    __resetForTests();
    expect(getPlayerReferenceLap('lmu', 1, 'car')).toBeNull();
    await loadPlayerReferenceLaps();

    const found = getPlayerReferenceLap('lmu', 1, 'car');
    expect(found?.finishTime).toBeCloseTo(98.5, 4);
    expect(Array.from(found?.pointPos ?? [])).toEqual(
      Array.from(new Float32Array([0.001, 0.5, 0.999]))
    );
  });

  it('prefers a lap saved before the file finished loading', async () => {
    savePlayerReferenceLap('lmu', 1, 'car', lap(98.5));
    savePlayerReferenceLap('lmu', 2, 'car', lap(120));
    await flushPlayerReferenceLapsOnShutdown();
    __resetForTests();

    savePlayerReferenceLap('lmu', 1, 'car', lap(97));
    await loadPlayerReferenceLaps();

    expect(getPlayerReferenceLap('lmu', 1, 'car')?.finishTime).toBe(97);
    // The other entry still arrives from disk.
    expect(getPlayerReferenceLap('lmu', 2, 'car')?.finishTime).toBe(120);
  });

  it('starts empty without a file, and without complaint', async () => {
    await loadPlayerReferenceLaps();

    expect(getPlayerReferenceLap('lmu', 1, 'car')).toBeNull();
  });

  it('ignores a file that is not JSON', async () => {
    await fsp.writeFile(file, '{ not json');

    await loadPlayerReferenceLaps();

    expect(getPlayerReferenceLap('lmu', 1, 'car')).toBeNull();
  });

  it('drops entries that are not a whole lap and keeps the rest', async () => {
    const good = {
      lapTime: 90,
      savedAt: '2026-11-13T12:00:00.000Z',
      interval: 0.5,
      pointPos: [0.1, 0.6],
      times: [9, 54],
    };
    await fsp.writeFile(
      file,
      JSON.stringify({
        version: 1,
        laps: {
          'lmu|1|good': good,
          'lmu|1|mismatched': { ...good, times: [9] },
          'lmu|1|text': { ...good, pointPos: ['a', 'b'] },
          'lmu|1|negative': { ...good, lapTime: -1 },
          'lmu|1|nan': { ...good, times: [9, null] },
          'lmu|1|notobject': 5,
        },
      })
    );

    await loadPlayerReferenceLaps();

    expect(getPlayerReferenceLap('lmu', 1, 'good')?.finishTime).toBe(90);
    for (const car of ['mismatched', 'text', 'negative', 'nan', 'notobject']) {
      expect(getPlayerReferenceLap('lmu', 1, car)).toBeNull();
    }
  });

  it('ignores a file written by a different format version', async () => {
    await fsp.writeFile(
      file,
      JSON.stringify({ version: 2, laps: { 'lmu|1|car': { lapTime: 90 } } })
    );

    await loadPlayerReferenceLaps();

    expect(getPlayerReferenceLap('lmu', 1, 'car')).toBeNull();
  });

  it('caps the collection, dropping the lap saved longest ago', () => {
    for (let track = 0; track < 201; track += 1) {
      savePlayerReferenceLap('lmu', track, 'car', lap(90));
    }

    expect(getPlayerReferenceLap('lmu', 0, 'car')).toBeNull();
    expect(getPlayerReferenceLap('lmu', 1, 'car')).not.toBeNull();
    expect(getPlayerReferenceLap('lmu', 200, 'car')).not.toBeNull();
  });

  it('counts a lap saved again as the newest', () => {
    for (let track = 0; track < 200; track += 1) {
      savePlayerReferenceLap('lmu', track, 'car', lap(90));
    }
    savePlayerReferenceLap('lmu', 0, 'car', lap(89));
    savePlayerReferenceLap('lmu', 200, 'car', lap(90));

    expect(getPlayerReferenceLap('lmu', 0, 'car')?.finishTime).toBe(89);
    expect(getPlayerReferenceLap('lmu', 1, 'car')).toBeNull();
  });

  it('refuses a lap with no time', () => {
    savePlayerReferenceLap('lmu', 1, 'car', lap(0));

    expect(getPlayerReferenceLap('lmu', 1, 'car')).toBeNull();
  });

  it('keeps the lap in memory and reports a full disk', async () => {
    vi.spyOn(fsp, 'writeFile').mockRejectedValueOnce(
      Object.assign(new Error('full'), { code: 'ENOSPC' })
    );

    savePlayerReferenceLap('lmu', 1, 'car', lap(98.5));
    await flushPlayerReferenceLapsOnShutdown();

    expect(getPlayerReferenceLap('lmu', 1, 'car')?.finishTime).toBeCloseTo(
      98.5,
      4
    );
    expect(getStorageStatus().diskFull).toBe(true);

    await flushPlayerReferenceLapsOnShutdown();
    expect(getStorageStatus().diskFull).toBe(false);
    expect(JSON.parse(await fsp.readFile(file, 'utf8')).version).toBe(1);
  });
});
