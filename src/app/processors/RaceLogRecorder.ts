import type {
  CarPitSnapshot,
  RaceDriverChange,
  RaceEntry,
  RaceEvent,
  RaceFlag,
  RaceFlagEvent,
  RaceLap,
  RaceLogSnapshot,
  RacePenaltyEvent,
  RacePenaltyName,
  RacePitExitEvent,
  RaceRetiredReason,
  RaceStint,
  Session,
  Telemetry,
} from '@irdashies/types';
import {
  CAR_PIT_IN_GARAGE,
  CAR_PIT_IN_LANE,
  CAR_PIT_ON_TRACK,
  GlobalFlags,
  LMU_FINISH_STATUS,
  RACE_HISTORY_MAX_CARS,
  RACE_LOG_MAX_EVENTS,
  RACE_LOG_PAGE_EVENTS,
  RACE_LOG_SNAPSHOT_EVENTS,
  RACE_LOG_THIN_FROM,
  SessionState,
  TrackLocation,
  isThinnedFirst,
  lmuPenaltyKindFromCode,
} from '@irdashies/types';
import { DRIVER_SETTLE_SECONDS } from './PitStopProcessor';
import { PIT_LAP_SECONDS, isStopVisit } from './pitVisit';
import { AWAY_SECONDS, type RaceStart } from './RaceHistoryRecorder';
import {
  WeatherForecastProcessor,
  lmuForecastSlot,
} from './WeatherForecastProcessor';

/**
 * The log of the race being recorded: what happened in it, one event at a
 * time, newest last.
 *
 * Pure, and beside the race history's recorder, which is where everything
 * it knows of laps, stops and drivers comes from. It is told what that
 * recorder tells its listener, and is handed the frame and the pit
 * tracker's reading on each of that recorder's slow ticks. It works out
 * nothing of its own about what a stop or a driver change is: a stop is a
 * stint the race history closed with one, with the times it gave it; a
 * driver change is one it announced. What is read off the frames here is
 * what the race history does not keep: the flags for the whole field, a
 * car driving into the pit lane, a car staying away, the place of the own
 * car, the penalties the sim counts.
 *
 * Its host, `RaceHistoryRuntime`, stores the events with the rest of the
 * race and publishes the most recent.
 *
 * Nothing is logged from the first tick of a race, or from the first after
 * a gap in the frames: what is found then is where things stand, not
 * something that happened. The one exception is a caution or a red that is
 * out and that the log does not know of, which is said, marked as noticed
 * late.
 *
 * Caps: RACE_LOG_MAX_EVENTS events, the oldest going first, and from
 * RACE_LOG_THIN_FROM on a fastest lap or a change of place goes before
 * anything else. Per-car state is made once per car and changed in place: a
 * tick on which nothing happens allocates nothing.
 */

/**
 * How long a car is in its garage, or out of the world, before it is said
 * to be out. A long repair is five minutes too, and is what the event says.
 */
export const RACE_LOG_PARKED_SECONDS = 300;

/**
 * A class's fastest lap is logged from the lap one of its cars completes
 * its third on: before that every lap is somebody's fastest.
 */
export const RACE_LOG_FASTEST_LAP_FROM_LAP = 3;

/**
 * How long a class's new fastest lap waits before it is said. The cars of
 * a class cross the line one after another, and on a lap that is quick for
 * all of them each betters the one before: said at once, that is a line in
 * the log for every car. Said after a moment, it is the one that stands.
 */
export const RACE_LOG_FASTEST_LAP_SETTLE_SECONDS = 15;

/**
 * How far the own car runs in a place before it is said to hold it: a lap
 * and a little more. Both sims hand out places at the line, so a place held
 * for exactly a lap would be said in the moment before the next one
 * replaces it.
 */
export const RACE_LOG_PLACE_HOLD_LAPS = 1.05;

/** LMU's sky types from 5 up have rain in them. */
const SKY_RAIN_FROM = 5;

/** LMU's mGamePhase, as the flag processor reads it. */
const PHASE_COUNTDOWN = 4;
const PHASE_GREEN = 5;
const PHASE_FULL_COURSE_YELLOW = 6;
const PHASE_STOPPED = 7;
const PHASE_OVER = 8;
/** A heartbeat while the sim is paused: it says nothing about the session. */
const PHASE_PAUSED = 9;

/** A place not acted on yet: the car has not been seen since the baseline. */
const PLACE_UNKNOWN = -1;
/** A slot with no car of the race in it. */
const NOT_ENTERED = -2;

const CAUTION_FLAGS = GlobalFlags.Caution | GlobalFlags.CautionWaving;

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

const flagOf = (frame: Telemetry, key: string): boolean =>
  (frame as unknown as Cells)[key]?.value?.[0] === true;

const numberAt = (
  values: readonly unknown[] | undefined,
  index: number,
  fallback: number
): number => {
  const value = values?.[index];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
};

/** What is kept about one car. Made once per car, then changed in place. */
interface LogCar {
  carIdx: number;
  /** CAR_PIT_* as last acted on, or PLACE_UNKNOWN. */
  place: number;
  /** When the car went to its garage or out of the world; NaN while here. */
  awaySince: number;
  /** It has been out on the circuit, or completed a lap, in this race. */
  raced: boolean;
  /** It has been said to be out, and has not been seen on the circuit since. */
  outSaid: boolean;
  /** When the absence that was said began; NaN where that was not seen. */
  outSince: number;

  /** The car was seen to drive into the lane on the visit under way. */
  entrySeen: boolean;
  entryAt: number;
  entryPosition: number | null;
  /** The visit has lasted long enough to be said. */
  entrySaid: boolean;
  /** The stop the visit has become, as the race history tells it. */
  stop: RaceStint | null;
  /** A driver change the race history put down to that stop. */
  stopChange: RaceDriverChange | null;
  /** The last stop it was said to have left, while it can still change. */
  lastExit: RacePitExitEvent | null;
  /** When the stint that stop ended was closed: what tells stops apart. */
  lastExitStopAt: number;

