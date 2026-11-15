import type { Session } from '@irdashies/types';

/** What a processor needs to know about the class of one car slot. */
export interface CarClassEntry {
  /** The session's class id for the car. */
  classId: number;
  /** CarClassRelSpeed: higher is faster; 0 where the sim states none. */
  relSpeed: number;
  /** The class's estimated lap, seconds; 0 where the sim states none. */
  estLapTime: number;
}

/**
 * Class facts per car slot, from the session's driver list.
 *
 * A sparse array indexed by CarIdx: a slot the session does not list is
 * absent, and every reader below treats an absent slot as "class unknown".
 */
export const carClassesFrom = (
  session: Session | null | undefined
): CarClassEntry[] => {
  const classes: CarClassEntry[] = [];
  for (const driver of session?.DriverInfo?.Drivers ?? []) {
    if (typeof driver.CarIdx !== 'number' || driver.CarIdx < 0) continue;
    classes[driver.CarIdx] = {
      classId: driver.CarClassID,
      relSpeed: driver.CarClassRelSpeed > 0 ? driver.CarClassRelSpeed : 0,
      estLapTime: driver.CarClassEstLapTime > 0 ? driver.CarClassEstLapTime : 0,
    };
  }
  return classes;
};

/**
 * The single rule for "a faster class": the session's CarClassRelSpeed where
 * both cars have one, else the class's estimated lap. Cars of one class are
 * never faster than each other, whatever their figures say.
 */
export const isFasterClass = (
  classes: readonly (CarClassEntry | undefined)[],
  carIdx: number,
  thanCarIdx: number
): boolean => {
  const car = classes[carIdx];
  const than = classes[thanCarIdx];
  if (!car || !than || car.classId === than.classId) return false;
  if (car.relSpeed > 0 && than.relSpeed > 0) {
    return car.relSpeed > than.relSpeed;
  }
  if (car.estLapTime > 0 && than.estLapTime > 0) {
    return car.estLapTime < than.estLapTime;
  }
  return false;
};
