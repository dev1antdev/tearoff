import { ipcMain } from 'electron';
import type { RaceHistoryBridge } from '@irdashies/types';
import { RACE_HISTORY_MAX_CARS } from '@irdashies/types';

/**
 * The detail of a recorded race, for whatever shows it: the laps and the
 * stints of one car, the driver changes of a race, its log, the races kept.
 *
 * Reading only. Nothing here changes a record, and nothing a caller sends
 * reaches the file but whole numbers that have been checked.
 */

/** What the bridge is answered from: the race history's runtime. */
export type RaceHistorySource = RaceHistoryBridge;

/** A car slot: a whole number from 0 up to the most the record keeps. */
const isCarIdx = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  value < RACE_HISTORY_MAX_CARS;

/** Row ids are positive integers; anything else is not one of ours. */
const isRaceId = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

const carIdxOrThrow = (value: unknown, request: string): number => {
  if (!isCarIdx(value)) throw new TypeError(`Invalid car for ${request}`);
  return value;
};

/**
 * The race a request is about: undefined for the one being recorded now,
 * which is what leaving it out or sending null asks for.
 */
const raceIdOrThrow = (value: unknown, request: string): number | undefined => {
  if (value === undefined || value === null) return undefined;
  if (!isRaceId(value)) throw new TypeError(`Invalid race for ${request}`);
  return value;
};

/**
 * The event a page of the log ends before: undefined for the most recent
 * page, which is what leaving it out or sending null asks for. Events are
 * numbered from 1, so nothing lies before a number below that.
 */
const beforeOrThrow = (value: unknown, request: string): number | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`Invalid event for ${request}`);
  }
  return value;
};

/** A request with more than it takes is not one this app makes. */
const noMoreThan = (
  args: readonly unknown[],
  count: number,
  request: string
): void => {
  if (args.length > count) {
    throw new TypeError(`${request} takes at most ${count} argument(s)`);
  }
};

/**
 * One instance is shared by IPC and browser clients: every argument is
 * checked here, so that whichever road a request comes by it is the same
 * request. Each function refuses what is not a car slot, a row id or an
 * event's number by rejecting, and asks the source nothing.
 */
export const createRaceHistoryBridge = (
  source: RaceHistorySource
): RaceHistoryBridge => ({
  async getCarLaps(carIdx: unknown, raceId?: unknown, ...rest: unknown[]) {
    noMoreThan(rest, 0, 'raceHistory:getCarLaps');
    return source.getCarLaps(
      carIdxOrThrow(carIdx, 'raceHistory:getCarLaps'),
      raceIdOrThrow(raceId, 'raceHistory:getCarLaps')
    );
  },
  async getCarStints(carIdx: unknown, raceId?: unknown, ...rest: unknown[]) {
    noMoreThan(rest, 0, 'raceHistory:getCarStints');
    return source.getCarStints(
      carIdxOrThrow(carIdx, 'raceHistory:getCarStints'),
      raceIdOrThrow(raceId, 'raceHistory:getCarStints')
    );
  },
  async getDriverChanges(raceId?: unknown, ...rest: unknown[]) {
    noMoreThan(rest, 0, 'raceHistory:getDriverChanges');
    return source.getDriverChanges(
      raceIdOrThrow(raceId, 'raceHistory:getDriverChanges')
    );
  },
  async listRaces(...rest: unknown[]) {
    noMoreThan(rest, 0, 'raceHistory:listRaces');
    return source.listRaces();
  },
  async getEvents(raceId?: unknown, before?: unknown, ...rest: unknown[]) {
    noMoreThan(rest, 0, 'raceHistory:getEvents');
    return source.getEvents(
      raceIdOrThrow(raceId, 'raceHistory:getEvents'),
      beforeOrThrow(before, 'raceHistory:getEvents')
    );
  },
});

const CHANNELS = [
  'raceHistory:getCarLaps',
  'raceHistory:getCarStints',
  'raceHistory:getDriverChanges',
  'raceHistory:listRaces',
  'raceHistory:getEvents',
] as const;

/**
 * Serves the bridge to the app's own windows over IPC. The renderer is not
 * trusted to send a number where one is expected: what it sends goes to the
 * bridge as it came, and the bridge checks it.
 *
 * Returns the bridge, for whatever else is to serve the same instance, and
 * the way to take the handlers down.
 */
export function setupRaceHistoryBridge(source: RaceHistorySource): {
  bridge: RaceHistoryBridge;
  dispose: () => void;
} {
  const bridge = createRaceHistoryBridge(source);
  // Handed on untyped: the bridge's own checks are what types them.
  const untyped = bridge as unknown as Record<
    string,
    (...args: unknown[]) => Promise<unknown>
  >;
  ipcMain.handle('raceHistory:getCarLaps', (_event, ...args: unknown[]) =>
    untyped.getCarLaps(...args)
  );
  ipcMain.handle('raceHistory:getCarStints', (_event, ...args: unknown[]) =>
    untyped.getCarStints(...args)
  );
  ipcMain.handle('raceHistory:getDriverChanges', (_event, ...args: unknown[]) =>
    untyped.getDriverChanges(...args)
  );
  ipcMain.handle('raceHistory:listRaces', (_event, ...args: unknown[]) =>
    untyped.listRaces(...args)
  );
  ipcMain.handle('raceHistory:getEvents', (_event, ...args: unknown[]) =>
    untyped.getEvents(...args)
  );
  return {
    bridge,
    dispose: () => {
      for (const channel of CHANNELS) ipcMain.removeHandler(channel);
    },
  };
}
