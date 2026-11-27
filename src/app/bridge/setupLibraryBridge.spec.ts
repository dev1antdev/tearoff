import { beforeEach, describe, expect, it, vi } from 'vitest';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { SetupLibraryListing, SetupLibraryState } from '../../types';
import type { SetupLibraryBridgeOptions } from './setupLibraryBridge';

const mock = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  return {
    handlers,
    handle: vi.fn(
      (channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler);
      }
    ),
    removeHandler: vi.fn((channel: string) => {
      handlers.delete(channel);
    }),
  };
});

vi.mock('electron', () => ({
  ipcMain: { handle: mock.handle, removeHandler: mock.removeHandler },
  dialog: { showOpenDialog: vi.fn() },
  shell: { openPath: vi.fn() },
}));

import { createSetupLibraryBridge } from './setupLibraryBridge';

const listing = (
  overrides: Partial<SetupLibraryListing> = {}
): SetupLibraryListing => ({
  libraryFolder: '/library/LMU',
  libraryExists: true,
  gameFolder: '/game/LMU',
  gameFolderSource: 'steam',
  gameTrackFolders: ['Spa'],
  tracks: [
    {
      folder: 'Spa',
      gameFolder: 'Spa',
      files: [
        {
          fileName: 'Race.svm',
          vehicleClass: 'GT3 Porsche',
          status: { kind: 'conflict', reason: 'changed-in-game' },
        },
      ],
    },
  ],
  unplacedFiles: [],
  truncated: false,
  ...overrides,
});

let root: string;

const setup = (options: Partial<SetupLibraryBridgeOptions> = {}) => {
  const state: SetupLibraryState = {
    ...listing(),
    autoInstall: true,
    lmuConnected: true,
    sessionTrackFolder: 'Spa',
    restReachable: true,
  };
  const getListing = vi.fn(async () => listing());
  const syncTrack = vi.fn(async () => ({
    copied: 1,
    updated: 0,
    conflicts: 0,
    errors: 0,
    resolved: true,
  }));
  const replace = vi.fn(async () => 'replaced' as const);
  const resetGameFolderCache = vi.fn();
  const status = vi.fn(() => ({
    lmuConnected: true,
    sessionTrackFolder: 'Spa',
    restReachable: true,
  }));
  const setEnabled = vi.fn();
  const setAutoInstall = vi.fn(async () => undefined);
  const setChosenGameFolder = vi.fn(async () => undefined);
  const pickFolder = vi.fn(async () => null as string | null);
  const openPath = vi.fn(async () => '');
  const libraryRoot = path.join(root, 'library', 'LMU');
  const dispose = createSetupLibraryBridge({
    library: { getListing, syncTrack, replace, resetGameFolderCache },
    autoInstall: { status, setEnabled },
    libraryRoot,
    getAutoInstall: () => state.autoInstall,
    setAutoInstall,
    setChosenGameFolder,
    pickFolder,
    openPath,
    ...options,
  });
  const call = (channel: string, ...args: unknown[]) => {
    const handler = mock.handlers.get(channel);
    if (!handler) throw new Error(`No handler for ${channel}`);
    return Promise.resolve(handler({}, ...args));
  };
  return {
    dispose,
    call,
    getListing,
    syncTrack,
    replace,
    resetGameFolderCache,
    setEnabled,
    setAutoInstall,
    setChosenGameFolder,
    pickFolder,
    openPath,
  };
};

beforeEach(async () => {
  mock.handlers.clear();
  vi.clearAllMocks();
  root = await fsp.mkdtemp(path.join(os.tmpdir(), 'tearoff-setup-bridge-'));
});

