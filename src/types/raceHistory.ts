/**
 * The history of a race: every completed lap of every car, the stints each
 * car ran and who drove them, for the whole distance. Shared by the main
 * process, which records and stores it, and whatever reads it.
 *
 * These are the records. `RaceHistoryRecorder` fills them from the frames,
 * and the lap library's file keeps them (`src/app/storage/lapLibrary/`,
 * tables `race`, `race_lap`, `race_stint` and `race_driver_change`), so a
 * race survives the app being restarted in the middle of it. What is small
 * and current about every car goes out on `race-history.summary`; the detail
 * of one car is asked for through `RaceHistoryBridge`.
 *
 * The race's log, what happened in it one event at a time, is kept beside
 * them (`raceLog.ts`, table `race_event`) and read through the same bridge.
 *
 * Nothing here is made up. A lap driven while the app was not running, or
 * while nothing asked for the record, is absent, and is counted as missing.
 */
import type { RaceEvent } from './raceLog';

/** Car slots a record is kept for. Le Mans Ultimate's scoring holds 104. */
export const RACE_HISTORY_MAX_CARS = 128;

/**
 * Laps kept for one car while a race is recorded; past it the oldest go.
 * A 24-hour race is about 400 laps at Le Mans and under 900 at Daytona.
 */
export const RACE_HISTORY_MAX_LAPS_PER_CAR = 2000;

/** Stints kept for one car; past it the oldest go. */
export const RACE_HISTORY_MAX_STINTS_PER_CAR = 200;

/** Driver changes kept for a race; past it the oldest go. */
export const RACE_HISTORY_MAX_DRIVER_CHANGES = 2000;

/** Races kept in the file. An older one goes with every row of it. */
export const RACE_HISTORY_MAX_RACES = 20;

/** One completed lap of one car. */
export interface RaceLap {
  carIdx: number;
  /** The lap just completed: 1 for the first lap of the session. */
  lap: number;
  /**
   * Session clock at the line, seconds: the frame the car's lap count moved
   * on, placed between it and the frame before by distance where the two
   * are either side of the line.
   */
  sessionTime: number;
  /**
   * Seconds, as the sim timed the lap. Null while the time has not arrived,
   * which is a second or three after the line, and for good when the sim
   * gave none: `LEDGER_LAP_VOIDED` in `flags` then says it did not count.
   */
  lapTime: number | null;
  /**
   * S1, S2 and S3 in seconds, where the sim gives them for the car: Le Mans
   * Ultimate does, iRacing does not. Null for each one that is not given.
   */
  sectors: readonly (number | null)[];
  /** Overall and class position at the line; null where the sim had none. */
  position: number | null;
  classPosition: number | null;
  /**
   * Seconds behind the first car of the class to complete this lap, at the
   * line: 0 for that car. Null when that car's crossing was not seen, as
   * for every lap the field completed while nothing was recording.
   */
  classGap: number | null;
  /**
   * `LEDGER_LAP_*` bits, read as they are for the player's own laps:
   * `IN_LAP` and `OUT_LAP` for a lap the car entered or left the pit lane
   * on, `YELLOW` for one driven under the car's own yellow, `CAUTION` for a
   * full-course yellow or a stopped session, `BLUE`, `FROM_START` for the
   * first lap of a race, and `VOIDED` for a lap the sim gave no time.
   */
  flags: number;
  /** Who the session named as driving the car at the line; '' unknown. */
  driver: string;
  /**
   * What the car had left to run on a second after the line, 0..1: virtual
   * energy for a car that runs on it, fuel otherwise. Null where the sim
   * publishes neither for the car, which under iRacing is always.
   */
  energy: number | null;
  /** True when `energy` is virtual energy, false when it is fuel. */
  energyIsVirtual: boolean;
  /**
   * Compound index per wheel, LF RF LR RR, as the session's tyre list
   * numbers them; -1 unknown. The four are the same under iRacing, which
   * has one compound per car.
   */
  compounds: readonly number[];
}

/** How a car's stint came to be opened. */
export type RaceStintOpenedBy =
  /** The car was seen before it had completed a lap. */
  | 'start'
  /** First seen with laps behind it, or after laps that were not seen. */
  | 'joined'
  /** After the stop that ended the stint before. */
  | 'stop'
  /** After a spell in the garage, or out of the world. */
  | 'garage'
  /** Another driver, with no stop seen. */
  | 'driver';

/** How a car's stint ended. */
export type RaceStintClosedBy =
  /** A visit to the pit lane on which the car stood still. */
  | 'stop'
  /** The car went to its garage, or out of the world. */
  | 'garage'
  /** The session named another driver, with no stop seen. */
  | 'driver'
  /** Laps after it were not seen, so where it really ended is not known. */
  | 'gap'
  /** The session ended, or the sim went away. */
  | 'session';

/** The stop that ended a stint. */
export interface RaceStintStop {
  /** Seconds from pit entry to pit exit; null while the car is still in. */
  laneTime: number | null;
  /** Seconds standing still on that visit. */
  standingTime: number;
  /** The session named another driver during it, or shortly after. */
  driverChanged: boolean;
}

/**
 * The run of one car between two stops, or between two drivers.
 *
 * From outside a car only standing still can be seen, so a stint ends at
 * any visit to the pit lane on which the car stood for more than a second:
 * a stop-and-go ends one as a service does. A drive-through ends none.
 */
