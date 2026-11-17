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
const NO_CARS: readonly number[] = [];

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
 * and the hook does not know which. A read that is refused or lost, as
 * one is when a page's socket drops, is asked again the next time the
 * car's records change.
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
): ReadonlyMap<number, T> => {
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
    if (!raceToken) return;

    cars.forEach((carIdx, index) => {
      const stamp = `${raceToken}:${revisions[index]}`;
      if (questions.get(carIdx) === stamp) return;
      questions.set(carIdx, stamp);
      read(bridge, carIdx)
        .then((answer) => {
          // Answered after a newer question for the car, after the car was
          // let go of, or after the reader went: not an answer to keep.
          if (!mounted.current || questions.get(carIdx) !== stamp) return;
          setHeld((before) => new Map(before).set(carIdx, answer));
        })
        .catch((error: unknown) => {
          logger.warn('Race history: could not read a car’s records', error);
          // So the next change of the car's records asks again.
          if (questions.get(carIdx) === stamp) questions.delete(carIdx);
        });
    });
  }, [state, key, read]);

  return held;
};

const readStints: Read<RaceStint[]> = (bridge, carIdx) =>
  bridge.getCarStints(carIdx);

/** The stints the race history holds for a few cars, oldest first. */
export const useRaceStints = (
  carIdxs: readonly number[]
): ReadonlyMap<number, readonly RaceStint[]> =>
  useRaceHistoryCars(carIdxs, readStints);

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
): CarRaceRecord | undefined => {
  const cars = useMemo(
    () => (carIdx === null || carIdx < 0 ? NO_CARS : [carIdx]),
    [carIdx]
  );
  const held = useRaceHistoryCars(cars, readRecord);
  return carIdx === null ? undefined : held.get(carIdx);
};

/**
 * The laps and stints of a few cars, each from the moment its answer is in:
 * a car asked about has no entry until then. A chart of several cars reads
 * them here, so that each is asked for once and again only when its own
 * records have changed, and a car no longer drawn is let go of.
 */
export const useCarRaceRecords = (
  carIdxs: readonly number[]
): ReadonlyMap<number, CarRaceRecord> =>
  useRaceHistoryCars(carIdxs, readRecord);

/**
 * Whether this page can read the race history at all: a window of the app
 * can, and so can a page served to a browser. False only where no bridge
 * was set up, as in a story that stages a page without one.
 */
export const raceHistoryReadable = (): boolean =>
  typeof window !== 'undefined' && window.raceHistoryBridge !== undefined;
