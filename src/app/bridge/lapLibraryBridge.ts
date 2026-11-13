import { BrowserWindow, ipcMain } from 'electron';
import type { LapLibraryService } from '../storage/lapLibrary/lapLibraryService';
import { defineRendererSubscriptionBridge } from './defineBridge';

/** Row ids are positive integers; anything else is not one of ours. */
const isId = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

/** An optional page size or offset: a whole number that is not negative. */
const countOrUndefined = (value: unknown, name: string): number | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`Invalid ${name} for the lap library`);
  }
  return value;
};

const idOrThrow = (value: unknown, channel: string): number => {
  if (!isId(value)) throw new TypeError(`Invalid id for ${channel}`);
  return value;
};

const CHANNELS = [
  'lapLibrary:listSessions',
  'lapLibrary:listLaps',
  'lapLibrary:deleteLap',
  'lapLibrary:deleteSession',
  'lapLibrary:pinReference',
  'lapLibrary:unpinReference',
  'lapLibrary:getStats',
] as const;

/**
 * What the settings page may ask of the lap library, over IPC.
 *
 * Every argument is checked here: the renderer is not trusted to send a
 * number where one is expected. A change is announced only to the windows
 * that asked to hear of it, which is the settings page while it is open.
 */
export function setupLapLibraryBridge(library: LapLibraryService) {
  const subscriptions = defineRendererSubscriptionBridge({
    name: 'lapLibrary',
    isValidKey: (value: unknown): value is 'changed' => value === 'changed',
  });

  ipcMain.handle(
    'lapLibrary:listSessions',
    (_event, limit: unknown, offset: unknown) =>
      library.listSessions(
        countOrUndefined(limit, 'limit'),
        countOrUndefined(offset, 'offset')
      )
  );
  ipcMain.handle('lapLibrary:listLaps', (_event, sessionId: unknown) =>
    library.listLaps(idOrThrow(sessionId, 'lapLibrary:listLaps'))
  );
  ipcMain.handle('lapLibrary:deleteLap', (_event, lapId: unknown) =>
    library.deleteLap(idOrThrow(lapId, 'lapLibrary:deleteLap'))
  );
  ipcMain.handle('lapLibrary:deleteSession', (_event, sessionId: unknown) =>
    library.deleteSession(idOrThrow(sessionId, 'lapLibrary:deleteSession'))
  );
  ipcMain.handle('lapLibrary:pinReference', (_event, lapId: unknown) =>
    library.pinReference(idOrThrow(lapId, 'lapLibrary:pinReference'))
  );
  ipcMain.handle('lapLibrary:unpinReference', (_event, lapId: unknown) =>
    library.unpinReference(idOrThrow(lapId, 'lapLibrary:unpinReference'))
  );
  ipcMain.handle('lapLibrary:getStats', () => library.getStats());

  const unsubscribe = library.onChanged(() => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (
        !window.isDestroyed() &&
        subscriptions.registry.has(window.webContents.id, 'changed')
      ) {
        window.webContents.send('lapLibrary:changed');
      }
    }
  });

  return () => {
    unsubscribe();
    subscriptions.dispose();
    for (const channel of CHANNELS) ipcMain.removeHandler(channel);
  };
}
