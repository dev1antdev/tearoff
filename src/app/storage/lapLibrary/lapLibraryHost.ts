import {
  LapLibraryDatabase,
  type LapLibraryDatabaseOptions,
} from './LapLibraryDatabase';
import { dispatch, type LapLibraryOpenReport } from './dispatch';
import { LapLibraryOpenError } from './upgrade';
import type { WorkerReply, WorkerRequest } from './workerClient';

/**
 * What the worker thread does with the lap library, apart from being a
 * thread: opens the database, and answers one request at a time.
 *
 * A file that cannot be opened -- from a newer build, not upgradable, not a
 * database -- does not end it. It stays up and refuses every request with
 * the reason, rather than leave the main process to guess, and it answers
 * `status` with what happened so the app can say so.
 */
export interface LapLibraryHost {
  handle(request: WorkerRequest): WorkerReply;
}

const failureReport = (error: unknown): LapLibraryOpenReport => ({
  available: false,
  reason: error instanceof LapLibraryOpenError ? error.reason : 'unreadable',
  message: error instanceof Error ? error.message : String(error),
  schemaVersion: null,
  upgradedFrom: null,
  backupName: null,
});

export const createLapLibraryHost = (
  file: string,
  options?: LapLibraryDatabaseOptions
): LapLibraryHost => {
  let db: LapLibraryDatabase | null = null;
  let failure: LapLibraryOpenReport | null = null;
  try {
    db = new LapLibraryDatabase(file, options);
  } catch (error) {
    failure = failureReport(error);
  }

  return {
    handle(request) {
      try {
        if (request.method === 'close') {
          db?.close();
          db = null;
          return { id: request.id, result: true };
        }
        if (!db) {
          if (failure && request.method === 'status') {
            return { id: request.id, result: failure };
          }
          throw new Error(failure?.message ?? 'The lap library is closed');
        }
        return {
          id: request.id,
          result: dispatch(db, request.method, request.args),
        };
      } catch (error) {
        return {
          id: request.id,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
};
