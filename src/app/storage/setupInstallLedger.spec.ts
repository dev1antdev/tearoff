import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import logger from '../logger';
import {
  SETUP_INSTALL_LEDGER_CAP,
  createSetupInstallLedger,
  parseSetupInstallFile,
  setupInstallKey,
  type SetupInstallLedger,
} from './setupInstallLedger';

vi.mock('electron', () => ({ app: {} }));
vi.mock('../logger', () => ({ default: { warn: vi.fn() } }));

const FILE = 'setup-installs.json';
const BOUNDARY = 'C:\\LMU\\UserData\\player\\Settings';
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

let directory: string;
let filePath: string;
let now: number;
let ledger: SetupInstallLedger;

const createLedger = () => createSetupInstallLedger(directory, () => now);
const readStored = async () => JSON.parse(await fsp.readFile(filePath, 'utf8'));
const writeStored = (value: unknown) =>
  fsp.writeFile(filePath, JSON.stringify(value));
const afterWriteDelay = () =>
  new Promise((resolve) => setTimeout(resolve, 400));
const busy = () => Object.assign(new Error('busy'), { code: 'EBUSY' });
const warnings = () =>
  vi.mocked(logger.warn).mock.calls.map(([message]) => message);

beforeEach(async () => {
  directory = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'tearoff-setup-ledger-')
  );
  filePath = path.join(directory, FILE);
  now = 1000;
  ledger = createLedger();
  vi.mocked(logger.warn).mockClear();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await ledger.flush();
  // directory is the exact mkdtemp result, never a real application profile.
  await fsp.rm(directory, { recursive: true, force: true });
});

describe('setupInstallKey', () => {
  const key = (boundary: string, platform: NodeJS.Platform = 'win32') =>
    setupInstallKey('lmu', boundary, 'Spa', 'My setup.svm', platform);

  it('depends on the canonical Settings folder', () => {
    expect(key(BOUNDARY)).not.toBe(key('D:\\LMU\\UserData\\player\\Settings'));
  });

  it('ignores the case of the path and names on Windows only', () => {
    expect(key(BOUNDARY)).toBe(key(BOUNDARY.toUpperCase()));
    const posix = (boundary: string) =>
      setupInstallKey('lmu', boundary, 'Spa', 'My setup.svm', 'darwin');
    expect(posix('/lmu/Settings')).not.toBe(posix('/LMU/Settings'));
  });
});

describe('parseSetupInstallFile', () => {
  it('refuses anything that is not a ledger', () => {
    for (const value of ['x', 42, null, [], {}, { version: '1' }]) {
      expect(parseSetupInstallFile(value)).toBeNull();
    }
    expect(parseSetupInstallFile({ version: 1 })).toBeNull();
    expect(parseSetupInstallFile({ version: 0, entries: {} })).toBeNull();
  });

  it('knows a file a newer build wrote', () => {
    expect(parseSetupInstallFile({ version: 2, entries: {} })).toBe('newer');
  });

  it('drops entries a write could not have produced', () => {
    const parsed = parseSetupInstallFile({
      version: 1,
      entries: {
        good: { sha256: SHA_A, installedAt: 5 },
        badSha: { sha256: 'xyz', installedAt: 5 },
        noTime: { sha256: SHA_A },
        notObject: 7,
      },
    });
    expect(parsed).toBeInstanceOf(Map);
    expect([...(parsed as Map<string, unknown>).keys()]).toEqual(['good']);
  });
});

describe('createSetupInstallLedger', () => {
  it('starts empty when the file is not there yet', async () => {
    await ledger.ready();
    expect(ledger.get('anything')).toBeUndefined();
    expect(warnings()).toEqual([]);
  });

  it('reads back what was written', async () => {
    ledger.set('k', SHA_A);
    await ledger.flush();
    const stored = await readStored();
    expect(stored).toEqual({
      version: 1,
      entries: { k: { sha256: SHA_A, installedAt: 1000 } },
    });

    ledger = createLedger();
    await ledger.ready();
    expect(ledger.get('k')).toBe(SHA_A);
  });

  it('starts empty from invalid JSON and still writes', async () => {
    await fsp.writeFile(filePath, 'not json');
    await ledger.ready();
    expect(ledger.get('k')).toBeUndefined();
    ledger.set('k', SHA_A);
    await ledger.flush();
    expect((await readStored()).entries.k.sha256).toBe(SHA_A);
  });

  it('never writes over a newer version', async () => {
    await writeStored({ version: 2, entries: {} });
    await ledger.ready();
    ledger.set('k', SHA_A);
    await ledger.flush();
    await afterWriteDelay();
    expect(await readStored()).toEqual({ version: 2, entries: {} });
    expect(warnings()).toContain(
      '[Setups] Install ledger written by a newer version, left as it is'
    );
  });

  it('never writes over a file it could not read', async () => {
    if (process.platform === 'win32') return;
    const before = JSON.stringify({
      version: 1,
      entries: { k: { sha256: SHA_A, installedAt: 1 } },
    });
    await fsp.writeFile(filePath, before);
    await fsp.chmod(filePath, 0o000);
    try {
      await ledger.ready();
      ledger.set('k', SHA_B);
      await ledger.flush();
      await afterWriteDelay();
      await fsp.chmod(filePath, 0o600);
      expect(await fsp.readFile(filePath, 'utf8')).toBe(before);
      expect(warnings()).toContain(
        '[Setups] Failed to read the install ledger'
      );
    } finally {
      await fsp.chmod(filePath, 0o600).catch(() => undefined);
    }
  });

  it('drops the entries set longest ago past the cap', async () => {
    for (let i = 0; i < SETUP_INSTALL_LEDGER_CAP + 3; i += 1) {
      now += 1;
      ledger.set(`k${i}`, SHA_A);
    }
    await ledger.flush();
    const entries = (await readStored()).entries as Record<string, unknown>;
    expect(Object.keys(entries)).toHaveLength(SETUP_INSTALL_LEDGER_CAP);
    expect(entries.k0).toBeUndefined();
    expect(entries.k2).toBeUndefined();
    expect(entries.k3).toBeDefined();
    expect(entries[`k${SETUP_INSTALL_LEDGER_CAP + 2}`]).toBeDefined();
  });

  it('keeps values set before the file was read, over the file’s', async () => {
    await writeStored({
      version: 1,
      entries: {
        early: { sha256: SHA_A, installedAt: 10 },
        later: { sha256: SHA_A, installedAt: 10 },
      },
    });
    ledger.set('early', SHA_B);
    await ledger.ready();
    expect(ledger.get('early')).toBe(SHA_B);
    expect(ledger.get('later')).toBe(SHA_A);
  });

  it('writes what was set before the file was read', async () => {
    ledger.set('k', SHA_A);
    await ledger.flush();
    expect((await readStored()).entries.k.sha256).toBe(SHA_A);
  });

  it('logs a failed write once, by name and code', async () => {
    const writeFile = vi.spyOn(fsp, 'writeFile').mockRejectedValueOnce(busy());
    ledger.set('k', SHA_A);
    await ledger.flush();
    writeFile.mockRestore();
    expect(warnings()).toContain('[Setups] Failed to write the install ledger');
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).toContain(
      'EBUSY'
    );
  });
});