  /** LMU's count of penalties as last read; -1 before a reading. */
  penalties: number;
  /** A penalty given whose kind the sim had not named yet. */
  unnamedPenalty: RacePenaltyEvent | null;
  /** iRacing's black flag as last read. */
  black: boolean;
  disqualified: boolean;
  /** LMU lists it as not finishing. */
  dnf: boolean;
}

const newLogCar = (carIdx: number): LogCar => ({
  carIdx,
  place: PLACE_UNKNOWN,
  awaySince: Number.NaN,
  raced: false,
  outSaid: false,
  outSince: Number.NaN,
  entrySeen: false,
  entryAt: 0,
  entryPosition: null,
  entrySaid: false,
  stop: null,
  stopChange: null,
  lastExit: null,
  lastExitStopAt: Number.NaN,
  penalties: -1,
  unnamedPenalty: null,
  black: false,
  disqualified: false,
  dnf: false,
});

/** How quick a class has been. Made once per class, then changed in place. */
interface ClassPace {
  /** Its fastest lap, seconds; infinite before one. */
  best: number;
  /** The most laps one of its cars has completed. */
  laps: number;
  /** The lap that is its fastest, while that is still to be said. */
  carIdx: number;
  lap: number;
  driver: string;
  /** Session clock at the line, and the clock in the sim when it was told. */
  at: number;
  timeOfDay: number | null;
  /** When it is to be said; NaN with nothing to say. */
  dueAt: number;
}

/** A caution or a red: whether it is out, and since when. */
interface Spell {
  on: boolean;
  /** Session clock when it began; NaN where that was not seen. */
  since: number;
  /** The event that said it late, while it may still turn out to be known. */
  late: RaceFlagEvent | null;
}

const newSpell = (): Spell => ({ on: false, since: Number.NaN, late: null });

export interface RaceLogListener {
  /** An event was added, or one already kept changed. */
  onEvent(event: RaceEvent): void;
  /**
   * Events went: at the cap, or because the file turned out to hold them
   * already. The events themselves, so that one never written can be told
   * from one in the file.
   */
  onEventsRemoved(events: readonly RaceEvent[]): void;
}

const NO_EVENTS: readonly RaceEvent[] = Object.freeze([]);

export class RaceLogRecorder {
  private race: RaceStart | null = null;
  private session: Session | null = null;
  private events: RaceEvent[] = [];
  private nextSeq = 1;
  /** How many of the events are of a kind that is thinned first. */
  private thinnable = 0;
  private version = 0;

  private readonly cars: (LogCar | undefined)[] = [];
  /** The class of the car in each slot, or NOT_ENTERED. */
  private readonly classOf: number[] = [];
  private entriesSeen: readonly RaceEntry[] | null = null;

  /** False until a tick has been read since the race began, or a gap. */
  private baselined = false;
  /** The session clock and the clock in the sim at the last tick. */
  private clock = 0;
  private timeOfDay: number | null = null;

  private readonly caution = newSpell();
  private readonly red = newSpell();
  private chequeredSaid = false;
  /** The tick before read the start procedure: the grid, a formation lap. */
  private wasBeforeStart = false;
  /** The race is under way: after its start and before its flag. */
  private underway = false;

  /** The own car's slot, its place as last said, and the one being held. */
  private ownCarIdx = -1;
  private saidPlace = 0;
  /** The car `saidPlace` is of. */
  private saidCarIdx = -1;
  private heldPlace = 0;
  /** Laps the own car had covered when it took the place being held. */
  private heldFrom = 0;

  /** How quick each class has been, by class. */
  private readonly paces = new Map<number, ClassPace>();
  /** How many classes have a fastest lap waiting to be said. */
  private pacesDue = 0;

  /** Driver changes not yet known to be with or without a stop. */
  private readonly pending: RaceDriverChange[] = [];
  private readonly changeSeen = new WeakSet<RaceDriverChange>();

  private readonly weather = new WeatherForecastProcessor();
  private forecastKey: string | null = null;
  private forecastChanged = false;

  constructor(private readonly listener: RaceLogListener) {}

  // --- What the race history's recorder says ---------------------------

  /** Another race began. What was logged of the one before is gone. */
  onRaceStarted(start: RaceStart): void {
    this.clear();
    this.race = start;
    this.readForecast(true);
    this.version += 1;
  }

  /** The race is over, or the sight of it was lost. */
  onRaceEnded(): void {
    if (!this.race) return;
    this.clear();
    this.version += 1;
  }

  onSession(session: Session): void {
    this.session = session;
    this.readForecast(false);
  }

  /** A lap with the sim's time on it may be the fastest of its class. */
  onLap(lap: RaceLap): void {
    if (!this.race) return;
    this.refreshEntries();
    const classId = this.classOf[lap.carIdx] ?? NOT_ENTERED;
    if (classId === NOT_ENTERED) return;
    const car = this.carFor(lap.carIdx);
    car.raced = true;
    const pace = this.paceOf(classId);
    const waiting = !Number.isNaN(pace.dueAt);
    if (pace.laps < lap.lap) {
      const counted = pace.laps >= RACE_LOG_FASTEST_LAP_FROM_LAP;
      pace.laps = lap.lap;
      // From here the class's fastest lap is said: the one it has by now,
      // once the cars behind this one have had their go at the same lap.
      if (!counted && waiting && lap.lap >= RACE_LOG_FASTEST_LAP_FROM_LAP) {
        pace.dueAt = this.clock + RACE_LOG_FASTEST_LAP_SETTLE_SECONDS;
      }
    }
    const time = lap.lapTime;
    // The same lap told again, as when its driver is named late, is not
    // quicker than itself.
    if (time === null || !(time > 0) || time >= pace.best) return;
    pace.best = time;
    pace.carIdx = lap.carIdx;
    pace.lap = lap.lap;
    pace.driver = lap.driver;
    pace.at = lap.sessionTime;
    pace.timeOfDay = this.timeOfDay;
    if (!waiting) {
      // A lap that betters one still waiting takes its place and its turn.
      pace.dueAt = this.clock + RACE_LOG_FASTEST_LAP_SETTLE_SECONDS;
      this.pacesDue += 1;
    }
  }

