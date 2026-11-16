import type {
  RaceDriverChange,
  RaceInfo,
  RaceLap,
  RaceRecords,
  RaceStint,
  RaceWriteBatch,
  StoredRace,
  StoredRaceState,
} from '@irdashies/types';
import type { LapLibraryCaller } from './dispatch';

/**
 * The history of races as the rest of the main process uses it: rows on
 * their way into the lap library's file, and the questions asked of it.
 *
 * Nothing is written a row at a time. A lap, a stint or a driver change
 * waits here and goes with everything else that is waiting, as one
 * transaction on the worker thread, at most once every few seconds. A row
 * written twice while it waits goes once, as it last stood: a stint is
 * changed by every lap of it.
 *
 * Caps: the file keeps `maxRaces` races, the oldest going with every row of
 * it when one is added. What waits here is bounded by what a field can
 * complete between two writes.
 *
 * Nothing here throws to its caller. A write that fails is logged and its
 * rows are let go; a question that cannot be answered gets an empty answer.
 * When the library's file could not be opened at all, nothing is written
 * and every answer is empty: the lap library says why, once.
 */

/** A race on its way into the file: what names it, and what it is. */
export interface RaceWriteHead {
  /** Names the race for as long as the app runs. */
  token: string;
  /**
   * The record of what it is, read when a batch is written. Its `id` is the
   * row of a race carried on after a restart; null for one being made.
   */
  info: RaceInfo;
}

export interface RaceHistoryStore {
  queueLap(race: RaceWriteHead, lap: RaceLap): void;
  queueStint(race: RaceWriteHead, stint: RaceStint): void;
  queueDriverChange(race: RaceWriteHead, change: RaceDriverChange): void;
  /** The race's own row is to be brought up to date: its entry list changed. */
  queueInfo(race: RaceWriteHead): void;
  /** Another car is in the slot: what the file holds for it is to go. */
  queueCarReplaced(race: RaceWriteHead, carIdx: number): void;
  /**
   * Writes what is waiting, now. Settles when it is in the file, or has
   * failed and been logged; it never rejects.
   */
  flush(): Promise<void>;
  /**
   * Calls back with a race's row once a batch of it is in the file. Returns
   * the way to stop.
   */
  onStored(callback: (token: string, raceId: number) => void): () => void;

  /** Races that might be the one being driven; see RaceHistoryTables. */
  findCandidates(
    simulator: string,
    trackId: number,
    sessionType: string | null
  ): Promise<StoredRaceState[]>;
  /** Everything kept of a race; null when there is no such race. */
  load(raceId: number): Promise<RaceRecords | null>;
  /** The races kept, most recent first. */
  listRaces(): Promise<StoredRace[]>;
  carLaps(raceId: number, carIdx: number): Promise<RaceLap[]>;
  carStints(raceId: number, carIdx: number): Promise<RaceStint[]>;
  driverChanges(raceId: number): Promise<RaceDriverChange[]>;
}

export interface RaceHistoryStoreOptions {
  /** How many races the file keeps. */
  maxRaces: number;
  /** Milliseconds from the first row waiting to the write that takes it. */
  writeIntervalMs?: number;
  /**
   * Whether anything may be written now. Asked for every row and again for
   * every write: a recording played back in place of a simulator is not to
   * reach the file by any road.
   */
  canWrite?: () => boolean;
  logError: (message: string, error: unknown) => void;
  logInfo?: (message: string) => void;
}

/**
 * A field of sixty completes a lap every second and a half or so; two
 * seconds gathers a handful of rows without leaving a lap long out of the
 * file.
 */
export const RACE_HISTORY_WRITE_INTERVAL_MS = 2000;

/** How many races' row ids are remembered: one is made a session. */
const MAX_REMEMBERED_RACES = 50;

interface Waiting {
  race: RaceWriteHead;
  laps: Map<string, RaceLap>;
  stints: Map<string, RaceStint>;
  changes: Map<string, RaceDriverChange>;
  replacedCars: Set<number>;
}

