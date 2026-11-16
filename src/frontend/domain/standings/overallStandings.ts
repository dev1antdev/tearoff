import { useMemo } from 'react';
import { useSessionType, useStandingsSnapshot } from '@irdashies/context';
import type { StandingsWidgetSettings } from '@irdashies/types';
import {
  augmentStandingsWithGap,
  augmentStandingsWithInterval,
  type Standings,
} from './createStandings';
import { useDriverStandings } from './useDriverStandings';

/**
 * The whole field as one list, for a table that shows every class together:
 * the Standings' own rows in overall order, each with its gap to the leader
 * of the race and its interval to the car one place ahead of it overall.
 *
 * Nothing is worked out a second way. The rows are `useDriverStandings`',
 * and the gaps are made by the two functions that make a class's, handed
 * the field as if it were one class.
 */

/** What the gap rules read of `standings.snapshot`. */
export interface OverallTiming {
  carIdxLap: number[];
  carIdxLapDistPct: number[];
  carIdxOnPitRoad: boolean[];
  carIdxEstTime: number[];
}

/** A car's place in the field; a car with none goes after those with one. */
const place = (row: Standings): number =>
  typeof row.position === 'number' && row.position > 0
    ? row.position
    : Number.POSITIVE_INFINITY;

/**
 * Outside a race a gap is between best laps, and a row's own figure is
 * against the best lap of its class. For the whole field it has to be
 * against the best lap of anybody.
 */
const againstFieldBest = (rows: Standings[]): Standings[] => {
  let best = Number.POSITIVE_INFINITY;
  for (const row of rows) {
    if (row.fastestTime > 0 && row.fastestTime < best) best = row.fastestTime;
  }
  return rows.map((row) => ({
    ...row,
    delta:
      row.fastestTime > 0 && Number.isFinite(best)
        ? row.fastestTime - best
        : undefined,
  }));
};

/**
 * The class groups of `useDriverStandings` as one list in overall order.
 *
 * In a race a row's time behind the leader of the race is the sim's, and
 * the gap is that. Under Le Mans Ultimate the time is worked out class by
 * class (`src/app/lmu/raceGap.ts`), so across classes it is as good as each
 * class's own pace is steady.
 */
export const buildOverallStandings = (
  groups: readonly (readonly [string, Standings[]])[],
  timing: OverallTiming,
  sessionType: string | undefined
): Standings[] => {
  const rows = groups.flatMap(([, classRows]) => classRows);
  if (rows.length === 0) return rows;
  const ordered = rows
    .map((row, index) => ({ row, index }))
    // Stable: cars with no place keep the order their classes list them in.
    .sort((a, b) => place(a.row) - place(b.row) || a.index - b.index)
    .map(({ row }) => row);
  const prepared = sessionType === 'Race' ? ordered : againstFieldBest(ordered);

  const [[, gapped]] = augmentStandingsWithGap(
    [['all', prepared]],
    timing.carIdxLap,
    timing.carIdxLapDistPct,
    timing.carIdxOnPitRoad,
    timing.carIdxEstTime,
    // Never the class reference laps: a lap of one class does not measure
    // the gap to a car of another.
    false,
    sessionType
  );
  const [[, done]] = augmentStandingsWithInterval(
    [['all', gapped]],
    timing.carIdxLap,
    timing.carIdxLapDistPct,
    true
  );
  return done;
};

// Gap and interval are only worked out when the settings say they are on,
// and the interval of a car more than a lap behind reads in laps. The cast
// is needed because the settings type marks the other fields required.
const FIELD_CONFIG = {
  gap: { enabled: true },
  interval: { enabled: true, displayMode: 'laps' },
} as unknown as StandingsWidgetSettings['config'];

const NO_ROWS: Standings[] = [];
const NO_NUMBERS: number[] = [];
const NO_BOOLEANS: boolean[] = [];

export interface FieldStandings {
  /** Every class with every car of it, as the Standings order them. */
  classes: [string, Standings[]][];
  /** The whole field in overall order; empty while not asked for. */
  overall: Standings[];
  /**
   * Whether each car is parked in its garage, by car index, where the sim
   * says so (Le Mans Ultimate); empty where it does not.
   */
  inGarage: readonly boolean[];
}

/**
 * Every car of the session for a table of the whole field: by class, and,
 * while `overall` is set, as one list as well. The one list is only worked
 * out while it is asked for, so a table showing a class does not pay for
 * it.
 */
export const useFieldStandings = (overall: boolean): FieldStandings => {
  const classes = useDriverStandings(FIELD_CONFIG, { showAll: true });
  const snapshot = useStandingsSnapshot();
  const sessionType = useSessionType(snapshot?.sessionNum ?? undefined);

  const carIdxLap = snapshot?.carIdxLap ?? NO_NUMBERS;
  const carIdxLapDistPct = snapshot?.carIdxLapDistPct ?? NO_NUMBERS;
  const carIdxOnPitRoad = snapshot?.carIdxOnPitRoad ?? NO_BOOLEANS;
  const carIdxEstTime = snapshot?.carIdxEstTime ?? NO_NUMBERS;

  const all = useMemo(
    () =>
      overall
        ? buildOverallStandings(
            classes,
            { carIdxLap, carIdxLapDistPct, carIdxOnPitRoad, carIdxEstTime },
            sessionType
          )
        : NO_ROWS,
    [
      overall,
      classes,
      carIdxLap,
      carIdxLapDistPct,
      carIdxOnPitRoad,
      carIdxEstTime,
      sessionType,
    ]
  );

  return {
    classes,
    overall: all,
    inGarage: snapshot?.carIdxInGarage ?? NO_BOOLEANS,
  };
};