  /** A stint a stop ended: the stop the car is making, or has just made. */
  onStint(stint: RaceStint): void {
    if (!this.race || stint.closedBy !== 'stop' || !stint.stop) return;
    const car = this.cars[stint.carIdx];
    if (!car) return;
    if (car.place === CAR_PIT_IN_LANE) {
      // Said when the car leaves, with the times the stop ends up with.
      if (car.entrySeen && !car.entrySaid) this.sayEntry(car);
      car.stop = stint;
      return;
    }
    // Out of the lane already: the stop last said, with a time of it moved.
    const exit = car.lastExit;
    if (!exit || car.lastExitStopAt !== stint.endTime) return;
    if (
      exit.standingTime === stint.stop.standingTime &&
      exit.laneTime === stint.stop.laneTime
    ) {
      return;
    }
    exit.standingTime = stint.stop.standingTime;
    exit.laneTime = stint.stop.laneTime;
    this.changed(exit);
  }

  /**
   * A driver change was seen, or one already seen was put down to a stop.
   * Whether it came with a stop is the race history's to say, and it can
   * say so later: a change is logged on its own only once the car is out of
   * the pit lane with no stop to its name.
   */
  onDriverChange(change: RaceDriverChange): void {
    if (!this.race) return;
    if (change.atStop) {
      const waiting = this.pending.indexOf(change);
      // Told a second time with nothing new: it is in the log already.
      if (waiting < 0 && this.changeSeen.has(change)) return;
      if (waiting >= 0) this.pending.splice(waiting, 1);
      this.changeSeen.add(change);
      this.putDownToStop(change);
      return;
    }
    if (this.changeSeen.has(change)) return;
    this.changeSeen.add(change);
    this.pending.push(change);
  }

  /**
   * Another car is in the slot. What was logged of the one that left goes,
   * as its laps and stints do: the entry list no longer names it.
   */
  onCarReplaced(carIdx: number): void {
    this.cars[carIdx] = undefined;
    for (const pace of this.paces.values()) {
      // A fastest lap of its that was still to be said is not said of the
      // car now in its slot. The time stands as the class's.
      if (pace.carIdx !== carIdx || Number.isNaN(pace.dueAt)) continue;
      pace.dueAt = Number.NaN;
      this.pacesDue -= 1;
    }
    for (let index = this.pending.length - 1; index >= 0; index -= 1) {
      if (this.pending[index].carIdx === carIdx) this.pending.splice(index, 1);
    }
    if (!this.events.some((event) => event.carIdx === carIdx)) return;
    this.events = this.events.filter((event) => event.carIdx !== carIdx);
    this.thinnable = this.events.filter((event) =>
      isThinnedFirst(event.kind)
    ).length;
    this.version += 1;
  }

  // --- The frames ------------------------------------------------------

  /**
   * One slow tick of the race history's recorder: the frame it read, and
   * where its pit tracker has every car.
   */
  onTick(frame: Telemetry, pit: CarPitSnapshot, now: number): void {
    const race = this.race;
    if (!race) return;
    const first = !this.baselined;
    this.clock = now;
    const timeOfDay = scalarOf(frame, 'SessionTimeOfDay');
    this.timeOfDay = timeOfDay !== null && timeOfDay >= 0 ? timeOfDay : null;
    this.refreshEntries();
    const isRace = race.info.sessionType === 'Race';
    const isLmu = scalarOf(frame, 'LmuGamePhase') !== null;

    this.followField(frame, now, first, isRace);

    const where = pit.where;
    const places = arrayOf(frame, 'CarIdxClassPosition');
    const surfaces = arrayOf(frame, 'CarIdxTrackSurface');
    const carFlags = arrayOf(frame, 'CarIdxSessionFlags');
    const finish = arrayOf(frame, 'LmuCarIdxFinishStatus');
    const penalties = isLmu ? arrayOf(frame, 'LmuCarIdxPenalties') : undefined;
    const penaltyKinds = arrayOf(frame, 'LmuCarIdxPenaltyKind');
    const penaltySeconds = arrayOf(frame, 'LmuCarIdxPenaltySeconds');
    // Parked cars are counted in a race under way: before its start and
    // while it is stopped the whole field stands in the pits.
    const countParked = isRace && this.underway && !this.red.on;

    const count = Math.min(where.length, this.classOf.length);
    for (let carIdx = 0; carIdx < count; carIdx += 1) {
      if (this.classOf[carIdx] === NOT_ENTERED) continue;
      const car = this.carFor(carIdx);

      this.followPlace(
        car,
        where[carIdx],
        numberAt(places, carIdx, 0),
        numberAt(surfaces, carIdx, TrackLocation.NotInWorld),
        pit,
        now,
        countParked
      );

      const flags = numberAt(carFlags, carIdx, 0);
      const status = numberAt(finish, carIdx, LMU_FINISH_STATUS.none);
      this.followStatus(car, flags, status, now, first, isRace);
      if (penalties) {
        this.followLmuPenalties(
          car,
          Math.trunc(numberAt(penalties, carIdx, -1)),
          numberAt(penaltyKinds, carIdx, 0),
          numberAt(penaltySeconds, carIdx, 0),
          now,
          first
        );
      } else if (!isLmu) {
        this.followBlackFlag(
          car,
          (flags & GlobalFlags.Black) !== 0,
          now,
          first
        );
      }
    }

    this.followOwnPlace(frame, now, first, isRace);
    this.sayDriverChanges();
    if (this.forecastChanged) {
      this.forecastChanged = false;
      this.sayForecast(frame, now);
    }
    if (this.pacesDue > 0) this.sayFastestLaps(now);
    if (first) this.seedPace(frame);
    this.baselined = true;
  }

