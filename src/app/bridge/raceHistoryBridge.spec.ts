import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RACE_HISTORY_MAX_CARS } from '@irdashies/types';

const mock = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  return {
    handlers,
    handle: vi.fn(
      (channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler);
      }
    ),
    removeHandler: vi.fn((channel: string) => {
      handlers.delete(channel);
    }),
  };
});
vi.mock('electron', () => ({
  ipcMain: { handle: mock.handle, removeHandler: mock.removeHandler },
}));

import {
  RaceHistoryRequestError,
  createRaceHistoryBridge,
  setupRaceHistoryBridge,
  type RaceHistorySource,
} from './raceHistoryBridge';

const source = () =>
  ({
    getCarLaps: vi.fn(async () => ({ laps: [], missingLaps: [], revision: 3 })),
    getCarStints: vi.fn(async () => []),
    getDriverChanges: vi.fn(async () => []),
    listRaces: vi.fn(async () => []),
    getEvents: vi.fn(async () => []),
  }) satisfies RaceHistorySource;

const invoke = (channel: string, ...args: unknown[]) => {
  const handler = mock.handlers.get(channel);
  if (!handler) throw new Error(`No handler for ${channel}`);
  return handler({ sender: { id: 1 } }, ...args) as Promise<unknown>;
};

/** Everything a car slot is not. */
const NOT_A_CAR = [
  -1,
  1.5,
  RACE_HISTORY_MAX_CARS,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  '3',
  null,
  undefined,
  true,
  {},
  [3],
];

/** Everything a race's row id is not, short of leaving it out. */
const NOT_A_RACE = [
  0,
  -4,
  2.5,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  '7',
  true,
  {},
  [7],
];

/**
 * Everything the number of an event is not, short of leaving it out. Events
 * are numbered from 1.
 */
const NOT_AN_EVENT = [
  0,
  -3,
  10.5,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  '200',
  true,
  {},
  [200],
];

const untouched = (service: ReturnType<typeof source>) => {
  for (const method of Object.values(service)) {
    expect(method).not.toHaveBeenCalled();
  }
};

beforeEach(() => {
  mock.handlers.clear();
  vi.clearAllMocks();
});

