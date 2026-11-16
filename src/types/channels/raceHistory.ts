/**
 * What is held of the race being recorded, per car, published by
 * `RaceHistoryRuntime` on `race-history.summary` about once a second while
 * something changes.
 *
 * Small on purpose: a count and the current stint for every car, never the
 * laps themselves. A reader that shows one car's laps or stints asks for
 * them through `RaceHistoryBridge`, and asks again when that car's
 * `revision` has moved.
 *
 * Every array is indexed by CarIdx. A slot with no car in it reads 0, -1 or
 * '' as its neighbours do.
 */
export interface RaceHistorySummarySnapshot {
  /**
   * Names the race the arrays are about, and changes when another one
   * begins; '' while none is being recorded. A reader drops what it holds
   * of the race before when this moves.
   */
  raceToken: string;
  /** The race's row in the file; null while it is not stored. */
  raceId: number | null;
  /** The race was found in the file and carried on after a restart. */
  resumed: boolean;
  /** Laps held for the car. */
  laps: readonly number[];
  /** The number of the last lap held; 0 with none. */
  lastLap: readonly number[];
  /**
   * Laps the car has completed that are not held: driven while the app was
   * not running, or before it began recording.
   */
  missingLaps: readonly number[];
  /** The stint under way: its first lap, 0 before one is completed. */
  stintFirstLap: readonly number[];
  /** Laps completed in it so far. */
  stintLaps: readonly number[];
  /** Who drives it, as the session names them; '' unknown. */
  stintDriver: readonly string[];
  /** Its mean clean lap so far, seconds; -1 before it has a clean lap. */
  stintAvgLap: readonly number[];
  /** How many clean laps that mean is of. */
  stintCleanLaps: readonly number[];
  /** Mean clean lap of the stint before it, seconds; -1 with none. */
  previousStintAvgLap: readonly number[];
  /** Who drove that one; '' with none. */
  previousStintDriver: readonly string[];
  /**
   * Mean clean lap, seconds, of the most recent stint driven by somebody
   * other than the driver of the stint under way: after a double stint the
   * driver before, where `previousStintAvgLap` is the same driver's first
   * half. -1 with none, where that stint had no clean lap, and where the
   * driver now at the wheel is not named.
   */
  previousDriverStintAvgLap: readonly number[];
  /** Who drove that one; '' with none. */
  previousDriverStintDriver: readonly string[];
  /** Driver changes seen for the car. */
  driverChanges: readonly number[];
  /** Pit stops seen for the car: visits on which it stood still. */
  stops: readonly number[];
  /** Goes up whenever anything kept for the car changes. */
  revision: readonly number[];
  sessionNum: number | null;
  version: number;
}
