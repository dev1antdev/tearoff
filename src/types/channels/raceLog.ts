import type { RaceEvent } from '../raceLog';

/**
 * The most recent events of the race being recorded, published by
 * `RaceHistoryRuntime` on `race-log.snapshot` when the log changes, at most
 * once a second, and only while something reads it.
 *
 * At most RACE_LOG_SNAPSHOT_EVENTS events. A reader that wants the ones
 * before asks `RaceHistoryBridge.getEvents` for those with a lower `seq`
 * than the oldest it holds; `total` says whether there are any.
 */
export interface RaceLogSnapshot {
  /**
   * Names the race the events are of, as the summary does, and changes when
   * another one begins; '' while none is being recorded. A reader drops
   * what it holds of the race before when this moves.
   */
  raceToken: string;
  /** The most recent events, oldest first. */
  events: readonly RaceEvent[];
  /** Events held for the race, these included. */
  total: number;
  sessionNum: number | null;
  /** Goes up whenever an event is added, changed or removed. */
  version: number;
}
