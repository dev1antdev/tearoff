import type {
  CarPitSnapshot,
  RaceEvent,
  RaceInfo,
  Session,
  Telemetry,
} from '@irdashies/types';
import {
  CAR_PIT_IN_GARAGE,
  CAR_PIT_ON_TRACK,
  LMU_FINISH_STATUS,
  SessionState,
  TrackLocation,
} from '@irdashies/types';
import type { Field } from './raceHistoryFixture';
import {
  RaceHistoryRecorder,
  type RaceHistoryListener,
  type RaceStart,
} from './RaceHistoryRecorder';
import { RaceLogRecorder } from './RaceLogRecorder';

/**
 * What the race log's specs stage a race with.
 *
 * Staged data, every frame of it: there is no recording with a pit stop, a
 * driver change, a full-course yellow or a penalty in it. What these are
 * for is the log's own rules, and not what either sim really writes.
 */

/** A log with a listener that keeps everything it is told. */
export interface Logged {
  log: RaceLogRecorder;
  /** Every event the log announced, as it stood when it did. */
  said: RaceEvent[];
  /** The numbers of the events it said went, in the order it said so. */
  removed: number[];
  /** The events it holds now, as plain copies. */
  events(): RaceEvent[];
  /** The same, with their numbers and clocks left out: what happened. */
  told(): Record<string, unknown>[];
}

/** An event without its number and its clocks. */
export const tell = (event: RaceEvent): Record<string, unknown> => {
  const rest: Record<string, unknown> = { ...event };
  delete rest.seq;
  delete rest.sessionTime;
  delete rest.timeOfDay;
  return rest;
};

export const logged = (): Logged => {
  const said: RaceEvent[] = [];
  const removed: number[] = [];
  const log = new RaceLogRecorder({
    onEvent: (event) => said.push({ ...event }),
    onEventsRemoved: (events) =>
      removed.push(...events.map((event) => event.seq)),
  });
  const events = () => log.allEvents().map((event) => ({ ...event }));
  return { log, said, removed, events, told: () => events().map(tell) };
};

export interface StagedCar {
  /** CAR_PIT_* as the pit tracker would have it. */
  where: number;
  classId: number;
  classPosition: number;
  /** The lap it is on, and how far round. */
  lap: number;
  pct: number;
  /** Seconds a lap. */
  pace: number;
  /** Its own session flags. */
  flags: number;
  surface: number;
  /** The sim's best lap for it; -1 with none. */
  best: number;
  /** Seconds in the lane, as the pit tracker timed its last pass. */
  laneTime: number;
  /** Le Mans Ultimate only. */
  penalties: number;
  penaltyKind: number;
  penaltySeconds: number;
  finish: number;
}

/**
 * A field as the log sees it on a tick: the frame's cells it reads, and
 * where the pit tracker has every car. No race history behind it: for what
 * the log reads off the frames by itself.
 */
export class Stage {
  time = 1000;
  sessionType = 'Race';
  sessionNum: number | null = 0;
  sessionState: number = SessionState.Racing;
  sessionFlags = 0;
  playerCarIdx = 0;
  timeOfDay: number | null = 50_400;
  /** Le Mans Ultimate's phase and yellow state; null stages iRacing. */
  lmu: { phase: number; yellowState: number; stale?: boolean } | null = null;
  /** Le Mans Ultimate only: when the session ends, on the session clock. */
  sessionEndTime: number | null = null;
  readonly cars: StagedCar[];
  private readonly info: RaceInfo;

