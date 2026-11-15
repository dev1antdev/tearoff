import type { FuelProjectionSnapshot } from '@irdashies/types';
import { averageLapUsage } from './averageUsage';

/**
 * The fuel saver's table: what a lap may cost for the fuel or the energy to
 * last one lap more, or one fewer, and what it would take to drop a stop.
 *
 * Pure, and in the budget's own unit throughout: litres or gallons for a
 * car on fuel, percent for one on virtual energy. The widget only draws it.
 */

export interface SaverInput {
  /** Level now and use so far this lap, in the budget's unit (L or %). */
  level: number;
  usedThisLap: number;
  /** Consumption per lap the targets are compared with. */
  perLap: number;
  /** Kept back, same unit. */
  reserve: number;
  /** Share of a lap between pit entry and the line, 0 when not applied. */
  pitEntryShare: number;
  stintLapsDone: number;
  fewerLaps: number;
  moreLaps: number;
  /** For the stop target: null outside a race or without an estimate. */
  lapsLeftInRace: number | null;
  capacity: number | null;
}

export interface SaverColumn {
  /** Laps from the start of this lap. */
  laps: number;
  /** Stint length in laps if the budget lasts that long. */
  stintLaps: number;
  /** Consumption per lap that makes it last, and how far above it we are. */
  target: number;
  saving: number;
  isCurrent: boolean;
}

export interface SaverResult {
  columns: readonly SaverColumn[];
  /** Null when no further stop is needed or there is no race estimate. */
  stopTarget: {
    stopsNow: number;
    target: number;
    saving: number;
    /** saving / perLap. */
    savingShare: number;
  } | null;
}

const NO_TABLE: SaverResult = { columns: [], stopTarget: null };

/** What is left to drive on, counted from the start of the lap under way. */
const remainingOf = (input: SaverInput): number =>
  Math.max(
    0,
    input.level +
      input.usedThisLap -
      input.reserve +
      input.pitEntryShare * input.perLap
  );

const stopTargetOf = (
  input: SaverInput,
  remaining: number
): SaverResult['stopTarget'] => {
  const { lapsLeftInRace, capacity, perLap, level } = input;
  if (lapsLeftInRace === null || capacity === null) return null;
  if (!(lapsLeftInRace > 0) || !(capacity > 0)) return null;
  const need = lapsLeftInRace * perLap - level;
  if (!(need > 0)) return null;
  // What is still in the car when the stint ends cannot be filled again.
  const leftover = remaining % perLap;
  const perStop = capacity - leftover;
  if (!(perStop > 0)) return null;
  const stopsNow = Math.ceil(need / perStop);
  const target = ((stopsNow - 1) * capacity + level) / lapsLeftInRace;
  const saving = perLap - target;
  return { stopsNow, target, saving, savingShare: saving / perLap };
};

/**
 * The table. Without a consumption figure there is none.
 *
 * The laps the budget lasts are counted from the start of the lap under
 * way, so the columns stand still through the lap; the quotient is rounded
 * to a tenth before it is cut to whole laps, which stops them flickering
 * when it sits just under one.
 */
export const computeSaverTable = (input: SaverInput): SaverResult => {
  const { perLap } = input;
  if (!(perLap > 0) || !Number.isFinite(perLap)) return NO_TABLE;
  const remaining = remainingOf(input);
  const whole = Math.floor(Math.round((remaining / perLap) * 10) / 10);

  const columns: SaverColumn[] = [];
  for (let offset = -input.fewerLaps; offset <= input.moreLaps; offset += 1) {
    const laps = whole + offset;
    if (laps < 1) continue;
    const target = remaining / laps;
    columns.push({
      laps,
      stintLaps: input.stintLapsDone + laps,
      target,
      saving: perLap - target,
      isCurrent: offset === 0,
    });
  }
  return { columns, stopTarget: stopTargetOf(input, remaining) };
};

export type SaverBasis = 'projected' | 'last' | 'average';

/** The lap is far enough on for its own projection to mean something. */
const PROJECTION_FROM_PCT = 0.05;

/**
 * The consumption per lap the targets are compared with, in the unit the
 * projection counts in; 0 when there is none yet.
 *
 * `projected` follows the lap under way, so lifting and coasting shows
 * before the line: the projection once the lap is five per cent done, else
 * the last lap, else the average. `average` leaves out laps through the
 * pits.
 */
export const saverPerLap = (
  fuel: Pick<
    FuelProjectionSnapshot,
    'projectedLapUsage' | 'lastLapUsage' | 'lapDistPct' | 'completedLaps'
  >,
  basis: SaverBasis,
  averageLaps: number
): number => {
  const average = () =>
    averageLapUsage(fuel.completedLaps, {
      laps: averageLaps,
      excludePitLaps: true,
    });
  if (basis === 'last') return fuel.lastLapUsage > 0 ? fuel.lastLapUsage : 0;
  if (basis === 'average') return average();
  if (fuel.lapDistPct >= PROJECTION_FROM_PCT && fuel.projectedLapUsage > 0) {
    return fuel.projectedLapUsage;
  }
  return fuel.lastLapUsage > 0 ? fuel.lastLapUsage : average();
};

/** How a saving is to be read against what the car is using now. */
export type SavingTone = 'inside' | 'reachable' | 'outOfReach';

/**
 * A saving of zero or less is already inside the target; one within
 * `reachShare` per cent of current use can be driven for; more cannot.
 */
export const savingTone = (
  saving: number,
  perLap: number,
  reachShare: number
): SavingTone => {
  if (!(saving > 0)) return 'inside';
  return perLap > 0 && saving / perLap <= reachShare / 100
    ? 'reachable'
    : 'outOfReach';
};

/** More than this share of current use is saved by no driving style. */
export const STOP_TARGET_MAX_SHARE = 0.5;

/** Litres in a US gallon. */
export const LITRES_PER_GALLON = 3.785411784;
