import { app } from 'electron';
import fsp from 'node:fs/promises';
import path from 'node:path';
import logger from '../logger';
import { isValidRect, type Rect } from '../windowBounds';
import { createDebouncedAtomicWriter } from './debouncedAtomicWriter';

const FILE_NAME = 'pitwall-window-bounds.json';
const errorCode = (error: unknown): string =>
  (error as NodeJS.ErrnoException)?.code ?? 'UNKNOWN';

/** Where the Pit Wall window was left. */
export interface PitWallWindowPlacement {
  /**
   * The window's rectangle while it is neither maximised nor full screen, in
   * Electron's logical pixels. Its position says which monitor it is on.
   */
  bounds: Rect;
  /** It was maximised, so it opens maximised on that monitor again. */
  maximized: boolean;
}

/**
 * The Pit Wall window's place between runs, in a file of its own beside the
 * settings window's. Nothing is written until the user has moved or resized
 * the window, so a profile that never opened it has no file.
 */
export function createPitWallWindowBoundsStore(storageDir: string) {
  const filePath = path.join(storageDir, FILE_NAME);
  let placement: PitWallWindowPlacement | undefined;
  let loaded: Promise<void> | undefined;
  let ready = false;
  let saveBlocked = false;
  const writer = createDebouncedAtomicWriter({
    filePath,
    serialize: () => JSON.stringify(placement ?? {}),
    onSuccess: () => undefined,
    onError: (error) =>
      logger.warn(
        '[PitWallWindowBounds] Failed to write',
        FILE_NAME,
        errorCode(error)
      ),
  });

  const load = (): Promise<void> =>
    (loaded ??= (async () => {
      let stored: unknown;
      try {
        stored = JSON.parse(await fsp.readFile(filePath, 'utf8'));
      } catch (error) {
        if (error instanceof SyntaxError) {
          logger.warn('[PitWallWindowBounds] Invalid JSON', FILE_NAME);
        } else if (errorCode(error) !== 'ENOENT') {
          // An unreadable file could hold a place the user chose. Do not
          // overwrite it; use the default this session and retry next run.
          saveBlocked = true;
          logger.warn(
            '[PitWallWindowBounds] Failed to read',
            FILE_NAME,
            errorCode(error)
          );
        }
      }

      // The file is untrusted: anything but a usable rectangle is ignored.
      if (
        typeof stored === 'object' &&
        stored !== null &&
        'bounds' in stored &&
        isValidRect(stored.bounds)
      ) {
        const { x, y, width, height } = stored.bounds;
        placement = {
          bounds: { x, y, width, height },
          maximized: 'maximized' in stored && stored.maximized === true,
        };
      }
      ready = true;
    })());

  return {
    load,
    get: (): PitWallWindowPlacement | undefined =>
      placement && {
        bounds: { ...placement.bounds },
        maximized: placement.maximized,
      },
    save(next: PitWallWindowPlacement): void {
      if (!ready || !isValidRect(next.bounds)) return;
      const { x, y, width, height } = next.bounds;
      placement = {
        bounds: { x, y, width, height },
        maximized: next.maximized === true,
      };
      if (!saveBlocked) writer.schedule();
    },
    async flush(): Promise<void> {
      if (loaded) await loaded;
      await writer.flush();
    },
  };
}

let store: ReturnType<typeof createPitWallWindowBoundsStore> | undefined;

/** Await once at startup, before anything can open the Pit Wall window. */
export const initializePitWallWindowBounds = (): Promise<void> => {
  store ??= createPitWallWindowBoundsStore(app.getPath('userData'));
  return store.load();
};

/** Cache-only window construction: initialization owns all reads. */
export const readPitWallWindowPlacement = ():
  PitWallWindowPlacement | undefined => store?.get();
export const savePitWallWindowPlacement = (
  placement: PitWallWindowPlacement
): void => store?.save(placement);
export const flushPitWallWindowBoundsOnShutdown = async (): Promise<void> => {
  await store?.flush();
};
