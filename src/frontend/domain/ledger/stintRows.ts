import type {
  FuelBudget,
  LedgerLap,
  LedgerStint,
  PlayerLedgerSnapshot,
  PlayerStintSnapshot,
  StintClosedBy,
  StintHistoryConfig,
} from '@irdashies/types';
import { formatTime } from '@irdashies/utils/time';
import {
  NO_READING,
  formatFigure,
  formatShare,
  fuelInUnits,
  wheelWear,
} from './ledgerFigures';
import {
  cleanLapsOf,
  lapsOfStint,
  shownLapTime,
  stintTotals,
} from './ledgerRows';

/**
 * The stint history's rows: the stint under way and the ones that are over,
 * each as the figures and marks the table draws. Pure, and the only place
 * the two ledger channels are turned into what that widget shows.
 */

/** The settings that decide which stints are listed and in what units. */
export type StintRowSettings = Pick<
  StintHistoryConfig,
  | 'historyCount'
  | 'showCurrent'
  | 'thisSessionOnly'
  | 'minLaps'
  | 'newestFirst'
  | 'wearMode'
  | 'fuelUnits'
>;

/** How hard a stint was on its tyres, by the wheel that lost the most. */
export type StintWearTone = 'none' | 'caution' | 'bad';

/** One stint as the table draws it. Every figure is ready to print. */
export interface StintRow {
  id: string;
  /** The stint under way, with its figures so far. */
  current: boolean;
  /** The stint's number in its session. */
  ordinal: string;
  /** The driver's surname; '' when the session named nobody. */
  driver: string;
  laps: string;
  /** `m:ss` on track, `h:mm:ss` from an hour. */
  time: string;
  /** What the car runs out of, and so what `used` and `added` count. */
  budget: FuelBudget;
  /** Virtual energy in percent, or fuel in the driver's unit. */
  used: string;
  /** The same for a lap. */
  usedPerLap: string;
  /** Compound name per wheel, LF, RF, LR, RR. */
  compounds: readonly (string | null)[];
  /** Tread worn, in percent. */
  wear: string;
  wearTone: StintWearTone;
  /** Brake disc worn, in millimetres. */
  brakes: string;
  /** The best clean lap. */
  best: string;
  /** That lap is the user's best of its session. */
  sessionBest: boolean;
  /** The best lap over the mean of the other clean laps, in percent. */
  consistency: string;
  /** How the stint ended; null while it is under way. */
  end: StintClosedBy | null;
  /** Seconds in the pit lane at the stop that ended it; '' without one. */
  stopTime: string;
  /** What the stop put in, in the unit of `used`; '' when nothing. */
  added: string;
  tyresChanged: boolean;
  brakesChanged: boolean;
  driverChanged: boolean;
}

/** Tread lost on one wheel above which the wear turns amber, and red. */
const WEAR_CAUTION = 0.3;
const WEAR_BAD = 0.5;