  /**
   * Forgets where every car was but keeps what is logged. Call it when
   * frames resume after a gap: what happened in between was not seen, and
   * the first tick after it is where things stand.
   */
  rebaseline(): void {
    this.baselined = false;
    this.wasBeforeStart = false;
    this.heldPlace = 0;
    for (const car of this.cars) {
      if (!car) continue;
      car.place = PLACE_UNKNOWN;
      car.awaySince = Number.NaN;
      this.endVisit(car);
    }
  }

  /**
   * Takes in what the file holds of this race's log, from before a restart.
   * The file's events come first, and what was logged since the race was
   * picked up is numbered on from them.
   */
  restore(stored: readonly RaceEvent[]): void {
    if (!this.race || stored.length === 0) return;
    let live = this.events;
    let cautionSince: number | undefined;
    let redSince: number | undefined;
    for (const event of stored) {
      if (event.kind === 'flag') {
        // Since when, where the file saw it begin.
        const since = event.late ? Number.NaN : event.sessionTime;
        if (event.flag === 'caution') cautionSince = since;
        else if (event.flag === 'red') redSince = since;
        else if (event.flag === 'chequered') this.chequeredSaid = true;
        else if (event.after === 'caution') cautionSince = undefined;
        else if (event.after === 'red') redSince = undefined;
        continue;
      }
      if (event.kind === 'position') {
        // The place last said: one it has moved from since is said again.
        this.saidPlace = event.to;
        this.saidCarIdx = event.carIdx;
        continue;
      }
      if (event.kind !== 'retired' && event.kind !== 'rejoined') continue;
      const car = this.entered(event.carIdx)
        ? this.carFor(event.carIdx)
        : undefined;
      if (!car) continue;
      if (event.kind === 'retired' && event.reason === 'disqualified') {
        // It may well be driving on: nothing to come back from.
        car.disqualified = true;
        continue;
      }
      // Said once: a car that was out before the restart is not said again.
      car.outSaid = event.kind === 'retired';
      car.outSince = car.outSaid ? event.sessionTime : Number.NaN;
    }

    // A caution the file saw begin and this run found out: the same one.
    const endedUnseen: RaceFlag[] = [];
    for (const [spell, flag, since] of [
      [this.caution, 'caution', cautionSince],
      [this.red, 'red', redSince],
    ] as const) {
      if (since === undefined) continue;
      if (!this.baselined) {
        spell.on = true;
        spell.since = since;
      } else if (spell.on) {
        if (!Number.isNaN(spell.since)) continue;
        spell.since = since;
        const late = spell.late;
        spell.late = null;
        if (late) {
          // Said late by this run, and in the file from when it began.
          live = live.filter((event) => event !== late);
          this.listener.onEventsRemoved([late]);
        }
      } else {
        // It ended while nothing was recording: when is not known.
        endedUnseen.push(flag);
      }
    }

    let seq = stored[stored.length - 1].seq;
    for (const event of live) event.seq = seq += 1;
    this.nextSeq = seq + 1;
    this.events = [...stored.map((event) => ({ ...event })), ...live];
    this.thinnable = this.events.filter((event) =>
      isThinnedFirst(event.kind)
    ).length;
    const over = this.events.length - RACE_LOG_MAX_EVENTS;
    if (over > 0) {
      const gone = this.events.splice(0, over);
      this.thinnable -= gone.filter((event) =>
        isThinnedFirst(event.kind)
      ).length;
      this.listener.onEventsRemoved(gone);
    }
    this.version += 1;
    // Under the numbers they have now.
    for (const event of live) this.listener.onEvent(event);
    for (const flag of endedUnseen) {
      this.sayFlag('green', this.clock, flag === 'red' ? 'red' : 'caution');
    }
  }

  // --- What is read of it ----------------------------------------------

  /** Goes up whenever an event is added, changed or removed. */
  currentVersion(): number {
    return this.version;
  }

  /** Every event held, oldest first. The log's own list. */
  allEvents(): readonly RaceEvent[] {
    return this.race ? this.events : NO_EVENTS;
  }

  /**
   * The RACE_LOG_PAGE_EVENTS most recent events numbered below `before`,
   * oldest first; the most recent of all with it left out. Copies.
   */
  page(before?: number): RaceEvent[] {
    const events = this.events;
    let end = events.length;
    if (before !== undefined) {
      while (end > 0 && events[end - 1].seq >= before) end -= 1;
    }
    return events
      .slice(Math.max(0, end - RACE_LOG_PAGE_EVENTS), end)
      .map((event) => ({ ...event }));
  }

  /** The most recent events, as they stand now. A new object every time. */
  snapshot(): RaceLogSnapshot {
    const events = this.events;
    return {
      raceToken: this.race?.token ?? '',
      events: events.slice(
        Math.max(0, events.length - RACE_LOG_SNAPSHOT_EVENTS)
      ),
      total: events.length,
      sessionNum: this.race?.info.sessionNum ?? null,
      version: this.version,
    };
  }

  // --- The whole field -------------------------------------------------