describe('race history bridge over IPC', () => {
  it('passes each request on to the race history', async () => {
    const service = source();
    setupRaceHistoryBridge(service);

    expect(await invoke('raceHistory:getCarLaps', 7, 12)).toEqual({
      laps: [],
      missingLaps: [],
      revision: 3,
    });
    await invoke('raceHistory:getCarStints', 0, 12);
    await invoke('raceHistory:getDriverChanges', 12);
    await invoke('raceHistory:listRaces');
    await invoke('raceHistory:getEvents', 12, 801);

    expect(service.getCarLaps).toHaveBeenCalledWith(7, 12);
    expect(service.getCarStints).toHaveBeenCalledWith(0, 12);
    expect(service.getDriverChanges).toHaveBeenCalledWith(12);
    expect(service.listRaces).toHaveBeenCalledWith();
    expect(service.getEvents).toHaveBeenCalledWith(12, 801);
  });

  it('asks for the latest of the log being kept when nothing is named', async () => {
    const service = source();
    setupRaceHistoryBridge(service);

    await invoke('raceHistory:getEvents');
    await invoke('raceHistory:getEvents', undefined, undefined);
    await invoke('raceHistory:getEvents', null, null);
    // The page before the events a window holds, of the race under way.
    await invoke('raceHistory:getEvents', undefined, 801);
    // And the latest page of a race in the file.
    await invoke('raceHistory:getEvents', 12);
    // The first event there can be: nothing lies before it, which is an
    // answer and not a mistake.
    await invoke('raceHistory:getEvents', undefined, 1);

    expect(service.getEvents.mock.calls).toEqual([
      [undefined, undefined],
      [undefined, undefined],
      [undefined, undefined],
      [undefined, 801],
      [12, undefined],
      [undefined, 1],
    ]);
  });

  it('refuses the log of anything but a row id, before anything but an event', async () => {
    const service = source();
    setupRaceHistoryBridge(service);

    for (const bad of NOT_A_RACE) {
      await expect(
        invoke('raceHistory:getEvents', bad),
        String(bad)
      ).rejects.toThrow(TypeError);
      await expect(
        invoke('raceHistory:getEvents', bad, 801),
        String(bad)
      ).rejects.toThrow(TypeError);
    }
    for (const bad of NOT_AN_EVENT) {
      await expect(
        invoke('raceHistory:getEvents', 12, bad),
        String(bad)
      ).rejects.toThrow(TypeError);
      await expect(
        invoke('raceHistory:getEvents', undefined, bad),
        String(bad)
      ).rejects.toThrow(TypeError);
    }
    untouched(service);
  });

  it('asks about the race being recorded when no race is named', async () => {
    const service = source();
    setupRaceHistoryBridge(service);

    await invoke('raceHistory:getCarLaps', 7);
    // What the preload sends for an argument left out, and null for good
    // measure.
    await invoke('raceHistory:getCarLaps', 8, undefined);
    await invoke('raceHistory:getCarStints', 9, null);
    await invoke('raceHistory:getDriverChanges');
    await invoke('raceHistory:getDriverChanges', undefined);

    expect(service.getCarLaps.mock.calls).toEqual([
      [7, undefined],
      [8, undefined],
    ]);
    expect(service.getCarStints).toHaveBeenCalledWith(9, undefined);
    expect(service.getDriverChanges.mock.calls).toEqual([
      [undefined],
      [undefined],
    ]);
  });

  it('takes the first and the last car slot there is', async () => {
    const service = source();
    setupRaceHistoryBridge(service);

    await invoke('raceHistory:getCarLaps', 0);
    await invoke('raceHistory:getCarLaps', RACE_HISTORY_MAX_CARS - 1);

    expect(service.getCarLaps).toHaveBeenCalledTimes(2);
  });

  it.each(['raceHistory:getCarLaps', 'raceHistory:getCarStints'])(
    'refuses %s with anything but a car slot',
    async (channel) => {
      const service = source();
      setupRaceHistoryBridge(service);

      for (const bad of NOT_A_CAR) {
        await expect(invoke(channel, bad), String(bad)).rejects.toThrow(
          TypeError
        );
        await expect(invoke(channel, bad, 12), String(bad)).rejects.toThrow(
          TypeError
        );
      }
      await expect(invoke(channel)).rejects.toThrow(TypeError);
      untouched(service);
    }
  );

  it.each(['raceHistory:getCarLaps', 'raceHistory:getCarStints'])(
    'refuses %s with anything but a row id for the race',
    async (channel) => {
      const service = source();
      setupRaceHistoryBridge(service);

      for (const bad of NOT_A_RACE) {
        await expect(invoke(channel, 7, bad), String(bad)).rejects.toThrow(
          TypeError
        );
      }
      untouched(service);
    }
  );

  it('refuses the driver changes of anything but a row id', async () => {
    const service = source();
    setupRaceHistoryBridge(service);

    for (const bad of NOT_A_RACE) {
      await expect(
        invoke('raceHistory:getDriverChanges', bad),
        String(bad)
      ).rejects.toThrow(TypeError);
    }
    untouched(service);
  });

  it('refuses a request that brings more than it takes', async () => {
    const service = source();
    setupRaceHistoryBridge(service);

    await expect(invoke('raceHistory:getCarLaps', 7, 12, 1)).rejects.toThrow(
      TypeError
    );
    await expect(
      invoke('raceHistory:getCarStints', 7, 12, 'DROP TABLE race')
    ).rejects.toThrow(TypeError);
    await expect(
      invoke('raceHistory:getDriverChanges', 12, 12)
    ).rejects.toThrow(TypeError);
    await expect(invoke('raceHistory:listRaces', 5)).rejects.toThrow(TypeError);
    await expect(invoke('raceHistory:listRaces', undefined)).rejects.toThrow(
      TypeError
    );
    await expect(
      invoke('raceHistory:getEvents', 12, 801, 5000)
    ).rejects.toThrow(TypeError);
    untouched(service);
  });

  it('removes its handlers when disposed', () => {
    const { dispose } = setupRaceHistoryBridge(source());
    expect(mock.handlers.size).toBe(5);

    dispose();

    expect(mock.handlers.size).toBe(0);
  });
});