export const createRaceHistoryStore = (
  client: LapLibraryCaller,
  options: RaceHistoryStoreOptions
): RaceHistoryStore => {
  const canWrite = options.canWrite ?? (() => true);
  const interval = options.writeIntervalMs ?? RACE_HISTORY_WRITE_INTERVAL_MS;
  /** By race token, in the order the races first had something waiting. */
  const waiting = new Map<string, Waiting>();
  const rowIds = new Map<string, number>();
  const listeners = new Set<(token: string, raceId: number) => void>();
  let timer: NodeJS.Timeout | undefined;
  let writes: Promise<void> = Promise.resolve();
  /** True once the file is known not to have opened. */
  let down = false;

  client
    .call('status')
    .then((report) => {
      down = !report.available;
    })
    .catch(() => {
      // No answer at all: the thread could not be started, or died.
      down = true;
    });

  const write = async (rows: Waiting): Promise<void> => {
    if (down || !canWrite()) return;
    const { race } = rows;
    const batch: RaceWriteBatch = {
      raceId: race.info.id ?? rowIds.get(race.token) ?? null,
      token: race.token,
      info: race.info,
      laps: [...rows.laps.values()],
      stints: [...rows.stints.values()],
      driverChanges: [...rows.changes.values()],
      replacedCars: [...rows.replacedCars],
      maxRaces: options.maxRaces,
    };
    try {
      const { raceId, removedRaces } = await client.call('raceWrite', batch);
      rowIds.delete(race.token);
      rowIds.set(race.token, raceId);
      if (rowIds.size > MAX_REMEMBERED_RACES) {
        for (const oldest of rowIds.keys()) {
          rowIds.delete(oldest);
          break;
        }
      }
      if (removedRaces > 0) {
        options.logInfo?.(
          `[RaceHistory] Removed ${removedRaces} older race(s) to keep ${options.maxRaces}`
        );
      }
      for (const listener of listeners) {
        try {
          listener(race.token, raceId);
        } catch (error) {
          options.logError('[RaceHistory] A listener failed:', error);
        }
      }
    } catch (error) {
      options.logError(
        `[RaceHistory] Could not store ${batch.laps.length} lap(s) of a race:`,
        error
      );
    }
  };

  const flush = (): Promise<void> => {
    clearTimeout(timer);
    timer = undefined;
    for (const rows of waiting.values()) {
      writes = writes.then(() => write(rows));
    }
    waiting.clear();
    return writes;
  };

  /** What is waiting for a race, starting the clock on the next write. */
  const waitingFor = (race: RaceWriteHead): Waiting | null => {
    if (down || !canWrite()) return null;
    let rows = waiting.get(race.token);
    if (!rows) {
      rows = {
        race,
        laps: new Map(),
        stints: new Map(),
        changes: new Map(),
        replacedCars: new Set(),
      };
      waiting.set(race.token, rows);
    }
    if (!timer) {
      timer = setTimeout(() => void flush(), interval);
      // Nothing waits for this timer: the shutdown writes what is left.
      timer.unref?.();
    }
    return rows;
  };

  /** Asks the file something; an empty answer when it cannot say. */
  const ask = <Answer>(
    what: string,
    question: () => Promise<Answer>,
    empty: Answer
  ): Promise<Answer> => {
    if (down) return Promise.resolve(empty);
    return question().catch((error: unknown) => {
      options.logError(`[RaceHistory] Could not read ${what}:`, error);
      return empty;
    });
  };

  return {
    queueLap(race, lap) {
      waitingFor(race)?.laps.set(`${lap.carIdx}:${lap.lap}`, lap);
    },
    queueStint(race, stint) {
      waitingFor(race)?.stints.set(`${stint.carIdx}:${stint.ordinal}`, stint);
    },
    queueDriverChange(race, change) {
      waitingFor(race)?.changes.set(`${change.carIdx}:${change.seq}`, change);
    },
    queueInfo(race) {
      waitingFor(race);
    },
    queueCarReplaced(race, carIdx) {
      const rows = waitingFor(race);
      if (!rows) return;
      // What was waiting for the slot was the car's that left.
      const ofCar = `${carIdx}:`;
      for (const list of [rows.laps, rows.stints, rows.changes]) {
        for (const key of list.keys()) {
          if (key.startsWith(ofCar)) list.delete(key);
        }
      }
      rows.replacedCars.add(carIdx);
    },
    flush,
    onStored(callback) {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },

    findCandidates: (simulator, trackId, sessionType) =>
      ask(
        'the races kept',
        () => client.call('raceCandidates', simulator, trackId, sessionType),
        []
      ),
    load: (raceId) =>
      ask('a race', () => client.call('raceLoad', raceId), null),
    listRaces: () => ask('the races kept', () => client.call('raceList'), []),
    carLaps: (raceId, carIdx) =>
      ask('a car’s laps', () => client.call('raceCarLaps', raceId, carIdx), []),
    carStints: (raceId, carIdx) =>
      ask(
        'a car’s stints',
        () => client.call('raceCarStints', raceId, carIdx),
        []
      ),
    driverChanges: (raceId) =>
      ask(
        'a race’s driver changes',
        () => client.call('raceDriverChanges', raceId),
        []
      ),
  };
};