  /** The flags for the whole field, the start and the end of the race. */
  private followField(
    frame: Telemetry,
    now: number,
    first: boolean,
    isRace: boolean
  ): void {
    let caution: boolean;
    let red: boolean;
    let chequered: boolean;
    let racing: boolean;
    let beforeStart: boolean;

    const phase = scalarOf(frame, 'LmuGamePhase');
    if (phase !== null) {
      // A paused sim, a frame it has stopped writing and one from no
      // session at all say nothing about the flags.
      if (
        phase === PHASE_PAUSED ||
        flagOf(frame, 'LmuDataStale') ||
        flagOf(frame, 'LmuNotInSession')
      ) {
        return;
      }
      const yellowState = scalarOf(frame, 'LmuYellowFlagState') ?? 0;
      caution =
        phase === PHASE_FULL_COURSE_YELLOW ||
        (yellowState >= 1 && yellowState <= 6);
      red = phase === PHASE_STOPPED;
      chequered = phase === PHASE_OVER;
      racing = phase === PHASE_GREEN;
      beforeStart = phase >= 0 && phase <= PHASE_COUNTDOWN;
    } else {
      const state = scalarOf(frame, 'SessionState') ?? SessionState.Invalid;
      if (state === SessionState.Invalid) return;
      const flags = scalarOf(frame, 'SessionFlags') ?? 0;
      caution = (flags & CAUTION_FLAGS) !== 0;
      red = (flags & GlobalFlags.Red) !== 0;
      // The state and not the flag: the flag is shown to the player's car,
      // which can be a lap after the winner's.
      chequered =
        state === SessionState.Checkered || state === SessionState.CoolDown;
      racing = state === SessionState.Racing;
      beforeStart =
        state === SessionState.GetInCar ||
        state === SessionState.Warmup ||
        state === SessionState.ParadeLaps;
    }

    if (isRace && racing && this.wasBeforeStart && !first && !caution && !red) {
      this.sayFlag('green', now, 'start');
    }
    this.wasBeforeStart = beforeStart;
    this.followSpell(this.caution, 'caution', caution, now, first);
    this.followSpell(this.red, 'red', red, now, first);
    if (chequered) this.sayChequered(now, first);
    this.underway =
      (racing || caution || red) && !beforeStart && !this.chequeredSaid;
  }

  private followSpell(
    spell: Spell,
    flag: 'caution' | 'red',
    on: boolean,
    now: number,
    first: boolean
  ): void {
    if (on === spell.on) return;
    if (on) {
      spell.on = true;
      // Found out on a first tick, it began before and when is not known.
      spell.since = first ? Number.NaN : now;
      const event = this.sayFlag(flag, now, null, null, first);
      spell.late = first ? event : null;
      return;
    }
    const duration =
      first || Number.isNaN(spell.since) ? null : now - spell.since;
    spell.on = false;
    spell.since = Number.NaN;
    spell.late = null;
    this.sayFlag('green', now, flag, duration);
  }

  /** The flag fell: said once, and not at all when it was down already. */
  private sayChequered(now: number, first: boolean): void {
    if (this.chequeredSaid) return;
    this.chequeredSaid = true;
    if (!first) this.sayFlag('chequered', now);
  }

  private sayFlag(
    flag: RaceFlag,
    now: number,
    after: RaceFlagEvent['after'] = null,
    durationS: number | null = null,
    late = false
  ): RaceFlagEvent {
    const event: RaceFlagEvent = {
      ...this.stamp(now),
      carIdx: null,
      kind: 'flag',
      flag,
      after,
      durationS,
      late,
    };
    this.keep(event);
    return event;
  }

  // --- A car -----------------------------------------------------------

  /** Where a car is: into the pit lane, out of it, and away. */
  private followPlace(
    car: LogCar,
    where: number,
    classPosition: number,
    surface: number,
    pit: CarPitSnapshot,
    now: number,
    countParked: boolean
  ): void {
    if (where === CAR_PIT_IN_GARAGE) {
      if (Number.isNaN(car.awaySince)) car.awaySince = now;
      const away = now - car.awaySince;
      if (car.place !== CAR_PIT_IN_GARAGE) {
        // A car driven on another machine can drop out of the world for a
        // frame or two and be back: the race history waits as long.
        if (car.place !== PLACE_UNKNOWN && away < AWAY_SECONDS) return;
        // Gone from where it was: a visit under way ends with no exit.
        car.place = CAR_PIT_IN_GARAGE;
        this.endVisit(car);
      }
      if (
        countParked &&
        car.raced &&
        !car.outSaid &&
        away >= RACE_LOG_PARKED_SECONDS
      ) {
        this.sayOut(
          car,
          surface === TrackLocation.NotInWorld ? 'gone' : 'garage',
          now,
          car.awaySince
        );
      }
      return;
    }
    car.awaySince = Number.NaN;

    if (where === CAR_PIT_IN_LANE) {
      if (car.place !== CAR_PIT_IN_LANE) {
        this.endVisit(car);
        // Out of its garage, or found in the lane: not a pit entry.
        if (car.place === CAR_PIT_ON_TRACK) {
          car.entrySeen = true;
          car.entryAt = now;
          car.entryPosition = classPosition > 0 ? classPosition : null;
        }
        car.place = CAR_PIT_IN_LANE;
      }
      // Not at the line itself: a car that brushes the pit entry and is
      // back on the circuit has not pitted.
      if (
        car.entrySeen &&
        !car.entrySaid &&
        now - car.entryAt > PIT_LAP_SECONDS
      ) {
        this.sayEntry(car);
      }
      return;
    }

    if (where !== CAR_PIT_ON_TRACK) return;
    if (car.place === CAR_PIT_IN_LANE) this.leftLane(car, pit, now);
    if (car.outSaid && !car.dnf) {
      // Away for how long is known only where both ends of it were seen.
      const seen =
        car.place === CAR_PIT_IN_LANE || car.place === CAR_PIT_IN_GARAGE;
      car.outSaid = false;
      this.keep({
        ...this.stamp(now),
        carIdx: car.carIdx,
        kind: 'rejoined',
        awayS: seen && !Number.isNaN(car.outSince) ? now - car.outSince : null,
      });
      car.outSince = Number.NaN;
    }
    car.place = CAR_PIT_ON_TRACK;
    car.raced = true;
  }

