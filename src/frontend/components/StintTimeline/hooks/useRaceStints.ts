import { useCallback, useEffect, useRef, useState } from 'react';
import { shallow } from 'zustand/shallow';
import { useChannelSelector } from '@irdashies/context';
import type { RaceHistorySummarySnapshot, RaceStint } from '@irdashies/types';
import logger from '@irdashies/utils/logger';

type Stints = ReadonlyMap<number, readonly RaceStint[]>;

const NO_STINTS: Stints = new Map();

const carsOf = (key: string): number[] =>
  key.split(',').filter(Boolean).map(Number);

/**
 * The stints the race history holds for a few cars, kept up to date.
 *
 * The summary channel says when a car's records have changed; the stints
 * themselves are asked for through the bridge, once for each car and again
 * only when its `revision` has moved, never on a timer. A race that is not
 * the one held (`raceToken`) drops everything first. Outside Electron there
 * is no bridge, and the map stays empty.
 *
 * Subscribing to the summary is also what keeps the race recorded while
 * this is on screen.
 */
export const useRaceStints = (carIdxs: readonly number[]): Stints => {
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

  const [stints, setStints] = useState<Stints>(NO_STINTS);
  /** What each car's stints were last asked for at: the race and revision. */
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
    setStints((held) =>
      [...held.keys()].every((carIdx) => questions.has(carIdx))
        ? held
        : new Map([...held].filter(([carIdx]) => questions.has(carIdx)))
    );
    if (!raceToken) return;

    cars.forEach((carIdx, index) => {
      const stamp = `${raceToken}:${revisions[index]}`;
      if (questions.get(carIdx) === stamp) return;
      questions.set(carIdx, stamp);
      bridge
        .getCarStints(carIdx)
        .then((answer) => {
          // Answered after a newer question for the car, or after the
          // widget went: not an answer to keep.
          if (!mounted.current || questions.get(carIdx) !== stamp) return;
          setStints((held) => new Map(held).set(carIdx, answer));
        })
        .catch((error: unknown) => {
          logger.warn('Stint timeline: could not read a car’s stints', error);
          // So the next change of the car's records asks again.
          if (questions.get(carIdx) === stamp) questions.delete(carIdx);
        });
    });
  }, [state, key]);

  return stints;
};
