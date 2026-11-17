import {
  RACE_FORECAST_MAX_CARS,
  type Driver,
  type RaceForecastCar,
} from '@irdashies/types';

/**
 * Which other cars the Race Charts draw beside our own: the cars around us
 * in class, or up to three the user has named by number.
 */

/** The most cars drawn beside our own. */
export const RACE_CHART_MAX_RIVALS = 3;

/** Why a car is drawn. */
export type ChartRivalRole =
  /** First in our class. */
  | 'leader'
  /** The car a place ahead of us in class. */
  | 'ahead'
  /** The car a place behind us. */
  | 'behind'
  /** Named by its number in the settings. */
  | 'chosen';

export interface ChartRival {
  carIdx: number;
  role: ChartRivalRole;
}

/** What is read of a car of the race forecast. */
export type ForecastPlace = Pick<
  RaceForecastCar,
  'carIdx' | 'own' | 'classPosition'
>;

/**
 * The cars around us in class: the leader, the car ahead and the car
 * behind, in the order of their places. Fewer where two of them are one
 * car, where we lead or are last, and none while the forecast has no cars,
 * which is outside a race and before its start.
 *
 * @param cars The running cars of our class in the order of their places,
 *   as `race-forecast.snapshot` lists them, our own among them.
 */
export const rivalsAround = (cars: readonly ForecastPlace[]): ChartRival[] => {
  const own = cars.findIndex((car) => car.own);
  if (own < 0) return [];
  const rivals: ChartRival[] = [];
  const first = cars[0];
  // The list is the whole class unless the class is larger than the list,
  // which then holds the cars nearest us: its first is the leader where the
  // sim places it first, or places nobody and the list is not cut short.
  const firstLeads =
    first.classPosition === 1 ||
    (first.classPosition === 0 && cars.length < RACE_FORECAST_MAX_CARS);
  if (own > 1 && firstLeads) {
    rivals.push({ carIdx: first.carIdx, role: 'leader' });
  }
  if (own > 0) {
    rivals.push({
      carIdx: cars[own - 1].carIdx,
      // Second in class: the car ahead is the leader, drawn once.
      role: own === 1 && firstLeads ? 'leader' : 'ahead',
    });
  }
  if (own < cars.length - 1) {
    rivals.push({ carIdx: cars[own + 1].carIdx, role: 'behind' });
  }
  return rivals;
};

/**
 * The car numbers typed into the settings, as a list: split at commas,
 * semicolons and spaces, a leading # dropped, a number named twice kept
 * once, and no more than three.
 */
export const parseCarNumbers = (text: string | undefined): string[] => {
  const numbers: string[] = [];
  for (const part of (text ?? '').split(/[\s,;]+/)) {
    const number = part.replace(/^#+/, '');
    if (number && !numbers.includes(number)) numbers.push(number);
  }
  return numbers.slice(0, RACE_CHART_MAX_RIVALS);
};

type NumberedDriver = Pick<
  Driver,
  'CarIdx' | 'CarNumber' | 'CarIsPaceCar' | 'IsSpectator'
>;

/** "07" and "7" are two cars under iRacing; letters are not told apart by case. */
const sameNumber = (a: string, b: string): boolean =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The cars named by number, in the order named. A number no car of the
 * session carries is left out, and so is our own.
 */
export const rivalsChosen = (
  numbers: readonly string[],
  drivers: readonly NumberedDriver[] | undefined,
  ownCarIdx: number | null
): ChartRival[] => {
  const rivals: ChartRival[] = [];
  for (const number of numbers.slice(0, RACE_CHART_MAX_RIVALS)) {
    const driver = (drivers ?? []).find(
      (entry) =>
        entry &&
        !entry.CarIsPaceCar &&
        !entry.IsSpectator &&
        sameNumber(`${entry.CarNumber ?? ''}`, number)
    );
    if (!driver || driver.CarIdx === ownCarIdx) continue;
    if (rivals.some((rival) => rival.carIdx === driver.CarIdx)) continue;
    rivals.push({ carIdx: driver.CarIdx, role: 'chosen' });
  }
  return rivals;
};

/**
 * Which of the three lines each car is drawn with. A car keeps its line for
 * as long as it is drawn, so the car ahead does not change colour when it
 * becomes the car behind; a car that comes in takes the first line free.
 *
 * Hands back `before` itself when nothing has changed, so that it can be
 * kept in state without another render.
 */
export const rivalLines = (
  before: ReadonlyMap<number, number>,
  shown: readonly number[]
): ReadonlyMap<number, number> => {
  const cars = shown.slice(0, RACE_CHART_MAX_RIVALS);
  if (
    cars.length === before.size &&
    cars.every((carIdx) => before.has(carIdx))
  ) {
    return before;
  }
  const lines = new Map<number, number>();
  for (const carIdx of cars) {
    const line = before.get(carIdx);
    if (line !== undefined) lines.set(carIdx, line);
  }
  const taken = new Set(lines.values());
  let free = 0;
  for (const carIdx of cars) {
    if (lines.has(carIdx)) continue;
    while (taken.has(free)) free += 1;
    lines.set(carIdx, free);
    taken.add(free);
  }
  return lines;
};