  private sayEntry(car: LogCar): void {
    car.entrySaid = true;
    // After the flag every car comes in: that is not news.
    if (this.chequeredSaid) return;
    this.keep({
      ...this.stamp(car.entryAt),
      carIdx: car.carIdx,
      kind: 'pit-entry',
      classPosition: car.entryPosition,
    });
  }

  /** Back on the circuit from the lane: after a stop, or straight through. */
  private leftLane(car: LogCar, pit: CarPitSnapshot, now: number): void {
    const stint = car.stop;
    // The pit tracker's own times for the visit just ended: what the race
    // history reads into a stop on this same tick.
    const stood = numberAt(pit.standingS, car.carIdx, 0);
    const timed = numberAt(pit.laneTimeS, car.carIdx, 0);
    if (this.chequeredSaid) {
      // Nothing: the race is run.
    } else if (stint?.stop || (car.entrySeen && isStopVisit(stood))) {
      // The race history keeps no stint without a lap in it, so a stop
      // before the car's first completed lap ends none and is not told of.
      // It was a stop all the same, by the one rule there is for that, when
      // the car was seen to drive in. One found standing in the lane with
      // no lap to its name is not: a car waiting in its stall to go out for
      // the first time reads the same, and under iRacing that is the whole
      // field before every session.
      const stop = stint?.stop;
      const change = car.stopChange;
      // A stop found in the middle has no times: how long the car had been
      // in the lane, and had stood, before it was seen is not known.
      const whole = car.entrySeen;
      const event: RacePitExitEvent = {
        ...this.stamp(now),
        carIdx: car.carIdx,
        kind: 'pit-exit',
        standingTime: !whole ? null : stop ? stop.standingTime : stood,
        laneTime: !whole
          ? null
          : stop
            ? stop.laneTime
            : timed > 0
              ? timed
              : null,
        driverFrom: change?.from ?? '',
        driverTo: change?.to ?? '',
      };
      car.lastExit = event;
      // What tells this stop from the next when the race history changes a
      // time of it afterwards; none for a stop whose times are not said.
      car.lastExitStopAt = (whole && stint?.endTime) || Number.NaN;
      this.keep(event);
    } else if (car.entrySaid) {
      this.keep({
        ...this.stamp(now),
        carIdx: car.carIdx,
        kind: 'drive-through',
        laneTime: timed > 0 ? timed : now - car.entryAt,
      });
    }
    this.endVisit(car);
  }

  private endVisit(car: LogCar): void {
    car.entrySeen = false;
    car.entrySaid = false;
    car.entryPosition = null;
    car.stop = null;
    car.stopChange = null;
  }

  private sayOut(
    car: LogCar,
    reason: RaceRetiredReason,
    now: number,
    since: number
  ): void {
    if (reason !== 'disqualified') {
      car.outSaid = true;
      car.outSince = since;
    }
    this.keep({
      ...this.stamp(now),
      carIdx: car.carIdx,
      kind: 'retired',
      reason,
    });
  }

  /** What the sim says of a car's race: disqualified, not finishing, done. */
  private followStatus(
    car: LogCar,
    flags: number,
    finish: number,
    now: number,
    first: boolean,
    isRace: boolean
  ): void {
    const disqualified = (flags & GlobalFlags.Disqualify) !== 0;
    if (disqualified && !car.disqualified && !first) {
      this.sayOut(car, 'disqualified', now, now);
    }
    car.disqualified = disqualified || car.disqualified;

    const dnf = finish === LMU_FINISH_STATUS.dnf;
    if (dnf && !car.dnf) {
      // Found so on a first tick, it is where things stand: not said, and
      // not said later as a car parked either.
      if (first || car.outSaid) {
        car.outSaid = true;
      } else {
        this.sayOut(car, 'dnf', now, now);
      }
    }
    car.dnf = dnf;

    // Le Mans Ultimate keeps its phase at green until the last car is in:
    // the first car it lists as finished is the flag falling.
    if (isRace && finish === LMU_FINISH_STATUS.finished) {
      this.sayChequered(now, first);
    }
  }

  /** Le Mans Ultimate counts each car's penalties, and names them late. */
  private followLmuPenalties(
    car: LogCar,
    count: number,
    kindCode: number,
    seconds: number,
    now: number,
    first: boolean
  ): void {
    if (count < 0) return;
    const kind = lmuPenaltyKindFromCode(kindCode) ?? '';
    const known = car.penalties;
    car.penalties = count;
    if (first || known < 0 || count === known) {
      const unnamed = car.unnamedPenalty;
      if (count !== known) {
        // The count moved while nothing was read: whose kind it is now is
        // not known.
        car.unnamedPenalty = null;
      } else if (unnamed && kind !== '') {
        // The kind of one already said, now that the sim names it.
        car.unnamedPenalty = null;
        unnamed.penalty = kind;
        unnamed.seconds = penaltySeconds(kind, seconds);
        this.changed(unnamed);
      }
      return;
    }
    const given = count > known;
    const event: RacePenaltyEvent = {
      ...this.stamp(now),
      carIdx: car.carIdx,
      kind: 'penalty',
      change: given ? 'given' : 'served',
      // Which of several was served is not said.
      penalty: given ? kind : '',
      seconds: given ? penaltySeconds(kind, seconds) : null,
      pending: count,
    };
    car.unnamedPenalty = given && kind === '' ? event : null;
    this.keep(event);
  }

