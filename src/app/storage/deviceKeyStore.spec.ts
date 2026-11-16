import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DEVICE_KEY_FILE_NAME, createDeviceKeyStore } from './deviceKeyStore';
import logger from '../logger';

vi.mock('../logger', () => ({ default: { warn: vi.fn() } }));

const isValid = (value: unknown): value is string =>
  typeof value === 'string' && /^key-\d+$/.test(value);
let directory: string;
let filePath: string;
let made: number;
const failure = (code: string) => Object.assign(new Error(code), { code });
const read = async () => JSON.parse(await fsp.readFile(filePath, 'utf8'));
const open = () =>
  createDeviceKeyStore({
    storageDir: directory,
    generate: () => `key-${++made}`,
    isValid,
  });
/** Everything the logger was handed, as one text. */
const logged = () => JSON.stringify(vi.mocked(logger.warn).mock.calls);

beforeEach(async () => {
  vi.mocked(logger.warn).mockClear();
  made = 0;
  directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'irdashies-key-'));
  filePath = path.join(directory, DEVICE_KEY_FILE_NAME);
});

afterEach(async () => {
  vi.restoreAllMocks();
  // directory is the exact mkdtemp result, never a real application profile.
  await fsp.rm(directory, { recursive: true, force: true });
});

describe('device key store', () => {
  it('has no key before it is opened, and writes nothing until then', async () => {
    const store = open();

    expect(store.current()).toBeNull();
    expect(await fsp.readdir(directory)).toEqual([]);
  });

  it('makes a key on first need and keeps it in a file of its own', async () => {
    const store = open();
    await store.open();

    expect(store.current()).toBe('key-1');
    expect(await fsp.readdir(directory)).toEqual([DEVICE_KEY_FILE_NAME]);
    expect(await read()).toEqual({ key: 'key-1' });
  });

  it('opens once, however often it is asked', async () => {
    const store = open();
    await Promise.all([store.open(), store.open(), store.open()]);

    expect(made).toBe(1);
    expect(store.current()).toBe('key-1');
  });

  it('hands the same key to the next run', async () => {
    await open().open();
    const next = open();
    await next.open();

    expect(next.current()).toBe('key-1');
    expect(made).toBe(1);
  });

  it('replaces the key on disk before it is the key', async () => {
    const store = open();
    await store.open();
    const rename = vi.spyOn(fsp, 'rename');
    let keyWhileWriting: string | null = null;
    rename.mockImplementationOnce(async (from, to) => {
      keyWhileWriting = store.current();
      rename.mockRestore();
      await fsp.rename(from, to);
    });

    expect(await store.replace()).toBe('key-2');

    expect(keyWhileWriting).toBe('key-1');
    expect(store.current()).toBe('key-2');
    expect(await read()).toEqual({ key: 'key-2' });
    // Written beside the file and moved over it: nothing is left behind.
    expect(await fsp.readdir(directory)).toEqual([DEVICE_KEY_FILE_NAME]);
  });

  it('keeps the old key in force when the new one cannot be stored', async () => {
    const store = open();
    await store.open();
    vi.spyOn(fsp, 'rename').mockRejectedValueOnce(failure('EPERM'));

    await expect(store.replace()).rejects.toMatchObject({ code: 'EPERM' });

    expect(store.current()).toBe('key-1');
    expect(await read()).toEqual({ key: 'key-1' });
    expect(await fsp.readdir(directory)).toEqual([DEVICE_KEY_FILE_NAME]);
    // The failure does not hold up the next attempt.
    expect(await store.replace()).toBe('key-3');
    expect(await read()).toEqual({ key: 'key-3' });
  });

  it('can be asked for a new key before it was ever opened', async () => {
    const store = open();

    expect(await store.replace()).toBe('key-2');
    expect(await read()).toEqual({ key: 'key-2' });
  });

  it.each([
    ['not JSON', '{"key":'],
    ['no key in it', '{}'],
    ['a key of the wrong shape', '{"key":"hello"}'],
    ['a key that is not text', '{"key":42}'],
    ['not an object', '"key-7"'],
  ])('makes a new key over a file with %s', async (_what, contents) => {
    await fsp.writeFile(filePath, contents, 'utf8');
    const store = open();
    await store.open();

    expect(store.current()).toBe('key-1');
    expect(await read()).toEqual({ key: 'key-1' });
  });

  it('leaves a file it cannot read alone, and still has a key for this run', async () => {
    await fsp.writeFile(filePath, '{"key":"key-99"}', 'utf8');
    vi.spyOn(fsp, 'readFile').mockRejectedValueOnce(failure('EACCES'));
    const store = open();
    await store.open();

    expect(store.current()).toBe('key-1');
    vi.restoreAllMocks();
    expect(await read()).toEqual({ key: 'key-99' });
    expect(logged()).toContain('EACCES');
  });

  it('has a key for this run when the folder cannot be written', async () => {
    vi.spyOn(fsp, 'writeFile').mockRejectedValueOnce(failure('ENOSPC'));
    const store = open();
    await store.open();

    expect(store.current()).toBe('key-1');
    expect(await fsp.readdir(directory)).toEqual([]);
    expect(logged()).toContain('ENOSPC');
  });

  it('never writes a key to the log', async () => {
    await fsp.writeFile(filePath, '{"key":', 'utf8');
    vi.spyOn(fsp, 'writeFile').mockRejectedValueOnce(failure('ENOSPC'));
    const store = open();
    await store.open();
    vi.spyOn(fsp, 'rename').mockRejectedValueOnce(failure('EPERM'));
    await store.replace().catch(() => undefined);

    expect(vi.mocked(logger.warn)).toHaveBeenCalled();
    expect(logged()).not.toMatch(/key-\d/);
  });
});