export interface RaceStint {
  carIdx: number;
  /** 1 for the first stint kept of the car. */
  ordinal: number;
  /** Who the session named as driving it; '' unknown. */
  driver: string;
  openedBy: RaceStintOpenedBy;
  /** Null while the stint is open. */
  closedBy: RaceStintClosedBy | null;
  /** Lap numbers of its first and last completed lap; null with none. */
  firstLap: number | null;
  lastLap: number | null;
  /** Session clock, seconds. The end of a stint a stop ended is pit entry. */
  startTime: number;
  endTime: number | null;
  /** Laps completed in it. */
  laps: number;
  /**
   * Its clean laps: timed by the sim, off pit road, not under a full-course
   * yellow and not the first lap of a race. Their mean and their best.
   */
  cleanLaps: number;
  avgLap: number | null;
  bestLap: number | null;
  /** Null while open and for a stint that no stop ended. */
  stop: RaceStintStop | null;
}

/** The session naming another driver for a car. */
export interface RaceDriverChange {
  carIdx: number;
  /** 1 for the car's first change, counting up. */
  seq: number;
  /** Session clock when the new name was first seen, seconds. */
  sessionTime: number;
  /** Laps the car had completed then. */
  lap: number;
  from: string;
  to: string;
  /** It came with a pit stop. */
  atStop: boolean;
}

/** One car of the entry list, as the session names it. */
export interface RaceEntry {
  carIdx: number;
  carNumber: string;
  /** The car as the sim files it: what tells one entry from another. */
  car: string;
  classId: number;
  className: string;
  teamName: string;
}

/** A compound of the session's tyre list. */
export interface RaceTyre {
  index: number;
  name: string;
}

/** What a recorded race is: which session of which event, and who was in it. */
export interface RaceInfo {
  /** Its row in the file; null for a race that is not stored. */
  id: number | null;
  /** 'iracing' or 'lmu'. */
  simulator: string;
  /**
   * The sim's own name for the session where it names one event and no
   * other, as iRacing's does; '' where it does not.
   */
  sessionKey: string;
  sessionNum: number | null;
  /** 'Practice', 'Qualify', 'Race'... as the sim words it. */
  sessionType: string | null;
  sessionName: string | null;
  trackId: number;
  trackName: string;
  trackConfig: string | null;
  trackLengthM: number;
  /** When the first record of it was made, Unix milliseconds. */
  startedAt: number;
  /** When the last one was, Unix milliseconds. */
  updatedAt: number;
  /** Session clock at the last record, seconds. */
  sessionTime: number;
  entries: readonly RaceEntry[];
  tyres: readonly RaceTyre[];
}

/** A race as the file lists it. */
export interface StoredRace extends RaceInfo {
  id: number;
  /** Cars with at least one lap kept. */
  cars: number;
  /** Laps kept, over every car. */
  laps: number;
}

/** The laps kept for one car. */
export interface RaceCarLaps {
  /** In the order driven. */
  laps: RaceLap[];
  /**
   * Lap numbers the car has completed that are not among them: driven while
   * the app was not running, or before it began recording.
   */
  missingLaps: number[];
  /** The car's counter on `race-history.summary` when this was read. */
  revision: number;
}

/**
 * The detail of a recorded race, for whatever shows it.
 *
 * `raceId` is a row id from `listRaces`. Left out, the answer is about the
 * race being recorded now, from memory, which is also the only way to read a
 * race that is not stored: one played back from a recording.
 */
export interface RaceHistoryBridge {
  /** The laps of one car, in the order driven, and which are missing. */
  getCarLaps: (carIdx: number, raceId?: number) => Promise<RaceCarLaps>;
  /** The stints of one car, oldest first. */
  getCarStints: (carIdx: number, raceId?: number) => Promise<RaceStint[]>;
  /** Every driver change of the race, oldest first. */
  getDriverChanges: (raceId?: number) => Promise<RaceDriverChange[]>;
  /** The races kept in the file, most recent first. */
  listRaces: () => Promise<StoredRace[]>;
  /**
   * Events of the race's log, oldest first: the RACE_LOG_PAGE_EVENTS most
   * recent ones numbered below `before`, or the most recent of all with it
   * left out. A reader that holds the events of `race-log.snapshot` asks
   * with the `seq` of the oldest of them to go further back.
   */
  getEvents: (raceId?: number, before?: number) => Promise<RaceEvent[]>;
}

/** Everything kept of one race: what the file hands back to carry it on. */
export interface RaceRecords {
  laps: readonly RaceLap[];
  stints: readonly RaceStint[];
  driverChanges: readonly RaceDriverChange[];
  /** The race's log, oldest first. Left out by a reader that has none. */
  events?: readonly RaceEvent[];
}

/** A race in the file that might be the one being driven now. */
export interface StoredRaceState {
  info: RaceInfo;
  /** The number of the last lap kept for each car that has one. */
  lastLaps: readonly { carIdx: number; lap: number }[];
}

/**
 * Rows of one race on their way into the file, written together or not at
 * all. A row already there under the same car and number is replaced.
 */
export interface RaceWriteBatch {
  /**
   * The race's row, for one carried on after a restart; null to find it by
   * `token`, or to make it.
   */
  raceId: number | null;
  /** Names the run of the app that is recording the race. */
  token: string;
  info: RaceInfo;
  laps: readonly RaceLap[];
  stints: readonly RaceStint[];
  driverChanges: readonly RaceDriverChange[];
  /**
   * Events of the race's log, each written under its `seq`: one already
   * there is replaced, as when a stop's driver change is named late.
   */
  events?: readonly RaceEvent[];
  /** Events that went at the log's cap, by `seq`: they go from the file. */
  removedEvents?: readonly number[];
  /**
   * Slots another car has taken: what the file holds for them goes before
   * anything of the batch is written.
   */
  replacedCars: readonly number[];
  /** How many races the file keeps; older ones go when one is added. */
  maxRaces: number;
}

export interface RaceWriteResult {
  raceId: number;
  /** Older races that went to make room. */
  removedRaces: number;
}
