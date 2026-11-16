import fsp from 'node:fs/promises';
import path from 'node:path';
import logger from '../logger';

export const DEVICE_KEY_FILE_NAME = 'browser-device-key.json';

const errorCode = (error: unknown): string =>
  (error as NodeJS.ErrnoException)?.code ?? 'UNKNOWN';

export interface DeviceKeyStoreOptions {
  /** The app's data folder. */
  storageDir: string;
  /** Makes a new key. */
  generate: () => string;
  /** Whether a stored value is a key. The file is untrusted. */
  isValid: (value: unknown) => value is string;
}

/**
 * The key other devices show the built-in web server, in a file of its own.
 *
 * It is not in a dashboard, because dashboards are exported and shared, and
 * nothing here writes it anywhere but that file: every message names the
 * file and an error code, never the key.
 *
 * A write is not debounced like other storage. A new key is a promise that
 * the old one is dead, so it is on disk, written whole beside the file and
 * moved over it, before anybody is told it exists.
 */
export function createDeviceKeyStore({
  storageDir,
  generate,
  isValid,
}: DeviceKeyStoreOptions) {
  const filePath = path.join(storageDir, DEVICE_KEY_FILE_NAME);
  const tempPath = `${filePath}.${process.pid}.tmp`;
  let key: string | null = null;
  let opened: Promise<void> | undefined;
  let lastWrite: Promise<void> = Promise.resolve();

  const write = (next: string): Promise<void> => {
    const operation = lastWrite.then(async () => {
      try {
        await fsp.writeFile(tempPath, JSON.stringify({ key: next }), 'utf8');
        await fsp.rename(tempPath, filePath);
      } catch (error) {
        await fsp.unlink(tempPath).catch(() => undefined);
        throw error;
      }
    });
    // One write at a time; a failed one does not hold up the next.
    lastWrite = operation.catch(() => undefined);
    return operation;
  };

  const open = (): Promise<void> =>
    (opened ??= (async () => {
      let stored: unknown;
      let mayOverwrite = true;
      try {
        stored = JSON.parse(await fsp.readFile(filePath, 'utf8'));
      } catch (error) {
        if (error instanceof SyntaxError) {
          logger.warn('[DeviceKey] Invalid JSON', DEVICE_KEY_FILE_NAME);
        } else if (errorCode(error) !== 'ENOENT') {
          // The file may hold the key the user's devices have. It is left
          // alone; this run uses a key of its own and the next reads again.
          mayOverwrite = false;
          logger.warn(
            '[DeviceKey] Failed to read',
            DEVICE_KEY_FILE_NAME,
            errorCode(error)
          );
        }
      }

      if (
        typeof stored === 'object' &&
        stored !== null &&
        'key' in stored &&
        isValid(stored.key)
      ) {
        key = stored.key;
        return;
      }

      const made = generate();
      // Good for this run even if it cannot be stored: the links then change
      // with the next start, which the warning below is there to explain.
      key = made;
      if (!mayOverwrite) return;
      try {
        await write(made);
      } catch (error) {
        logger.warn(
          '[DeviceKey] Failed to write',
          DEVICE_KEY_FILE_NAME,
          errorCode(error)
        );
      }
    })());

  return {
    /**
     * Reads the stored key, or makes and stores one where there is none.
     * Never rejects. Awaited once, before the server answers another device.
     */
    open,
    /** The key now; null until `open` has finished. */
    current: (): string | null => key,
    /**
     * Makes a new key and stores it. The old key stays in force, and this
     * rejects, when the new one could not be written.
     */
    async replace(): Promise<string> {
      await open();
      const made = generate();
      await write(made);
      key = made;
      return made;
    },
  };
}

export type DeviceKeyStore = ReturnType<typeof createDeviceKeyStore>;
