import { parentPort, workerData } from 'node:worker_threads';
import { LapLibraryDatabase } from './LapLibraryDatabase';
import { dispatch } from './dispatch';
import type { WorkerReply, WorkerRequest } from './workerClient';

/**
 * The thread the lap library's database lives on.
 *
 * SQLite's built-in binding is synchronous. Called from the main process it
 * would hold up the telemetry loop for as long as the disk took, and an
 * antivirus scan or a sleeping drive can make that a visible hitch in every
 * overlay. Here a slow disk only makes a lap land in the library a little
 * later.
 */
const port = parentPort;
if (!port) throw new Error('The lap library worker must run as a worker');

let db: LapLibraryDatabase | null = null;
let openError = 'The lap library is closed';
try {
  db = new LapLibraryDatabase((workerData as { file: string }).file);
} catch (error) {
  // Stay alive and answer every request with the reason, rather than die and
  // leave the main process to guess.
  openError = error instanceof Error ? error.message : String(error);
}

port.on('message', (request: WorkerRequest) => {
  let reply: WorkerReply;
  try {
    if (request.method === 'close') {
      db?.close();
      db = null;
      reply = { id: request.id, result: true };
    } else {
      if (!db) throw new Error(openError);
      reply = {
        id: request.id,
        result: dispatch(db, request.method, request.args),
      };
    }
  } catch (error) {
    reply = {
      id: request.id,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  port.postMessage(reply);
});
