import type { Driver, StandingsSnapshot } from '@irdashies/types';

/**
 * Who a car's class neighbours are: one rule, for the renderer's rivals box
 * and for the main process's finish projection, so that the two never name
 * different cars.
 *
 * Pure, and free of both sides: it reads the session's driver list and the
 * positions of `standings.snapshot`.
 */

/** Car indices, or -1 where there is no such car. */
export interface ClassNeighbours {
  ahead: number;
  behind: number;
  leader: number;
}

const NO_NEIGHBOURS: ClassNeighbours = { ahead: -1, behind: -1, leader: -1 };

/**
 * Each car's class, or undefined for a slot that is not racing: the pace
 * car, a spectator, an empty slot. Indexed by CarIdx.
 */
export const classIdsByCar = (
  drivers: readonly Driver[] | undefined
): (number | undefined)[] => {
  const classes: (number | undefined)[] = [];
  for (const driver of drivers ?? []) {
    if (!driver || driver.CarIsPaceCar || driver.IsSpectator) continue;
    classes[driver.CarIdx] = driver.CarClassID;
  }
  return classes;
};

/**
 * Each car's place in its class: the live one, worked out from where the
 * cars are on the road, where the snapshot has it, and the sim's own
 * otherwise. Outside a race there is no live order and the sim's stands.
 */
export const classPositionsByCar = (
  snapshot: Pick<StandingsSnapshot, 'liveClassPosition' | 'carIdxClassPosition'>
): (number | undefined)[] => {
  const length = Math.max(
    snapshot.liveClassPosition.length,
    snapshot.carIdxClassPosition.length
  );
  const positions: (number | undefined)[] = new Array(length);
  for (let carIdx = 0; carIdx < length; carIdx += 1) {
    positions[carIdx] =
      snapshot.liveClassPosition[carIdx] ??
      snapshot.carIdxClassPosition[carIdx];
  }
  return positions;
};

const isPlace = (value: number | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

/**
 * The focus car's neighbours in its class: the car one place ahead, the car
 * one place behind, and the class leader.
 *
 * One pass, no sort. A car with no place (0 or undefined) and a car with no
 * class (the pace car, a spectator) is never a neighbour. There is no filter
 * for a car in the pits or in its garage: while it holds the place it is the
 * car to beat.
 */
export const classNeighbours = (
  focusCarIdx: number,
  classIdByCar: readonly (number | undefined)[],
  classPositionByCar: readonly (number | undefined)[]
): ClassNeighbours => {
  const classId = classIdByCar[focusCarIdx];
  if (classId === undefined) return NO_NEIGHBOURS;
  const focusPlace = classPositionByCar[focusCarIdx];
  const found = { ...NO_NEIGHBOURS };
  for (let carIdx = 0; carIdx < classPositionByCar.length; carIdx += 1) {
    if (classIdByCar[carIdx] !== classId) continue;
    const place = classPositionByCar[carIdx];
    if (!isPlace(place)) continue;
    if (place === 1) found.leader = carIdx;
    if (!isPlace(focusPlace) || carIdx === focusCarIdx) continue;
    if (place === focusPlace - 1) found.ahead = carIdx;
    else if (place === focusPlace + 1) found.behind = carIdx;
  }
  return found;
};

export interface ClassNeighbourhood {
  /** Car indices, the nearest place ahead first. */
  ahead: number[];
  /** Car indices, the nearest place behind first. */
  behind: number[];
}

export interface ClassNeighbourhoodOptions {
  /** The most cars wanted on each side. */
  ahead: number;
  behind: number;
  /**
   * Leaves a car out, and the next one along takes its row: a car that has
   * retired holds its place to the flag and is nobody's race. Every car
   * with a place counts without it, as for `classNeighbours`.
   */
  isRunning?: (carIdx: number) => boolean;
}

/**
 * The cars around the focus car in its class, several places each way: the
 * same class and the same places `classNeighbours` goes by, further out.
 */
export const classNeighbourhood = (
  focusCarIdx: number,
  classIdByCar: readonly (number | undefined)[],
  classPositionByCar: readonly (number | undefined)[],
  { ahead, behind, isRunning }: ClassNeighbourhoodOptions
): ClassNeighbourhood => {
  const found: ClassNeighbourhood = { ahead: [], behind: [] };
  const classId = classIdByCar[focusCarIdx];
  const focusPlace = classPositionByCar[focusCarIdx];
  if (classId === undefined || !isPlace(focusPlace)) return found;
  for (let carIdx = 0; carIdx < classPositionByCar.length; carIdx += 1) {
    if (carIdx === focusCarIdx || classIdByCar[carIdx] !== classId) continue;
    const place = classPositionByCar[carIdx];
    if (!isPlace(place) || place === focusPlace) continue;
    if (isRunning && !isRunning(carIdx)) continue;
    (place < focusPlace ? found.ahead : found.behind).push(carIdx);
  }
  const placeOf = (carIdx: number): number => classPositionByCar[carIdx] ?? 0;
  found.ahead.sort((a, b) => placeOf(b) - placeOf(a));
  found.behind.sort((a, b) => placeOf(a) - placeOf(b));
  found.ahead.length = Math.min(found.ahead.length, Math.max(0, ahead));
  found.behind.length = Math.min(found.behind.length, Math.max(0, behind));
  return found;
};