describe('createSetupLibraryBridge', () => {
  it('registers every channel and removes them on dispose', () => {
    const bridge = setup();
    expect([...mock.handlers.keys()].sort()).toEqual([
      'setupLibrary:chooseGameFolder',
      'setupLibrary:getState',
      'setupLibrary:installTrack',
      'setupLibrary:openLibraryFolder',
      'setupLibrary:replaceSetup',
      'setupLibrary:setAutoInstall',
    ]);
    bridge.dispose();
    expect(mock.handlers.size).toBe(0);
  });

  it('merges the listing with the install status', async () => {
    const bridge = setup();
    await expect(bridge.call('setupLibrary:getState')).resolves.toMatchObject({
      libraryFolder: '/library/LMU',
      autoInstall: true,
      lmuConnected: true,
      sessionTrackFolder: 'Spa',
      restReachable: true,
    });
    expect(bridge.getListing).toHaveBeenCalledWith('Spa');
  });

  it('opens the library folder after making sure it exists', async () => {
    const bridge = setup();
    const folder = path.join(root, 'library', 'LMU');
    await bridge.call('setupLibrary:openLibraryFolder');
    expect((await fsp.stat(folder)).isDirectory()).toBe(true);
    expect(bridge.openPath).toHaveBeenCalledWith(folder);
  });

  it('reports a cancelled folder choice and persists nothing', async () => {
    const bridge = setup();
    await expect(bridge.call('setupLibrary:chooseGameFolder')).resolves.toBe(
      'cancelled'
    );
    expect(bridge.setChosenGameFolder).not.toHaveBeenCalled();
  });

  it('refuses a folder that is not an LMU install', async () => {
    const bridge = setup({ pickFolder: async () => root });
    await expect(bridge.call('setupLibrary:chooseGameFolder')).resolves.toBe(
      'not-lmu-folder'
    );
    expect(bridge.setChosenGameFolder).not.toHaveBeenCalled();
    expect(bridge.resetGameFolderCache).not.toHaveBeenCalled();
  });

  it('keeps a chosen LMU folder and forgets the old detection', async () => {
    await fsp.mkdir(path.join(root, 'UserData', 'player'), {
      recursive: true,
    });
    const bridge = setup({ pickFolder: async () => root });
    await expect(bridge.call('setupLibrary:chooseGameFolder')).resolves.toBe(
      'chosen'
    );
    expect(bridge.setChosenGameFolder).toHaveBeenCalledWith(root);
    expect(bridge.resetGameFolderCache).toHaveBeenCalled();
  });

  it('persists the automatic install choice and tells the service', async () => {
    const bridge = setup();
    await bridge.call('setupLibrary:setAutoInstall', false);
    expect(bridge.setAutoInstall).toHaveBeenCalledWith(false);
    expect(bridge.setEnabled).toHaveBeenCalledWith(false);
  });

  it('refuses a non-boolean automatic install choice', async () => {
    const bridge = setup();
    await expect(
      bridge.call('setupLibrary:setAutoInstall', 'yes')
    ).rejects.toBeInstanceOf(TypeError);
    expect(bridge.setAutoInstall).not.toHaveBeenCalled();
  });

  it('installs a listed track, creating the folder only for the session', async () => {
    const bridge = setup();
    await bridge.call('setupLibrary:installTrack', 'Spa');
    expect(bridge.syncTrack).toHaveBeenCalledWith('Spa', {
      createGameFolder: true,
    });
  });

  it('does not create a folder for a track the session is not at', async () => {
    const syncTrack = vi.fn(async () => ({
      copied: 0,
      updated: 0,
      conflicts: 0,
      errors: 0,
      resolved: true,
    }));
    const bridge = setup({
      library: {
        getListing: async () =>
          listing({
            tracks: [{ folder: 'Lemans', gameFolder: 'Lemans', files: [] }],
          }),
        syncTrack,
        replace: vi.fn(),
        resetGameFolderCache: vi.fn(),
      },
    });
    await bridge.call('setupLibrary:installTrack', 'Lemans');
    expect(syncTrack).toHaveBeenCalledWith('Lemans', {
      createGameFolder: false,
    });
  });

  it('refuses a track that is not in the library', async () => {
    const bridge = setup();
    await expect(
      bridge.call('setupLibrary:installTrack', '../Spa')
    ).rejects.toBeInstanceOf(TypeError);
    expect(bridge.syncTrack).not.toHaveBeenCalled();
  });

  it('refuses a track the game has no folder for', async () => {
    const bridge = setup({
      library: {
        getListing: async () =>
          listing({
            tracks: [{ folder: 'Spa', gameFolder: null, files: [] }],
          }),
        syncTrack: vi.fn(),
        replace: vi.fn(),
        resetGameFolderCache: vi.fn(),
      },
    });
    await expect(
      bridge.call('setupLibrary:installTrack', 'Spa')
    ).rejects.toBeInstanceOf(TypeError);
  });

  it('replaces a file only when the listing calls it a conflict', async () => {
    const bridge = setup();
    await bridge.call('setupLibrary:replaceSetup', 'Spa', 'Race.svm');
    expect(bridge.replace).toHaveBeenCalledWith('Spa', 'Race.svm');
  });

  it('refuses a file that is not a conflict', async () => {
    const bridge = setup({
      library: {
        getListing: async () =>
          listing({
            tracks: [
              {
                folder: 'Spa',
                gameFolder: 'Spa',
                files: [
                  {
                    fileName: 'Race.svm',
                    vehicleClass: 'GT3',
                    status: { kind: 'installed' },
                  },
                ],
              },
            ],
          }),
        syncTrack: vi.fn(),
        replace: vi.fn(),
        resetGameFolderCache: vi.fn(),
      },
    });
    await expect(
      bridge.call('setupLibrary:replaceSetup', 'Spa', 'Race.svm')
    ).rejects.toBeInstanceOf(TypeError);
    expect(bridge.replace).not.toHaveBeenCalled();
  });

  it('refuses a file name that is too long or not a string', async () => {
    const bridge = setup();
    for (const fileName of ['x'.repeat(256), 7, null]) {
      await expect(
        bridge.call('setupLibrary:replaceSetup', 'Spa', fileName)
      ).rejects.toBeInstanceOf(TypeError);
    }
    expect(bridge.replace).not.toHaveBeenCalled();
  });
});
