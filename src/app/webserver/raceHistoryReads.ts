import type { RaceHistoryBridge } from '@irdashies/types';
import { RaceHistoryRequestError } from '../bridge/raceHistoryBridge';

/**
 * The race history, read over one browser page's socket.
 *
 * The bridge handed in is the one the app's own windows are answered from
 * over IPC, and every argument is checked there and nowhere else: what a
 * socket sends is handed on as it came. Nothing here writes. The bridge has
 * no call that changes a record, and the reads a socket may ask for are the
 * five named in `bridgeProxy.ts`.
 *
 * Who may ask is not decided here either. A socket exists only for a
 * visitor the handshake let in, by the Host and Origin rules and then the
 * key (rules R12.5 and R12.7).
 */

/** A read the bridge has, by the name of its method. */
export type RaceHistoryRead = keyof RaceHistoryBridge;

/**
 * The most reads one socket has in hand at a time, the one being answered
 * included. A page asks for a car's records once and again when they
 * change: every panel that reads the history, on one page, is about twenty
 * requests at once. One past this many is refused, so a socket that asks
 * faster than it is answered is told so instead of being queued for.
 */
export const RACE_HISTORY_MAX_WAITING = 64;

/**
 * No read takes more than two arguments. A longer list is handed on cut to
 * this many, which is still more than any read takes: the bridge refuses it
 * in its own words, and a list of a million entries is never spread.
 */
const MAX_ARGS_HANDED_ON = 4;

/** As long as a request id is echoed back. A page's own are a dozen. */
const MAX_REQUEST_ID_LENGTH = 64;

export const RACE_HISTORY_UNAVAILABLE = 'The race history is unavailable';
export const RACE_HISTORY_BUSY = 'Too many race history requests are waiting';
export const RACE_HISTORY_FAILED = 'The race history could not be read';
export const RACE_HISTORY_NO_ID = 'A race history request needs a request id';
export const RACE_HISTORY_NO_ARGS =
  'A race history request carries its arguments as a list';

/** What a socket sent, as far as a read is concerned. */
export interface RaceHistoryMessage {
  type: string;
  requestId?: unknown;
  /** The arguments, in the order the bridge takes them. */
  data?: unknown;
}

/** What goes back: the answer, or why there is none. Never both. */
export type RaceHistoryAnswer =
  | { type: string; requestId: string; data: unknown }
  | { type: string; requestId: string | null; error: string };

export interface RaceHistoryReadsOptions {
  /** The one checked bridge; absent where the server was given none. */
  bridge: RaceHistoryBridge | undefined;
  /**
   * Whether the socket still is one to answer. One that is being closed,
   * as a device's is when its key was replaced, is read for no further.
   */
  isOpen: () => boolean;
  /**
   * Sends one answer to the socket. Resolves once it has been written out:
   * the next read is not started before, so a page that does not take its
   * answers is not read for either.
   */
  send: (answer: RaceHistoryAnswer) => Promise<void>;
  /** Told of a read that failed for a reason of the app's own. */
  onFailure: (type: string, error: unknown) => void;
  limit?: number;
}

const isRequestId = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= MAX_REQUEST_ID_LENGTH;

/**
 * Answers one socket's reads one at a time, in the order they came.
 *
 * A request refused at the door (no id, no list of arguments, too many
 * waiting) is answered at once and the bridge is never asked. One that is
 * taken waits its turn; what the bridge makes of its arguments is found
 * out then.
 */
export function createRaceHistoryReads({
  bridge,
  isOpen,
  send,
  onFailure,
  limit = RACE_HISTORY_MAX_WAITING,
}: RaceHistoryReadsOptions) {
  const waiting: (() => Promise<void>)[] = [];
  let answering = false;
  let closed = false;

  /** Whether there is still somebody to answer. */
  const live = (): boolean => {
    if (!closed && !isOpen()) {
      closed = true;
      waiting.length = 0;
    }
    return !closed;
  };

  /** Never rejects, and sends nothing to a socket that has gone. */
  const deliver = async (answer: RaceHistoryAnswer): Promise<void> => {
    if (!live()) return;
    try {
      await send(answer);
    } catch (error) {
      onFailure(answer.type, error);
    }
  };

  const next = (): void => {
    const task = live() ? waiting.shift() : undefined;
    if (!task) {
      answering = false;
      return;
    }
    answering = true;
    void task().finally(next);
  };

  // Handed on untyped: the bridge's own checks are what types them.
  const untyped = bridge as unknown as
    Record<string, (...args: unknown[]) => Promise<unknown>> | undefined;

  return {
    /**
     * Takes one request for `read`. `message` is what the socket sent,
     * parsed and otherwise untouched.
     */
    ask(read: RaceHistoryRead, message: RaceHistoryMessage): void {
      if (!live()) return;
      const { type } = message;
      if (!isRequestId(message.requestId)) {
        void deliver({ type, requestId: null, error: RACE_HISTORY_NO_ID });
        return;
      }
      const requestId = message.requestId;
      const refuse = (error: string) =>
        void deliver({ type, requestId, error });

      if (!untyped) return refuse(RACE_HISTORY_UNAVAILABLE);
      if (!Array.isArray(message.data)) return refuse(RACE_HISTORY_NO_ARGS);
      if (waiting.length + (answering ? 1 : 0) >= limit) {
        return refuse(RACE_HISTORY_BUSY);
      }

      const args: unknown[] = message.data.slice(0, MAX_ARGS_HANDED_ON);
      waiting.push(async () => {
        let answer: RaceHistoryAnswer;
        try {
          const data = await untyped[read](...args);
          answer = { type, requestId, data: data ?? null };
        } catch (error) {
          // A refusal is the bridge's own sentence about the request. A
          // failure may name a file of this PC: it stays in the log here.
          const refused = error instanceof RaceHistoryRequestError;
          if (!refused) onFailure(type, error);
          answer = {
            type,
            requestId,
            error: refused ? error.message : RACE_HISTORY_FAILED,
          };
        }
        await deliver(answer);
      });
      if (!answering) next();
    },

    /** The socket closed: what waits is let go of, and nothing is sent. */
    close(): void {
      closed = true;
      waiting.length = 0;
    },

    /** Reads in hand: the one being answered and those behind it. */
    held: (): number => waiting.length + (answering ? 1 : 0),
  };
}

export type RaceHistoryReads = ReturnType<typeof createRaceHistoryReads>;
