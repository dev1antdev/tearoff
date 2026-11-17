import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { shallow } from 'zustand/shallow';
import { useChannelSelector } from '@irdashies/context';
import type {
  RaceHistoryBridge,
  RaceHistorySummarySnapshot,
  RaceStint,
} from '@irdashies/types';
import logger from '@irdashies/utils/logger';
import type { CarRaceRecord } from './carRecord';

/**
 * What the race history holds for a few cars, read through its bridge and
 * kept up to date: one rule for every panel that shows a car's laps or
 * stints, so that none of them asks on a timer and none shows an answer
 * about a car it no longer shows.
 */

/** What is asked of the bridge for one car. */
type Read<T> = (bridge: RaceHistoryBridge, carIdx: number) => Promise<T>;

const NOTHING_HELD: ReadonlyMap<number, never> = new Map<number, never>();
const NONE_FAILED: ReadonlySet<number> = new Set<number>();
const NO_CARS: readonly number[] = [];

/** What is held for the cars asked about. */
interface CarReads<T> {
  /** The answers, by car. A car with none has no entry. */
  held: ReadonlyMap<number, T>;
  /**
   * The cars whose last read failed and that have no answer since: asked
   * again when their records next change, or the page's connection is back.
   */
  failed: ReadonlySet<number>;
}

const without = (
  cars: ReadonlySet<number>,
  gone: (carIdx: number) => boolean
): ReadonlySet<number> => {
  const kept = [...cars].filter((carIdx) => !gone(carIdx));
  return kept.length === 0 ? NONE_FAILED : new Set(kept);
};

const carsOf = (key: string): number[] =>
  key.split(',').filter(Boolean).map(Number);

/**
 * The summary channel says when a car's records have changed; the records
 * themselves are asked for through the bridge, once for each car and again
 * only when its `revision` has moved, never on a timer. A race that is not
 * the one held (`raceToken`) drops everything first, and so does a car that
 * is no longer asked about: an answer that comes back for it afterwards, or
 * after a newer question for the same car, is not kept. Where the page
 * was given no bridge the map stays empty.
 *
 * The bridge is a window's over IPC and a browser page's over its socket,
 * and the hook does not know which. A read that is refused or lost is asked
 * again the next time the car's records change. On a page served to a
 * browser that is not soon enough: a read in flight when the socket drops,
 * or made while it is down, is lost, and a car that has retired never
 * changes again. So when the page's connection comes back
 * (`window.browserConnection`, which a window of the app has not) every car
 * that has no answer is asked for again. Until it has one, a car whose
 * read failed is named in `failed`, for a panel to say so.
 *
 * Subscribing to the summary is also what keeps the race recorded while a
 * reader is on screen.
 *
 * `read` is one function for the life of the hook: each caller below hands
 * it a constant.
 */
const useRaceHistoryCars = <T>(
  carIdxs: readonly number[],
  read: Read<T>
): CarReads<T> => {
  // A string, so that the same cars in a new array are the same cars.
  const key = carIdxs.join(',');
  const select = useCallback(
    (summary: RaceHistorySummarySnapshot) => [
      summary.raceToken,
      ...carsOf(key).map((carIdx) => summary.revision[carIdx] ?? 0),
    ],
    [key]
  );
  const state = useChannelSelector('race-history.summary', select, {
    enabled: key !== '',
    equality: shallow,
  });

  const [held, setHeld] = useState<ReadonlyMap<number, T>>(NOTHING_HELD);
  /** The cars whose last read failed and has not been made good. */
  const [failed, setFailed] = useState<ReadonlySet<number>>(NONE_FAILED);
  /** Counts the times the page's connection came back. */
  const [reconnected, setReconnected] = useState(0);
  /** What each car was last asked about at: the race and the revision. */
  const asked = useRef(new Map<number, string>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    // A page served to a browser; the app's windows have no connection.
    const connection = window.browserConnection;
    if (!connection) return;
    return connection.onConnectionChanged((connected) => {
      if (connected) setReconnected((count) => count + 1);
    });
  }, []);

  useEffect(() => {
    const bridge = window.raceHistoryBridge;
    if (!bridge || !state) return;
    const [raceToken, ...revisions] = state;
    const cars = carsOf(key);
    const questions = asked.current;

    // Cars no longer shown, and every car of a race that is over.
    const wanted = new Set(cars);
    for (const [carIdx, stamp] of questions) {
      if (!wanted.has(carIdx) || !stamp.startsWith(`${raceToken}:`)) {
        questions.delete(carIdx);
      }
    }
    setHeld((before) =>
      [...before.keys()].every((carIdx) => questions.has(carIdx))
        ? before
        : new Map([...before].filter(([carIdx]) => questions.has(carIdx)))
    );
    // A failure is forgotten with the car, and with the race it was in.
    setFailed((before) =>
      raceToken && [...before].every((carIdx) => wanted.has(carIdx))
        ? before
        : without(before, (carIdx) => !raceToken || !wanted.has(carIdx))
    );
    if (!raceToken) return;

    cars.forEach((carIdx, index) => {
      const stamp = `${raceToken}:${revisions[index]}`;
      if (questions.get(carIdx) === stamp) return;
      questions.set(carIdx, stamp);
      // Asked again: it is being read, not failed.
      setFailed((before) =>
        before.has(carIdx) ? without(before, (car) => car === carIdx) : before
      );
      read(bridge, carIdx)
        .then((answer) => {
          // Answered after a newer question for the car, after the car was
          // let go of, or after the reader went: not an answer to keep.
          if (!mounted.current || questions.get(carIdx) !== stamp) return;
          setHeld((before) => new Map(before).set(carIdx, answer));
        })
        .catch((error: unknown) => {
          logger.warn('Race history: could not read a car’s records', error);
          if (questions.get(carIdx) !== stamp) return;
          // So the next change of the car's records, or the connection
          // coming back, asks again.
          questions.delete(carIdx);
          if (mounted.current) {
            setFailed((before) => new Set(before).add(carIdx));
          }
        });
    });
    // `reconnected` is here to run this again when the connection is back:
    // a car whose read was lost has no question standing, and gets one.
  }, [state, key, read, reconnected]);

  return useMemo(() => ({ held, failed }), [held, failed]);
};

