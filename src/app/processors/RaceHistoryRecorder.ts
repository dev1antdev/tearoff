import type {
  CarPitSnapshot,
  RaceDriverChange,
  RaceEntry,
  RaceHistorySummarySnapshot,
  RaceInfo,
  RaceLap,
  RaceRecords,
  RaceStint,
  RaceStintClosedBy,
  RaceStintOpenedBy,
  RaceStintStop,
  RaceTyre,
  Session,
  Telemetry,
} from '@irdashies/types';
import {
  CAR_PIT_IN_GARAGE,
  CAR_PIT_IN_LANE,
  CAR_PIT_ON_TRACK,
  GlobalFlags,
  LEDGER_LAP_FROM_START,
  LEDGER_LAP_IN_LAP,
  LEDGER_LAP_OUT_LAP,
  LEDGER_LAP_VOIDED,
  RACE_HISTORY_MAX_CARS,
  RACE_HISTORY_MAX_DRIVER_CHANGES,
  RACE_HISTORY_MAX_LAPS_PER_CAR,
  RACE_HISTORY_MAX_STINTS_PER_CAR,
} from '@irdashies/types';
import { isCleanLap, sessionFlagLapBits } from '../../shared/lapValidity';
import { CarPitProcessor, ENERGY_SETTLE_SECONDS } from './CarPitProcessor';
import { LapCounterWatch, NO_CROSSING } from './lapCrossing';
import { EARLY_TIME_WINDOW_SECONDS } from './LapTimesProcessor';
import { crossingTime, trackLengthFrom } from './lapTiming';
import { DRIVER_SETTLE_SECONDS } from './PitStopProcessor';
import { isPitLapVisit, isStopVisit } from './pitVisit';

/**
 * Every lap of every car, the stints each car ran and who drove them, for
 * one session at a time.
 *
 * Pure: it is handed the session and every frame, keeps the records, and
 * says what changed through its listener. Storage, the channel and the
 * decision to carry on a race found in the file belong to its host,
 * `RaceHistoryRuntime`.
 *
 * It decides nothing of its own about what a lap, a pit visit or a clean
 * lap is. A lap ends where the lap history says it does (`lapCrossing.ts`),
 * at a time placed as the lap timers place theirs (`lapTiming.ts`); a visit
 * to the pit lane and whether it was a stop are the per-car pit tracker's
 * (`CarPitProcessor`, `pitVisit.ts`), run here on the same frames; a lap's
 * flags and whether it is clean are the player's ledger's
 * (`shared/lapValidity.ts`).
 *
 * A lap's own time is the sim's. It arrives up to a few seconds after the
 * line under iRacing and a moment before the lap count under Le Mans
 * Ultimate, so a lap is kept as soon as it is completed and given its time
 * when that moves. What the car had left to run on is read a second after
 * the line, as the pit tracker reads it and for its reason.
 *
 * Caps: RACE_HISTORY_MAX_LAPS_PER_CAR laps and
 * RACE_HISTORY_MAX_STINTS_PER_CAR stints for each of at most
 * RACE_HISTORY_MAX_CARS cars, and RACE_HISTORY_MAX_DRIVER_CHANGES driver
 * changes, oldest dropped first. Per-car state is made once per car and
 * changed in place: a frame on which no car completes a lap, enters or
 * leaves the pits or changes driver allocates nothing.
 */

/** How long a lap waits for the sim's time before it is kept without one. */
export const LAP_TIME_WAIT_SECONDS = 10;
/**
 * How far round the next lap a time that comes later still is taken for the
 * lap before. Past it a new time is the next lap's own, a moment early.
 */
const LATE_TIME_MAX_PCT = 0.9;
/**
 * How far the session clock may step back and still be the same session:
 * the figure the stint tracker and Le Mans Ultimate's session identity use.
 */
const SESSION_REWIND_SECONDS = 2;
/**
 * How often a car's place, flags and lap time are read, in session seconds:
 * the rate the pit tracker is run at when the processor host runs it.
 */
const TICK_SECONDS = 0.2;
/**
 * How long a car must be in its garage, or out of the world, before that
 * ends its stint. A car driven on another machine can drop out of the world
 * for a frame or two and be back.
 */
const AWAY_SECONDS = 5;

const CAUTION_SESSION_FLAGS =
  GlobalFlags.Caution | GlobalFlags.CautionWaving | GlobalFlags.Red;
/** The bits of a car's own flags that say something about its lap. */
const CAR_LAP_FLAGS =
  GlobalFlags.Yellow |
  GlobalFlags.YellowWaving |
  GlobalFlags.Blue |
  CAUTION_SESSION_FLAGS;

/** A place not acted on yet: the car has not been seen in the world. */
const PLACE_UNKNOWN = -1;
const SECTOR_COUNT = 3;
const WHEEL_COUNT = 4;
const NO_SECTORS: readonly (number | null)[] = Object.freeze([
  null,
  null,
  null,
]);
const NO_STINTS: readonly RaceStint[] = Object.freeze([]);
/** What the entry list's signature is before one has been read. */
const NO_ENTRIES_KEY = 'none';

type Cells = Record<string, { value?: unknown[] } | undefined>;

const arrayOf = (
  frame: Telemetry,
  key: string
): readonly unknown[] | undefined => {
  const value = (frame as unknown as Cells)[key]?.value;
  return Array.isArray(value) ? value : undefined;
};

