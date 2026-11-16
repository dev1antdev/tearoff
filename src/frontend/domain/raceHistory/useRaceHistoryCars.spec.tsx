import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ChannelBridge,
  ChannelName,
  ChannelPayloads,
  RaceCarLaps,
  RaceHistoryBridge,
  RaceHistorySummarySnapshot,
  RaceStint,
} from '@irdashies/types';
import { lapOf, stintOf } from './recordFixture';
import {
  raceHistoryReadable,
  useCarRaceRecord,
  useRaceStints,
} from './useRaceHistoryCars';

/**
 * The reading rule every panel about a car's records shares, over a stub of
 * the summary channel and a stub of the race history's bridge whose answers
 * a test hands out when it chooses to.
 */

type Listener = (payload: unknown) => void;

const summaryOf = (
  revision: number[],
  raceToken = 'race:1'
): RaceHistorySummarySnapshot => ({
  raceToken,
  raceId: null,
  resumed: false,
  laps: [],
  lastLap: [],
  missingLaps: [],
  stintFirstLap: [],
  stintLaps: [],
  stintDriver: [],
  stintAvgLap: [],
  stintCleanLaps: [],
  previousStintAvgLap: [],
  previousStintDriver: [],
  previousDriverStintAvgLap: [],
  previousDriverStintDriver: [],
  driverChanges: [],
  stops: [],
  revision,
  sessionNum: 0,
  version: 1,
});

/** The summary channel: says what it holds, and what a test publishes. */
const channel = (first: RaceHistorySummarySnapshot | undefined) => {
  const listeners = new Set<Listener>();
  const bridge: ChannelBridge = {
    subscribe: <K extends ChannelName>(
      _name: K,
      callback: (payload: ChannelPayloads[K]) => void
    ) => {
      const listener = callback as Listener;
      listeners.add(listener);
      if (first !== undefined) listener(first);
      return () => listeners.delete(listener);
    },
  };
  window.channelBridge = bridge;
  return {
    publish: (summary: RaceHistorySummarySnapshot) =>
      act(() => listeners.forEach((listener) => listener(summary))),
    subscribers: () => listeners.size,
  };
};

interface Asked {
  carIdx: number;
  /** Answers the question with a number of laps for the car. */
  answer: (laps: number) => Promise<void>;
  fail: () => Promise<void>;
}

/**
 * A bridge whose every question about a car's laps waits to be answered.
 * The stints are answered at once, with one stint of the car.
 */
const history = () => {
  const asked: Asked[] = [];
  const bridge: RaceHistoryBridge = {
    getCarLaps: vi.fn(
      (carIdx: number) =>
        new Promise<RaceCarLaps>((resolve, reject) => {
          asked.push({
            carIdx,
            answer: (laps) =>
              act(async () => {
                resolve({
                  laps: Array.from({ length: laps }, (_, index) =>
                    lapOf(index + 1, { carIdx })
                  ),
                  missingLaps: [],
                  revision: 1,
                });
              }),
            fail: () =>
              act(async () => {
                reject(new Error('the file is busy'));
              }),
          });
        })
    ),
    getCarStints: vi.fn(async (carIdx: number): Promise<RaceStint[]> => [
      stintOf(1, { carIdx }),
    ]),
    getDriverChanges: vi.fn(async () => []),
    listRaces: vi.fn(async () => []),
    getEvents: vi.fn(async () => []),
  };
  window.raceHistoryBridge = bridge;
  return { bridge, asked };
};

afterEach(() => {
  window.raceHistoryBridge = undefined;
  vi.restoreAllMocks();
});

