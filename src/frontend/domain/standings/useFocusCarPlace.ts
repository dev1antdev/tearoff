import { useMemo } from 'react';
import {
  useSessionDrivers,
  useSessionQualifyPositions,
  useSessionQualifyingResults,
  useSessionType,
  useStandingsSelector,
} from '@irdashies/context';
import type { StandingsSnapshot } from '@irdashies/types';
import { classGridChange, overallGridChange } from './classRivals';
import { normalizeQualifyingResults } from './useQualifyingGrid';

/** Where the focus car stands, by the sim's own count. */
export interface FocusCarPlace {
  carIdx: number;
  /** Overall place; 0 where the sim has not ranked the car. */
  position: number;
  /** Place in class; 0 likewise. */
  classPosition: number;
  sessionNum: number | null;
}

const place = (values: readonly number[], carIdx: number): number => {
  const value = values[carIdx];
  return typeof value === 'number' && value > 0 ? value : 0;
};

const selectFocusCarPlace = (
  snapshot: StandingsSnapshot
): FocusCarPlace | null => {
  const carIdx = snapshot.focusCarIdx;
  if (carIdx === null || carIdx < 0) return null;
  return {
    carIdx,
    position: place(snapshot.carIdxPosition, carIdx),
    classPosition: place(snapshot.carIdxClassPosition, carIdx),
    sessionNum: snapshot.sessionNum,
  };
};

const samePlace = (a: FocusCarPlace | null, b: FocusCarPlace | null): boolean =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.carIdx === b.carIdx &&
    a.position === b.position &&
    a.classPosition === b.classPosition &&
    a.sessionNum === b.sessionNum);

/**
 * The focus car's place overall and in class: the car being driven, and
 * while watching, the car the camera is on. Read from each standings
 * snapshot and handed out only when a place or the car changes, so a figure
 * that moves a few times a race does not render five times a second.
 */
export const useFocusCarPlace = (): FocusCarPlace | undefined =>
  useStandingsSelector(selectFocusCarPlace, { equality: samePlace }) ??
  undefined;

/**
 * How many cars are racing: the field the focus car's place is out of. The
 * pace car and spectators are not counted. 0 when the focus car is itself
 * one of those, or not in the session at all: it has no place to show.
 */
export const useFieldSize = (focusCarIdx: number | undefined): number => {
  const drivers = useSessionDrivers();
  return useMemo(() => {
    let size = 0;
    let focusRaces = false;
    for (const driver of drivers ?? []) {
      if (!driver || driver.CarIsPaceCar || driver.IsSpectator) continue;
      size += 1;
      if (driver.CarIdx === focusCarIdx) focusRaces = true;
    }
    return focusRaces ? size : 0;
  }, [drivers, focusCarIdx]);
};

/**
 * Places the focus car has gained (positive) or lost since the grid, in its
 * class or overall. Undefined outside a race, with no grid result for the
 * car, and while it has no place.
 */
export const useGridPlaceChange = (
  scope: 'class' | 'overall'
): number | undefined => {
  const focus = useFocusCarPlace();
  const sessionNum = focus?.sessionNum ?? undefined;
  const sessionType = useSessionType(sessionNum);
  const raw = useSessionQualifyingResults();
  const qualifyPositions = useSessionQualifyPositions(sessionNum);
  const results = useMemo(
    () => normalizeQualifyingResults(raw, qualifyPositions),
    [raw, qualifyPositions]
  );

  if (!focus || sessionType !== 'Race') return undefined;
  return scope === 'overall'
    ? overallGridChange(results, focus.carIdx, focus.position)
    : classGridChange(results, focus.carIdx, focus.classPosition);
};
