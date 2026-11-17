import { describe, expect, it, vi } from 'vitest';
import type { RaceHistoryBridge } from '@irdashies/types';

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }));

import { createRaceHistoryBridge } from '../bridge/raceHistoryBridge';
import {
  RACE_HISTORY_BUSY,
  RACE_HISTORY_FAILED,
  RACE_HISTORY_MAX_WAITING,
  RACE_HISTORY_NO_ARGS,
  RACE_HISTORY_NO_ID,
  RACE_HISTORY_UNAVAILABLE,
  createRaceHistoryReads,
  type RaceHistoryAnswer,
} from './raceHistoryReads';

// The queue on its own, with a socket that is a list of what was sent and a
// source whose answers are let out by hand. The same queue behind a real
// socket is in bridgeProxy.raceHistory.spec.ts.

/** A promise settled from outside. */
const gate = <T>() => {
  let open!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    open = resolve;
  });
  return { promise, open };
};

/**
 * Lets every promise that can settle now do so: an immediate runs once the
 * chain of them has run dry, however long it is.
 */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

const stage = (options: { limit?: number; withBridge?: boolean } = {}) => {
  const laps = vi.fn<RaceHistoryBridge['getCarLaps']>(async (carIdx) => ({
    laps: [],
    missingLaps: [],
    revision: carIdx,
  }));
  const source = {
    getCarLaps: laps,
    getCarStints: vi.fn(async () => []),
    getDriverChanges: vi.fn(async () => []),
    listRaces: vi.fn(async () => []),
    getEvents: vi.fn(async () => []),
  } satisfies RaceHistoryBridge;
  const sent: RaceHistoryAnswer[] = [];
  /** Held shut, an answer is on its way and not yet written out. */
  let written: Promise<void> = Promise.resolve();
  const socket = { open: true };
  const onFailure = vi.fn();
  const reads = createRaceHistoryReads({
    bridge:
      options.withBridge === false
        ? undefined
        : createRaceHistoryBridge(source),
    isOpen: () => socket.open,
    send: (answer) => {
      sent.push(answer);
      return written;
    },
    onFailure,
    limit: options.limit,
  });
  return {
    reads,
    source,
    sent,
    socket,
    onFailure,
    /** Returns what lets the held answer, and those after it, be written. */
    holdWrites: (): (() => void) => {
      const held = gate<undefined>();
      written = held.promise;
      return () => held.open(undefined);
    },
    ask: (carIdx: unknown, requestId: unknown = `r${carIdx}`) =>
      reads.ask('getCarLaps', {
        type: 'raceHistory:getCarLaps',
        requestId,
        data: [carIdx],
      }),
  };
};

