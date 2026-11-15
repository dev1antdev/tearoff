import { RadioInfo } from './radio-info';
import { CameraInfo } from './camera-info';
import { SessionList, SessionResultsPosition } from './session-info';
import { WeekendInfo } from './weekend-info';
import { DriverInfo } from './driver-info';
import { SplitTimeInfo } from './split-info';
import { CarSetupInfo } from './setup-info';

export interface LmuTrackMap {
  orientation?: 'lmu-ccw-v1';
  active: {
    inside: string;
    outside: string;
    trackPathPoints: { x: number; y: number }[];
    totalLength: number;
  };
  startFinish: {
    line: string;
    point: { x: number; y: number; length: number };
    direction: 'anticlockwise';
  };
  turns?: {
    x?: number;
    y?: number;
    content?: string;
  }[];
}

/** One point on LMU's weather forecast for a session. */
export interface LmuWeatherNode {
  /** Where in the session this applies, as a fraction of its length, 0..1. */
  start: number;
  /** LMU's sky type index, 0..10. */
  skyType: number;
  /** Degrees Celsius. */
  temperature: number;
  /** Chance of rain as a fraction, 0..1. */
  rainChance: number;
  /**
   * Relative humidity as a fraction, 0..1. Absent when the node states none,
   * as are the two wind figures: a node is whole with sky, temperature and
   * rain chance alone.
   */
  humidity?: number;
  /**
   * Metres per second. The forecast's wind, which is not felt on track: LMU's
   * shared-memory wind vector is always zero.
   */
  windSpeed?: number;
  /**
   * LMU's own index, 0..7. The sim words 6 as "West" and 7 as "North West",
   * so 0 as north in 45 degree steps clockwise is inferred from those two.
   */
  windDirection?: number;
}

/**
 * What each kind of pit work costs the player's car, from the `pitStopTimes`
 * group of `/rest/garage/UIScreen/RepairAndRefuel`.
 *
 * Constants of a car in a session. Each member carries the sim's own key in
 * camel case, and is absent when the sim did not state it. Seconds, unless a
 * member says otherwise; units measured on a recording.
 *
 * The `*Concurrent` members are flags as the sim sends them, 0 or 1. That 1
 * means the work may overlap other work is how rFactor 2 reads them, and is
 * assumed rather than confirmed here.
 */
export interface LmuPitService {
  /** Litres per second. */
  fuelFillRate?: number;
  /** Seconds to connect the hose, and to take it off again. */
  fuelInsert?: number;
  fuelRemove?: number;
  fuelTimeConcurrent?: number;
  fuelRandomDelay?: number;
  /** Share of a full energy budget per second: 0.025 is 2.5 % a second. */
  virtualEnergyFillRate?: number;
  virtualEnergyInsert?: number;
  virtualEnergyRemove?: number;
  virtualEnergyTimeConcurrent?: number;
  fourTireChange?: number;
  twoTireChange?: number;
  tireTimeConcurrent?: number;
  randomTireDelay?: number;
  driverChange?: number;
  driverConcurrent?: number;
  driverRandom?: number;
  fixAeroDamage?: number;
  fixAllDamage?: number;
  fixTimeConcurrent?: number;
  fixRandomDelay?: number;
  brakeChange?: number;
  brakeTimeConcurrent?: number;
}

/**
 * One setting of the garage setup, as the sim's setup screen states it.
 *
 * `text` carries the quantity as the screen words it, `value` is the position
 * of the slider and `positions` how many positions it has.
 */
export interface LmuGarageSetting {
  text: string;
  value: number;
  positions: number;
}

/**
 * Session values LMU serves over its local REST API rather than shared memory.
 *
 * One namespaced object rather than fields scattered across SessionData, the
 * same way LmuTrackMap is carried: a later addition touches nothing outside
 * this interface. Every field optional, like Driver.CarIsAIControlled -- the
 * established way to say "only some sims report this".
 */
