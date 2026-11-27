import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import logger from '../../logger';
import {
  createSetupInstallLedger,
  setupInstallKey,
  type SetupInstallLedger,
} from '../../storage/setupInstallLedger';
import {
  createSetupLibrary,
  decideInstall,
  type SetupLibraryOptions,
} from './setupLibrary';

vi.mock('../../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const CAR = 'GT3 Porsche_911_GT3_R_LMGT3 WEC2025';
const setup = (wing = 0): string =>
  `[GENERAL]\nVehicleClassSetting="${CAR}"\n[REARWING]\nRWSetting=${wing}//6.3 deg\n`;

let root: string;
let libraryRoot: string;
let gameRoot: string;
let settingsRoot: string;
let boundary: string;
let storageDir: string;
let ledger: SetupInstallLedger;
let clock: number;

const createLibrary = (overrides: Partial<SetupLibraryOptions> = {}) =>
  createSetupLibrary({
    libraryRoot,
    ledger,
    getChosenGameFolder: () => undefined,
    detectGameFolder: async () => gameRoot,
    now: () => clock,
    ...overrides,
  });

const putLibrary = async (
  folder: string,
  fileName: string,
  content: string
): Promise<string> => {
  const filePath = path.join(libraryRoot, folder, fileName);
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, content);
  return filePath;
};

const gameFile = (folder: string, fileName: string): string =>
  path.join(settingsRoot, folder, fileName);

const readGame = (folder: string, fileName: string): Promise<string> =>
  fsp.readFile(gameFile(folder, fileName), 'utf8');

const exists = async (filePath: string): Promise<boolean> => {
  try {
    await fsp.stat(filePath);
    return true;
  } catch {
    return false;
  }
};

const keyFor = (fileName: string, folder = 'Spa'): string =>
  setupInstallKey('lmu', boundary, folder, fileName);

const shaOf = (text: string): string =>
  createHash('sha256').update(Buffer.from(text)).digest('hex');

const warnings = (): string[] =>
  vi.mocked(logger.warn).mock.calls.map(([message]) => String(message));
const infos = (): string[] =>
  vi.mocked(logger.info).mock.calls.map(([message]) => String(message));

beforeEach(async () => {
  root = await fsp.mkdtemp(path.join(os.tmpdir(), 'tearoff-setup-library-'));
  libraryRoot = path.join(root, 'documents', 'Tearoff', 'Setups', 'LMU');
  gameRoot = path.join(root, 'game', 'Le Mans Ultimate');
  settingsRoot = path.join(gameRoot, 'UserData', 'player', 'Settings');
  await fsp.mkdir(path.join(settingsRoot, 'Spa'), { recursive: true });
  storageDir = path.join(root, 'userData');
  await fsp.mkdir(storageDir);
  boundary = await fsp.realpath(settingsRoot);
  ledger = createSetupInstallLedger(storageDir);
  clock = Date.now() + 60_000;
  vi.mocked(logger.warn).mockClear();
  vi.mocked(logger.info).mockClear();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await ledger.flush();
  // root is the exact mkdtemp result, never a real application profile.
  await fsp.rm(root, { recursive: true, force: true });
});

describe('decideInstall', () => {
  const sha = 'a'.repeat(64);
  const other = 'b'.repeat(64);

  it('copies a file the game does not have', () => {
    expect(
      decideInstall({ librarySha: sha, targetSha: null, ledgerSha: undefined })
    ).toBe('copy');
  });

  it('does nothing when the game already has these bytes', () => {
    for (const ledgerSha of [undefined, sha, other]) {
      expect(
        decideInstall({ librarySha: sha, targetSha: sha, ledgerSha })
      ).toBe('none');
    }
  });

  it('updates its own untouched file', () => {
    expect(
      decideInstall({ librarySha: sha, targetSha: other, ledgerSha: other })
    ).toBe('update');
  });

  it('never touches a file changed since Tearoff wrote it', () => {
    expect(
      decideInstall({
        librarySha: sha,
        targetSha: other,
        ledgerSha: 'c'.repeat(64),
      })
    ).toBe('conflict-changed');
  });

  it('never touches a file Tearoff did not write', () => {
    expect(
      decideInstall({ librarySha: sha, targetSha: other, ledgerSha: undefined })
    ).toBe('conflict-foreign');
  });
});

