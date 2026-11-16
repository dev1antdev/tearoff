import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { RaceWriteBatch } from '@irdashies/types';
import { dispatch } from '../storage/lapLibrary/dispatch';
import { LapLibraryDatabase } from '../storage/lapLibrary/LapLibraryDatabase';
import {
  createRaceHistoryStore,
  type RaceHistoryStore,
} from '../storage/lapLibrary/raceHistoryStore';
import {
  createWorkerClient,
  type WorkerLike,
  type WorkerReply,
  type WorkerRequest,
} from '../storage/lapLibrary/workerClient';

/**
 * The race history's real storage, for the specs that run a race into it:
 * the store, the lap library's client and dispatcher, and a real database
 * in a file of its own under the system's temporary folder. Everything but
 * the worker thread, which a stand-in answers for on the next turn of the
 * event loop, with what crossed to it copied as a thread would copy it.
 *
 * Never the player's own library: the file is made for the spec, and
 * `close` removes it.
 */
export interface RaceHistoryFile {
  db: LapLibraryDatabase;
  /** Every request that crossed to the worker, in order. */
  requests: WorkerRequest[];
  /** Everything the stores logged as an error. */
  errors: string[];
  /**
   * A store on the file, as one run of the app has. `canWrite` is the
   * guard the app builds its own with; left out, the store always writes.
   */
  openStore(canWrite?: () => boolean): RaceHistoryStore;
  /** The batches written so far. */
  writes(): RaceWriteBatch[];
  /** How many times the worker was asked for a method. */
  asked(method: string): number;
  /** Closes the database and removes the folder it was made in. */
  close(): void;
}

export const openRaceHistoryFile = (): RaceHistoryFile => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'tearoff-races-'));
  const db = new LapLibraryDatabase(path.join(folder, 'laps.db'));
  const requests: WorkerRequest[] = [];
  const errors: string[] = [];

  const fakeWorker = (): WorkerLike => {
    const listeners: ((reply: WorkerReply) => void)[] = [];
    const worker: WorkerLike = {
      postMessage(request: WorkerRequest) {
        // Cloned at the moment of sending, as a thread boundary would.
        const args = structuredClone(request.args);
        requests.push({ ...request, args });
        setTimeout(() => {
          let reply: WorkerReply;
          try {
            reply = {
              id: request.id,
              result: structuredClone(dispatch(db, request.method, args)),
            };
          } catch (error) {
            reply = { id: request.id, error: (error as Error).message };
          }
          for (const listener of listeners) listener(reply);
        }, 0);
      },
      on(event: 'message' | 'error' | 'exit', listener: never) {
        if (event === 'message') listeners.push(listener);
        return worker;
      },
      terminate: () => Promise.resolve(0),
    };
    return worker;
  };

  return {
    db,
    requests,
    errors,
    openStore: (canWrite) =>
      createRaceHistoryStore(createWorkerClient(fakeWorker()), {
        maxRaces: 20,
        // Long enough that only a flush asked for writes.
        writeIntervalMs: 600_000,
        canWrite,
        logError: (message, error) =>
          errors.push(`${message} ${String(error)}`),
      }),
    writes: () =>
      requests
        .filter((request) => request.method === 'raceWrite')
        .map((request) => request.args[0] as RaceWriteBatch),
    asked: (method) =>
      requests.filter((request) => request.method === method).length,
    close: () => {
      db.close();
      // The exact mkdtemp result, never a real application folder.
      fs.rmSync(folder, { recursive: true, force: true });
    },
  };
};

/** Lets every answer from the stand-in worker arrive and be acted on. */
export const idle = async (): Promise<void> => {
  for (let turn = 0; turn < 8; turn += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};
