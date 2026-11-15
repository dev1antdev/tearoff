import { app } from 'electron';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import logger from '../../logger';
import type { LapLibraryCaller } from './dispatch';
import {
  createLapLibraryService,
  LAP_LIBRARY_MAX_LAPS,
  type LapLibraryService,
} from './lapLibraryService';
import { createWorkerClient, type WorkerClient } from './workerClient';

let service: LapLibraryService | null = null;
let client: WorkerClient | null = null;

/** Stands in when the worker cannot be started: every call is refused. */
const unavailable = (reason: unknown): LapLibraryCaller => ({
  call: () =>
    Promise.reject(
      reason instanceof Error ? reason : new Error(String(reason))
    ),
});

/**
 * Starts the lap library: the database on its worker thread, and the service
 * in front of it. Safe to call more than once.
 *
 * It does not throw. If the thread cannot be started, or the file cannot be
 * opened -- it is from a newer build, or could not be upgraded or read --
 * the app runs on without a library: laps are not recorded, the settings
 * page says why instead of listing anything, and so does the log. The file
 * is left as it was found.
 */
export const startLapLibrary = (): LapLibraryService => {
  if (service) return service;
  let caller: LapLibraryCaller;
  try {
    const file = path.join(app.getPath('userData'), 'laps.db');
    // Built as its own bundle beside the main one; see forge.config.mts. The
    // main-process build emits CommonJS files as .cjs. Inside a packaged
    // app this path is in app.asar, which a worker thread can be started
    // from: checked against a packaged build under Electron 45.
    const worker = new Worker(path.join(__dirname, 'lapLibraryWorker.cjs'), {
      workerData: { file },
    });
    client = createWorkerClient(worker);
    caller = client;
  } catch (error) {
    logger.error('[LapLibrary] Could not start the lap library:', error);
    caller = unavailable(error);
  }
  service = createLapLibraryService(caller, {
    maxLaps: LAP_LIBRARY_MAX_LAPS,
    logError: (message, error) => logger.error(message, error),
    logInfo: (message) => logger.info(message),
  });
  return service;
};

/** The running library, or null before `startLapLibrary`. */
export const getLapLibrary = (): LapLibraryService | null => service;

/**
 * Closes the database and ends its thread. Awaited by the shutdown
 * coordinator, so the last lap is on disk before the process exits.
 */
export const closeLapLibraryOnShutdown = async (): Promise<void> => {
  const closing = client;
  client = null;
  service = null;
  await closing?.close();
};
