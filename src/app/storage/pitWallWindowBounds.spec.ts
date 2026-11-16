import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPitWallWindowBoundsStore } from './pitWallWindowBounds';
import logger from '../logger';

vi.mock('electron', () => ({ app: {} }));
vi.mock('../logger', () => ({ default: { warn: vi.fn() } }));

const FILE = 'pitwall-window-bounds.json';
const bounds = { x: -1800, y: 60, width: 1600, height: 900 };
const chosen = { bounds, maximized: false };
let directory: string;
let filePath: string;
let store: ReturnType<typeof createPitWallWindowBoundsStore>;
const failure = (code: string) => Object.assign(new Error(code), { code });
const read = async () => JSON.parse(await fsp.readFile(filePath, 'utf8'));

beforeEach(async () => {
  vi.mocked(logger.warn).mockClear();
  directory = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'irdashies-pitwall-bounds-')
  );
  filePath = path.join(directory, FILE);
  store = createPitWallWindowBoundsStore(directory);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await store.flush();
  // directory is the exact mkdtemp result, never a real application profile.
  await fsp.rm(directory, { recursive: true, force: true });
});

describe('Pit Wall window bounds store', () => {
  it('has nothing to restore on a profile that never opened the window, and writes no file', async () => {
    await store.load();
    await store.flush();
    expect(store.get()).toBeUndefined();
    expect(await fsp.readdir(directory)).toEqual([]);
  });

  it('remembers the place, the size and the maximised state between runs', async () => {
    await store.load();
    store.save({ bounds, maximized: true });
    await store.flush();
    expect(await read()).toEqual({ bounds, maximized: true });

    const next = createPitWallWindowBoundsStore(directory);
    await next.load();
    expect(next.get()).toEqual({ bounds, maximized: true });
  });

  it('keeps only the rectangle of what it is handed', async () => {
    await store.load();
    store.save({
      bounds: { ...bounds, extra: 'ignored' } as typeof bounds,
      maximized: 'yes' as unknown as boolean,
    });
    await store.flush();
    expect(await read()).toEqual({ bounds, maximized: false });
  });

  it('hands out a copy, so a caller cannot change what is stored', async () => {
    await store.load();
    store.save(chosen);
    const first = store.get();
    if (first) first.bounds.x = 5;
    expect(store.get()).toEqual(chosen);
  });

  it('ignores a save before the stored place has been read', async () => {
    await fsp.writeFile(filePath, JSON.stringify(chosen));
    store.save({ bounds: { ...bounds, x: 10 }, maximized: false });
    await store.load();
    expect(store.get()).toEqual(chosen);
  });

  it.each([
    { bounds: { ...bounds, width: 0 }, maximized: false },
    { bounds: { ...bounds, x: Number.NaN }, maximized: false },
    { bounds: null, maximized: true },
  ])('refuses to save a rectangle that is not one: %j', async (placement) => {
    await store.load();
    store.save(chosen);
    store.save(placement as unknown as typeof chosen);
    await store.flush();
    expect(store.get()).toEqual(chosen);
  });

  it.each([
    'not json',
    'null',
    '[]',
    '{}',
    '{"bounds":null}',
    '{"bounds":[0,0,10,10]}',
    '{"bounds":{"x":0,"y":0,"width":-1,"height":10}}',
    '{"bounds":{"x":"0","y":0,"width":10,"height":10}}',
    '{"maximized":true}',
  ])('falls back to no saved place for malformed data: %s', async (raw) => {
    await fsp.writeFile(filePath, raw);
    await store.load();
    expect(store.get()).toBeUndefined();
    // The file is replaced only once the user gives the window a place.
    expect(await fsp.readFile(filePath, 'utf8')).toBe(raw);
    store.save(chosen);
    await store.flush();
    expect(await read()).toEqual(chosen);
  });

  it('reads a maximised flag that is not a boolean as not maximised', async () => {
    await fsp.writeFile(filePath, JSON.stringify({ bounds, maximized: 1 }));
    await store.load();
    expect(store.get()).toEqual({ bounds, maximized: false });
  });

  it('warns about invalid JSON without throwing', async () => {
    await fsp.writeFile(filePath, '{"bounds":');
    await expect(store.load()).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      '[PitWallWindowBounds] Invalid JSON',
      FILE
    );
  });

  it('coalesces repeated initialization', async () => {
    const readFile = vi.spyOn(fsp, 'readFile');
    const first = store.load();
    expect(store.load()).toBe(first);
    await Promise.all([first, store.load()]);
    expect(readFile).toHaveBeenCalledOnce();
  });

  it('does not overwrite unreadable saved data; the next launch restores it', async () => {
    const content = JSON.stringify(chosen);
    await fsp.writeFile(filePath, content);
    const readFile = vi
      .spyOn(fsp, 'readFile')
      .mockRejectedValueOnce(failure('EACCES'));
    const write = vi.spyOn(fsp, 'writeFile');
    await store.load();
    expect(store.get()).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      '[PitWallWindowBounds] Failed to read',
      FILE,
      'EACCES'
    );
    store.save({ bounds: { ...bounds, x: 10 }, maximized: false });
    await store.flush();
    expect(write).not.toHaveBeenCalled();
    readFile.mockRestore();
    expect(await fsp.readFile(filePath, 'utf8')).toBe(content);

    const next = createPitWallWindowBoundsStore(directory);
    await next.load();
    expect(next.get()).toEqual(chosen);
  });

  it.each(['ENOSPC', 'EPERM'])(
    'keeps the previous file when a write fails with %s, and retries on the next flush',
    async (code) => {
      await fsp.writeFile(filePath, JSON.stringify(chosen));
      await store.load();
      const rename = vi
        .spyOn(fsp, 'rename')
        .mockRejectedValueOnce(failure(code));
      const moved = { bounds: { ...bounds, x: 40 }, maximized: false };
      store.save(moved);
      await store.flush();
      expect(logger.warn).toHaveBeenCalledWith(
        '[PitWallWindowBounds] Failed to write',
        FILE,
        code
      );
      expect(await read()).toEqual(chosen);
      expect(await fsp.readdir(directory)).toEqual([FILE]);

      await store.flush();
      expect(rename).toHaveBeenCalledTimes(2);
      expect(await read()).toEqual(moved);
    }
  );
});