  /** iRacing shows a car its black flag, and takes it back when served. */
  private followBlackFlag(
    car: LogCar,
    black: boolean,
    now: number,
    first: boolean
  ): void {
    if (black === car.black) return;
    car.black = black;
    if (first) return;
    this.keep({
      ...this.stamp(now),
      carIdx: car.carIdx,
      kind: 'penalty',
      change: black ? 'given' : 'served',
      penalty: 'black',
      seconds: null,
      pending: null,
    });
  }

  // --- The own car's place ---------------------------------------------

  /**
   * The own car's place in its class, said once it has held for a lap of
   * the car's own running: a place swapped back and forth in a fight, or
   * through a round of stops, is not said at every swap.
   */
  private followOwnPlace(
    frame: Telemetry,
    now: number,
    first: boolean,
    isRace: boolean
  ): void {
    const own = Math.trunc(scalarOf(frame, 'PlayerCarIdx') ?? -1);
    if (own !== this.ownCarIdx) {
      this.ownCarIdx = own;
      this.heldPlace = 0;
    }
    if (own !== this.saidCarIdx) {
      // Another car's place is not this one's to have moved from.
      this.saidCarIdx = own;
      this.saidPlace = 0;
    }
    if (own < 0 || !isRace || !this.underway) {
      this.heldPlace = 0;
      return;
    }
    const place = numberAt(arrayOf(frame, 'CarIdxClassPosition'), own, 0);
    if (!(place > 0)) return;
    if (this.saidPlace === 0) {
      // Where it stands when the race, or the log, begins.
      this.saidPlace = place;
      return;
    }
    if (place === this.saidPlace) {
      this.heldPlace = 0;
      return;
    }
    const covered =
      numberAt(arrayOf(frame, 'CarIdxLap'), own, 0) +
      Math.max(0, numberAt(arrayOf(frame, 'CarIdxLapDistPct'), own, 0));
    if (place !== this.heldPlace || first) {
      this.heldPlace = place;
      this.heldFrom = covered;
      return;
    }
    if (covered - this.heldFrom < RACE_LOG_PLACE_HOLD_LAPS) return;
    this.keep({
      ...this.stamp(now),
      carIdx: own,
      kind: 'position',
      from: this.saidPlace,
      to: place,
    });
    this.saidPlace = place;
    this.heldPlace = 0;
  }

  // --- Drivers ---------------------------------------------------------

  /** A change the race history has put down to a stop goes on the stop. */
  private putDownToStop(change: RaceDriverChange): void {
    const car = this.cars[change.carIdx];
    if (car?.place === CAR_PIT_IN_LANE) {
      car.stopChange = change;
      return;
    }
    // Named after the car left, as it often is: the exit said already.
    const exit = car?.lastExit;
    if (
      exit &&
      change.sessionTime - exit.sessionTime <= DRIVER_SETTLE_SECONDS + 1 &&
      this.events.includes(exit)
    ) {
      exit.driverFrom = change.from;
      exit.driverTo = change.to;
      this.changed(exit);
      return;
    }
    // A stop whose exit is not in the log: the change is said on its own.
    this.sayDriverChange(change);
  }

  /** Says the changes that have turned out to come without a stop. */
  private sayDriverChanges(): void {
    if (this.pending.length === 0) return;
    for (let index = 0; index < this.pending.length;) {
      const change = this.pending[index];
      // In the pit lane: whether it comes with a stop is known when the
      // car stands still, or leaves.
      if (
        !change.atStop &&
        this.cars[change.carIdx]?.place === CAR_PIT_IN_LANE
      ) {
        index += 1;
        continue;
      }
      this.pending.splice(index, 1);
      if (!change.atStop) this.sayDriverChange(change);
    }
  }

  private sayDriverChange(change: RaceDriverChange): void {
    if (this.chequeredSaid) return;
    this.keep({
      ...this.stamp(change.sessionTime),
      carIdx: change.carIdx,
      kind: 'driver-change',
      driverFrom: change.from,
      driverTo: change.to,
    });
  }

  // --- The forecast ----------------------------------------------------

  /**
   * Reads the session's forecast for the kind of session being run. One
   * that says something else than the one before has changed; the first of
   * a race is what the forecast is.
   */
  private readForecast(quiet: boolean): void {
    const sessionNum = this.race?.info.sessionNum;
    if (sessionNum === null || sessionNum === undefined) return;
    const nodes =
      this.session?.LmuRest?.forecast?.[lmuForecastSlot(sessionNum)];
    if (!nodes || nodes.length === 0) return;
    let key = '';
    for (const node of nodes) {
      key += `${node.skyType}:${Math.round(node.rainChance * 100)};`;
    }
    if (key === this.forecastKey) return;
    if (!quiet && this.forecastKey !== null) this.forecastChanged = true;
    this.forecastKey = key;
  }

  /**
   * Says what the changed forecast holds, by the Weather Forecast's own
   * reckoning of when each of its points begins, run for this one frame.
   */
  private sayForecast(frame: Telemetry, now: number): void {
    if (!this.session) return;
    this.weather.init(this.session);
    this.weather.onFrame(frame);
    const forecast = this.weather.snapshot();
    if (!forecast.available) return;
    const rain = forecast.nodes.find((node) => node.skyType >= SKY_RAIN_FROM);
    this.keep({
      ...this.stamp(now),
      carIdx: null,
      kind: 'forecast',
      rain: rain !== undefined,
      inMinutes: rain?.startsInMinutes ?? null,
      rainChance: rain?.rainChance ?? null,
    });
  }

  // --- Pace ------------------------------------------------------------

