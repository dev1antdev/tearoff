import { app } from 'electron';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import logger from '../../logger';
import type { LapLibraryCaller } from './dispatch';
import {
  createLapLibraryService,
  type LapLibraryService,
} from './lapLibraryService';
import { createWorkerClient, type WorkerClient } from './workerClient';

/**
 * The most laps the library keeps. A lap is a few kilobytes at a short
 * circuit and about thirty at the Nordschleife, so this is tens of megabytes
 * at the outside. The reference lap of each track and car is never dropped.
 */
const MAX_LAPS = 5000;

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
 * It does not throw. If the thread cannot be started the app runs on without
 * a library: laps are not recorded, the settings page lists nothing, and the
 * log says why.
 */
export const startLapLibrary = (): LapLibraryService => {
  if (service) return service;
  let caller: LapLibraryCaller;
  try {
    const file = path.join(app.getPath('userData'), 'laps.db');
    // Built as its own bundle beside main.js; see forge.config.mts.
    const worker = new Worker(path.join(__dirname, 'lapLibraryWorker.js'), {
      workerData: { file },
    });
    client = createWorkerClient(worker);
    caller = client;
  } catch (error) {
    logger.error('[LapLibrary] Could not start the lap library:', error);
    caller = unavailable(error);
  }
  service = createLapLibraryService(caller, {
    maxLaps: MAX_LAPS,
    logError: (message, error) => logger.error(message, error),
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
