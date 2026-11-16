import { app } from 'electron';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { RACE_HISTORY_MAX_RACES } from '@irdashies/types';
import logger from '../../logger';
import { isRecordedSource } from '../../tapeReplaySource';
import type { LapLibraryCaller } from './dispatch';
import {
  createLapLibraryService,
  LAP_LIBRARY_MAX_LAPS,
  type LapLibraryService,
} from './lapLibraryService';
import {
  createRaceHistoryStore,
  type RaceHistoryStore,
} from './raceHistoryStore';
import { createWorkerClient, type WorkerClient } from './workerClient';

let service: LapLibraryService | null = null;
let client: WorkerClient | null = null;
/** What both services ask the worker through; a refusal when it is down. */
let caller: LapLibraryCaller | null = null;
let raceHistory: RaceHistoryStore | null = null;

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
 * The history of races, kept in the lap library's file and written on its
 * worker thread. Starts the library if nothing has yet. Safe to call more
 * than once, and like the library it does not throw: with no file to write
 * to, a race is kept for as long as the app runs and no longer.
 *
 * A recording played back in place of a simulator is never written, whoever
 * asks: the store itself refuses, whatever its caller was told.
 */
export const startRaceHistoryStore = (): RaceHistoryStore => {
  if (raceHistory) return raceHistory;
  startLapLibrary();
  raceHistory = createRaceHistoryStore(
    caller ?? unavailable('The lap library is not running'),
    {
      maxRaces: RACE_HISTORY_MAX_RACES,
      canWrite: () => !isRecordedSource(),
      logError: (message, error) => logger.error(message, error),
      logInfo: (message) => logger.info(message),
    }
  );
  return raceHistory;
};

/**
 * Closes the database and ends its thread. Awaited by the shutdown
 * coordinator, so the last lap is on disk before the process exits.
 */
export const closeLapLibraryOnShutdown = async (): Promise<void> => {
  const closing = client;
  const races = raceHistory;
  client = null;
  service = null;
  caller = null;
  raceHistory = null;
  try {
    // The rows of a race still waiting go in before the file is closed.
    await races?.flush();
  } finally {
    // Whatever became of them, the file is closed: the player's own last
    // lap is in it.
    await closing?.close();
  }
};