  constructor(cars = 4) {
    this.cars = Array.from({ length: cars }, (_, carIdx) => ({
      where: CAR_PIT_ON_TRACK,
      // Two classes of two.
      classId: carIdx < cars / 2 ? 1 : 2,
      classPosition: (carIdx % Math.ceil(cars / 2)) + 1,
      lap: 5,
      pct: 0.5 - carIdx * 0.05,
      pace: 100,
      flags: 0,
      surface: TrackLocation.OnTrack,
      best: -1,
      laneTime: 0,
      penalties: 0,
      penaltyKind: 0,
      penaltySeconds: 0,
      finish: LMU_FINISH_STATUS.none,
    }));
    this.info = {
      id: null,
      simulator: 'iracing',
      sessionKey: '',
      sessionNum: this.sessionNum,
      sessionType: this.sessionType,
      sessionName: 'RACE',
      trackId: 18,
      trackName: 'Road America',
      trackConfig: null,
      trackLengthM: 6500,
      startedAt: 0,
      updatedAt: 0,
      sessionTime: this.time,
      entries: [],
      tyres: [],
    };
  }

  /** The race as the race history's recorder would announce it. */
  start(): RaceStart {
    this.info.sessionType = this.sessionType;
    this.info.sessionNum = this.sessionNum;
    this.info.entries = this.cars.map((car, carIdx) => ({
      carIdx,
      carNumber: `${carIdx + 10}`,
      car: 'gt3',
      classId: car.classId,
      className: `Class ${car.classId}`,
      teamName: `Team ${carIdx}`,
    }));
    return {
      token: 'boot:1',
      info: this.info,
      lapsCompleted: this.cars.map((car) => car.lap - 1),
      sessionTime: this.time,
    };
  }

  frame(): Telemetry {
    const cars = this.cars;
    const frame: Record<string, { value: unknown[] }> = {
      SessionTime: { value: [this.time] },
      SessionNum: { value: [this.sessionNum] },
      SessionState: { value: [this.sessionState] },
      SessionFlags: { value: [this.sessionFlags] },
      PlayerCarIdx: { value: [this.playerCarIdx] },
      CarIdxLap: { value: cars.map((car) => car.lap) },
      CarIdxLapDistPct: { value: cars.map((car) => car.pct) },
      CarIdxClassPosition: { value: cars.map((car) => car.classPosition) },
      CarIdxTrackSurface: { value: cars.map((car) => car.surface) },
      CarIdxSessionFlags: { value: cars.map((car) => car.flags) },
      CarIdxBestLapTime: { value: cars.map((car) => car.best) },
    };
    if (this.timeOfDay !== null) {
      frame.SessionTimeOfDay = { value: [this.timeOfDay] };
    }
    if (this.lmu) {
      frame.LmuGamePhase = { value: [this.lmu.phase] };
      frame.LmuYellowFlagState = { value: [this.lmu.yellowState] };
      frame.LmuDataStale = { value: [this.lmu.stale === true] };
      frame.LmuCarIdxPenalties = { value: cars.map((car) => car.penalties) };
      frame.LmuCarIdxPenaltyKind = {
        value: cars.map((car) => car.penaltyKind),
      };
      frame.LmuCarIdxPenaltySeconds = {
        value: cars.map((car) => car.penaltySeconds),
      };
      frame.LmuCarIdxFinishStatus = { value: cars.map((car) => car.finish) };
      if (this.sessionEndTime !== null) {
        frame.LmuSessionEndTime = { value: [this.sessionEndTime] };
      }
    }
    return frame as unknown as Telemetry;
  }

  /** The pit tracker's reading: only what the log takes from it is filled. */
  pit(): CarPitSnapshot {
    return {
      where: this.cars.map((car) => car.where),
      laneTimeS: this.cars.map((car) => car.laneTime),
      standingS: this.cars.map(() => 0),
      stops: [],
      lastPitLap: [],
      lastStopLap: [],
      stintLaps: [],
      longestStintLaps: [],
      usedLastLap: [],
      usedAverage: [],
      lapsLeft: [],
      requested: [],
      counts: {
        onTrack: 0,
        inLane: 0,
        standingInLane: 0,
        requested: 0,
        inGarage: 0,
      },
      sessionNum: this.sessionNum,
      version: 0,
    };
  }