export interface LmuRestSession {
  /** Race time multiplier. A scaled session makes real-time projections wrong. */
  timeScale?: number;
  privateQualifying?: boolean;
  /**
   * How long the race is set to run, in seconds, from `SESSSET_race_time`,
   * which the sim holds in minutes. Not the session clock's end time, which
   * also holds whatever ran before the race's own time: 900 against 1035 on
   * a recorded fifteen-minute race with a rolling start. Absent when the sim
   * states none.
   */
  raceTime?: number;
  /**
   * The car's virtual-energy budget. Hypercars, LMDh and LMGT3 are
   * energy-limited rather than fuel-limited, so this is the denominator that
   * matters; the numerator is mVirtualEnergy from shared memory.
   */
  maxVirtualEnergy?: number;
  /**
   * Litres of fuel per percent of virtual energy, from the garage setup.
   *
   * The conversion factor between the two budgets an energy-limited car runs
   * on, and the only thing that relates them. A setup reading 0.83 with the
   * virtual energy set to 23% carries 19.1 L, which is how the garage screen
   * arrives at both figures from one slider.
   *
   * It is a setup value, not a measurement, so it moves only when the player
   * edits the setup.
   */
  fuelRatio?: number;
  /**
   * The fuel tank in litres, as the pit screen states it.
   *
   * Preferred over every other route to the tank, because the others are
   * inferences: fuelLevelMax has to be read as litres, and mFuelCapacity is
   * shared memory's separate word for the same thing.
   */
  maxFuel?: number;
  /**
   * The top step of the garage's fuel-ratio slider.
   *
   * The ratio is litres per percent of virtual energy, so at its top step a
   * full energy load fills the tank exactly -- which makes this bound the tank
   * in litres, and a usable fallback when maxFuel is not being served.
   */
  fuelLevelMax?: number;
  forecast?: {
    practice?: LmuWeatherNode[];
    qualify?: LmuWeatherNode[];
    race?: LmuWeatherNode[];
  };
  /**
   * Driver nationality as ISO 3166-1 alpha-2, keyed by the driver name the
   * sim reports, from `/rest/multiplayer/teams`.
   *
   * Keyed by name rather than by index or id because that endpoint carries
   * neither -- it is a bare map of names. Names are unique within a session,
   * so this is sound, but it means an entry only matches while the scoring
   * name and the teams name agree.
   *
   * Absent outside multiplayer: a single-player grid has no teams payload,
   * and the AI have no nationality to report.
   */
  nationalities?: Record<string, string>;
  /**
   * The entrant each car is run by, keyed by CarIdx, from `fullTeamName` on
   * `/rest/watch/standings`.
   *
   * The authoritative answer, and the reason this endpoint is polled at all.
   * Shared memory has no team field; the fallback parses the prefix of the
   * entry name, which carries the season with it -- "Proton Competition 2026
   * #77:LM" yields "Proton Competition 2026" where this endpoint states
   * "Proton Competition".
   *
   * Keyed by the payload's `slotID`, which is the scoring slot id and so this
   * app's CarIdx. By slot rather than by driver name, unlike `nationalities`:
   * a team runs a car, and the driver in it changes at every stop of an
   * endurance race.
   */
  teamNames?: Record<number, string>;
  /**
   * The session's compounds in index order, from
   * `/rest/garage/UIScreen/TireManagement`.
   *
   * Position is the compound index per-wheel telemetry reports, so a hole is
   * kept as an empty string rather than removed -- filtering one out would
   * renumber every compound after it. Merged into DriverInfo.DriverTires with
   * what the grid itself states, which wins where the two disagree.
   */
  tireCompounds?: string[];
  /** What each kind of pit work costs this car. See LmuPitService. */
  pitService?: LmuPitService;
  /**
   * Thickness of a new brake disc on each wheel, millimetres, in the order
   * LF, RF, LR, RR, from the garage setup (`WM_BRAKEDISC-W_*`).
   *
   * What a disc starts at, where LmuBrakeThickness on the telemetry frame is
   * what it has worn to. All four or absent.
   */
  brakeDiscNewMm?: number[];
  /**
   * Garage setup values kept as the setup screen states them, for the ones
   * that have no reading in shared memory.
   */
  garage?: {
    /**
     * The regeneration level (`VM_REGEN_LEVEL`). Present only for a car that
     * has the setting: the sim lists it for every car, with a single position
     * where there is nothing to choose.
     *
     * The garage's figure. Nothing shows that it follows a change made on
     * track.
     */
    regenLevel?: LmuGarageSetting;
  };
}

/**
 * Information about the current session, stored as yaml.
 * Does not update as much as telemetry.
 * @todo the CarSetup types are incomplete. Help wanted!
 */
export interface SessionData {
  WeekendInfo: WeekendInfo;
  SessionInfo: SessionList;
  CameraInfo: CameraInfo;
  RadioInfo: RadioInfo;
  DriverInfo: DriverInfo;
  SplitTimeInfo: SplitTimeInfo;
  CarSetup: CarSetupInfo;
  QualifyResultsInfo?: { Results: SessionResultsPosition[] | null };
  LmuTrackMap?: LmuTrackMap;
  LmuRest?: LmuRestSession;
}