describe('getListing', () => {
  it('lists tracks and their files, with the car', async () => {
    await putLibrary('Spa', 'Race.svm', setup());
    await putLibrary('bar', 'Other.SVM', setup());
    await putLibrary('Spa', 'notes.txt', 'x');
    await fsp.mkdir(path.join(libraryRoot, 'Spa', 'nested'));
    await putLibrary('', 'Loose.svm', setup());

    const listing = await createLibrary().getListing(null);

    expect(listing.libraryExists).toBe(true);
    expect(listing.tracks.map((track) => track.folder)).toEqual(['bar', 'Spa']);
    expect(listing.tracks[1].files.map((file) => file.fileName)).toEqual([
      'Race.svm',
    ]);
    expect(listing.tracks[1].files[0].vehicleClass).toBe(CAR);
    expect(listing.unplacedFiles).toEqual(['Loose.svm']);
    expect(listing.truncated).toBe(false);
  });

  it('matches a library folder to the game’s own name, ignoring case', async () => {
    await putLibrary('spa', 'Race.svm', setup());
    const listing = await createLibrary().getListing(null);
    expect(listing.tracks[0].gameFolder).toBe('Spa');
  });

  it('takes the session’s track folder when the game has none yet', async () => {
    await putLibrary('lemans', 'Race.svm', setup());
    const listing = await createLibrary().getListing('Lemans');
    expect(listing.tracks[0].gameFolder).toBe('Lemans');
    expect(listing.tracks[0].files[0].status).toEqual({ kind: 'ready' });
  });

  it('creates nothing, even when the library does not exist', async () => {
    const missing = path.join(root, 'missing-library');
    const library = createSetupLibrary({
      libraryRoot: missing,
      ledger,
      getChosenGameFolder: () => undefined,
      detectGameFolder: async () => gameRoot,
      now: () => clock,
    });
    const listing = await library.getListing(null);
    expect(listing.libraryExists).toBe(false);
    expect(await exists(missing)).toBe(false);
  });

  it('marks an invalid file without installing it', async () => {
    await putLibrary('Spa', 'Empty.svm', '');
    await putLibrary('Spa', 'NoCar.svm', '[GENERAL]\n');
    const listing = await createLibrary().getListing(null);
    expect(listing.tracks[0].files.map((file) => file.status)).toEqual([
      { kind: 'invalid', problem: 'empty' },
      { kind: 'invalid', problem: 'no-vehicle-class' },
    ]);
  });

  it('shows more than 200 files per folder as truncated', async () => {
    for (let index = 0; index < 201; index += 1) {
      await putLibrary('Spa', `Setup ${index}.svm`, setup(index));
    }
    const listing = await createLibrary().getListing(null);
    expect(listing.tracks[0].files).toHaveLength(200);
    expect(listing.truncated).toBe(true);
  });
});

