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

    expect(service.getCarLaps).toHaveBeenCalledWith(7, 12);
    expect(service.getCarStints).toHaveBeenCalledWith(0, 12);
    expect(service.getDriverChanges).toHaveBeenCalledWith(12);
    expect(service.listRaces).toHaveBeenCalledWith();
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
    untouched(service);
  });

  it('removes its handlers when disposed', () => {
    const { dispose } = setupRaceHistoryBridge(source());
    expect(mock.handlers.size).toBe(4);

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
  });
});
