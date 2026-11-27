import { dialog, ipcMain, shell } from 'electron';
import fsp from 'node:fs/promises';
import type { SetupLibraryState } from '../../types';
import logger from '../logger';
import { isLmuInstall } from '../lmu/setupLibrary/lmuInstall';
import type {
  SetupLibrary,
  SyncResult,
} from '../lmu/setupLibrary/setupLibrary';
import type { LmuSetupAutoInstall } from '../services/lmuSetupAutoInstall';

/**
 * What the settings window may ask of the setup library, over IPC.
 *
 * Nothing a renderer sends is taken as it comes: a track or a file is only
 * accepted when a fresh listing holds it under the same name, and no path
 * crosses in either direction. The game folder and the library folder are
 * chosen in dialogs this process opens, on paths it owns.
 */

const CHANNELS = [
  'setupLibrary:getState',
  'setupLibrary:openLibraryFolder',
  'setupLibrary:chooseGameFolder',
  'setupLibrary:setAutoInstall',
  'setupLibrary:installTrack',
  'setupLibrary:replaceSetup',
] as const;

const MAX_FOLDER_LENGTH = 128;
const MAX_FILE_LENGTH = 255;

const sameName = (a: string, b: string): boolean =>
  a.toLowerCase() === b.toLowerCase();

const textOrThrow = (value: unknown, max: number, channel: string): string => {
  if (typeof value !== 'string' || value.length < 1 || value.length > max) {
    throw new TypeError(`Invalid input for ${channel}`);
  }
  return value;
};

export interface SetupLibraryBridgeOptions {
  library: Pick<
    SetupLibrary,
    'getListing' | 'syncTrack' | 'replace' | 'resetGameFolderCache'
  >;
  autoInstall: Pick<LmuSetupAutoInstall, 'status' | 'setEnabled'>;
  libraryRoot: string;
  getAutoInstall: () => boolean;
  setAutoInstall: (enabled: boolean) => Promise<void>;
  setChosenGameFolder: (folder: string) => Promise<void>;
  /** Injected for tests; the defaults use Electron's dialog and shell. */
  pickFolder?: (defaultPath: string | undefined) => Promise<string | null>;
  openPath?: (folder: string) => Promise<string>;
}

export function createSetupLibraryBridge(
  options: SetupLibraryBridgeOptions
): () => void {
  const { library, autoInstall, libraryRoot } = options;
  const pickFolder =
    options.pickFolder ??
    (async (defaultPath: string | undefined) => {
      const { canceled, filePaths } = await dialog.showOpenDialog({
        title: 'Choose the Le Mans Ultimate folder',
        properties: ['openDirectory'],
        ...(defaultPath ? { defaultPath } : {}),
      });
      return canceled || !filePaths[0] ? null : filePaths[0];
    });
  const openPath =
    options.openPath ?? ((folder: string) => shell.openPath(folder));

  const state = async (): Promise<SetupLibraryState> => {
    const status = autoInstall.status();
    const listing = await library.getListing(status.sessionTrackFolder);
    return {
      ...listing,
      autoInstall: options.getAutoInstall(),
      ...status,
    };
  };

  ipcMain.handle('setupLibrary:getState', () => state());

  ipcMain.handle('setupLibrary:openLibraryFolder', async () => {
    await fsp.mkdir(libraryRoot, { recursive: true });
    const error = await openPath(libraryRoot);
    if (error) {
      // shell.openPath answers with a sentence; nothing of it is logged.
      logger.warn('[Setups] Could not open the library folder');
    }
  });

  ipcMain.handle('setupLibrary:chooseGameFolder', async () => {
    const listing = await library.getListing(null);
    const chosen = await pickFolder(listing.gameFolder ?? undefined);
    if (!chosen) return 'cancelled';
    if (!(await isLmuInstall(chosen))) return 'not-lmu-folder';
    await options.setChosenGameFolder(chosen);
    library.resetGameFolderCache();
    return 'chosen';
  });

  ipcMain.handle(
    'setupLibrary:setAutoInstall',
    async (_event, enabled: unknown) => {
      if (typeof enabled !== 'boolean') {
        throw new TypeError('Invalid input for setupLibrary:setAutoInstall');
      }
      await options.setAutoInstall(enabled);
      autoInstall.setEnabled(enabled);
    }
  );

  ipcMain.handle(
    'setupLibrary:installTrack',
    async (_event, folder: unknown) => {
      const name = textOrThrow(
        folder,
        MAX_FOLDER_LENGTH,
        'setupLibrary:installTrack'
      );
      const status = autoInstall.status();
      const listing = await library.getListing(status.sessionTrackFolder);
      const track = listing.tracks.find((entry) => entry.folder === name);
      if (!track || track.gameFolder === null) {
        throw new TypeError('Invalid track for setupLibrary:installTrack');
      }
      const createGameFolder = Boolean(
        status.sessionTrackFolder && sameName(status.sessionTrackFolder, name)
      );
      const result: SyncResult = await library.syncTrack(track.folder, {
        createGameFolder,
      });
      if (!result.resolved) {
        logger.warn(
          `[Setups] ${track.folder} could not be installed: the game has no setup folder for it`
        );
      }
      return state();
    }
  );

  ipcMain.handle(
    'setupLibrary:replaceSetup',
    async (_event, folder: unknown, fileName: unknown) => {
      const trackName = textOrThrow(
        folder,
        MAX_FOLDER_LENGTH,
        'setupLibrary:replaceSetup'
      );
      const file = textOrThrow(
        fileName,
        MAX_FILE_LENGTH,
        'setupLibrary:replaceSetup'
      );
      const status = autoInstall.status();
      const listing = await library.getListing(status.sessionTrackFolder);
      const track = listing.tracks.find((entry) => entry.folder === trackName);
      const entry = track?.files.find(
        (fileEntry) => fileEntry.fileName === file
      );
      if (!track || !entry || entry.status.kind !== 'conflict') {
        throw new TypeError('Invalid file for setupLibrary:replaceSetup');
      }
      await library.replace(track.folder, entry.fileName);
      return state();
    }
  );

  return () => {
    for (const channel of CHANNELS) ipcMain.removeHandler(channel);
  };
}
