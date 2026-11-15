import { useCallback, useMemo } from 'react';
import { useSessionDrivers, useStandingsSelector } from '@irdashies/context';
import {
  LMU_FINISH_STATUS,
  SessionState,
  TrackLocation,
  type Driver,
  type StandingsSnapshot,
} from '@irdashies/types';
import { getCarClassDisplayName } from './getCarClassDisplayName';

/** One class of the field: who is entered, who is still running. */
export interface ClassField {
  classId: number;
  /** Display name, as the standings' class header prints it. */
  name: string;
  /** 0xRRGGBB, the session's class colour. */
  color: number;
  /** Cars entered in the class. */
  total: number;
  /** Cars still running: total minus garage, not-in-world, DNF and DQ. */
  active: number;
  /** Active cars in the pit lane or stopped at their box. */
  inPitLane: number;
  /** Best overall place in the class; 0 when no car has a place. */
  leaderPosition: number;
  /** The focus car's class. */
  isFocusClass: boolean;
}

/**
 * How the classes are ordered: by the overall place of each class's leader,
 * or fastest class first, as the standings list them.
 */
export type ClassFieldsOrder = 'leaderPosition' | 'classSpeed';

/** What the summary reads of `standings.snapshot`. */
export type ClassFieldsSnapshot = Pick<
  StandingsSnapshot,
  | 'carIdxPosition'
  | 'carIdxTrackSurface'
  | 'carIdxOnPitRoad'
  | 'carIdxFinishStatus'
  | 'carIdxInGarage'
  | 'focusCarIdx'
  | 'sessionState'
>;

interface ClassTally {
  classId: number;
  drivers: Driver[];
  relSpeed: number;
  active: number;
  inPitLane: number;
  leaderPosition: number;
}

/**
 * Whether a car is out of the running.
 *
 * Retired or disqualified, in its garage stall, or not in the world. A car
 * stopped at its pit box is running. A car the snapshot has no surface for is
 * taken as running: "no reading" is not "gone", and a class should not read
 * 0/14 in the moment before the first snapshot arrives.
 *
 * Under iRacing there is no garage flag and "not in the world" covers both a
 * driver who has left and one sitting in the garage. Under LMU the garage
 * flag is what tells a garage stall from a stop at the box, which the track
 * surface alone cannot.
 *
 * The end of the session is not a retirement. A car the sim says has
 * finished has run its race wherever it is parked afterwards, and once the
 * chequered flag is out a car leaving the world is going home: without
 * these two the final classification would read 0/14 for every class.
 */
const isOutOfRunning = (
  snapshot: ClassFieldsSnapshot,
  carIdx: number
): boolean => {
  const finish = snapshot.carIdxFinishStatus[carIdx];
  if (finish === LMU_FINISH_STATUS.finished) return false;
  if (finish === LMU_FINISH_STATUS.dnf || finish === LMU_FINISH_STATUS.dq) {
    return true;
  }
  if (snapshot.carIdxInGarage[carIdx] === true) return true;
  return (
    snapshot.carIdxTrackSurface[carIdx] === TrackLocation.NotInWorld &&
    snapshot.sessionState < SessionState.Checkered
  );
};

const isInPitLane = (snapshot: ClassFieldsSnapshot, carIdx: number): boolean =>
  snapshot.carIdxOnPitRoad[carIdx] === true ||
  snapshot.carIdxTrackSurface[carIdx] === TrackLocation.InPitStall;

/** A class with no placed car sorts after every class that has one. */
const placeForOrder = (field: ClassTally): number =>
  field.leaderPosition > 0 ? field.leaderPosition : Number.POSITIVE_INFINITY;

/**
 * The field at a glance: per class the cars entered, the cars still running,
 * the cars in the pit lane and the overall place of the class leader.
 *
 * Pure, and stateless: everything comes from the session's driver list and
 * one standings snapshot. The pace car and spectators are not counted.
 */
