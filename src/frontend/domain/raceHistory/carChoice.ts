import type { Driver } from '@irdashies/types';

/**
 * The cars a panel about one car can be pointed at, in the order they are
 * offered: our own first, then the cars of our class by place, then
 * everybody else.
 */

export type CarChoiceGroup =
  /** Our own entry. */
  | 'own'
  /** A car of our class. */
  | 'class'
  /** A car of another class; every car, where we have none. */
  | 'rest';

export interface CarChoice {
  carIdx: number;
  number: string;
  /** Who runs it: the team where the session names one, else the driver. */
  name: string;
  className: string;
  group: CarChoiceGroup;
}

type ChoiceDriver = Pick<
  Driver,
  | 'CarIdx'
  | 'CarNumber'
  | 'CarNumberRaw'
  | 'UserName'
  | 'TeamName'
  | 'CarClassID'
  | 'CarClassShortName'
  | 'CarIsPaceCar'
  | 'IsSpectator'
>;

/** A place the sim has given; a car with none goes after those with one. */
const placeAt = (
  places: readonly number[] | undefined,
  carIdx: number
): number => {
  const place = places?.[carIdx];
  return typeof place === 'number' && place > 0
    ? place
    : Number.POSITIVE_INFINITY;
};

const byPlace =
  (places: readonly number[] | undefined) =>
  (a: ChoiceDriver, b: ChoiceDriver): number =>
    placeAt(places, a.CarIdx) - placeAt(places, b.CarIdx) ||
    // Cars the sim has not placed, by number.
    (a.CarNumberRaw ?? 0) - (b.CarNumberRaw ?? 0) ||
    a.CarIdx - b.CarIdx;

const choiceOf = (driver: ChoiceDriver, group: CarChoiceGroup): CarChoice => ({
  carIdx: driver.CarIdx,
  number: `${driver.CarNumber ?? ''}`,
  name: driver.TeamName || `${driver.UserName ?? ''}`,
  className: driver.CarClassShortName ?? '',
  group,
});

/**
 * Every car of the session that races, in the order it is offered.
 *
 * @param positions Overall places by car index, 0 where the sim has none.
 * @param classPositions Places in class, likewise.
 */
export const carChoices = (
  drivers: readonly ChoiceDriver[] | undefined,
  ownCarIdx: number | undefined,
  positions: readonly number[] | undefined,
  classPositions: readonly number[] | undefined
): CarChoice[] => {
  const racing = (drivers ?? []).filter(
    (driver) => driver && !driver.CarIsPaceCar && !driver.IsSpectator
  );
  const own = racing.find((driver) => driver.CarIdx === ownCarIdx);
  if (!own) {
    return [...racing]
      .sort(byPlace(positions))
      .map((driver) => choiceOf(driver, 'rest'));
  }
  const others = racing.filter((driver) => driver !== own);
  return [
    choiceOf(own, 'own'),
    ...others
      .filter((driver) => driver.CarClassID === own.CarClassID)
      .sort(byPlace(classPositions))
      .map((driver) => choiceOf(driver, 'class')),
    ...others
      .filter((driver) => driver.CarClassID !== own.CarClassID)
      .sort(byPlace(positions))
      .map((driver) => choiceOf(driver, 'rest')),
  ];
};

/**
 * The car a panel shows: the one chosen while it is still in the session,
 * else our own, else the first there is. Null with no car at all.
 */
export const chosenCar = (
  choices: readonly CarChoice[],
  chosen: number | null
): CarChoice | null =>
  choices.find((choice) => choice.carIdx === chosen) ?? choices[0] ?? null;