describe('syncTrack', () => {
  it('copies a new setup byte for byte and records it', async () => {
    await putLibrary('Spa', 'Race.svm', setup());
    const library = createLibrary();

    await expect(
      library.syncTrack('Spa', { createGameFolder: false })
    ).resolves.toEqual({
      copied: 1,
      updated: 0,
      conflicts: 0,
      errors: 0,
      resolved: true,
    });
    expect(await readGame('Spa', 'Race.svm')).toBe(setup());
    expect(ledger.get(keyFor('Race.svm'))).toBeDefined();

    await library.syncTrack('Spa', { createGameFolder: false });
    expect(await readGame('Spa', 'Race.svm')).toBe(setup());
  });

  it('replaces its own untouched file when the library changes', async () => {
    const libraryPath = await putLibrary('Spa', 'Race.svm', setup(0));
    const library = createLibrary();
    await library.syncTrack('Spa', { createGameFolder: false });

    await fsp.writeFile(libraryPath, setup(1));
    await library.syncTrack('Spa', { createGameFolder: false });

    expect(await readGame('Spa', 'Race.svm')).toBe(setup(1));
  });

  it('leaves a file changed in the garage alone', async () => {
    const libraryPath = await putLibrary('Spa', 'Race.svm', setup(0));
    const library = createLibrary();
    await library.syncTrack('Spa', { createGameFolder: false });

    await fsp.writeFile(gameFile('Spa', 'Race.svm'), 'driver worked on it');
    await fsp.writeFile(libraryPath, setup(1));
    const result = await library.syncTrack('Spa', { createGameFolder: false });

    expect(result.conflicts).toBe(1);
    expect(await readGame('Spa', 'Race.svm')).toBe('driver worked on it');
    const listing = await library.getListing(null);
    expect(listing.tracks[0].files[0].status).toEqual({
      kind: 'conflict',
      reason: 'changed-in-game',
    });
  });

  it('leaves a same-name file Tearoff did not write alone', async () => {
    await fsp.writeFile(gameFile('Spa', 'Race.svm'), 'someone else’s');
    await putLibrary('Spa', 'Race.svm', setup());

    const library = createLibrary();
    const result = await library.syncTrack('Spa', { createGameFolder: false });

    expect(result.conflicts).toBe(1);
    expect(await readGame('Spa', 'Race.svm')).toBe('someone else’s');
  });

  it('claims no file whose bytes only happen to match', async () => {
    await fsp.writeFile(gameFile('Spa', 'Race.svm'), setup());
    const libraryPath = await putLibrary('Spa', 'Race.svm', setup());
    const library = createLibrary();

    await library.syncTrack('Spa', { createGameFolder: false });
    expect(ledger.get(keyFor('Race.svm'))).toBeUndefined();
    expect((await library.getListing(null)).tracks[0].files[0].status).toEqual({
      kind: 'installed',
    });

    await fsp.writeFile(libraryPath, setup(1));
    await library.syncTrack('Spa', { createGameFolder: false });
    expect(await readGame('Spa', 'Race.svm')).toBe(setup());
    expect((await library.getListing(null)).tracks[0].files[0].status).toEqual({
      kind: 'conflict',
      reason: 'not-from-tearoff',
    });
  });

  it('never removes a file from the game when the library loses it', async () => {
    await putLibrary('Spa', 'Race.svm', setup());
    const library = createLibrary();
    await library.syncTrack('Spa', { createGameFolder: false });

    await fsp.rm(path.join(libraryRoot, 'Spa', 'Race.svm'));
    await library.syncTrack('Spa', { createGameFolder: false });

    expect(await readGame('Spa', 'Race.svm')).toBe(setup());
  });

  it('waits for a file the producer may still be writing', async () => {
    await putLibrary('Spa', 'Race.svm', setup());
    clock = Date.now();
    const library = createLibrary();

    await library.syncTrack('Spa', { createGameFolder: false });
    expect(await exists(gameFile('Spa', 'Race.svm'))).toBe(false);
    expect((await library.getListing(null)).tracks[0].files[0].status).toEqual({
      kind: 'pending',
    });

    clock += 5_000;
    await library.syncTrack('Spa', { createGameFolder: false });
    expect(await readGame('Spa', 'Race.svm')).toBe(setup());
  });

  it('never copies an invalid file', async () => {
    await putLibrary('Spa', 'Empty.svm', '');
    await putLibrary(
      'Spa',
      'Huge.svm',
      `VehicleClassSetting="${CAR}"\n${'x'.repeat(256 * 1024)}`
    );
    const library = createLibrary();
    const result = await library.syncTrack('Spa', { createGameFolder: false });
    expect(result.copied).toBe(0);
    expect(await exists(gameFile('Spa', 'Empty.svm'))).toBe(false);
    expect(await exists(gameFile('Spa', 'Huge.svm'))).toBe(false);
  });

  it('uses the game’s own casing for a library folder', async () => {
    await putLibrary('spa', 'Race.svm', setup());
    const library = createLibrary();
    await library.syncTrack('spa', { createGameFolder: false });
    expect(await readGame('Spa', 'Race.svm')).toBe(setup());
  });

  it('creates a missing game track folder only when allowed', async () => {
    await putLibrary('Lemans', 'Race.svm', setup());
    const library = createLibrary();

    await expect(
      library.syncTrack('Lemans', { createGameFolder: false })
    ).resolves.toMatchObject({ resolved: false });
    expect(await exists(path.join(settingsRoot, 'Lemans'))).toBe(false);

    await expect(
      library.syncTrack('Lemans', { createGameFolder: true })
    ).resolves.toMatchObject({ resolved: true, copied: 1 });
    expect(await readGame('Lemans', 'Race.svm')).toBe(setup());
  });

  it('creates a missing Settings folder on the automatic path', async () => {
    const install = path.join(root, 'fresh-game');
    await fsp.mkdir(path.join(install, 'UserData', 'player'), {
      recursive: true,
    });
    await putLibrary('Spa', 'Race.svm', setup());
    const library = createLibrary({
      detectGameFolder: async () => install,
    });

    // Without permission only the session's own track may create anything,
    // and nothing exists yet to install into.
    await expect(
      library.syncTrack('Spa', { createGameFolder: false })
    ).resolves.toMatchObject({ resolved: false });
    expect(
      await exists(path.join(install, 'UserData', 'player', 'Settings'))
    ).toBe(false);

    await expect(
      library.syncTrack('Spa', { createGameFolder: true })
    ).resolves.toMatchObject({ resolved: true, copied: 1 });
    expect(
      await fsp.readFile(
        path.join(install, 'UserData', 'player', 'Settings', 'Spa', 'Race.svm'),
        'utf8'
      )
    ).toBe(setup());
  });

  it('installs nothing when no game folder is known', async () => {
    await putLibrary('Spa', 'Race.svm', setup());
    const library = createLibrary({ detectGameFolder: async () => null });
    await expect(
      library.syncTrack('Spa', { createGameFolder: true })
    ).resolves.toMatchObject({ resolved: false });
    expect(await exists(gameFile('Spa', 'Race.svm'))).toBe(false);
  });
});

