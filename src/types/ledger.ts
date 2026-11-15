/**
 * The player's per-lap ledger and stints: what each lap cost, and the runs
 * between two services. Shared by the main process, which measures and
 * stores them, and the renderer that shows them.
 *
 * These are the records. The lap library keeps them for good
 * (`src/app/storage/lapLibrary/`, tables `lap_ledger` and `stint`); the
 * runtime that fills them is `PlayerLedgerRuntime`.
 */

export const LEDGER_LAP_IN_LAP = 1 << 0; // went onto pit road during the lap
export const LEDGER_LAP_OUT_LAP = 1 << 1; // began on pit road
export const LEDGER_LAP_VOIDED = 1 << 2; // the sim voided it (LMU track limits)
export const LEDGER_LAP_INCIDENT = 1 << 3; // incident points, off track or a tow (iRacing)
export const LEDGER_LAP_YELLOW = 1 << 4; // a local or sector yellow was shown
export const LEDGER_LAP_CAUTION = 1 << 5; // full-course yellow or safety car
export const LEDGER_LAP_BLUE = 1 << 6; // the player was shown a blue flag
export const LEDGER_LAP_WET = 1 << 7; // wetness reached "very lightly wet", or declared wet
export const LEDGER_LAP_NOT_OWN = 1 << 8; // the player was not at the wheel throughout
export const LEDGER_LAP_FROM_START = 1 << 9; // opened by leaving the grid, not by a crossing
export const LEDGER_LAP_SERVICED = 1 << 10; // fuel, energy or tyres changed during it

/** One lap of the player's car and what it cost. */
export interface LedgerLap {
  /** Lap library row id; 0 while unsaved (tape, demo, storage unavailable). */
  id: number;
  /** The stint that was open when the lap closed: its `LedgerStint.id`. */
  stintId: string;
  sessionNum: number | null;
  /** The driver's count: 1 on the first lap of the session. */
  lapNumber: number | null;
  /** 1 on the first line crossing of the stint. */
  stintLap: number;
  /** Session clock at the two ends, seconds. */
  startTime: number;
  endTime: number;
  /** Seconds, line to line by the app's clock. */
  lapTime: number;
  /** Seconds, as the sim timed it; null when it gave none in time. */
  simLapTime: number | null;
  /** LEDGER_LAP_* bits. */
  flags: number;
  /** Incident points on the lap; null where the sim counts none (LMU). */
  incidents: number | null;
  /** Litres at the line, burned on the lap, and put in during it. */
  fuelAtLine: number | null;
  fuelUsed: number | null;
  fuelAdded: number;
  /** Virtual energy as a fraction of the budget, 0..1; null for a fuel car. */
  energyAtLine: number | null;
  energyUsed: number | null;
  energyAdded: number;
  /** LF, RF, LR, RR. Tread is 0..1 remaining; used is 0..1 worn on track. */
  treadAtLine: readonly (number | null)[];
  treadUsed: readonly (number | null)[];
  /** LF, RF, LR, RR. Disc thickness and wear in millimetres. */
  brakeAtLine: readonly (number | null)[];
  brakeUsed: readonly (number | null)[];
  /** Compound name per wheel at the line, as DriverTires names it. */
  compounds: readonly (string | null)[];
  /** S1, S2, S3 in seconds. */
  sectors: readonly (number | null)[];
  /** Highest TrackWetness value seen on the lap (0 unknown, 1 dry .. 7). */
  wetness: number;
  /** Highest Precipitation seen on the lap, 0..1. */
  rain: number;
  /** Celsius at the line. */
  airTemp: number | null;
  trackTemp: number | null;
  /** Overall and class position at the line. */
  position: number | null;
  classPosition: number | null;
}

export type StintOpenedBy = 'pitExit' | 'green' | 'joined';
export type StintClosedBy =
  'service' | 'garage' | 'driver' | 'session' | 'disconnect';

/** The service that ended a stint. */
export interface LedgerStop {
  /** Seconds from pit entry to pit exit; null when one end was not seen. */
  pitLaneTime: number | null;
  /** Seconds at a standstill on pit road. */
  stationaryTime: number;
  /** Litres put in; negative when fuel was taken out. */
  fuelAdded: number;
  /** Virtual energy put in, as a fraction of the budget. */
  energyAdded: number;
  /** One bit per wheel changed: LF 1, RF 2, LR 4, RR 8. */
  tyresChanged: number;
  brakesChanged: boolean;
  driverChanged: boolean;
  /** Seconds: the sim's own stop estimate at pit entry (LmuPitStopTime). */
  simEstimate: number | null;
}

/** A pit lane visit that serviced nothing: a drive-through, repairs only. */
export interface LedgerPass {
  pitLaneTime: number | null;
  stationaryTime: number;
}

/** The run of the player's car between two services. */
export interface LedgerStint {
  /** '<library session token>:<ordinal>'. Never reused, never changes. */
  id: string;
  /** 1 for the first stint of the session. */
  ordinal: number;
  sessionNum: number | null;
  /** The driver's name as the session gave it when the stint opened. */
  driver: string | null;
  /** The local player drove it. */
  own: boolean;
  openedBy: StintOpenedBy;
  /** Null while the stint is open. */
  closedBy: StintClosedBy | null;
  /** Session clock, seconds. End is pit entry for a serviced stint. */
  startTime: number;
  endTime: number | null;
  /** Laps completed at each end. */
  startLap: number;
  endLap: number | null;
  /** Line crossings while it was open. */
  laps: number;
  /** Litres. */
  startFuel: number | null;
  endFuel: number | null;
  /** Virtual energy, 0..1. */
  startEnergy: number | null;
  endEnergy: number | null;
  /** LF, RF, LR, RR; tread 0..1 remaining. */
  startTread: readonly (number | null)[];
  endTread: readonly (number | null)[];
  /** LF, RF, LR, RR; disc thickness in millimetres. */
  startBrake: readonly (number | null)[];
  endBrake: readonly (number | null)[];
  /** Compound name per wheel, read at the opening. */
  compounds: readonly (string | null)[];
  /** Seconds, over the stint's clean laps. */
  bestLap: number | null;
  avgLap: number | null;
  cleanLaps: number;
  /** The mean of the clean laps other than the best, minus the best. */
  paceDelta: number | null;
  /** Best lap over the mean of the other clean laps, 0..1. */
  consistency: number | null;
  /** Pit lane visits without service, oldest first, at most 10. */
  passes: readonly LedgerPass[];
  /** Null while open and for a stint not ended by a service. */
  stop: LedgerStop | null;
}