const scalarOf = (frame: Telemetry, key: string): number | null => {
  const value = (frame as unknown as Cells)[key]?.value?.[0];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

const numberAt = (
  values: readonly unknown[] | undefined,
  index: number,
  fallback: number
): number => {
  const value = values?.[index];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
};

const flagAt = (
  values: readonly unknown[] | undefined,
  index: number
): boolean => values?.[index] === true || values?.[index] === 1;

/** Writes one entry of a published array; true when it moved. */
const put = <T>(target: T[], index: number, value: T): boolean => {
  if (target[index] === value) return false;
  target[index] = value;
  return true;
};

/** Brings a published array to a length, filling what is new. */
const resize = <T>(target: T[], length: number, fill: T): void => {
  const from = target.length;
  target.length = length;
  for (let index = from; index < length; index += 1) target[index] = fill;
};

/** Two names for one driver, where either may not be known. */
const sameDriver = (a: string, b: string): boolean =>
  a === b || a === '' || b === '';

/**
 * The most recent stint before the last of `stints` that somebody other
 * than `driver` drove. Only where both names are known: a stint nobody is
 * named for cannot be said to be another driver's.
 */
const stintByAnotherDriver = (
  stints: readonly RaceStint[],
  driver: string
): RaceStint | undefined => {
  if (driver === '') return undefined;
  for (let index = stints.length - 2; index >= 0; index -= 1) {
    const stint = stints[index];
    if (stint.driver !== '' && stint.driver !== driver) return stint;
  }
  return undefined;
};

/** What the session says of one car slot. */
interface RosterEntry {
  driver: string;
  classId: number;
  /** The car and not the driver: what a slot changing hands shows in. */
  entryKey: string;
  entry: RaceEntry;
}

/** What is kept about one car. Made once per car, then changed in place. */
interface Car {
  carIdx: number;
  /** Seen in the world on a frame of this race, not only read from a file. */
  seen: boolean;
  driver: string;
  classId: number;
  entryKey: string;

  /** The lap the car is on, as last read; -1 before a reading. */
  lapNow: number;
  /** The number of the last lap kept; 0 with none. */
  lastLap: number;
  /** LEDGER_LAP_* bits gathered for the lap under way. */
  lapBits: number;

  /** CAR_PIT_* as last acted on, or PLACE_UNKNOWN. */
  place: number;
  /** When the car went to its garage or out of the world; NaN while here. */
  awaySince: number;
  /** A visit to the pit lane is under way. */
  visitOpen: boolean;
  /** The car was seen to drive into the lane, so the visit can be timed. */
  visitEntrySeen: boolean;
  visitEntryAt: number;
  /** The number of the last lap kept when the visit began. */
  visitLap: number;
  /** The visit under way has already ended the stint. */
  visitIsStop: boolean;
  /** A driver change seen during the visit, not yet put down to a stop. */
  visitChange: RaceDriverChange | null;
  /** The stint the last stop ended, while its times can still change. */
  stopStint: RaceStint | null;
  /** When the car left its last stop; NaN before one. */
  stopExitAt: number;

  /** The sim's last lap time for the car as last read, and when it moved. */
  raw: number;
  rawChangedAt: number;
  /** What it read before that, and since when. */
  rawBefore: number;
  rawBeforeSince: number;
  /** The newest lap, while it waits for its time. */
  open: RaceLap | null;
  openAt: number;
  /** What goes with it a moment after the line has been read. */
  openRead: boolean;
  /** It has been handed on without a time, and may still be given one. */
  openSettled: boolean;
  openStint: RaceStint | null;

  /** Oldest first. */
  laps: RaceLap[];
  stints: RaceStint[];
  /** The open stint: the last of `stints`. Null for a car not seen yet. */
  stint: RaceStint | null;
  changes: number;
  stops: number;
  revision: number;
}

const newCar = (carIdx: number): Car => ({
  carIdx,
  seen: false,
  driver: '',
  classId: -1,
  entryKey: '',
  lapNow: -1,
  lastLap: 0,
  lapBits: 0,
  place: PLACE_UNKNOWN,
  awaySince: Number.NaN,
  visitOpen: false,
  visitEntrySeen: false,
  visitEntryAt: 0,
  visitLap: 0,
  visitIsStop: false,
  visitChange: null,
  stopStint: null,
  stopExitAt: Number.NaN,
  raw: -1,
  rawChangedAt: Number.NEGATIVE_INFINITY,
  rawBefore: -1,
  rawBeforeSince: Number.NEGATIVE_INFINITY,
  open: null,
  openAt: 0,
  openRead: false,
  openSettled: false,
  openStint: null,
  laps: [],
  stints: [],
  stint: null,
  changes: 0,
  stops: 0,
  revision: 0,
});

/** The summary as its owner writes it: the same arrays, in place. */
type MutableSummary = {
  -readonly [
    Key in keyof RaceHistorySummarySnapshot
  ]: RaceHistorySummarySnapshot[Key] extends readonly (infer Item)[]
    ? Item[]
    : RaceHistorySummarySnapshot[Key];
};

/** A race as it begins: what it is, and where every car stands. */
export interface RaceStart {
  /** Names the race for as long as the recorder lives. */
  token: string;
  /** The record of what it is. Changed in place as the race goes on. */
  info: RaceInfo;
  /** Laps each car has completed, by CarIdx; -1 for a slot with no car. */
  lapsCompleted: number[];
  /** Session clock on the first frame, seconds. */
  sessionTime: number;
}

export interface RaceHistoryListener {
  /** Another race began. What was kept of the one before is gone. */
  onRaceStarted(start: RaceStart): void;
  /**
   * A lap was completed, or one already kept changed. `settled` is false
   * for a lap just completed that is still waiting for its time.
   */
  onLap(lap: RaceLap, settled: boolean): void;
  /** A stint with at least one lap opened, changed or closed. */
  onStint(stint: RaceStint): void;
  /** A driver change was seen, or one already kept was put down to a stop. */
  onDriverChange(change: RaceDriverChange): void;
  /** The entry list or the tyre list of the race changed. */
  onRaceInfoChanged(): void;
  /**
   * A slot changed hands: another car is in it, and what was kept for the
   * one that left has been dropped.
   */
  onCarReplaced(carIdx: number): void;
  /** The race is over: its session ended, or the sim went away. */
  onRaceEnded(): void;
}

export interface RaceHistoryRecorderOptions {
  /** 'iracing' or 'lmu', as known when a race begins. */
  simulator: () => string;
  /** Whether that simulator's session id names one event and no other. */
  sessionIdsAreUnique: () => boolean;
  /** Wall-clock time in Unix milliseconds. */
  now: () => number;
  /** Distinguishes one run of the app from the next, in a race's token. */
  bootId: string;
}

export class RaceHistoryRecorder {
  private readonly carPit = new CarPitProcessor();
  private readonly lapCounters = new LapCounterWatch(RACE_HISTORY_MAX_CARS);
  private readonly cars: (Car | undefined)[] = [];
  private readonly roster = new Map<number, RosterEntry>();
  /** Slots that are not competitors: the pace car, spectators. */
  private readonly ignored = new Set<number>();
  private readonly sessionTypes = new Map<
    number,
    { type: string | null; name: string | null }
  >();
  /**
   * For each class, when its first car completed each lap, by lap number:
   * what a gap to the class leader at the line is measured from.
   */
  private readonly classFirstAt = new Map<number, number[]>();
  private changes: RaceDriverChange[] = [];

  private session: Session | null = null;
  /** The event and track the session is of; '' before a session. */
  private eventKey = '';
  private entriesKey = NO_ENTRIES_KEY;
  private tyres: RaceTyre[] = [];

  private race: RaceStart | null = null;
  private raceEventKey = '';
  private isRace = false;
  private resumed = false;
  private raceCount = 0;
  /** The furthest the session clock has been in this race. */
  private raceClock = 0;
  /** The session clock on the frame before; null when it is not known. */
  private previousTime: number | null = null;
  /** The lap fractions of the frame before, as that frame held them. */
  private previousPcts: readonly unknown[] | undefined;
  /** The session clock at the last tick. */
  private tickedAt = Number.NEGATIVE_INFINITY;
  /** The flag bits the last tick put on every car's lap. */
  private fieldBits = 0;
  private version = 0;

  private readonly latest: MutableSummary = {
    raceToken: '',
    raceId: null,
    resumed: false,
    laps: [],
    lastLap: [],
    missingLaps: [],
    stintFirstLap: [],
    stintLaps: [],
    stintDriver: [],
    stintAvgLap: [],
    stintCleanLaps: [],
    previousStintAvgLap: [],
    previousStintDriver: [],
    previousDriverStintAvgLap: [],
    previousDriverStintDriver: [],
    driverChanges: [],
    stops: [],
    revision: [],
    sessionNum: null,
    version: 0,
  };
  private summaryVersion = -1;

  constructor(
    private readonly listener: RaceHistoryListener,
    private readonly options: RaceHistoryRecorderOptions
  ) {}

  /**
   * Reads who is in each slot, and what the session is. A slot whose name
   * is another one than before has changed driver; a slot whose car is
   * another one has changed hands.
   */
  onSession(session: Session): void {
    this.session = session;
    this.carPit.init(session);

    const weekend = session?.WeekendInfo;
    const eventKey = `${weekend?.SubSessionID ?? ''}|${weekend?.TrackID ?? ''}`;
    if (this.race && eventKey !== this.raceEventKey) {
      // Another event or another track with the sim still connected.
      this.endRace(true);
    }
    this.eventKey = eventKey;

    this.sessionTypes.clear();
    for (const entry of session?.SessionInfo?.Sessions ?? []) {
      if (typeof entry?.SessionNum !== 'number') continue;
      this.sessionTypes.set(entry.SessionNum, {
        type: entry.SessionType || null,
        name: entry.SessionName || null,
      });
    }

    this.tyres = [];
    for (const tyre of session?.DriverInfo?.DriverTires ?? []) {
      if (
        typeof tyre?.TireIndex === 'number' &&
        typeof tyre.TireCompoundType === 'string'
      ) {
        this.tyres.push({ index: tyre.TireIndex, name: tyre.TireCompoundType });
      }
    }

    this.roster.clear();
    this.ignored.clear();
    for (const driver of session?.DriverInfo?.Drivers ?? []) {
      const carIdx = driver?.CarIdx;
      if (
        typeof carIdx !== 'number' ||
        carIdx < 0 ||
        carIdx >= RACE_HISTORY_MAX_CARS
      ) {
        continue;
      }
      if (driver.CarIsPaceCar === 1 || driver.IsSpectator === 1) {
        this.ignored.add(carIdx);
        continue;
      }
      const car = `${driver.CarPath ?? ''}`;
      this.roster.set(carIdx, {
        driver: driver.UserName ?? '',
        classId: typeof driver.CarClassID === 'number' ? driver.CarClassID : -1,
        // The same two the pit tracker tells a slot changing hands by.
        entryKey: `${car}|${driver.CarNumber ?? ''}`,
        entry: {
          carIdx,
          carNumber: `${driver.CarNumber ?? ''}`,
          car,
          classId:
            typeof driver.CarClassID === 'number' ? driver.CarClassID : -1,
          className: driver.CarClassShortName ?? '',
          teamName: driver.TeamName ?? '',
        },
      });
    }

    if (!this.race) return;
    for (const [carIdx, entry] of this.roster) {
      const car = this.cars[carIdx];
      if (!car) continue;
      if (car.entryKey !== '' && car.entryKey !== entry.entryKey) {
        this.replaceCar(car, entry);
        continue;
      }
      car.entryKey = entry.entryKey;
      car.classId = entry.classId;
      this.setDriver(car, entry.driver);
    }
    this.refreshRaceInfo();
  }

  onFrame(frame: Telemetry): void {
    const laps = arrayOf(frame, 'CarIdxLap');
    const now = scalarOf(frame, 'SessionTime');
    if (!laps || now === null) return;
    const sessionNum = scalarOf(frame, 'SessionNum');

    if (this.race) {
      const raceNum = this.race.info.sessionNum;
      if (
        (sessionNum !== null && raceNum !== null && sessionNum !== raceNum) ||
        // A session that starts again says so first by its clock.
        now < this.raceClock - SESSION_REWIND_SECONDS
      ) {
        this.endRace(true);
      }
    }
    if (!this.race) {
      if (!this.session) return;
      this.startRace(sessionNum, now, laps);
    }
    if (now > this.raceClock) this.raceClock = now;

    // Every frame looks only for a lap count that moved, which is what has
    // to be timed to the frame. Where the cars are, their flags and the
    // sim's lap times move far slower and are read five times a second.
    const tick = now - this.tickedAt >= TICK_SECONDS || now < this.tickedAt;
    if (tick) {
      this.tickedAt = now;
      // The pit tracker first, so that a visit ending on this tick is read
      // with its final times.
      this.carPit.onFrame(frame);
      // A full-course yellow or a stopped session is every car's.
      this.fieldBits = sessionFlagLapBits(
        (scalarOf(frame, 'SessionFlags') ?? 0) & CAUTION_SESSION_FLAGS
      );
    }
    const pcts = arrayOf(frame, 'CarIdxLapDistPct');

    const count = Math.min(laps.length, RACE_HISTORY_MAX_CARS);
    for (let carIdx = 0; carIdx < count; carIdx += 1) {
      if (this.ignored.has(carIdx)) continue;
      const lapNow = Math.trunc(numberAt(laps, carIdx, -1));
      // Taken for every slot, so that a car going out of the world and
      // coming back is a new baseline and not a crossing.
      const completed = this.lapCounters.take(carIdx, lapNow);
      let car = this.cars[carIdx];
      if (!car?.seen) {
        if (lapNow < 0) continue;
        const entry = this.roster.get(carIdx);
        // Not before the session names it: an unnamed slot has no class to
        // be measured in and no driver.
        if (!entry) continue;
        car = this.firstSight(carIdx, entry, lapNow, now);
        car.raw = numberAt(arrayOf(frame, 'CarIdxLastLapTime'), carIdx, -1);
      }
      if (lapNow >= 0) car.lapNow = lapNow;
      if (tick) this.tickCar(car, frame, now, pcts);
      // One lap at a time: a counter that jumped is laps that were not seen,
      // and the time now is not when any of them ended. Lap 0, from the grid
      // to the line, is not a lap either.
      if (
        completed !== NO_CROSSING &&
        completed >= 1 &&
        lapNow === completed + 1
      ) {
        this.recordLap(car, completed, frame, now, pcts);
      }
    }
    this.previousPcts = pcts;
    this.previousTime = now;
  }

  /** What is read of a car five times a second. */
  private tickCar(
    car: Car,
    frame: Telemetry,
    now: number,
    pcts: readonly unknown[] | undefined
  ): void {
    const carIdx = car.carIdx;
    const pit = this.carPit.snapshot();
    const where = pit.where[carIdx];
    if (where !== undefined) this.followPit(car, where, pit, now);

    car.lapBits |= this.fieldBits;
    const ownFlags =
      numberAt(arrayOf(frame, 'CarIdxSessionFlags'), carIdx, 0) & CAR_LAP_FLAGS;
    if (ownFlags !== 0) car.lapBits |= sessionFlagLapBits(ownFlags);

    const raw = numberAt(arrayOf(frame, 'CarIdxLastLapTime'), carIdx, -1);
    if (raw !== car.raw) {
      car.rawBefore = car.raw;
      car.rawBeforeSince = car.rawChangedAt;
      car.raw = raw;
      car.rawChangedAt = now;
    }
    if (car.open) {
      this.followOpenLap(car, frame, now, numberAt(pcts, carIdx, -1));
    }
  }

  /**
   * Forgets where every car was but keeps what is recorded. Call it when
   * frames resume after a gap: the lap counts and the pit lane moved on
   * meanwhile, and what happened in between was not seen.
   */
  rebaseline(): void {
    for (const car of this.cars) {
      if (!car) continue;
      this.closeOpenLap(car, Number.NaN);
      car.lapBits = 0;
      car.place = PLACE_UNKNOWN;
      car.awaySince = Number.NaN;
      car.visitOpen = false;
      car.visitChange = null;
    }
    this.lapCounters.rebaseline();
    this.previousTime = null;
    this.previousPcts = undefined;
    this.tickedAt = Number.NEGATIVE_INFINITY;
    this.resetPitTracker();
  }

  /**
   * Hands on every lap still waiting for its time, as it is, so that it is
   * kept. For when the app is about to stop.
   */
  handOnOpenLaps(): void {
    for (const car of this.cars) {
      if (car) this.closeOpenLap(car, Number.NaN);
    }
  }

  /**
   * The sim went away. The race is let go of, but nothing is said to have
   * ended: the cars may well be racing on, and a stint left open is carried
   * on if the race is picked up again with no lap missed.
   */
  onDisconnect(): void {
    this.endRace(false);
    this.session = null;
    this.eventKey = '';
    this.roster.clear();
    this.ignored.clear();
    this.sessionTypes.clear();
  }

  /** The race being recorded, or null between two. */
  currentRace(): RaceStart | null {
    return this.race;
  }

  /** Goes up whenever anything kept changes. */
  currentVersion(): number {
    return this.version;
  }

  /**
   * Says the race is kept in the file under `id`, or that it is not (null).
   */
  noteStored(id: number | null): void {
    if (!this.race || this.race.info.id === id) return;
    this.race.info.id = id;
    this.version += 1;
  }

  /** The laps kept for a car, oldest first. The recorder's own list. */
  carLaps(carIdx: number): readonly RaceLap[] {
    return this.cars[carIdx]?.laps ?? [];
  }

  /** The stints kept for a car, oldest first. The recorder's own list. */
  carStints(carIdx: number): readonly RaceStint[] {
    return this.cars[carIdx]?.stints ?? [];
  }

  /** A car's counter, as on the summary. */
  carRevision(carIdx: number): number {
    return this.cars[carIdx]?.revision ?? 0;
  }

  /** Every driver change of the race, oldest first. The recorder's own. */
  driverChanges(): readonly RaceDriverChange[] {
    return this.changes;
  }

  /**
   * Lap numbers a car has completed that are not kept: driven while nothing
   * was recording.
   */
  missingLaps(carIdx: number): number[] {
    const car = this.cars[carIdx];
    if (!car) return [];
    const missing: number[] = [];
    const completed = this.lapsCompleted(car);
    let held = 0;
    for (let lap = 1; lap <= completed; lap += 1) {
      while (held < car.laps.length && car.laps[held].lap < lap) held += 1;
      if (car.laps[held]?.lap !== lap) missing.push(lap);
    }
    return missing;
  }

  /**
   * What is held for every car, as it stands now. The same object every
   * time, its arrays written in place; its version moves only when
   * something in it has.
   */
  summary(): RaceHistorySummarySnapshot {
    if (this.summaryVersion === this.version) return this.latest;
    this.summaryVersion = this.version;
    const out = this.latest;
    const race = this.race;
    out.raceToken = race?.token ?? '';
    out.raceId = race?.info.id ?? null;
    out.resumed = this.resumed;
    out.sessionNum = race?.info.sessionNum ?? null;
    const length = race ? this.cars.length : 0;
    resize(out.laps, length, 0);
    resize(out.lastLap, length, 0);
    resize(out.missingLaps, length, 0);
    resize(out.stintFirstLap, length, 0);
    resize(out.stintLaps, length, 0);
    resize(out.stintDriver, length, '');
    resize(out.stintAvgLap, length, -1);
    resize(out.stintCleanLaps, length, 0);
    resize(out.previousStintAvgLap, length, -1);
    resize(out.previousStintDriver, length, '');
    resize(out.previousDriverStintAvgLap, length, -1);
    resize(out.previousDriverStintDriver, length, '');
    resize(out.driverChanges, length, 0);
    resize(out.stops, length, 0);
    resize(out.revision, length, 0);
    for (let carIdx = 0; carIdx < length; carIdx += 1) {
      const car = this.cars[carIdx];
      const stints = car ? car.stints : NO_STINTS;
      const stint = stints[stints.length - 1];
      // The one before the stint under way: the last one that is over.
      const before = stints.length > 1 ? stints[stints.length - 2] : undefined;
      const driver = stint?.driver ?? car?.driver ?? '';
      // After a double stint that one is the same driver's: the pace of
      // whoever had the car before is further back.
      const others = stintByAnotherDriver(stints, driver);
      put(out.laps, carIdx, car?.laps.length ?? 0);
      put(out.lastLap, carIdx, car?.lastLap ?? 0);
      put(
        out.missingLaps,
        carIdx,
        car ? Math.max(0, this.lapsCompleted(car) - car.laps.length) : 0
      );
      put(out.stintFirstLap, carIdx, stint?.firstLap ?? 0);
      put(out.stintLaps, carIdx, stint?.laps ?? 0);
      put(out.stintDriver, carIdx, driver);
      put(out.stintAvgLap, carIdx, stint?.avgLap ?? -1);
      put(out.stintCleanLaps, carIdx, stint?.cleanLaps ?? 0);
      put(out.previousStintAvgLap, carIdx, before?.avgLap ?? -1);
      put(out.previousStintDriver, carIdx, before?.driver ?? '');
      put(out.previousDriverStintAvgLap, carIdx, others?.avgLap ?? -1);
      put(out.previousDriverStintDriver, carIdx, others?.driver ?? '');
      put(out.driverChanges, carIdx, car?.changes ?? 0);
      put(out.stops, carIdx, car?.stops ?? 0);
      put(out.revision, carIdx, car?.revision ?? 0);
    }
    out.version = this.version;
    return out;
  }

  /**
   * Takes in what the file holds of this race, from before a restart. Laps
   * completed since the race was picked up again stay as they are; a stint
   * that was open when the app stopped is carried on where no lap was
   * missed, and is cut short where one was.
   */
  restore(stored: RaceRecords): void {
    if (!this.race) return;
    this.resumed = true;
    const now = this.raceClock;

    const touched = new Set<Car>();
    const carFor = (carIdx: number): Car | null => {
      if (!Number.isInteger(carIdx) || carIdx < 0) return null;
      if (carIdx >= RACE_HISTORY_MAX_CARS) return null;
      const car = this.cars[carIdx] ?? this.addCar(carIdx);
      touched.add(car);
      return car;
    };

    const liveStints = new Map<Car, RaceStint[]>();
    const storedLaps = new Map<Car, RaceLap[]>();
    for (const lap of stored.laps) {
      const car = carFor(lap.carIdx);
      if (!car) continue;
      let list = storedLaps.get(car);
      if (!list) storedLaps.set(car, (list = []));
      list.push({
        ...lap,
        sectors: [...lap.sectors],
        compounds: [...lap.compounds],
      });
    }
    for (const [car, list] of storedLaps) {
      // What was recorded since the race was picked up wins over the file.
      const live = new Set(car.laps.map((lap) => lap.lap));
      car.laps = [...list.filter((lap) => !live.has(lap.lap)), ...car.laps]
        .sort((a, b) => a.lap - b.lap)
        .slice(-RACE_HISTORY_MAX_LAPS_PER_CAR);
      car.lastLap = car.laps[car.laps.length - 1]?.lap ?? 0;
    }

    for (const stint of stored.stints) {
      const car = carFor(stint.carIdx);
      if (!car) continue;
      if (!liveStints.has(car)) {
        liveStints.set(car, car.stints);
        car.stints = [];
        car.stint = null;
      }
      car.stints.push({
        ...stint,
        stop: stint.stop ? { ...stint.stop } : null,
      });
    }
    for (const [car, live] of liveStints) {
      car.stints.sort((a, b) => a.ordinal - b.ordinal);
      // The stops of the stints in the file, and those seen since.
      car.stops += car.stints.filter((s) => s.closedBy === 'stop').length;
      for (const stint of live) {
        const kept = this.attachStint(car, stint, now);
        if (car.openStint === stint) car.openStint = kept;
        if (car.stopStint === stint) car.stopStint = kept;
        if (stint.closedBy === null) car.stint = kept;
        if (kept.laps > 0) this.listener.onStint(kept);
      }
    }

    // The file's changes first, then what was seen since, counted on.
    const seenSince = this.changes;
    this.changes = [];
    const storedSeq = new Map<Car, number>();
    for (const change of stored.driverChanges) {
      const car = carFor(change.carIdx);
      if (!car) continue;
      this.changes.push({ ...change });
      storedSeq.set(car, Math.max(storedSeq.get(car) ?? 0, change.seq));
    }
    for (const change of seenSince) {
      const car = this.cars[change.carIdx];
      const base = car ? (storedSeq.get(car) ?? 0) : 0;
      if (base > 0) {
        change.seq += base;
        this.listener.onDriverChange(change);
      }
      this.changes.push(change);
    }
    for (const [car, base] of storedSeq) car.changes += base;
    this.changes.sort((a, b) => a.sessionTime - b.sessionTime);

    // The class leaders' crossings, so a gap at the line can be measured
    // against a lap that was led before the restart.
    for (const car of touched) {
      if (car.classId < 0) continue;
      const firstAt = this.classFirst(car.classId);
      for (const lap of car.laps) {
        if (lap.classGap === 0) firstAt[lap.lap] ??= lap.sessionTime;
      }
      car.revision += 1;
    }
    this.version += 1;
  }

  // --- A race ---------------------------------------------------------

  private startRace(
    sessionNum: number | null,
    now: number,
    laps: readonly unknown[]
  ): void {
    const session = this.session;
    const weekend = session?.WeekendInfo;
    const kind =
      sessionNum !== null ? this.sessionTypes.get(sessionNum) : undefined;
    const subSessionId = weekend?.SubSessionID ?? 0;
    this.raceCount += 1;
    const wallClock = this.options.now();
    const lapsCompleted: number[] = [];
    const count = Math.min(laps.length, RACE_HISTORY_MAX_CARS);
    for (let carIdx = 0; carIdx < count; carIdx += 1) {
      const lapNow = Math.trunc(numberAt(laps, carIdx, -1));
      lapsCompleted.push(
        lapNow >= 0 && this.roster.has(carIdx) ? Math.max(0, lapNow - 1) : -1
      );
    }
    this.race = {
      token: `${this.options.bootId}:${this.raceCount}`,
      info: {
        id: null,
        simulator: this.options.simulator(),
        // Only an id that names one event and no other. iRacing's test
        // sessions all report 0, and the id Tearoff derives for Le Mans
        // Ultimate is shared by every race at one track on one server.
        sessionKey:
          this.options.sessionIdsAreUnique() &&
          typeof subSessionId === 'number' &&
          subSessionId > 0
            ? `${subSessionId}:${sessionNum ?? 0}`
            : '',
        sessionNum,
        sessionType: kind?.type ?? null,
        sessionName: kind?.name ?? null,
        trackId: typeof weekend?.TrackID === 'number' ? weekend.TrackID : -1,
        trackName: weekend?.TrackDisplayName || weekend?.TrackName || 'Unknown',
        trackConfig: weekend?.TrackConfigName || null,
        trackLengthM: session ? trackLengthFrom(session) : 0,
        startedAt: wallClock,
        updatedAt: wallClock,
        sessionTime: now,
        entries: [],
        tyres: this.tyres,
      },
      lapsCompleted,
      sessionTime: now,
    };
    this.raceEventKey = this.eventKey;
    this.resumed = false;
    this.raceClock = now;
    this.previousTime = null;
    this.previousPcts = undefined;
    this.tickedAt = Number.NEGATIVE_INFINITY;
    this.entriesKey = NO_ENTRIES_KEY;
    this.refreshRaceInfo(true);
    this.version += 1;
    this.listener.onRaceStarted(this.race);
  }

  /**
   * Lets go of the race.
   *
   * @param over The session itself ended, so every stint still open ended
   *   with it. False when only the sight of it was lost.
   */
  private endRace(over: boolean): void {
    if (!this.race) return;
    for (const car of this.cars) {
      if (!car) continue;
      this.closeOpenLap(car, Number.NaN);
      const stint = car.stint;
      if (over && stint && stint.laps > 0) {
        stint.closedBy = 'session';
        stint.endTime = this.raceClock;
        this.listener.onStint(stint);
      }
    }
    this.listener.onRaceEnded();
    this.race = null;
    this.isRace = false;
    this.resumed = false;
    this.cars.length = 0;
    this.changes = [];
    this.classFirstAt.clear();
    this.lapCounters.rebaseline();
    this.previousTime = null;
    this.previousPcts = undefined;
    this.raceClock = 0;
    this.resetPitTracker();
    this.version += 1;
  }

  /** Starts the pit tracker over, with the session it had. */
  private resetPitTracker(): void {
    this.carPit.onLifecycle({ type: 'disconnect' });
    if (this.session) this.carPit.init(this.session);
  }

  /** Brings the race's entry and tyre lists up to the session's. */
  private refreshRaceInfo(quiet = false): void {
    const race = this.race;
    if (!race) return;
    const kind =
      race.info.sessionNum !== null
        ? this.sessionTypes.get(race.info.sessionNum)
        : undefined;
    // A session whose kind was not stated when the race began.
    race.info.sessionType ??= kind?.type ?? null;
    race.info.sessionName ??= kind?.name ?? null;
    this.isRace = race.info.sessionType === 'Race';
    let key = `${race.info.sessionType ?? ''}|${race.info.sessionName ?? ''};`;
    for (const [carIdx, entry] of this.roster) {
      key += `${carIdx}:${entry.entryKey}:${entry.entry.className}:${entry.entry.teamName};`;
    }
    for (const tyre of this.tyres) key += `${tyre.index}=${tyre.name};`;
    if (key === this.entriesKey) return;
    this.entriesKey = key;
    race.info.entries = [...this.roster.values()]
      .map(({ entry }) => entry)
      .sort((a, b) => a.carIdx - b.carIdx);
    race.info.tyres = this.tyres;
    if (!quiet) this.listener.onRaceInfoChanged();
  }

  // --- A car ----------------------------------------------------------

  private addCar(carIdx: number): Car {
    const car = newCar(carIdx);
    // Kept dense: a slot below it with no car is an undefined, not a hole.
    while (this.cars.length < carIdx) this.cars.push(undefined);
    this.cars[carIdx] = car;
    const entry = this.roster.get(carIdx);
    if (entry) {
      car.driver = entry.driver;
      car.classId = entry.classId;
      car.entryKey = entry.entryKey;
    }
    return car;
  }

  /** The first frame of this race with the car in the world. */
  private firstSight(
    carIdx: number,
    entry: RosterEntry,
    lapNow: number,
    now: number
  ): Car {
    const car = this.cars[carIdx] ?? this.addCar(carIdx);
    car.seen = true;
    car.lapNow = lapNow;
    car.classId = entry.classId;
    car.entryKey = entry.entryKey;
    if (entry.driver !== '') car.driver = entry.driver;
    const stint = this.newStint(car, lapNow <= 1 ? 'start' : 'joined', now);
    car.stint = this.attachStint(car, stint, now);
    this.bump(car);
    return car;
  }

  /** Another car in the slot: what was kept is the car's that left. */
  private replaceCar(car: Car, entry: RosterEntry): void {
    const fresh = newCar(car.carIdx);
    fresh.revision = car.revision;
    fresh.driver = entry.driver;
    fresh.classId = entry.classId;
    fresh.entryKey = entry.entryKey;
    this.cars[car.carIdx] = fresh;
    this.changes = this.changes.filter(
      (change) => change.carIdx !== car.carIdx
    );
    this.bump(fresh);
    this.listener.onCarReplaced(car.carIdx);
  }

  /** Laps a car has completed, kept or not. */
  private lapsCompleted(car: Car): number {
    return Math.max(car.lapNow - 1, car.lastLap, 0);
  }

  private bump(car: Car): void {
    car.revision += 1;
    this.version += 1;
  }

  // --- Laps -----------------------------------------------------------

  private recordLap(
    car: Car,
    lapNumber: number,
    frame: Telemetry,
    now: number,
    pcts: readonly unknown[] | undefined
  ): void {
    // The lap before, if its time never came: now is the last word on it.
    this.closeOpenLap(car, now);
    // A number already kept is a counter that went back and came forward
    // again; the lap kept under it stands.
    if (lapNumber <= car.lastLap) return;
    const race = this.race;
    if (!race) return;

    // Between this frame and the one before, by distance. A source that
    // writes its frames into one array has no frame before to read: the
    // crossing is then this frame's.
    const before =
      this.previousPcts !== pcts
        ? numberAt(this.previousPcts, car.carIdx, -1)
        : -1;
    const at = crossingTime(
      before >= 0 ? before : null,
      numberAt(pcts, car.carIdx, -1),
      this.previousTime,
      now
    );
    if (car.lastLap > 0 && lapNumber !== car.lastLap + 1) {
      // Laps between were not seen, and neither was what the car did on
      // them: the stint it was on ends with the last lap that was.
      const last = car.laps[car.laps.length - 1];
      this.endStint(car, 'gap', last?.sessionTime ?? at, null);
    }
    const stint = car.stint ?? this.openStint(car, 'joined', at);

    const position = numberAt(arrayOf(frame, 'CarIdxPosition'), car.carIdx, 0);
    const classPosition = numberAt(
      arrayOf(frame, 'CarIdxClassPosition'),
      car.carIdx,
      0
    );
    const lap: RaceLap = {
      carIdx: car.carIdx,
      lap: lapNumber,
      sessionTime: at,
      lapTime: null,
      sectors: NO_SECTORS,
      position: position > 0 ? position : null,
      classPosition: classPosition > 0 ? classPosition : null,
      classGap: this.classGap(car, lapNumber, at),
      flags:
        car.lapBits |
        (lapNumber === 1 && this.isRace ? LEDGER_LAP_FROM_START : 0),
      driver: car.driver,
      energy: null,
      energyIsVirtual: false,
      compounds: [-1, -1, -1, -1],
    };
    car.lapBits = 0;
    car.laps.push(lap);
    if (car.laps.length > RACE_HISTORY_MAX_LAPS_PER_CAR) car.laps.shift();
    car.lastLap = lapNumber;

    stint.laps += 1;
    stint.firstLap ??= lapNumber;
    stint.lastLap = lapNumber;

    car.open = lap;
    car.openAt = at;
    car.openRead = false;
    car.openSettled = false;
    car.openStint = stint;

    race.info.sessionTime = this.raceClock;
    race.info.updatedAt = this.options.now();
    this.bump(car);
    this.listener.onLap(lap, false);
    this.listener.onStint(stint);
  }

  /**
   * Seconds behind the first car of the class to complete the lap; 0 for
   * that car. Null when that car's crossing was not seen.
   */
  private classGap(car: Car, lapNumber: number, at: number): number | null {
    if (car.classId < 0) return null;
    const firstAt = this.classFirst(car.classId);
    const first = firstAt[lapNumber];
    if (first !== undefined) return Math.max(0, at - first);
    // Nobody of the class is known to have completed it. This car is the
    // first only if none of them is already on the lap after it: one that
    // is completed this lap while nothing was recording.
    for (const other of this.cars) {
      if (
        other &&
        other !== car &&
        other.classId === car.classId &&
        other.lapNow > lapNumber
      ) {
        return null;
      }
    }
    firstAt[lapNumber] = at;
    return 0;
  }

  private classFirst(classId: number): number[] {
    let firstAt = this.classFirstAt.get(classId);
    if (!firstAt) {
      firstAt = [];
      this.classFirstAt.set(classId, firstAt);
    }
    return firstAt;
  }

  /** One frame of a car whose newest lap is waiting for its time. */
  private followOpenLap(
    car: Car,
    frame: Telemetry,
    now: number,
    pct: number
  ): void {
    const lap = car.open;
    if (!lap) return;
    const since = now - car.openAt;
    // Not at the line itself: the reading that goes with a lap completion
    // is taken a moment after it, for the pit tracker's reason.
    if (since < ENERGY_SETTLE_SECONDS) return;
    if (!car.openRead) {
      car.openRead = true;
      this.readAfterLine(car, lap, frame);
    }
    // The sim's time moved since a moment before the line: it is this
    // lap's. Under Le Mans Ultimate it can lead the lap count.
    const timed = car.rawChangedAt >= car.openAt - EARLY_TIME_WINDOW_SECONDS;
    if (!car.openSettled) {
      if (timed) {
        this.applyTime(car, lap, frame);
        car.open = null;
      } else if (since < LAP_TIME_WAIT_SECONDS) {
        return;
      } else {
        car.openSettled = true;
      }
      this.bump(car);
      this.listener.onLap(lap, true);
      if (timed && car.openStint) this.listener.onStint(car.openStint);
      return;
    }
    // A time that came late. Near the end of the next lap it is that lap's
    // own, a moment early: this one is then left as it is until the car
    // completes that lap, which is the last that can be said of it.
    if (!timed || pct < 0 || pct >= LATE_TIME_MAX_PCT) return;
    this.applyTime(car, lap, frame);
    car.open = null;
    this.bump(car);
    this.listener.onLap(lap, true);
    if (car.openStint) this.listener.onStint(car.openStint);
  }

  /** What the car has left to run on, and on which tyres. */
  private readAfterLine(car: Car, lap: RaceLap, frame: Telemetry): void {
    const carIdx = car.carIdx;
    const energy = numberAt(
      arrayOf(frame, 'LmuCarIdxEnergyRemaining'),
      carIdx,
      -1
    );
    lap.energy = energy >= 0 ? energy : null;
    lap.energyIsVirtual =
      lap.energy !== null &&
      flagAt(arrayOf(frame, 'LmuCarIdxEnergyIsVirtual'), carIdx);

    const wheels = arrayOf(frame, 'LmuCarIdxWheelCompounds');
    const single = numberAt(arrayOf(frame, 'CarIdxTireCompound'), carIdx, -1);
    const compounds = lap.compounds as number[];
    for (let wheel = 0; wheel < WHEEL_COUNT; wheel += 1) {
      compounds[wheel] = numberAt(wheels, carIdx * WHEEL_COUNT + wheel, single);
    }
  }

  /** Gives a lap the sim's time and sectors, and its stint the lap's pace. */
  private applyTime(car: Car, lap: RaceLap, frame: Telemetry): void {
    const carIdx = car.carIdx;
    // Le Mans Ultimate says outright that a lap did not count; the time in
    // its place is one measured from the lap's two starts, not the sim's.
    const notCounted = flagAt(
      arrayOf(frame, 'LmuCarIdxLastLapInvalid'),
      carIdx
    );
    if (notCounted || !(car.raw > 0)) {
      lap.lapTime = null;
      lap.flags |= LEDGER_LAP_VOIDED;
    } else {
      lap.lapTime = car.raw;
    }
    const sectorTimes = arrayOf(frame, 'LmuCarIdxLastSectorTimes');
    const base = carIdx * SECTOR_COUNT;
    if (sectorTimes && sectorTimes.length >= base + SECTOR_COUNT) {
      const sectors: (number | null)[] = [null, null, null];
      for (let sector = 0; sector < SECTOR_COUNT; sector += 1) {
        const value = sectorTimes[base + sector];
        sectors[sector] = typeof value === 'number' && value > 0 ? value : null;
      }
      lap.sectors = sectors;
    }
    this.countPace(car.openStint, lap);
  }

  private countPace(stint: RaceStint | null, lap: RaceLap): void {
    if (!stint || lap.lapTime === null || !isCleanLap(lap.flags)) return;
    const sum = (stint.avgLap ?? 0) * stint.cleanLaps + lap.lapTime;
    stint.cleanLaps += 1;
    stint.avgLap = sum / stint.cleanLaps;
    stint.bestLap =
      stint.bestLap === null
        ? lap.lapTime
        : Math.min(stint.bestLap, lap.lapTime);
  }

  /**
   * Stops waiting for the newest lap's time.
   *
   * @param nextCrossingAt The session time at which the car completed the
   *   lap after it; NaN when it has not. A time that stood for all of that
   *   lap was this lap's too: the lap-time history reads a time the sim
   *   repeats the same way.
   */
  private closeOpenLap(car: Car, nextCrossingAt: number): void {
    const lap = car.open;
    if (!lap) return;
    car.open = null;
    if (!car.openSettled) {
      // Handed on as it is, so that it is kept at all.
      this.listener.onLap(lap, true);
      return;
    }
    if (Number.isNaN(nextCrossingAt) || lap.lapTime !== null) return;
    // A time that has only just moved is the lap's that has just ended;
    // what stood through that lap is the one before it.
    const justMoved =
      car.rawChangedAt >= nextCrossingAt - EARLY_TIME_WINDOW_SECONDS;
    const stood = justMoved ? car.rawBefore : car.raw;
    const since = justMoved ? car.rawBeforeSince : car.rawChangedAt;
    if (!(stood > 0) || since >= car.openAt - EARLY_TIME_WINDOW_SECONDS) {
      return;
    }
    lap.lapTime = stood;
    this.countPace(car.openStint, lap);
    this.bump(car);
    this.listener.onLap(lap, true);
    if (car.openStint) this.listener.onStint(car.openStint);
  }

  // --- The pit lane ---------------------------------------------------

  /** One frame of where a car is, as the pit tracker has it. */
  private followPit(
    car: Car,
    where: number,
    pit: CarPitSnapshot,
    now: number
  ): void {
    if (where === CAR_PIT_IN_GARAGE) {
      if (car.place === CAR_PIT_IN_GARAGE || car.place === PLACE_UNKNOWN) {
        car.place = CAR_PIT_IN_GARAGE;
        return;
      }
      if (Number.isNaN(car.awaySince)) {
        car.awaySince = now;
        return;
      }
      if (now - car.awaySince < AWAY_SECONDS) return;
      // Gone for good from where it was racing.
      if (car.place === CAR_PIT_ON_TRACK) car.lapBits |= LEDGER_LAP_IN_LAP;
      if (!car.visitIsStop || !car.visitOpen) {
        this.endStint(car, 'garage', car.awaySince, null);
        this.bump(car);
      }
      car.visitOpen = false;
      car.visitChange = null;
      car.place = CAR_PIT_IN_GARAGE;
      car.awaySince = Number.NaN;
      return;
    }
    car.awaySince = Number.NaN;

    if (where === CAR_PIT_IN_LANE) {
      if (car.place !== CAR_PIT_IN_LANE) {
        const drivenIn = car.place === CAR_PIT_ON_TRACK;
        if (drivenIn) car.lapBits |= LEDGER_LAP_IN_LAP;
        car.visitOpen = true;
        car.visitEntrySeen = drivenIn;
        car.visitEntryAt = now;
        car.visitLap = car.lastLap;
        car.visitIsStop = false;
        car.visitChange = null;
        car.place = CAR_PIT_IN_LANE;
      }
      if (
        car.visitOpen &&
        !car.visitIsStop &&
        isStopVisit(numberAt(pit.standingS, car.carIdx, 0))
      ) {
        this.visitBecameStop(car, pit, now);
      }
      return;
    }

    if (where !== CAR_PIT_ON_TRACK) return;
    if (car.place === CAR_PIT_IN_LANE && car.visitOpen) {
      this.endVisit(car, pit, now);
    } else if (car.place === CAR_PIT_IN_GARAGE) {
      // Straight out of the garage.
      car.lapBits |= LEDGER_LAP_OUT_LAP;
    }
    car.place = CAR_PIT_ON_TRACK;
  }

  /** The car has stood in the lane for more than a second: its stint ends. */
  private visitBecameStop(car: Car, pit: CarPitSnapshot, now: number): void {
    car.visitIsStop = true;
    car.stops += 1;
    const change = car.visitChange;
    car.visitChange = null;
    car.stopStint = this.endStint(
      car,
      'stop',
      car.visitEntrySeen ? car.visitEntryAt : now,
      {
        laneTime: null,
        standingTime: numberAt(pit.standingS, car.carIdx, 0),
        driverChanged: change !== null,
      }
    );
    car.stopExitAt = Number.NaN;
    if (change) {
      change.atStop = true;
      this.listener.onDriverChange(change);
    }
    this.bump(car);
  }

  /** The car is back on the track from the lane. */
  private endVisit(car: Car, pit: CarPitSnapshot, now: number): void {
    const laneTime = numberAt(pit.laneTimeS, car.carIdx, 0);
    const standingTime = numberAt(pit.standingS, car.carIdx, 0);
    car.visitOpen = false;
    if (!car.visitEntrySeen || isPitLapVisit(laneTime)) {
      car.lapBits |= LEDGER_LAP_OUT_LAP;
    } else if (car.lastLap === car.visitLap) {
      // A brush of the pit entry line, on a lap still under way.
      car.lapBits &= ~LEDGER_LAP_IN_LAP;
    }

    if (car.visitIsStop) {
      const stop = car.stopStint?.stop;
      if (car.stopStint && stop) {
        stop.laneTime = car.visitEntrySeen ? laneTime : null;
        stop.standingTime = standingTime;
        this.listener.onStint(car.stopStint);
      }
      car.stopExitAt = now;
      // The stint after it is driven from the pit exit.
      if (car.stint?.openedBy === 'stop') {
        car.stint.startTime = now;
        if (car.stint.laps > 0) this.listener.onStint(car.stint);
      }
      this.bump(car);
      return;
    }
    const change = car.visitChange;
    car.visitChange = null;
    if (change) {
      // Another driver and no stop seen: the name alone ends the stint.
      this.endStint(car, 'driver', change.sessionTime, null);
      this.bump(car);
    }
  }

  // --- Stints ---------------------------------------------------------

  private newStint(car: Car, by: RaceStintOpenedBy, at: number): RaceStint {
    return {
      carIdx: car.carIdx,
      ordinal: (car.stints[car.stints.length - 1]?.ordinal ?? 0) + 1,
      driver: car.driver,
      openedBy: by,
      closedBy: null,
      firstLap: null,
      lastLap: null,
      startTime: at,
      endTime: null,
      laps: 0,
      cleanLaps: 0,
      avgLap: null,
      bestLap: null,
      stop: null,
    };
  }

  private openStint(car: Car, by: RaceStintOpenedBy, at: number): RaceStint {
    const stint = this.newStint(car, by, at);
    car.stints.push(stint);
    if (car.stints.length > RACE_HISTORY_MAX_STINTS_PER_CAR) car.stints.shift();
    car.stint = stint;
    return stint;
  }

  /**
   * Ends the open stint and opens the next. A stint without a lap is not
   * kept: null then, the stint otherwise.
   */
  private endStint(
    car: Car,
    by: RaceStintClosedBy,
    at: number,
    stop: RaceStintStop | null
  ): RaceStint | null {
    const stint = car.stint;
    let kept: RaceStint | null = null;
    if (stint) {
      if (stint.laps > 0) {
        stint.closedBy = by;
        stint.endTime = at;
        stint.stop = stop;
        kept = stint;
        this.listener.onStint(stint);
      } else {
        car.stints.pop();
      }
    }
    this.openStint(
      car,
      by === 'stop' || by === 'garage' || by === 'driver' ? by : 'joined',
      at
    );
    return kept;
  }

  /**
   * Puts a stint after the ones a car already has. Where the last of those
   * is still open, the stint carries it on if no lap was missed between
   * them and the driver is the same; otherwise that one is cut short, since
   * where it really ended was not seen. Returns the stint that stands.
   */
  private attachStint(car: Car, stint: RaceStint, now: number): RaceStint {
    const last = car.stints[car.stints.length - 1];
    if (last && last !== stint && last.closedBy === null) {
      const first = stint.firstLap ?? (car.lapNow >= 1 ? car.lapNow : null);
      if (
        first !== null &&
        last.lastLap !== null &&
        first === last.lastLap + 1 &&
        sameDriver(last.driver, stint.driver)
      ) {
        const sum =
          (last.avgLap ?? 0) * last.cleanLaps +
          (stint.avgLap ?? 0) * stint.cleanLaps;
        last.cleanLaps += stint.cleanLaps;
        last.avgLap = last.cleanLaps > 0 ? sum / last.cleanLaps : null;
        last.bestLap =
          last.bestLap === null || stint.bestLap === null
            ? (last.bestLap ?? stint.bestLap)
            : Math.min(last.bestLap, stint.bestLap);
        last.laps += stint.laps;
        last.lastLap = stint.lastLap ?? last.lastLap;
        last.closedBy = stint.closedBy;
        last.endTime = stint.endTime;
        last.stop = stint.stop;
        if (last.driver === '') last.driver = stint.driver;
        return last;
      }
      last.closedBy = 'gap';
      last.endTime =
        car.laps.find((lap) => lap.lap === last.lastLap)?.sessionTime ??
        last.startTime;
      if (last.laps > 0) this.listener.onStint(last);
      if (
        last.driver !== '' &&
        stint.driver !== '' &&
        last.driver !== stint.driver
      ) {
        // Another driver than when the app stopped: changed while nothing
        // was recording, so all that is known is when it was noticed.
        this.pushChange(car, last.driver, stint.driver, now, false);
      }
    }
    stint.ordinal = (last?.ordinal ?? 0) + 1;
    car.stints.push(stint);
    if (car.stints.length > RACE_HISTORY_MAX_STINTS_PER_CAR) car.stints.shift();
    return stint;
  }

  // --- Drivers --------------------------------------------------------

  /** Takes the name the session gives a car now. */
  private setDriver(car: Car, name: string): void {
    if (name === '' || name === car.driver) return;
    const from = car.driver;
    car.driver = name;
    if (from === '' || !car.seen || !car.stint) {
      // The first name the car has had here: nobody was replaced.
      if (car.stint && car.stint.driver === '') car.stint.driver = name;
      return;
    }
    const now = this.raceClock;
    const change = this.pushChange(car, from, name, now, false);
    if (car.visitOpen && !car.visitIsStop) {
      // In the pit lane and not stopped yet: whether this came with a stop
      // is known when the car stands still, or leaves.
      car.visitChange = change;
    } else if (
      car.stint.openedBy === 'stop' &&
      ((car.visitOpen && car.visitIsStop) ||
        now - car.stopExitAt <= DRIVER_SETTLE_SECONDS)
    ) {
      // The session names the new driver during the stop or, as often, a
      // while after it: either way the stint the stop began is theirs.
      this.driverTookOver(car, change);
    } else {
      this.endStint(car, 'driver', now, null);
    }
    this.bump(car);
  }

  private pushChange(
    car: Car,
    from: string,
    to: string,
    at: number,
    atStop: boolean
  ): RaceDriverChange {
    car.changes += 1;
    const change: RaceDriverChange = {
      carIdx: car.carIdx,
      seq: car.changes,
      sessionTime: at,
      lap: this.lapsCompleted(car),
      from,
      to,
      atStop,
    };
    this.changes.push(change);
    if (this.changes.length > RACE_HISTORY_MAX_DRIVER_CHANGES) {
      this.changes.shift();
    }
    this.listener.onDriverChange(change);
    return change;
  }

  /** A change that belongs to the stop the open stint began at. */
  private driverTookOver(car: Car, change: RaceDriverChange): void {
    change.atStop = true;
    this.listener.onDriverChange(change);
    const ended = car.stopStint;
    if (ended?.stop) {
      ended.stop.driverChanged = true;
      this.listener.onStint(ended);
    }
    const stint = car.stint;
    if (!stint) return;
    stint.driver = change.to;
    if (stint.firstLap === null) return;
    // Laps of it kept under the name the session still had.
    for (let index = car.laps.length - 1; index >= 0; index -= 1) {
      const lap = car.laps[index];
      if (lap.lap < stint.firstLap) break;
      lap.driver = change.to;
      if (lap !== car.open || car.openSettled) this.listener.onLap(lap, true);
    }
    this.listener.onStint(stint);
  }
}