describe('replace', () => {
  it('overwrites a conflict after the person agreed', async () => {
    await fsp.writeFile(gameFile('Spa', 'Race.svm'), 'garage save');
    await putLibrary('Spa', 'Race.svm', setup());
    const library = createLibrary();
    await library.syncTrack('Spa', { createGameFolder: false });

    await expect(library.replace('Spa', 'Race.svm')).resolves.toBe('replaced');
    expect(await readGame('Spa', 'Race.svm')).toBe(setup());
    expect((await library.getListing(null)).tracks[0].files[0].status).toEqual({
      kind: 'installed',
    });

    // What Replace overwrote is not destroyed: it stays in the garage.
    const names = await fsp.readdir(path.join(settingsRoot, 'Spa'));
    const kept = names.filter((name) => /\(kept .+\)\.svm$/.test(name));
    expect(kept).toHaveLength(1);
    expect(
      await fsp.readFile(path.join(settingsRoot, 'Spa', kept[0]), 'utf8')
    ).toBe('garage save');
  });

  it('puts the original back on a full volume, without new space', async () => {
    await fsp.writeFile(gameFile('Spa', 'Race.svm'), 'garage save');
    await putLibrary('Spa', 'Race.svm', setup());
    const library = createLibrary();

    // No copy can be made at all: the backup fails, and so would a rollback
    // that copied the bytes back. The link is what restores the name.
    const spy = vi
      .spyOn(fsp, 'copyFile')
      .mockImplementation(() =>
        Promise.reject(Object.assign(new Error('no space'), { code: 'ENOSPC' }))
      );

    try {
      await expect(library.replace('Spa', 'Race.svm')).resolves.toBe('refused');
    } finally {
      spy.mockRestore();
    }

    expect(await readGame('Spa', 'Race.svm')).toBe('garage save');
    const names = await fsp.readdir(path.join(settingsRoot, 'Spa'));
    expect(names.some((name) => name.includes('(kept '))).toBe(false);
    expect(names.some((name) => name.endsWith('.old'))).toBe(false);
  });

  it('keeps nothing extra when it replaces only its own bytes', async () => {
    await putLibrary('Spa', 'Race.svm', setup());
    const library = createLibrary();
    await library.syncTrack('Spa', { createGameFolder: false });

    await expect(library.replace('Spa', 'Race.svm')).resolves.toBe('replaced');
    const names = await fsp.readdir(path.join(settingsRoot, 'Spa'));
    expect(names.some((name) => name.includes('(kept '))).toBe(false);
  });

  it('refuses an invalid, pending or unknown file', async () => {
    await putLibrary('Spa', 'Empty.svm', '');
    const library = createLibrary();
    clock = Date.now();
    await expect(library.replace('Spa', 'Empty.svm')).resolves.toBe('refused');
    await expect(library.replace('Spa', 'Missing.svm')).resolves.toBe(
      'refused'
    );
    await expect(library.replace('../Spa', 'Empty.svm')).resolves.toBe(
      'refused'
    );
  });
});