describe('race history bridge called directly', () => {
  // One instance is to answer the app's windows and a page served to a
  // browser alike, so the checks are the bridge's own and not the IPC
  // handlers'.
  it('is the instance the IPC handlers answer from', async () => {
    const service = source();
    const { bridge } = setupRaceHistoryBridge(service);

    await bridge.getCarLaps(4, 9);
    await invoke('raceHistory:getCarLaps', 5, 9);

    expect(service.getCarLaps.mock.calls).toEqual([
      [4, 9],
      [5, 9],
    ]);
  });

  it('refuses the same things with no IPC in between', async () => {
    const service = source();
    const bridge = createRaceHistoryBridge(service) as unknown as Record<
      string,
      (...args: unknown[]) => Promise<unknown>
    >;

    for (const bad of NOT_A_CAR) {
      await expect(bridge.getCarLaps(bad)).rejects.toThrow(TypeError);
      await expect(bridge.getCarStints(bad)).rejects.toThrow(TypeError);
    }
    for (const bad of NOT_A_RACE) {
      await expect(bridge.getCarLaps(1, bad)).rejects.toThrow(TypeError);
      await expect(bridge.getCarStints(1, bad)).rejects.toThrow(TypeError);
      await expect(bridge.getDriverChanges(bad)).rejects.toThrow(TypeError);
      await expect(bridge.getEvents(bad)).rejects.toThrow(TypeError);
    }
    for (const bad of NOT_AN_EVENT) {
      await expect(bridge.getEvents(undefined, bad)).rejects.toThrow(TypeError);
    }
    await expect(bridge.listRaces('all')).rejects.toThrow(TypeError);
    untouched(service);

    await expect(bridge.getCarLaps(1)).resolves.toMatchObject({ revision: 3 });
    await expect(bridge.listRaces()).resolves.toEqual([]);
  });

  it('says what was wrong without repeating what was sent', async () => {
    const bridge = createRaceHistoryBridge(source()) as unknown as Record<
      string,
      (...args: unknown[]) => Promise<unknown>
    >;

    await expect(bridge.getCarLaps('C:\\Users\\somebody')).rejects.toThrow(
      'Invalid car for raceHistory:getCarLaps'
    );
    await expect(bridge.getCarStints(1, 'x')).rejects.toThrow(
      'Invalid race for raceHistory:getCarStints'
    );
    await expect(bridge.getEvents(undefined, 'newest')).rejects.toThrow(
      'Invalid event for raceHistory:getEvents'
    );
  });

  it('says how many arguments a request takes when it brought more', async () => {
    const bridge = createRaceHistoryBridge(source()) as unknown as Record<
      string,
      (...args: unknown[]) => Promise<unknown>
    >;

    await expect(bridge.getCarLaps(7, 12, 1)).rejects.toThrow(
      'raceHistory:getCarLaps takes at most 2 argument(s)'
    );
    await expect(bridge.getCarStints(7, 12, 1)).rejects.toThrow(
      'raceHistory:getCarStints takes at most 2 argument(s)'
    );
    await expect(bridge.getDriverChanges(12, 12)).rejects.toThrow(
      'raceHistory:getDriverChanges takes at most 1 argument(s)'
    );
    await expect(bridge.listRaces(null)).rejects.toThrow(
      'raceHistory:listRaces takes at most 0 argument(s)'
    );
    await expect(bridge.getEvents(12, 801, 5000)).rejects.toThrow(
      'raceHistory:getEvents takes at most 2 argument(s)'
    );
  });

  it('refuses under a name of its own, which a failure further in does not have', async () => {
    // A road that sends an answer back passes a refusal's words on and
    // keeps a failure's to itself: this is how it tells the two apart.
    const service = source();
    const failure = new Error('SQLITE_CANTOPEN: C:\\Users\\somebody\\laps.db');
    service.getCarLaps.mockRejectedValueOnce(failure);
    const bridge = createRaceHistoryBridge(service) as unknown as Record<
      string,
      (...args: unknown[]) => Promise<unknown>
    >;

    await expect(bridge.getCarLaps(1)).rejects.toBe(failure);
    for (const refused of [
      bridge.getCarLaps(-1),
      bridge.getCarLaps(1, 0),
      bridge.getEvents(undefined, 0),
      bridge.listRaces(1),
    ]) {
      const error = await refused.catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(RaceHistoryRequestError);
      // Still a TypeError, as it was before it had a name.
      expect(error).toBeInstanceOf(TypeError);
    }
    expect(failure).not.toBeInstanceOf(RaceHistoryRequestError);
  });
});