export const summariseClassFields = (
  drivers: readonly Driver[],
  snapshot: ClassFieldsSnapshot,
  order: ClassFieldsOrder = 'leaderPosition'
): ClassField[] => {
  const tallies = new Map<number, ClassTally>();
  let focusClassId: number | undefined;

  for (const driver of drivers) {
    if (driver.CarIsPaceCar || driver.IsSpectator) continue;
    const classId = driver.CarClassID;
    let tally = tallies.get(classId);
    if (!tally) {
      tally = {
        classId,
        drivers: [],
        relSpeed: driver.CarClassRelSpeed ?? 0,
        active: 0,
        inPitLane: 0,
        leaderPosition: 0,
      };
      tallies.set(classId, tally);
    }
    tally.drivers.push(driver);

    const carIdx = driver.CarIdx;
    if (carIdx === snapshot.focusCarIdx) focusClassId = classId;
    if (!isOutOfRunning(snapshot, carIdx)) {
      tally.active += 1;
      if (isInPitLane(snapshot, carIdx)) tally.inPitLane += 1;
    }
    const place = snapshot.carIdxPosition[carIdx];
    if (
      place > 0 &&
      (tally.leaderPosition === 0 || place < tally.leaderPosition)
    ) {
      tally.leaderPosition = place;
    }
  }

  const sorted = [...tallies.values()].sort((a, b) =>
    order === 'classSpeed'
      ? b.relSpeed - a.relSpeed || a.classId - b.classId
      : placeForOrder(a) === placeForOrder(b)
        ? a.classId - b.classId
        : placeForOrder(a) - placeForOrder(b)
  );

  return sorted.map((tally) => ({
    classId: tally.classId,
    name: getCarClassDisplayName(tally.classId, tally.drivers),
    color: tally.drivers[0].CarClassColor,
    total: tally.drivers.length,
    active: tally.active,
    inPitLane: tally.inPitLane,
    leaderPosition: tally.leaderPosition,
    isFocusClass: tally.classId === focusClassId,
  }));
};

/**
 * The first `maxClasses` classes, with the focus car's class always among
 * them: when it would fall off the end it takes the last place shown.
 */
export const limitClassFields = (
  fields: readonly ClassField[],
  maxClasses: number
): ClassField[] => {
  const limit = Math.max(1, Math.floor(maxClasses));
  if (fields.length <= limit) return [...fields];
  const shown = fields.slice(0, limit);
  const focus = fields.find((field) => field.isFocusClass);
  if (focus && !shown.includes(focus)) shown[limit - 1] = focus;
  return shown;
};

const classFieldEqual = (a: ClassField, b: ClassField): boolean =>
  a.classId === b.classId &&
  a.name === b.name &&
  a.color === b.color &&
  a.total === b.total &&
  a.active === b.active &&
  a.inPitLane === b.inPitLane &&
  a.leaderPosition === b.leaderPosition &&
  a.isFocusClass === b.isFocusClass;

/** Structural: two summaries that would draw the same are the same. */
export const classFieldsEqual = (
  a: readonly ClassField[],
  b: readonly ClassField[]
): boolean =>
  a.length === b.length &&
  a.every((field, index) => classFieldEqual(field, b[index]));

const NO_DRIVERS: readonly Driver[] = [];
const NO_SNAPSHOT: ClassFieldsSnapshot = {
  carIdxPosition: [],
  carIdxTrackSurface: [],
  carIdxOnPitRoad: [],
  carIdxFinishStatus: [],
  carIdxInGarage: [],
  focusCarIdx: null,
  sessionState: 0,
};

/**
 * The class summary of the running session, re-read from each standings
 * snapshot (5 Hz) and handed out only when a count, a place or the order has
 * changed.
 *
 * Nothing to reset: the summary keeps no state, and the snapshot it reads
 * empties on a session change and on disconnect. Before the first snapshot
 * the classes are listed from the session alone, every car taken as running.
 */
export const useClassFields = (
  order: ClassFieldsOrder = 'leaderPosition',
  enabled = true
): ClassField[] => {
  const drivers = useSessionDrivers() ?? NO_DRIVERS;
  const selector = useCallback(
    (snapshot: StandingsSnapshot) =>
      summariseClassFields(drivers, snapshot, order),
    [drivers, order]
  );
  const live = useStandingsSelector(selector, {
    equality: classFieldsEqual,
    enabled,
  });
  const fromSession = useMemo(
    () => summariseClassFields(drivers, NO_SNAPSHOT, order),
    [drivers, order]
  );
  return live ?? fromSession;
};