describe('a write never clobbers what it did not check', () => {
  it('keeps a file created between the decision and the publish', async () => {
    await putLibrary('Spa', 'Race.svm', setup());
    let created = false;
    const library = createLibrary({
      hooks: {
        beforePublish: async (target) => {
          if (created) return;
          created = true;
          await fsp.writeFile(target, 'appeared meanwhile', { flag: 'wx' });
        },
      },
    });

    const result = await library.syncTrack('Spa', { createGameFolder: false });
    expect(result.conflicts).toBe(1);
    expect(await readGame('Spa', 'Race.svm')).toBe('appeared meanwhile');
    expect(ledger.get(keyFor('Race.svm'))).toBeUndefined();
  });

  it('keeps a garage save made between the decision and the update', async () => {
    const libraryPath = await putLibrary('Spa', 'Race.svm', setup(0));
    const library = createLibrary();
    await library.syncTrack('Spa', { createGameFolder: false });
    const owned = ledger.get(keyFor('Race.svm'));

    await fsp.writeFile(libraryPath, setup(1));
    let changed = false;
    const racing = createLibrary({
      hooks: {
        beforeRename: async (target) => {
          if (changed) return;
          changed = true;
          await fsp.writeFile(target, 'saved during the update');
        },
      },
    });

    const result = await racing.syncTrack('Spa', { createGameFolder: false });
    expect(result.conflicts).toBe(1);
    expect(await readGame('Spa', 'Race.svm')).toBe('saved during the update');
    expect(ledger.get(keyFor('Race.svm'))).toBe(owned);
    expect(
      (await fsp.readdir(path.join(settingsRoot, 'Spa'))).filter((name) =>
        name.includes('.old')
      )
    ).toEqual([]);
  });

  it('keeps a file recreated while the update publishes', async () => {
    const libraryPath = await putLibrary('Spa', 'Race.svm', setup(0));
    const library = createLibrary();
    await library.syncTrack('Spa', { createGameFolder: false });

    await fsp.writeFile(libraryPath, setup(1));
    let created = false;
    const racing = createLibrary({
      hooks: {
        afterRename: async (_aside, target) => {
          if (created) return;
          created = true;
          await fsp.writeFile(target, 'saved again', { flag: 'wx' });
        },
      },
    });

    const result = await racing.syncTrack('Spa', { createGameFolder: false });
    expect(result.conflicts).toBe(1);
    expect(await readGame('Spa', 'Race.svm')).toBe('saved again');
    expect(
      (await fsp.readdir(path.join(settingsRoot, 'Spa'))).filter((name) =>
        name.includes('.old')
      )
    ).toEqual([]);
  });

  it('keeps a double save as a visible setup', async () => {
    const libraryPath = await putLibrary('Spa', 'Race.svm', setup(0));
    const library = createLibrary();
    await library.syncTrack('Spa', { createGameFolder: false });

    await fsp.writeFile(libraryPath, setup(1));
    let raced = false;
    const racing = createLibrary({
      hooks: {
        beforeRename: async (target) => {
          if (raced) return;
          await fsp.writeFile(target, 'first save');
        },
        afterRename: async (_aside, target) => {
          if (raced) return;
          raced = true;
          await fsp.writeFile(target, 'second save', { flag: 'wx' });
        },
      },
    });

    await racing.syncTrack('Spa', { createGameFolder: false });
    expect(await readGame('Spa', 'Race.svm')).toBe('second save');
    const names = await fsp.readdir(path.join(settingsRoot, 'Spa'));
    const kept = names.filter((name) => /\(kept .+\)\.svm$/.test(name));
    expect(kept).toHaveLength(1);
    expect(
      await fsp.readFile(path.join(settingsRoot, 'Spa', kept[0]), 'utf8')
    ).toBe('first save');
  });

  it('publishes the bytes it validated, not a newer revision', async () => {
    const libraryPath = await putLibrary('Spa', 'Race.svm', setup(0));
    const library = createLibrary({
      hooks: {
        beforePublish: async () => {
          await fsp.writeFile(libraryPath, setup(9));
        },
      },
    });

    await library.syncTrack('Spa', { createGameFolder: false });
    expect(await readGame('Spa', 'Race.svm')).toBe(setup(0));
    expect(ledger.get(keyFor('Race.svm'))).toBe(shaOf(setup(0)));
  });

  it('reports a failed write, then clears it', async () => {
    await putLibrary('Spa', 'Race.svm', setup());
    let fail = true;
    const library = createLibrary({
      hooks: {
        beforePublish: () => {
          if (!fail) return;
          fail = false;
          throw Object.assign(new Error('busy'), { code: 'EBUSY' });
        },
      },
    });

    const result = await library.syncTrack('Spa', { createGameFolder: false });
    expect(result.errors).toBe(1);
    expect((await library.getListing(null)).tracks[0].files[0].status).toEqual({
      kind: 'error',
      code: 'EBUSY',
    });

    await library.syncTrack('Spa', { createGameFolder: false });
    expect((await library.getListing(null)).tracks[0].files[0].status).toEqual({
      kind: 'installed',
    });
  });
});