describe('useCarRaceRecord', () => {
  it('asks for the car’s laps and stints once, and hands them on', async () => {
    channel(summaryOf([1, 1, 1]));
    const { bridge, asked } = history();
    const { result } = renderHook(() => useCarRaceRecord(1));

    expect(result.current).toBeUndefined();
    expect(bridge.getCarLaps).toHaveBeenCalledTimes(1);
    expect(bridge.getCarLaps).toHaveBeenCalledWith(1);
    expect(bridge.getCarStints).toHaveBeenCalledWith(1);

    await asked[0].answer(3);
    expect(result.current?.laps).toHaveLength(3);
    expect(result.current?.stints).toHaveLength(1);
    expect(result.current?.missingLaps).toEqual([]);
  });

  it('asks again when the car’s revision moves, and for nothing else', async () => {
    const summary = channel(summaryOf([1, 1, 1]));
    const { bridge, asked } = history();
    const { result } = renderHook(() => useCarRaceRecord(1));
    await asked[0].answer(3);

    // The summary comes again unchanged, then with another car's records
    // changed: neither is a reason to ask.
    await summary.publish({ ...summaryOf([1, 1, 1]), version: 2 });
    await summary.publish({ ...summaryOf([5, 1, 9]), version: 3 });
    expect(bridge.getCarLaps).toHaveBeenCalledTimes(1);

    await summary.publish({ ...summaryOf([5, 2, 9]), version: 4 });
    expect(bridge.getCarLaps).toHaveBeenCalledTimes(2);
    // What was held stays on show until the new answer is in.
    expect(result.current?.laps).toHaveLength(3);
    await asked[1].answer(4);
    expect(result.current?.laps).toHaveLength(4);
  });

  it('never asks on a timer', async () => {
    vi.useFakeTimers();
    try {
      channel(summaryOf([1, 1]));
      const { bridge } = history();
      renderHook(() => useCarRaceRecord(0));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
      });
      expect(bridge.getCarLaps).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops an answer that comes back for a car no longer chosen', async () => {
    channel(summaryOf([1, 1, 1]));
    const { asked } = history();
    const { result, rerender } = renderHook(
      ({ carIdx }: { carIdx: number }) => useCarRaceRecord(carIdx),
      { initialProps: { carIdx: 0 } }
    );

    // Another car is chosen before the first has been answered for.
    rerender({ carIdx: 2 });
    expect(asked.map((question) => question.carIdx)).toEqual([0, 2]);

    await asked[0].answer(7);
    expect(result.current).toBeUndefined();

    await asked[1].answer(2);
    expect(result.current?.laps).toHaveLength(2);
    expect(result.current?.laps[0].carIdx).toBe(2);
  });

  it('lets go of a car’s record at once when another car is chosen', async () => {
    channel(summaryOf([1, 1, 1]));
    const { asked } = history();
    const { result, rerender } = renderHook(
      ({ carIdx }: { carIdx: number }) => useCarRaceRecord(carIdx),
      { initialProps: { carIdx: 0 } }
    );
    await asked[0].answer(7);
    expect(result.current?.laps).toHaveLength(7);

    rerender({ carIdx: 2 });
    // Not the laps of the car before under the name of this one.
    expect(result.current).toBeUndefined();

    // Back to the first car: what was held of it is gone, and is asked for.
    rerender({ carIdx: 0 });
    expect(result.current).toBeUndefined();
    expect(asked.map((question) => question.carIdx)).toEqual([0, 2, 0]);
  });

  it('keeps the newer of two answers for one car, whichever comes last', async () => {
    const summary = channel(summaryOf([1]));
    const { asked } = history();
    const { result } = renderHook(() => useCarRaceRecord(0));
    await summary.publish({ ...summaryOf([2]), version: 2 });
    expect(asked).toHaveLength(2);

    // The second question is answered first, then the first one late.
    await asked[1].answer(9);
    await asked[0].answer(8);
    expect(result.current?.laps).toHaveLength(9);
  });

  it('drops what it holds when another race begins, and asks again', async () => {
    const summary = channel(summaryOf([3]));
    const { bridge, asked } = history();
    const { result } = renderHook(() => useCarRaceRecord(0));
    await asked[0].answer(5);
    expect(result.current?.laps).toHaveLength(5);

    // Between two races nothing is recorded.
    await summary.publish(summaryOf([], ''));
    expect(result.current).toBeUndefined();
    expect(bridge.getCarLaps).toHaveBeenCalledTimes(1);

    // The next race, whose counter happens to stand where the last one's did.
    await summary.publish(summaryOf([3], 'race:2'));
    expect(bridge.getCarLaps).toHaveBeenCalledTimes(2);
    await asked[1].answer(1);
    expect(result.current?.laps).toHaveLength(1);
  });

  it('asks again at the next change after a question that failed', async () => {
    const summary = channel(summaryOf([1]));
    const { bridge, asked } = history();
    const { result } = renderHook(() => useCarRaceRecord(0));
    await asked[0].fail();
    expect(result.current).toBeUndefined();

    await summary.publish({ ...summaryOf([2]), version: 2 });
    expect(bridge.getCarLaps).toHaveBeenCalledTimes(2);
    await asked[1].answer(2);
    expect(result.current?.laps).toHaveLength(2);
  });

  it('asks nothing and reads no summary for no car', () => {
    const summary = channel(summaryOf([1]));
    const { bridge } = history();
    const { result } = renderHook(() => useCarRaceRecord(null));
    expect(result.current).toBeUndefined();
    expect(bridge.getCarLaps).not.toHaveBeenCalled();
    // Reading the summary is what has a race recorded.
    expect(summary.subscribers()).toBe(0);
  });

  it('has nothing where there is no bridge to ask', async () => {
    channel(summaryOf([1]));
    window.raceHistoryBridge = undefined;
    expect(raceHistoryReadable()).toBe(false);
    const { result } = renderHook(() => useCarRaceRecord(0));
    await waitFor(() => expect(result.current).toBeUndefined());
  });

  it('waits for the summary before it asks', async () => {
    const summary = channel(undefined);
    const { bridge } = history();
    expect(raceHistoryReadable()).toBe(true);
    renderHook(() => useCarRaceRecord(0));
    expect(bridge.getCarLaps).not.toHaveBeenCalled();
    await summary.publish(summaryOf([1]));
    expect(bridge.getCarLaps).toHaveBeenCalledTimes(1);
  });
});

describe('useRaceStints', () => {
  it('reads the stints of several cars by the same rule', async () => {
    const summary = channel(summaryOf([1, 1, 1]));
    const { bridge } = history();
    const cars = [0, 2];
    const { result } = renderHook(() => useRaceStints(cars));
    await waitFor(() => expect(result.current.size).toBe(2));
    expect(bridge.getCarStints).toHaveBeenCalledTimes(2);
    // The laps are not this reader's to ask for.
    expect(bridge.getCarLaps).not.toHaveBeenCalled();

    await summary.publish({ ...summaryOf([1, 1, 2]), version: 2 });
    await waitFor(() => expect(bridge.getCarStints).toHaveBeenCalledTimes(3));
    expect(bridge.getCarStints).toHaveBeenLastCalledWith(2);
  });
});
