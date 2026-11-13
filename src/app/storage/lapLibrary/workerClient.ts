import type {
  LapLibraryCaller,
  LapLibraryMethod,
  LapLibraryMethods,
} from './dispatch';

export interface WorkerRequest {
  id: number;
  /** A LapLibraryMethod, or 'close'. */
  method: string;
  args: readonly unknown[];
}

export interface WorkerReply {
  id: number;
  result?: unknown;
  error?: string;
}

/** As much of a worker thread as the client uses, so a spec can stand in. */
export interface WorkerLike {
  postMessage(message: WorkerRequest): void;
  on(event: 'message', listener: (reply: WorkerReply) => void): unknown;
  on(event: 'error', listener: (error: unknown) => void): unknown;
  on(event: 'exit', listener: (code: number) => void): unknown;
  terminate(): Promise<unknown>;
}

export interface WorkerClient extends LapLibraryCaller {
  /** Closes the database and ends the thread. Calls after it are refused. */
  close(): Promise<void>;
}

/** How long a close waits for the thread to answer before ending it anyway. */
const CLOSE_TIMEOUT_MS = 2000;

/**
 * The main-process end of the lap library's worker thread: sends a request,
 * hands back a promise for its reply.
 *
 * A thread that dies takes its pending requests with it: every one is
 * refused with the reason, and so is anything asked afterwards. Nothing here
 * throws into the caller synchronously.
 */
export const createWorkerClient = (worker: WorkerLike): WorkerClient => {
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (reason: Error) => void }
  >();
  let nextId = 1;
  let dead: Error | null = null;

  const fail = (reason: Error) => {
    dead ??= reason;
    for (const request of pending.values()) request.reject(reason);
    pending.clear();
  };

  worker.on('message', (reply) => {
    const request = pending.get(reply.id);
    if (!request) return;
    pending.delete(reply.id);
    if (reply.error !== undefined) request.reject(new Error(reply.error));
    else request.resolve(reply.result);
  });
  worker.on('error', (error) => {
    fail(error instanceof Error ? error : new Error(String(error)));
  });
  worker.on('exit', (code) => {
    fail(new Error(`The lap library worker exited (code ${code})`));
  });

  const send = (method: string, args: readonly unknown[]): Promise<unknown> =>
    new Promise((resolve, reject) => {
      if (dead) {
        reject(dead);
        return;
      }
      const id = nextId;
      nextId += 1;
      pending.set(id, { resolve, reject });
      try {
        worker.postMessage({ id, method, args });
      } catch (error) {
        pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });

  return {
    call: <M extends LapLibraryMethod>(
      method: M,
      ...args: Parameters<LapLibraryMethods[M]>
    ) => send(method, args) as Promise<ReturnType<LapLibraryMethods[M]>>,

    async close() {
      if (!dead) {
        let timer: NodeJS.Timeout | undefined;
        await Promise.race([
          send('close', []).catch(() => undefined),
          new Promise((resolve) => {
            timer = setTimeout(resolve, CLOSE_TIMEOUT_MS);
          }),
        ]);
        if (timer) clearTimeout(timer);
      }
      fail(new Error('The lap library is closed'));
      await worker.terminate().catch(() => undefined);
    },
  };
};