const readStints: Read<RaceStint[]> = (bridge, carIdx) =>
  bridge.getCarStints(carIdx);

/** The stints the race history holds for a few cars, oldest first. */
export const useRaceStints = (
  carIdxs: readonly number[]
): ReadonlyMap<number, readonly RaceStint[]> =>
  useRaceHistoryCars(carIdxs, readStints).held;

const readRecord: Read<CarRaceRecord> = async (bridge, carIdx) => {
  const [laps, stints] = await Promise.all([
    bridge.getCarLaps(carIdx),
    bridge.getCarStints(carIdx),
  ]);
  return { laps: laps.laps, missingLaps: laps.missingLaps, stints };
};

/**
 * The laps and stints of one car, or undefined while there is no answer for
 * it: before the first one arrives, between races, and for no car at all.
 * Choosing another car lets go of the one before at once.
 */
export const useCarRaceRecord = (
  carIdx: number | null
): CarRaceRecord | undefined => useCarRaceRead(carIdx).record;

/** One car's record, and whether the last read of it failed. */
export interface CarRaceRead {
  record: CarRaceRecord | undefined;
  /**
   * The read was refused or lost and has not been made good: there is no
   * record, and none is on its way until the car's records change or the
   * page's connection comes back.
   */
  failed: boolean;
}

/**
 * `useCarRaceRecord`, for a panel that tells a record that is being read
 * from one that could not be.
 */
export const useCarRaceRead = (carIdx: number | null): CarRaceRead => {
  const cars = useMemo(
    () => (carIdx === null || carIdx < 0 ? NO_CARS : [carIdx]),
    [carIdx]
  );
  const { held, failed } = useRaceHistoryCars(cars, readRecord);
  const record = carIdx === null ? undefined : held.get(carIdx);
  const lost = carIdx !== null && record === undefined && failed.has(carIdx);
  return useMemo(() => ({ record, failed: lost }), [record, lost]);
};

/**
 * The laps and stints of a few cars, each from the moment its answer is in:
 * a car asked about has no entry until then. A chart of several cars reads
 * them here, so that each is asked for once and again only when its own
 * records have changed, and a car no longer drawn is let go of.
 */
export const useCarRaceRecords = (
  carIdxs: readonly number[]
): ReadonlyMap<number, CarRaceRecord> => useCarRaceReads(carIdxs).records;

/**
 * `useCarRaceRecords`, with the cars whose last read failed and that have
 * no record since.
 */
export const useCarRaceReads = (
  carIdxs: readonly number[]
): {
  records: ReadonlyMap<number, CarRaceRecord>;
  failed: ReadonlySet<number>;
} => {
  const { held, failed } = useRaceHistoryCars(carIdxs, readRecord);
  return useMemo(() => ({ records: held, failed }), [held, failed]);
};

/**
 * Whether this page can read the race history at all: a window of the app
 * can, and so can a page served to a browser. False only where no bridge
 * was set up, as in a story that stages a page without one.
 */
export const raceHistoryReadable = (): boolean =>
  typeof window !== 'undefined' && window.raceHistoryBridge !== undefined;