  /**
   * One tick, after `seconds` of every running car lapping at its pace. A
   * quarter of a second unless told, so that the clock stays a figure a
   * float holds exactly and a length can be compared as it is.
   */
  tick(log: RaceLogRecorder, seconds = 0.25): void {
    this.time += seconds;
    if (this.timeOfDay !== null) this.timeOfDay += seconds;
    for (const car of this.cars) {
      if (car.where === CAR_PIT_IN_GARAGE) continue;
      car.pct += seconds / car.pace;
      if (car.pct >= 1) {
        car.pct -= 1;
        car.lap += 1;
      }
    }
    log.onTick(this.frame(), this.pit(), this.time);
  }

  /** Ticks once a second for a while. */
  run(log: RaceLogRecorder, seconds: number): void {
    for (let elapsed = 0; elapsed < seconds; elapsed += 1) this.tick(log, 1);
  }

  /** Puts a car out of the world, or back on the circuit. */
  vanish(carIdx: number): void {
    this.cars[carIdx].where = CAR_PIT_IN_GARAGE;
    this.cars[carIdx].surface = TrackLocation.NotInWorld;
  }
  appear(carIdx: number): void {
    this.cars[carIdx].where = CAR_PIT_ON_TRACK;
    this.cars[carIdx].surface = TrackLocation.OnTrack;
  }
}

/** What a frame carries beyond what the staged field writes. */
export interface FrameExtras {
  sessionState?: number;
  playerCarIdx?: number;
  timeOfDay?: number;
  bestLaps?: number[];
}

/** A race history recorder with the log wired to it as the runtime wires it. */
export interface Raced extends Logged {
  recorder: RaceHistoryRecorder;
  extras: FrameExtras;
  onSession(session: Session): void;
  onFrame(frame: Telemetry): void;
  /** Ticks the log was given. */
  ticks: number;
}

/**
 * The race history's recorder and the log, joined as `RaceHistoryRuntime`
 * joins them: everything the recorder tells its listener goes to the log,
 * and each of the recorder's slow ticks is one of the log's.
 */
export const raced = (field: Field, extras: FrameExtras = {}): Raced => {
  const base = logged();
  const { log } = base;
  const listener: RaceHistoryListener = {
    onRaceStarted: (start) => log.onRaceStarted(start),
    onLap: (lap) => log.onLap(lap),
    onStint: (stint) => log.onStint(stint),
    onDriverChange: (change) => log.onDriverChange(change),
    onRaceInfoChanged: () => undefined,
    onCarReplaced: (carIdx) => log.onCarReplaced(carIdx),
    onRaceEnded: () => log.onRaceEnded(),
  };
  let clock = Date.UTC(2026, 10, 16, 12, 0, 0);
  const recorder = new RaceHistoryRecorder(listener, {
    simulator: () => (field.lmu ? 'lmu' : 'iracing'),
    sessionIdsAreUnique: () => true,
    now: () => (clock += 1000),
    bootId: 'boot',
  });
  const out: Raced = {
    ...base,
    recorder,
    extras,
    ticks: 0,
    onSession(session) {
      recorder.onSession(session);
      log.onSession(session);
    },
    onFrame(frame) {
      const cells = frame as unknown as Record<string, { value: unknown[] }>;
      cells.SessionState = {
        value: [out.extras.sessionState ?? SessionState.Racing],
      };
      cells.PlayerCarIdx = { value: [out.extras.playerCarIdx ?? 0] };
      if (out.extras.timeOfDay !== undefined) {
        cells.SessionTimeOfDay = { value: [out.extras.timeOfDay] };
      }
      if (out.extras.bestLaps) {
        cells.CarIdxBestLapTime = { value: out.extras.bestLaps };
      }
      const tickedAt = recorder.lastTickAt();
      recorder.onFrame(frame);
      const ticked = recorder.lastTickAt();
      if (ticked !== tickedAt) {
        out.ticks += 1;
        log.onTick(frame, recorder.pitState(), ticked);
      }
    },
  };
  out.onSession(field.session());
  return out;
};
