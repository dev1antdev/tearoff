import { parentPort, workerData } from 'node:worker_threads';
import { createLapLibraryHost } from './lapLibraryHost';
import type { WorkerRequest } from './workerClient';

/**
 * The thread the lap library's database lives on.
 *
 * SQLite's built-in binding is synchronous. Called from the main process it
 * would hold up the telemetry loop for as long as the disk took, and an
 * antivirus scan or a sleeping drive can make that a visible hitch in every
 * overlay. Here a slow disk only makes a lap land in the library a little
 * later. The same goes for bringing an older file up to this build's schema,
 * which copies the whole file first: it happens here, as the thread starts.
 */
const port = parentPort;
if (!port) throw new Error('The lap library worker must run as a worker');

const host = createLapLibraryHost((workerData as { file: string }).file);

port.on('message', (request: WorkerRequest) => {
  port.postMessage(host.handle(request));
});