/** A stint's time on track: `m:ss`, and `h:mm:ss` from an hour. */
export const formatStintTime = (seconds: number | null): string => {
  if (seconds === null || !(seconds >= 0)) return NO_READING;
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = String(whole % 60).padStart(2, '0');
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}`
    : `${minutes}:${rest}`;
};

/** Which budget a stint was run on: virtual energy where it had any. */
export const stintBudget = (stint: LedgerStint): FuelBudget =>
  stint.startEnergy !== null ? 'virtualEnergy' : 'fuel';

const surname = (driver: string | null): string =>
  driver?.trim().split(/\s+/).pop() ?? '';

/**
 * What wore over a stint, as one figure. Null where nothing was read, and
 * where nothing moved: a sim that refreshes tread only in the pits reads the
 * same at both ends of a stint, which is no wear figure at all.
 */
const worn = (
  wheels: readonly (number | null)[],
  mode: StintRowSettings['wearMode']
): number | null => {
  const figure = wheelWear(wheels, mode);
  return figure !== null && figure > 0 ? figure : null;
};

const wearTone = (wheels: readonly (number | null)[]): StintWearTone => {
  const highest = wheelWear(wheels, 'highest');
  if (highest === null) return 'none';
  if (highest > WEAR_BAD) return 'bad';
  return highest > WEAR_CAUTION ? 'caution' : 'none';
};

/**
 * The stint's best lap as the lap list shows it: the sim's own time for the
 * best of its clean rows. The record's own best, timed by the app's clock,
 * stands in once rows of the stint have left the ledger.
 */
const bestLapOf = (
  stint: LedgerStint,
  laps: readonly LedgerLap[]
): number | null => {
  const clean = cleanLapsOf(lapsOfStint(laps, stint.id));
  if (clean.length === 0 || clean.length < stint.cleanLaps) {
    return stint.bestLap;
  }
  return Math.min(...clean.map(shownLapTime));
};

const sameLap = (a: number | null, b: number | undefined): boolean =>
  a !== null && b !== undefined && Math.abs(a - b) < 0.001;

interface RowContext {
  laps: readonly LedgerLap[];
  settings: StintRowSettings;
  /** The user's best lap of each session, by session number. */
  sessionBests: ReadonlyMap<number | null, number>;
  /** Per-lap rates of the stint under way, where they are its own. */
  rates: PlayerStintSnapshot['rates'] | null;
}

const rowOf = (
  stint: LedgerStint,
  current: boolean,
  { laps, settings, sessionBests, rates }: RowContext
): StintRow => {
  const totals = stintTotals(stint);
  const budget = stintBudget(stint);
  const energy = budget === 'virtualEnergy';
  const inUnits = (litres: number) => fuelInUnits(litres, settings.fuelUnits);

  // Level against level, so the stretch from the pit exit to the line counts.
  const used = energy
    ? formatShare(totals.energy, 1)
    : formatFigure(totals.fuel === null ? null : inUnits(totals.fuel), 1);
  // For the stint under way, the rate over its clean laps: its total so far
  // holds a part of a lap, which a mean over whole laps would overstate.
  const total = energy ? totals.energy : totals.fuel;
  const rate = current
    ? rates && (energy ? rates.energy : rates.fuel)
    : total !== null && stint.laps > 0
      ? total / stint.laps
      : null;
  const usedPerLap = energy
    ? formatShare(rate, 2)
    : formatFigure(typeof rate === 'number' ? inUnits(rate) : null, 2);

  const best = bestLapOf(stint, laps);
  const stop = stint.stop;
  const put = stop ? (energy ? stop.energyAdded : stop.fuelAdded) : 0;

  return {
    id: stint.id,
    current,
    ordinal: String(stint.ordinal),
    driver: surname(stint.driver),
    laps: String(stint.laps),
    time: formatStintTime(totals.time),
    budget,
    used,
    usedPerLap,
    compounds: stint.compounds,
    wear: formatShare(worn(totals.tread, settings.wearMode), 1),
    wearTone: wearTone(totals.tread),
    brakes: formatFigure(worn(totals.brake, settings.wearMode), 2),
    best: best !== null && best > 0 ? formatTime(best) : NO_READING,
    sessionBest: sameLap(best, sessionBests.get(stint.sessionNum)),
    consistency: formatShare(stint.consistency, 1),
    end: current ? null : stint.closedBy,
    stopTime: stop ? formatFigure(stop.pitLaneTime, 1) : '',
    added:
      put > 0
        ? energy
          ? formatShare(put, 0)
          : formatFigure(inUnits(put), 0)
        : '',
    tyresChanged: (stop?.tyresChanged ?? 0) !== 0,
    brakesChanged: stop?.brakesChanged ?? false,
    driverChanged: stop?.driverChanged ?? false,
  };
};

/**
 * The rows of the stint history, in the order they are drawn.
 *
 * Only the user's own stints: one a team-mate drove is the car's, and while
 * they are at the wheel there is no stint of the user's under way. Finished
 * stints come from the ledger, newest first; the stint under way from the
 * live channel, whose end fields hold the present values.
 */
export const stintRows = (
  ledger: PlayerLedgerSnapshot | undefined,
  live: PlayerStintSnapshot | undefined,
  settings: StintRowSettings
): StintRow[] => {
  const laps = ledger?.laps ?? [];
  const sessionNum = ledger?.sessionNum ?? live?.sessionNum ?? null;
  const inSession = (stint: LedgerStint) => stint.sessionNum === sessionNum;

  const own = (ledger?.stints ?? []).filter((stint) => stint.own);
  const open =
    live?.stint && live.stint.own && inSession(live.stint) ? live.stint : null;

  const sessionBests = new Map<number | null, number>();
  for (const stint of open ? [open, ...own] : own) {
    const best = bestLapOf(stint, laps);
    if (best === null || !(best > 0)) continue;
    const known = sessionBests.get(stint.sessionNum);
    if (known === undefined || best < known) {
      sessionBests.set(stint.sessionNum, best);
    }
  }

  const context: RowContext = {
    laps,
    settings,
    sessionBests,
    rates: live?.rates.source === 'stint' ? live.rates : null,
  };
  const finished = own
    .filter(
      (stint) =>
        stint.laps >= settings.minLaps &&
        (!settings.thisSessionOnly || inSession(stint))
    )
    .slice(0, Math.max(0, settings.historyCount))
    .map((stint) => rowOf(stint, false, context));
  const rows =
    settings.showCurrent && open
      ? [rowOf(open, true, context), ...finished]
      : finished;
  return settings.newestFirst ? rows : rows.reverse();
};