describe('recovering an interrupted update', () => {
  const asideOf = (fileName: string, index = 1): string =>
    `${gameFile('Spa', fileName)}.tearoff-1-${index}.old`;

  it('restores a save left in a side file when the game file is gone', async () => {
    await putLibrary('Spa', 'Race.svm', setup());
    await fsp.writeFile(asideOf('Race.svm'), 'garage save moved aside');

    const library = createLibrary();
    await library.syncTrack('Spa', { createGameFolder: false });

    expect(await readGame('Spa', 'Race.svm')).toBe('garage save moved aside');
    expect(await exists(asideOf('Race.svm'))).toBe(false);
  });

  it('removes its own old bytes from a side file', async () => {
    await putLibrary('Spa', 'Race.svm', setup(1));
    await fsp.writeFile(gameFile('Spa', 'Race.svm'), setup(1));
    ledger.set(keyFor('Race.svm'), shaOf(setup(1)));
    await fsp.writeFile(asideOf('Race.svm'), setup(1));

    const library = createLibrary();
    await library.syncTrack('Spa', { createGameFolder: false });

    expect(await exists(asideOf('Race.svm'))).toBe(false);
    expect(await readGame('Spa', 'Race.svm')).toBe(setup(1));
  });

  it('recovers a side file even when the library lost the track', async () => {
    await fsp.mkdir(libraryRoot, { recursive: true });
    await fsp.writeFile(asideOf('Race.svm'), 'garage save moved aside');

    const library = createLibrary();
    const result = await library.syncTrack('Spa', {
      createGameFolder: false,
    });

    expect(result.resolved).toBe(true);
    expect(await readGame('Spa', 'Race.svm')).toBe('garage save moved aside');
    expect(await exists(asideOf('Race.svm'))).toBe(false);
  });

  it('keeps the last good setup when a publish was torn', async () => {
    const oldBytes = setup(0);
    await putLibrary('Spa', 'Race.svm', setup(1));
    ledger.set(keyFor('Race.svm'), shaOf(oldBytes));
    // The new version was being published when the process died.
    await fsp.writeFile(gameFile('Spa', 'Race.svm'), setup(1).slice(0, 12));
    await fsp.writeFile(asideOf('Race.svm'), oldBytes);

    const library = createLibrary();
    const result = await library.syncTrack('Spa', {
      createGameFolder: false,
    });

    expect(result.conflicts).toBe(1);
    const names = await fsp.readdir(path.join(settingsRoot, 'Spa'));
    expect(names.some((name) => name.endsWith('.old'))).toBe(false);
    const kept = names.filter((name) => /\(kept .+\)\.svm$/.test(name));
    expect(kept).toHaveLength(1);
    expect(
      await fsp.readFile(path.join(settingsRoot, 'Spa', kept[0]), 'utf8')
    ).toBe(oldBytes);
  });

  it('keeps a save it cannot restore, visibly', async () => {
    await putLibrary('Spa', 'Race.svm', setup());
    await fsp.writeFile(gameFile('Spa', 'Race.svm'), 'newer save');
    await fsp.writeFile(asideOf('Race.svm'), 'moved aside save');

    const library = createLibrary();
    await library.syncTrack('Spa', { createGameFolder: false });

    expect(await readGame('Spa', 'Race.svm')).toBe('newer save');
    const names = await fsp.readdir(path.join(settingsRoot, 'Spa'));
    expect(names.some((name) => /Race \(kept .+\)\.svm$/.test(name))).toBe(
      true
    );
    expect(names.some((name) => name.endsWith('.old'))).toBe(false);
  });
});

