import type { Standings } from '@irdashies/domain';
import { isOnOutLap } from '@irdashies/domain/standings/outLap';

/**
 * Which list the timing tower shows and what it says of a car besides its
 * figures: the tabs, the tab it is on, and the tag after a driver's name.
 * Pure: the rows themselves are the Standings', from `useFieldStandings`.
 */

/** The tab of the whole field. A class's tab is the class id as text. */
export const ALL_TAB = 'all';

export interface TowerTab {
  id: string;
  label: string;
  /** The class colour, as the session gives it; none for the whole field. */
  color?: number;
}

/** What the tabs read of a class: `useCarClassStats` has both. */
export interface TowerClassName {
  shortName: string;
  color: number;
}

/**
 * A tab for each class that has a car, in the order the Standings list the
 * classes, and one for the whole field after them. A session of one class
 * has nothing to choose between, and no tabs.
 */
export const towerTabs = (
  classes: readonly (readonly [string, readonly Standings[]])[],
  names: Readonly<Record<string, TowerClassName | undefined>> | undefined
): TowerTab[] => {
  const withCars = classes.filter(([, rows]) => rows.length > 0);
  if (withCars.length < 2) return [];
  return [
    ...withCars.map(([classId, rows]) => ({
      id: classId,
      label: names?.[classId]?.shortName || rows[0].carClass.name || classId,
      color: names?.[classId]?.color ?? rows[0].carClass.color,
    })),
    { id: ALL_TAB, label: 'All' },
  ];
};

/**
 * The tab the tower is on: the one chosen while that still exists, else the
 * class of our own car, else the first.
 *
 * With no tabs it is the one class there is, so that the list is that
 * class's whatever was chosen in a session before.
 */
export const resolveTowerTab = (
  chosen: string | null,
  tabs: readonly TowerTab[],
  ownClassId: string | undefined,
  classes: readonly (readonly [string, readonly Standings[]])[]
): string => {
  if (tabs.length === 0) {
    return classes.find(([, rows]) => rows.length > 0)?.[0] ?? ALL_TAB;
  }
  if (chosen !== null && tabs.some((tab) => tab.id === chosen)) return chosen;
  if (ownClassId !== undefined && tabs.some((tab) => tab.id === ownClassId)) {
    return ownClassId;
  }
  return tabs[0].id;
};

/**
 * What is said of a car after its driver's name. One at a time, the first
 * that holds:
 *
 * - DQ, DNF: the car is out of the race.
 * - GAR: parked in its garage, where the sim says so.
 * - AWAY: not in the world. Under iRacing that is the garage too.
 * - PIT: in the pit lane, moving or at its box.
 * - OUT: on the lap it left the pit lane on.
 */
export type TowerTag = 'DQ' | 'DNF' | 'GAR' | 'AWAY' | 'PIT' | 'OUT';

export const TOWER_TAG_TITLES: Readonly<Record<TowerTag, string>> = {
  DQ: 'Disqualified',
  DNF: 'Retired',
  GAR: 'In its garage',
  AWAY: 'Not in the world: in its garage, or gone from the session',
  PIT: 'In the pit lane',
  OUT: 'On its out-lap',
};

export const towerTag = (
  row: Pick<
    Standings,
    | 'finishState'
    | 'dnf'
    | 'onTrack'
    | 'onPitRoad'
    | 'lastPitLap'
    | 'lastLap'
    | 'carTrackSurface'
  >,
  inGarage: boolean,
  pitExitAfterSF: boolean
): TowerTag | null => {
  if (row.finishState === 'DQ') return 'DQ';
  if (row.finishState === 'DNF' || row.dnf) return 'DNF';
  if (inGarage) return 'GAR';
  if (!row.onTrack) return 'AWAY';
  if (row.onPitRoad) return 'PIT';
  return isOnOutLap({
    onPitRoad: row.onPitRoad,
    lastPitLap: row.lastPitLap,
    lastLap: row.lastLap,
    pitExitAfterSF,
    carTrackSurface: row.carTrackSurface,
  })
    ? 'OUT'
    : null;
};
