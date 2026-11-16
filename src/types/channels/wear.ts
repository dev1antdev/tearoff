/**
 * `wear.snapshot`: how much tread and brake disc the player's car has left,
 * how fast each is going and how many laps it will last. Published by
 * `PlayerLedgerRuntime` from `WearForecast`, because the laps it forecasts
 * from have to exist before a widget is shown.
 *
 * Le Mans Ultimate only: iRacing refreshes tread in the pits alone and says
 * nothing about discs.
 */

/**
 * Where a wear per lap was taken from.
 *
 * - `tyre`: clean laps on the tyre now fitted (tread only).
 * - `stint`: clean laps of the open stint (discs only).
 * - `session`: clean laps of this session. For tread these were driven on an
 *   earlier set of the same compound, so the figure is an estimate.
 * - `baseline`: what this track and car cost in earlier sessions.
 * - `projected`: what the lap under way is heading for, before any lap has
 *   been measured.
 */
export type WearRateSource =
  'tyre' | 'stint' | 'session' | 'baseline' | 'projected';

/** Where a brake failure thickness was taken from. */
export type BrakeFailureSource = 'setting' | 'learned' | 'class';

export interface WearWheelSnapshot {
  /** Tread remaining, percent, one decimal. */
  treadPct: number | null;
  /** Tread worn so far this lap, percent, two decimals. */
  treadLapPct: number | null;
  /** What this lap is heading for, percent, two decimals. */
  treadProjectedPct: number | null;
  /** Wear per lap the forecast uses, percent, two decimals. */
  treadPerLapPct: number | null;
  treadRateSource: WearRateSource | null;
  /** Whole laps until the tread reaches the floor, at most 999. */
  treadLapsLeft: number | null;
  /** Tread expected when the fuel or energy runs out, percent, one decimal. */
  treadEndOfStintPct: number | null;
  /** Index into the session's DriverTires; -1 unknown. */
  compound: number;
  /** The sim says the tyre is flat. */
  flat: boolean;
  /** Disc thickness, millimetres, two decimals. */
  brakeMm: number | null;
  /**
   * Usable disc left, percent, one decimal: thickness above the failure
   * thickness over a new disc's. Null when no failure thickness is known.
   */
  brakeLifePct: number | null;
  /** Disc worn so far this lap, millimetres, four decimals. */
  brakeLapMm: number | null;
  /** Wear per lap the forecast uses, millimetres, four decimals. */
  brakePerLapMm: number | null;
  brakeRateSource: WearRateSource | null;
  /** Whole laps until the disc reaches the failure thickness, at most 999. */
  brakeLapsLeft: number | null;
  /**
   * The disc is at or below the failure thickness, or has stopped wearing
   * under braking while the sim went on answering.
   */
  brakeFailed: boolean;
}

export interface WearSnapshot {
  /** False with no player car. */
  available: boolean;
  /** LF, RF, LR, RR. */
  wheels: readonly WearWheelSnapshot[];
  /** Seconds per lap, one decimal, to turn laps into minutes. */
  paceLapTime: number | null;
  /** Laps the fuel or energy lasts, one decimal. */
  budgetLapsLeft: number | null;
  /** Thickness of a new disc, millimetres: front, rear. */
  brakeNewMm: readonly (number | null)[];
  /** The failure thickness in use, millimetres: front, rear. */
  brakeFailureMm: readonly (number | null)[];
  /** Where each of those came from: front, rear. */
  brakeFailureSource: readonly (BrakeFailureSource | null)[];
  /**
   * The sim's REST API gave disc thicknesses and has stopped answering: the
   * brake figures above are then null rather than the last ones read, which
   * would look like discs that no longer wear.
   */
  brakeStale: boolean;
  sessionNum: number | null;
  version: number;
}

/** Most laps a forecast states; beyond it the figure reads as "999+". */
export const WEAR_MAX_LAPS = 999;

const emptyWearWheel = (): WearWheelSnapshot => ({
  treadPct: null,
  treadLapPct: null,
  treadProjectedPct: null,
  treadPerLapPct: null,
  treadRateSource: null,
  treadLapsLeft: null,
  treadEndOfStintPct: null,
  compound: -1,
  flat: false,
  brakeMm: null,
  brakeLifePct: null,
  brakeLapMm: null,
  brakePerLapMm: null,
  brakeRateSource: null,
  brakeLapsLeft: null,
  brakeFailed: false,
});

export const EMPTY_WEAR: WearSnapshot = {
  available: false,
  wheels: [
    emptyWearWheel(),
    emptyWearWheel(),
    emptyWearWheel(),
    emptyWearWheel(),
  ],
  paceLapTime: null,
  budgetLapsLeft: null,
  brakeNewMm: [null, null],
  brakeFailureMm: [null, null],
  brakeFailureSource: [null, null],
  brakeStale: false,
  sessionNum: null,
  version: 0,
};

/**
 * What the forecast takes from the `wear` widget's settings: where a tyre
 * and a disc are finished. Le Mans Ultimate states neither, so they are the
 * driver's to set; they reach the forecast from the current dashboard.
 */
export interface WearForecastTuning {
  /** Tread, percent, at which a tyre is finished. */
  floorPct: number;
  /**
   * Disc thickness, millimetres, at which a front brake fails. 0 leaves it
   * to a thickness learned from a failure, then to the figure for the class.
   */
  failureFrontMm: number;
  /** The same for a rear brake. */
  failureRearMm: number;
}

export const DEFAULT_WEAR_TUNING: WearForecastTuning = {
  floorPct: 0,
  failureFrontMm: 0,
  failureRearMm: 0,
};

/**
 * Where a failure thickness learned from a failed brake is kept, by
 * `simulator|carKey|axle` with the axle `front` or `rear`. Read from memory:
 * a forecast may not wait for the disk.
 */
export interface BrakeLimitStore {
  /** The learned failure thickness, millimetres, or undefined. */
  get(key: string): number | undefined;
  set(key: string, mm: number): void;
}
