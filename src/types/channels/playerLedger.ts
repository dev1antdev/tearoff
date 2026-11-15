import type { LedgerLap, LedgerStint } from '../ledger';
import type { FuelBudget } from './channel';

/**
 * The two channels of the player's ledger, published by `PlayerLedgerRuntime`
 * whether or not a widget is on screen: the laps and stints that are over,
 * and the stint that is under way.
 */

/** The most rows `player-ledger.snapshot` carries, newest first. */
export const PLAYER_LEDGER_MAX_LAPS = 120;
/** The most closed stints it carries, newest first. */
export const PLAYER_LEDGER_MAX_STINTS = 40;

/**
 * Every lap the player's car completed in this connection and every stint
 * that has ended. The version moves only when a row or a stint is added or
 * patched, which is once or twice a lap.
 */
export interface PlayerLedgerSnapshot {
  /** Newest first, at most 120. Practice, qualifying and race share it. */
  laps: readonly LedgerLap[];
  /** Closed stints, newest first, at most 40. */
  stints: readonly LedgerStint[];
  sessionNum: number | null;
  version: number;
}

/** Where a per-lap rate was taken from. */
export type LedgerRateSource = 'stint' | 'session' | 'baseline';

/**
 * The stint under way. Stint time is rounded to whole seconds, litres to
 * 0.01, energy to 0.0001 and tread to 0.001, so the version moves about once
 * a second while driving.
 */
export interface PlayerStintSnapshot {
  /** False with no player car: monitor, spectating, a replay file. */
  available: boolean;
  state: 'idle' | 'running' | 'inPits';
  /** Which budget ends this car's stints. */
  budget: FuelBudget;
  /** The open stint, with its end fields holding the present values. */
  stint: LedgerStint | null;
  /** The lap under way. */
  lap: {
    lapNumber: number | null;
    /** The stint lap the next line crossing completes. */
    stintLap: number;
    /** Litres and energy fraction burned so far this lap. */
    fuelUsed: number | null;
    energyUsed: number | null;
    /**
     * Tread worn on track so far this lap, LF, RF, LR, RR, 0..1, rounded to
     * 0.001; null for a wheel without a live reading, which is every wheel
     * under iRacing. Absent from a snapshot with no lap under way.
     */
    treadUsed?: readonly (number | null)[];
    /** LEDGER_LAP_* bits so far. */
    flags: number;
  };
  /** Per-lap rates: litres, energy fraction, seconds. */
  rates: {
    fuel: number | null;
    energy: number | null;
    lapTime: number | null;
    source: LedgerRateSource | null;
  };
  /** Laps until fuel or energy runs out at those rates, whichever is first. */
  budgetLapsLeft: number | null;
  sessionNum: number | null;
  version: number;
}

export const EMPTY_PLAYER_LEDGER: PlayerLedgerSnapshot = {
  laps: [],
  stints: [],
  sessionNum: null,
  version: 0,
};

export const EMPTY_PLAYER_STINT: PlayerStintSnapshot = {
  available: false,
  state: 'idle',
  budget: 'fuel',
  stint: null,
  lap: {
    lapNumber: null,
    stintLap: 1,
    fuelUsed: null,
    energyUsed: null,
    flags: 0,
  },
  rates: { fuel: null, energy: null, lapTime: null, source: null },
  budgetLapsLeft: null,
  sessionNum: null,
  version: 0,
};