describe('reads of the race history for one socket', () => {
  it('answers each read from the bridge, under the id it was asked with', async () => {
    const { reads, source, sent } = stage();

    reads.ask('getCarLaps', {
      type: 'raceHistory:getCarLaps',
      requestId: 'a',
      data: [7, 12],
    });
    reads.ask('getCarStints', {
      type: 'raceHistory:getCarStints',
      requestId: 'b',
      data: [7, null],
    });
    reads.ask('getDriverChanges', {
      type: 'raceHistory:getDriverChanges',
      requestId: 'c',
      data: [],
    });
    reads.ask('listRaces', {
      type: 'raceHistory:listRaces',
      requestId: 'd',
      data: [],
    });
    reads.ask('getEvents', {
      type: 'raceHistory:getEvents',
      requestId: 'e',
      data: [null, 801],
    });
    await settle();

    expect(sent).toEqual([
      {
        type: 'raceHistory:getCarLaps',
        requestId: 'a',
        data: { laps: [], missingLaps: [], revision: 7 },
      },
      { type: 'raceHistory:getCarStints', requestId: 'b', data: [] },
      { type: 'raceHistory:getDriverChanges', requestId: 'c', data: [] },
      { type: 'raceHistory:listRaces', requestId: 'd', data: [] },
      { type: 'raceHistory:getEvents', requestId: 'e', data: [] },
    ]);
    expect(source.getCarLaps).toHaveBeenCalledExactlyOnceWith(7, 12);
    expect(source.getCarStints).toHaveBeenCalledExactlyOnceWith(7, undefined);
    expect(source.getDriverChanges).toHaveBeenCalledExactlyOnceWith(undefined);
    expect(source.listRaces).toHaveBeenCalledExactlyOnceWith();
    expect(source.getEvents).toHaveBeenCalledExactlyOnceWith(undefined, 801);
    expect(reads.held()).toBe(0);
  });

  it('asks the source for one read at a time, in the order they came', async () => {
    const { reads, source, sent, ask } = stage();
    const first = gate<Awaited<ReturnType<RaceHistoryBridge['getCarLaps']>>>();
    source.getCarLaps.mockImplementationOnce(() => first.promise);

    ask(1);
    ask(2);
    ask(3);
    await settle();

    // The second is not asked for while the first is unanswered.
    expect(source.getCarLaps.mock.calls).toEqual([[1, undefined]]);
    expect(reads.held()).toBe(3);

    first.open({ laps: [], missingLaps: [], revision: 1 });
    await settle();

    expect(source.getCarLaps.mock.calls.map(([carIdx]) => carIdx)).toEqual([
      1, 2, 3,
    ]);
    expect(sent.map((answer) => answer.requestId)).toEqual(['r1', 'r2', 'r3']);
  });

  it('does not read on for a socket that has not taken its last answer', async () => {
    const { source, sent, ask, holdWrites } = stage();
    const letWritesThrough = holdWrites();

    ask(1);
    ask(2);
    await settle();

    // The first answer is handed to the socket and not written out yet.
    expect(sent).toHaveLength(1);
    expect(source.getCarLaps).toHaveBeenCalledTimes(1);

    letWritesThrough();
    await settle();

    expect(source.getCarLaps).toHaveBeenCalledTimes(2);
    expect(sent).toHaveLength(2);
  });

  it(`holds ${RACE_HISTORY_MAX_WAITING} reads for a socket and refuses the next`, async () => {
    const { reads, source, sent, ask } = stage();
    const first = gate<Awaited<ReturnType<RaceHistoryBridge['getCarLaps']>>>();
    source.getCarLaps.mockImplementationOnce(() => first.promise);

    for (let n = 0; n < RACE_HISTORY_MAX_WAITING; n++) ask(n % 100, `in${n}`);
    expect(reads.held()).toBe(RACE_HISTORY_MAX_WAITING);
    ask(1, 'over-1');
    ask(2, 'over-2');
    await settle();

    // Refused at once, out of turn, and the source never asked for them.
    expect(sent).toEqual([
      {
        type: 'raceHistory:getCarLaps',
        requestId: 'over-1',
        error: RACE_HISTORY_BUSY,
      },
      {
        type: 'raceHistory:getCarLaps',
        requestId: 'over-2',
        error: RACE_HISTORY_BUSY,
      },
    ]);
    expect(source.getCarLaps).toHaveBeenCalledTimes(1);
    expect(reads.held()).toBe(RACE_HISTORY_MAX_WAITING);

    first.open({ laps: [], missingLaps: [], revision: 0 });
    await settle();

    // Everything that was taken is answered, and there is room again.
    expect(sent).toHaveLength(RACE_HISTORY_MAX_WAITING + 2);
    expect(source.getCarLaps).toHaveBeenCalledTimes(RACE_HISTORY_MAX_WAITING);
    expect(reads.held()).toBe(0);
    ask(5, 'after');
    await settle();
    expect(sent.at(-1)).toMatchObject({ requestId: 'after', data: {} });
  });

  it('takes the cap it is given', async () => {
    const { source, sent, ask } = stage({ limit: 2 });
    const first = gate<Awaited<ReturnType<RaceHistoryBridge['getCarLaps']>>>();
    source.getCarLaps.mockImplementationOnce(() => first.promise);

    ask(1);
    ask(2);
    ask(3);
    await settle();

    expect(sent).toEqual([
      {
        type: 'raceHistory:getCarLaps',
        requestId: 'r3',
        error: RACE_HISTORY_BUSY,
      },
    ]);
  });

  it('answers a request the bridge refuses in the bridge’s words, in its turn', async () => {
    const { reads, source, sent, onFailure } = stage();

    reads.ask('getCarLaps', {
      type: 'raceHistory:getCarLaps',
      requestId: 'a',
      data: [128],
    });
    reads.ask('getCarStints', {
      type: 'raceHistory:getCarStints',
      requestId: 'b',
      data: [1, -4],
    });
    reads.ask('getEvents', {
      type: 'raceHistory:getEvents',
      requestId: 'c',
      data: [null, '200'],
    });
    reads.ask('listRaces', {
      type: 'raceHistory:listRaces',
      requestId: 'd',
      data: [null],
    });
    await settle();

    expect(sent).toEqual([
      {
        type: 'raceHistory:getCarLaps',
        requestId: 'a',
        error: 'Invalid car for raceHistory:getCarLaps',
      },
      {
        type: 'raceHistory:getCarStints',
        requestId: 'b',
        error: 'Invalid race for raceHistory:getCarStints',
      },
      {
        type: 'raceHistory:getEvents',
        requestId: 'c',
        error: 'Invalid event for raceHistory:getEvents',
      },
      {
        type: 'raceHistory:listRaces',
        requestId: 'd',
        error: 'raceHistory:listRaces takes at most 0 argument(s)',
      },
    ]);
    for (const method of Object.values(source)) {
      expect(method).not.toHaveBeenCalled();
    }
    // A refusal is the asker's mistake, not something to log.
    expect(onFailure).not.toHaveBeenCalled();
  });

  it('never spreads a long list of arguments, and the bridge still refuses it', async () => {
    const { reads, source, sent } = stage();

    reads.ask('getCarLaps', {
      type: 'raceHistory:getCarLaps',
      requestId: 'a',
      data: Array.from({ length: 500_000 }, () => 1),
    });
    reads.ask('getCarLaps', {
      type: 'raceHistory:getCarLaps',
      requestId: 'b',
      data: [1, 2, 3],
    });
    await settle();

    expect(sent.map((answer) => 'error' in answer && answer.error)).toEqual([
      'raceHistory:getCarLaps takes at most 2 argument(s)',
      'raceHistory:getCarLaps takes at most 2 argument(s)',
    ]);
    expect(source.getCarLaps).not.toHaveBeenCalled();
  });

  it('keeps a failure’s own words in the log and out of the answer', async () => {
    const { source, sent, ask, onFailure } = stage();
    const failure = new Error(
      'SQLITE_CANTOPEN: C:\\Users\\somebody\\AppData\\Roaming\\tearoff\\laps.db'
    );
    source.getCarLaps.mockRejectedValueOnce(failure);

    ask(1);
    ask(2);
    await settle();

    expect(sent[0]).toEqual({
      type: 'raceHistory:getCarLaps',
      requestId: 'r1',
      error: RACE_HISTORY_FAILED,
    });
    expect(JSON.stringify(sent)).not.toContain('somebody');
    expect(onFailure).toHaveBeenCalledExactlyOnceWith(
      'raceHistory:getCarLaps',
      failure
    );
    // The read behind it is answered all the same.
    expect(sent[1]).toMatchObject({ requestId: 'r2', data: { revision: 2 } });
  });

  it('refuses at the door what is not a request, and asks the bridge nothing', async () => {
    const { reads, source, sent } = stage();
    const type = 'raceHistory:getCarLaps';

    for (const requestId of [undefined, null, '', 7, {}, ['a'], 'x'.repeat(65)])
      reads.ask('getCarLaps', { type, requestId, data: [1] });
    for (const data of [undefined, null, 1, '1', { 0: 1, length: 1 }, true])
      reads.ask('getCarLaps', { type, requestId: 'a', data });
    await settle();

    expect(sent).toEqual([
      ...Array.from({ length: 7 }, () => ({
        type,
        requestId: null,
        error: RACE_HISTORY_NO_ID,
      })),
      ...Array.from({ length: 6 }, () => ({
        type,
        requestId: 'a',
        error: RACE_HISTORY_NO_ARGS,
      })),
    ]);
    expect(source.getCarLaps).not.toHaveBeenCalled();
    expect(reads.held()).toBe(0);
  });

  it('says so where the server was given no race history', async () => {
    const { reads, sent } = stage({ withBridge: false });

    reads.ask('listRaces', {
      type: 'raceHistory:listRaces',
      requestId: 'a',
      data: [],
    });
    await settle();

    expect(sent).toEqual([
      {
        type: 'raceHistory:listRaces',
        requestId: 'a',
        error: RACE_HISTORY_UNAVAILABLE,
      },
    ]);
  });

  it('lets go of what waits when the socket closes, and sends nothing after', async () => {
    const { reads, source, sent, ask } = stage();
    const first = gate<Awaited<ReturnType<RaceHistoryBridge['getCarLaps']>>>();
    source.getCarLaps.mockImplementationOnce(() => first.promise);

    ask(1);
    ask(2);
    ask(3);
    await settle();
    reads.close();
    expect(reads.held()).toBe(1);

    // The read that was under way comes back to a socket that has gone.
    first.open({ laps: [], missingLaps: [], revision: 1 });
    await settle();
    ask(4);
    await settle();

    expect(sent).toEqual([]);
    expect(source.getCarLaps).toHaveBeenCalledTimes(1);
    expect(reads.held()).toBe(0);
  });

  it('reads no further for a socket that is being closed, before it has closed', async () => {
    // Between the server's close and the page's goodbye: a device whose key
    // was replaced.
    const { reads, source, sent, socket, ask } = stage();
    const first = gate<Awaited<ReturnType<RaceHistoryBridge['getCarLaps']>>>();
    source.getCarLaps.mockImplementationOnce(() => first.promise);

    ask(1);
    ask(2);
    await settle();
    socket.open = false;
    first.open({ laps: [], missingLaps: [], revision: 1 });
    await settle();
    ask(3);
    await settle();

    expect(sent).toEqual([]);
    expect(source.getCarLaps).toHaveBeenCalledTimes(1);
    expect(reads.held()).toBe(0);
  });

  it('goes on to the next read when an answer could not be sent', async () => {
    const { reads, source, onFailure } = stage();
    const delivered: string[] = [];
    const failing = createRaceHistoryReads({
      bridge: createRaceHistoryBridge(source),
      isOpen: () => true,
      send: async (answer) => {
        if (answer.requestId === 'a') throw new Error('socket went away');
        delivered.push(String(answer.requestId));
      },
      onFailure,
    });

    failing.ask('listRaces', {
      type: 'raceHistory:listRaces',
      requestId: 'a',
      data: [],
    });
    failing.ask('listRaces', {
      type: 'raceHistory:listRaces',
      requestId: 'b',
      data: [],
    });
    await settle();

    expect(delivered).toEqual(['b']);
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(reads.held()).toBe(0);
  });
});