describe('ownership belongs to one LMU folder', () => {
  it('does not carry over to another install with the same bytes', async () => {
    await putLibrary('Spa', 'Race.svm', setup(0));
    const libraryA = createLibrary();
    await libraryA.syncTrack('Spa', { createGameFolder: false });

    const otherRoot = path.join(root, 'other-game');
    const otherSettings = path.join(
      otherRoot,
      'UserData',
      'player',
      'Settings',
      'Spa'
    );
    await fsp.mkdir(otherSettings, { recursive: true });
    await fsp.writeFile(path.join(otherSettings, 'Race.svm'), setup(0));

    await fsp.writeFile(path.join(libraryRoot, 'Spa', 'Race.svm'), setup(1));
    const libraryB = createLibrary({ detectGameFolder: async () => otherRoot });
    const result = await libraryB.syncTrack('Spa', { createGameFolder: false });

    expect(result.conflicts).toBe(1);
    expect(
      await fsp.readFile(path.join(otherSettings, 'Race.svm'), 'utf8')
    ).toBe(setup(0));
  });
});

describe('where writes may go', () => {
  it('follows a link on the install itself, as the game does', async () => {
    const outside = path.join(root, 'outside-data');
    await fsp.mkdir(path.join(outside, 'player', 'Settings', 'Spa'), {
      recursive: true,
    });
    const install = path.join(root, 'linked-game');
    await fsp.mkdir(install, { recursive: true });
    await fsp.symlink(
      outside,
      path.join(install, 'UserData'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    await putLibrary('Spa', 'Race.svm', setup());

    const library = createLibrary({ detectGameFolder: async () => install });
    await library.syncTrack('Spa', { createGameFolder: false });

    expect(
      await fsp.readFile(
        path.join(outside, 'player', 'Settings', 'Spa', 'Race.svm'),
        'utf8'
      )
    ).toBe(setup());
  });

  it('refuses a track folder that redirects elsewhere', async () => {
    const outside = path.join(root, 'outside-track');
    await fsp.mkdir(outside, { recursive: true });
    await fsp.rm(path.join(settingsRoot, 'Spa'), { recursive: true });
    await fsp.symlink(
      outside,
      path.join(settingsRoot, 'Spa'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    await putLibrary('Spa', 'Race.svm', setup());

    const library = createLibrary();
    const result = await library.syncTrack('Spa', { createGameFolder: true });

    expect(result.resolved).toBe(false);
    expect(await exists(path.join(outside, 'Race.svm'))).toBe(false);
  });

  it('refuses a track folder that links to another track', async () => {
    await fsp.mkdir(path.join(settingsRoot, 'Monza'), { recursive: true });
    await fsp.writeFile(path.join(settingsRoot, 'Monza', 'Race.svm'), setup(0));
    await fsp.rm(path.join(settingsRoot, 'Spa'), { recursive: true });
    await fsp.symlink(
      path.join(settingsRoot, 'Monza'),
      path.join(settingsRoot, 'Spa'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    ledger.set(keyFor('Race.svm'), shaOf(setup(0)));
    await putLibrary('Spa', 'Race.svm', setup(1));

    const library = createLibrary();
    const result = await library.syncTrack('Spa', { createGameFolder: true });

    expect(result.resolved).toBe(false);
    expect(
      await fsp.readFile(path.join(settingsRoot, 'Monza', 'Race.svm'), 'utf8')
    ).toBe(setup(0));
  });

  it('stops writing when the track folder is redirected mid-pass', async () => {
    const outside = path.join(root, 'outside-mid-pass');
    await fsp.mkdir(outside, { recursive: true });
    await putLibrary('Spa', 'Race.svm', setup());

    const library = createLibrary({
      hooks: {
        beforePublish: async () => {
          await fsp.rm(path.join(settingsRoot, 'Spa'), {
            recursive: true,
            force: true,
          });
          await fsp.symlink(
            outside,
            path.join(settingsRoot, 'Spa'),
            process.platform === 'win32' ? 'junction' : 'dir'
          );
        },
      },
    });

    const result = await library.syncTrack('Spa', { createGameFolder: false });

    expect(result.resolved).toBe(false);
    expect(await exists(path.join(outside, 'Race.svm'))).toBe(false);
  });

  it('never follows a link standing where a setup should be', async () => {
    const target = path.join(root, 'elsewhere.svm');
    await fsp.writeFile(target, 'not touched');
    const libraryFile = gameFile('Spa', 'Race.svm');
    await fsp.symlink(target, libraryFile);
    await putLibrary('Spa', 'Race.svm', setup());

    const library = createLibrary();
    const result = await library.syncTrack('Spa', { createGameFolder: false });

    expect(result.conflicts).toBe(1);
    expect(await fsp.readFile(target, 'utf8')).toBe('not touched');
  });
});

describe('the queue', () => {
  it('refuses new writes once closed and drains what was queued', async () => {
    await putLibrary('Spa', 'Race.svm', setup());
    const library = createLibrary();
    library.close();

    await expect(
      library.syncTrack('Spa', { createGameFolder: false })
    ).resolves.toMatchObject({ resolved: false });
    await expect(library.replace('Spa', 'Race.svm')).resolves.toBe('refused');
    await library.drain();
    expect(await exists(gameFile('Spa', 'Race.svm'))).toBe(false);
  });

  it('drains a sync in flight', async () => {
    await putLibrary('Spa', 'Race.svm', setup());
    let release: (() => void) | undefined;
    const library = createLibrary({
      hooks: {
        beforePublish: () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      },
    });

    const syncing = library.syncTrack('Spa', { createGameFolder: false });
    let drained = false;
    const draining = library.drain().then(() => {
      drained = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(drained).toBe(false);

    release?.();
    await syncing;
    await draining;
    expect(drained).toBe(true);
  });
});

describe('logging', () => {
  it('never writes a path', async () => {
    await putLibrary('Spa', 'Race.svm', setup());
    await fsp.writeFile(gameFile('Spa', 'Race.svm'), 'someone else’s');
    const library = createLibrary();
    await library.syncTrack('Spa', { createGameFolder: false });
    await library.getListing(null);

    for (const line of [...warnings(), ...infos()]) {
      expect(line).not.toContain(root);
    }
  });
});
