import { useCallback, useMemo, useState } from 'react';
import { shallow } from 'zustand/shallow';
import {
  useChannelSelector,
  useDriverCarIdx,
  useSessionDrivers,
  useStandingsSelector,
  useTrackStateSelector,
} from '@irdashies/context';
import { carStintPaceDelta } from '@irdashies/shared';
import type {
  RaceHistorySummarySnapshot,
  StandingsSnapshot,
  TrackStateSnapshot,
} from '@irdashies/types';
import { sessionBestLapTime } from '../lapTiming/sessionBest';
import { carChoices, chosenCar, type CarChoice } from './carChoice';

/**
 * What a panel about one car reads besides that car's records: which car it
 * is about, how its record stands, and the two figures of the session a
 * record is read against.
 */

/**
 * Every car's place and place in class as one string. The snapshot comes
 * again every time a car moves a metre, and the places a few times a race.
 */
const selectPlaces = (snapshot: StandingsSnapshot): string =>
  `${snapshot.carIdxPosition.join(',')}|${snapshot.carIdxClassPosition.join(',')}`;

const placesOf = (text: string | undefined): (number[] | undefined)[] =>
  text
    ? text.split('|').map((part) => (part ? part.split(',').map(Number) : []))
    : [undefined, undefined];

export interface CarChoiceState {
  /** Every car that can be chosen, in the order offered. */
  choices: CarChoice[];
  /** The car shown; null while the session has none. */
  car: CarChoice | null;
  choose: (carIdx: number) => void;
}

/**
 * The car a panel is about: our own entry until another is chosen. Our own
 * is the one the user drives or shares, which stays ours while a team-mate
 * drives it and while the camera is on somebody else.
 *
 * The choice is kept for as long as the panel is on screen and no longer: a
 * panel hosted on the Pit Wall has no way to save, and one on the overlay
 * is not asked to.
 */
export const useCarChoice = (): CarChoiceState => {
  const drivers = useSessionDrivers();
  const ownCarIdx = useDriverCarIdx();
  const places = useStandingsSelector(selectPlaces);
  const [chosen, setChosen] = useState<number | null>(null);

  const choices = useMemo(() => {
    const [positions, classPositions] = placesOf(places);
    return carChoices(drivers, ownCarIdx, positions, classPositions);
  }, [drivers, ownCarIdx, places]);
  const car = useMemo(() => chosenCar(choices, chosen), [choices, chosen]);

  return { choices, car, choose: setChosen };
};

/** How one car's record stands, from the race history's summary. */
export interface CarHistoryState {
  /** A race is being recorded. */
  recording: boolean;
  /** Laps the car has completed that are not held. */
  missingLaps: number;
  /**
   * The mean clean lap of the stint under way less that of the most recent
   * stint somebody else drove, seconds: negative is quicker. Null until the
   * stint has three clean laps, and with no such stint to hold it against.
   */
  paceDelta: number | null;
  /** Who drove that stint; '' with none. */
  paceAgainst: string;
}

const NO_HISTORY: CarHistoryState = {
  recording: false,
  missingLaps: 0,
  paceDelta: null,
  paceAgainst: '',
};

/**
 * One car's line of `race-history.summary`. Reading it is what has the race
 * recorded, so nothing is read while `carIdx` is null.
 */
export const useCarHistoryState = (carIdx: number | null): CarHistoryState => {
  const select = useCallback(
    (summary: RaceHistorySummarySnapshot): CarHistoryState =>
      carIdx === null
        ? NO_HISTORY
        : {
            recording: summary.raceToken !== '',
            missingLaps: summary.missingLaps[carIdx] ?? 0,
            // By the timing tower's own rule, against the previous driver.
            paceDelta: carStintPaceDelta(summary, carIdx, 'driver'),
            paceAgainst: summary.previousDriverStintDriver[carIdx] ?? '',
          },
    [carIdx]
  );
  return (
    useChannelSelector('race-history.summary', select, {
      enabled: carIdx !== null,
      equality: shallow,
    }) ?? NO_HISTORY
  );
};

/**
 * The best lap of a car's class in the session, as the sim has it, seconds;
 * null where no car of the class has one.
 */
export const useClassBestLap = (
  carIdx: number | null,
  enabled = true
): number | null => {
  const drivers = useSessionDrivers();
  const carIdxClass = useMemo(() => {
    const classes: (number | undefined)[] = [];
    for (const driver of drivers ?? []) {
      if (driver) classes[driver.CarIdx] = driver.CarClassID;
    }
    return classes;
  }, [drivers]);
  const select = useCallback(
    (snapshot: StandingsSnapshot): number | null =>
      carIdx === null
        ? null
        : sessionBestLapTime({
            carIdxBestLapTime: snapshot.carIdxBestLapTime,
            carIdxClass,
            playerCarIdx: carIdx,
            scope: 'class',
          }),
    [carIdx, carIdxClass]
  );
  return (
    useStandingsSelector(select, { enabled: enabled && carIdx !== null }) ??
    null
  );
};

/** The session clock to the minute: a drive time is printed in minutes. */
const selectClockMinute = (snapshot: TrackStateSnapshot): number | null =>
  Number.isFinite(snapshot.sessionTime)
    ? Math.floor(snapshot.sessionTime / 60) * 60
    : null;

/** The session clock in seconds, moving once a minute; null while unknown. */
export const useSessionClockMinute = (): number | null =>
  useTrackStateSelector(selectClockMinute) ?? null;