  /**
   * Takes each class's fastest lap from the sim's own list, and how far its
   * cars have run: a log begun in the middle of a race does not call the
   * next quick lap the fastest of all.
   */
  private seedPace(frame: Telemetry): void {
    const bests = arrayOf(frame, 'CarIdxBestLapTime');
    const laps = arrayOf(frame, 'CarIdxLap');
    for (let carIdx = 0; carIdx < this.classOf.length; carIdx += 1) {
      const classId = this.classOf[carIdx];
      if (classId === NOT_ENTERED) continue;
      const pace = this.paceOf(classId);
      const best = numberAt(bests, carIdx, -1);
      // Quicker than what the log has: a lap from before it began, which
      // is the class's fastest and is not news.
      if (best > 0 && best < pace.best) {
        pace.best = best;
        if (!Number.isNaN(pace.dueAt)) {
          pace.dueAt = Number.NaN;
          this.pacesDue -= 1;
        }
      }
      const completed = Math.trunc(numberAt(laps, carIdx, 0)) - 1;
      if (completed > pace.laps) pace.laps = completed;
    }
  }

  /** Says each class's fastest lap that has waited its moment. */
  private sayFastestLaps(now: number): void {
    for (const pace of this.paces.values()) {
      if (
        Number.isNaN(pace.dueAt) ||
        now < pace.dueAt ||
        pace.laps < RACE_LOG_FASTEST_LAP_FROM_LAP
      ) {
        continue;
      }
      pace.dueAt = Number.NaN;
      this.pacesDue -= 1;
      this.keep({
        ...this.stamp(pace.at, pace.timeOfDay),
        carIdx: pace.carIdx,
        kind: 'fastest-lap',
        lap: pace.lap,
        lapTime: pace.best,
        driver: pace.driver,
      });
    }
  }

  private paceOf(classId: number): ClassPace {
    let pace = this.paces.get(classId);
    if (!pace) {
      pace = {
        best: Number.POSITIVE_INFINITY,
        laps: 0,
        carIdx: -1,
        lap: 0,
        driver: '',
        at: 0,
        timeOfDay: null,
        dueAt: Number.NaN,
      };
      this.paces.set(classId, pace);
    }
    return pace;
  }

  // --- The list --------------------------------------------------------

  /**
   * What every event begins with: the next number, and its clocks. The
   * clock in the sim is the one at the last tick unless another is given,
   * as for a lap said a while after it was driven.
   */
  private stamp(
    sessionTime: number,
    timeOfDay: number | null = this.timeOfDay
  ): {
    seq: number;
    sessionTime: number;
    timeOfDay: number | null;
  } {
    const seq = this.nextSeq;
    this.nextSeq += 1;
    return { seq, sessionTime, timeOfDay };
  }

  private keep(event: RaceEvent): void {
    this.events.push(event);
    if (isThinnedFirst(event.kind)) this.thinnable += 1;
    this.thin(event);
    this.version += 1;
    this.listener.onEvent(event);
  }

  /** An event already kept has changed. */
  private changed(event: RaceEvent): void {
    this.version += 1;
    this.listener.onEvent(event);
  }

  /** Makes room for the event just added. */
  private thin(added: RaceEvent): void {
    const events = this.events;
    if (events.length <= RACE_LOG_THIN_FROM) return;
    const gone: RaceEvent[] = [];
    if (this.thinnable > (isThinnedFirst(added.kind) ? 1 : 0)) {
      const index = events.findIndex(
        (event) => event !== added && isThinnedFirst(event.kind)
      );
      if (index >= 0) {
        gone.push(...events.splice(index, 1));
        this.thinnable -= 1;
      }
    }
    if (events.length > RACE_LOG_MAX_EVENTS) {
      const oldest = events.shift();
      if (oldest) {
        gone.push(oldest);
        if (isThinnedFirst(oldest.kind)) this.thinnable -= 1;
      }
    }
    if (gone.length > 0) this.listener.onEventsRemoved(gone);
  }

  // --- Cars and classes ------------------------------------------------

  private entered(carIdx: number): boolean {
    this.refreshEntries();
    return (this.classOf[carIdx] ?? NOT_ENTERED) !== NOT_ENTERED;
  }

  private carFor(carIdx: number): LogCar {
    let car = this.cars[carIdx];
    if (!car) {
      car = newLogCar(carIdx);
      // Kept dense: a slot below it with no car is an undefined, not a hole.
      while (this.cars.length < carIdx) this.cars.push(undefined);
      this.cars[carIdx] = car;
    }
    return car;
  }

  /** Brings the class of each slot up to the race's entry list. */
  private refreshEntries(): void {
    const entries = this.race?.info.entries;
    if (!entries || entries === this.entriesSeen) return;
    this.entriesSeen = entries;
    this.classOf.length = 0;
    for (const entry of entries) {
      if (entry.carIdx < 0 || entry.carIdx >= RACE_HISTORY_MAX_CARS) continue;
      while (this.classOf.length <= entry.carIdx)
        this.classOf.push(NOT_ENTERED);
      this.classOf[entry.carIdx] = entry.classId;
    }
  }

  private clear(): void {
    this.race = null;
    this.events = [];
    this.nextSeq = 1;
    this.thinnable = 0;
    this.cars.length = 0;
    this.classOf.length = 0;
    this.entriesSeen = null;
    this.baselined = false;
    this.clock = 0;
    this.timeOfDay = null;
    Object.assign(this.caution, newSpell());
    Object.assign(this.red, newSpell());
    this.chequeredSaid = false;
    this.wasBeforeStart = false;
    this.underway = false;
    this.ownCarIdx = -1;
    this.saidPlace = 0;
    this.saidCarIdx = -1;
    this.heldPlace = 0;
    this.heldFrom = 0;
    this.paces.clear();
    this.pacesDue = 0;
    this.pending.length = 0;
    this.forecastKey = null;
    this.forecastChanged = false;
  }
}

/** A time penalty's seconds, where the sim states them. */
const penaltySeconds = (
  kind: RacePenaltyName,
  seconds: number
): number | null =>
  kind === 'TIME' && seconds > 0 ? Math.round(seconds) : null;
