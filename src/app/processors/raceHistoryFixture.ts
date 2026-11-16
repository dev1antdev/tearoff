import type {
  RaceDriverChange,
  RaceLap,
  RaceStint,
  Session,
  Telemetry,
} from '@irdashies/types';
import { TrackLocation } from '@irdashies/types';
import {
  RaceHistoryRecorder,
  type RaceHistoryListener,
  type RaceHistoryRecorderOptions,
  type RaceStart,
} from './RaceHistoryRecorder';

/**
 * A small field of cars lapping a circuit, for the race history's specs: it
 * writes the frames a sim would, in iRacing's shape unless told to add Le
 * Mans Ultimate's keys, and the session that goes with them.
 *
 * Staged data, every frame of it. What it is for is the recorder's own
 * rules -- which frame a lap is taken from, when a stint ends -- and not
 * what either sim really writes, which only a recording can show.
 */

export interface FieldCar {
  /** The lap the car is on: 1 on its first. -1 for a slot with no car. */
  lap: number;
  /** Lap fraction, 0..1. */
  pct: number;
  /** Seconds a lap at the pace it is driving. */
  pace: number;
  /** Standing still: it does not move along the lap. */
  halted: boolean;
  onPitRoad: boolean;
  surface: TrackLocation;
  /** The sim's last lap time as published. */
  lastLapTime: number;
  position: number;
  classPosition: number;
  /** The car's own session flags. */
  flags: number;
  name: string;
  classId: number;
  carNumber: string;
  carPath: string;
  /** Session time its lap began. */
  lapStartedAt: number;
  /** The time of the lap under way has been published ahead of its end. */
  timeIsOut: boolean;
}

export interface FieldOptions {
  /** How many cars, each a little slower than the one before. */
  cars?: number;
  /** Seconds between frames. */
  dt?: number;
  /** Seconds after the line at which the sim publishes a lap's time. */
  timeLag?: number;
  /** Writes Le Mans Ultimate's per-car keys as well. */
  lmu?: boolean;
  sessionNum?: number;
  sessionType?: string;
  subSessionId?: number;
  trackId?: number;
}

export class Field {
  time = 100;
  sessionNum: number;
  sessionType: string;
  subSessionId: number;
  trackId: number;
  sessionFlags = 0;
  dt: number;
  /** Negative publishes a lap's time that long before its count moves. */
  timeLag: number;
  readonly lmu: boolean;
  readonly cars: FieldCar[];
  /**
   * Called for a lap just completed, to say what time the sim gives it:
   * a number to publish, or undefined to leave what it published before.
   *
   * As it stands no two laps of a car are given the same time to the last
   * bit, though the cars lap at an even pace: a sim's times never repeat
   * like that, and a spec about a repeated time asks for one.
   */
  timeFor: (carIdx: number, lap: number, driven: number) => number | undefined =
    (_carIdx, lap, driven) => driven + lap * 1e-9;
  /** LMU only: laps the sim gave no time, by `${carIdx}:${lap}`. */
  readonly notCounted = new Set<string>();
  /** LMU only: what each car has left, 0..1. */
  energy: number[] = [];
  private readonly lastLapInvalid: boolean[] = [];
  private readonly due: { at: number; carIdx: number; value: number }[] = [];

  constructor(options: FieldOptions = {}) {
    this.dt = options.dt ?? 0.1;
    this.timeLag = options.timeLag ?? 0;
    this.lmu = options.lmu ?? false;
    this.sessionNum = options.sessionNum ?? 0;
    this.sessionType = options.sessionType ?? 'Race';
    this.subSessionId = options.subSessionId ?? 4242;
    this.trackId = options.trackId ?? 18;
    this.cars = Array.from({ length: options.cars ?? 3 }, (_, carIdx) => ({
      lap: 1,
      // Spread round the first tenth of the lap, the quickest in front.
      pct: 0.1 - carIdx * 0.02,
      pace: 100 + carIdx,
      halted: false,
      onPitRoad: false,
      surface: TrackLocation.OnTrack,
      lastLapTime: -1,
      position: carIdx + 1,
      classPosition: carIdx + 1,
      flags: 0,
      name: `Driver ${carIdx}`,
      classId: 7,
      carNumber: `${carIdx + 10}`,
      carPath: 'gt3',
      lapStartedAt: this.time,
      timeIsOut: false,
    }));
    this.energy = this.cars.map(() => 0.9);
  }

  session(): Session {
    return {
      WeekendInfo: {
        SubSessionID: this.subSessionId,
        TrackID: this.trackId,
        TrackDisplayName: 'Road America',
        TrackConfigName: 'Full Course',
        TrackLength: '6.5 km',
      },
      SessionInfo: {
        Sessions: [
          {
            SessionNum: this.sessionNum,
            SessionType: this.sessionType,
            SessionName: this.sessionType.toUpperCase(),
          },
        ],
      },
      DriverInfo: {
        DriverTires: [
          { TireIndex: 0, TireCompoundType: 'Medium' },
          { TireIndex: 1, TireCompoundType: 'Hard' },
        ],
        Drivers: this.cars
          .map((car, carIdx) => ({ car, carIdx }))
          .filter(({ car }) => car.lap >= 0)
          .map(({ car, carIdx }) => ({
            CarIdx: carIdx,
            UserName: car.name,
            TeamName: `Team ${carIdx}`,
            CarNumber: car.carNumber,
            CarPath: car.carPath,
            CarClassID: car.classId,
            CarClassShortName: `Class ${car.classId}`,
            CarIsPaceCar: 0,
            IsSpectator: 0,
          })),
      },
    } as unknown as Session;
  }

  frame(): Telemetry {
    const frame: Record<string, { value: unknown[] }> = {
      SessionTime: { value: [this.time] },
      SessionNum: { value: [this.sessionNum] },
      SessionFlags: { value: [this.sessionFlags] },
      CarIdxLap: { value: this.cars.map((car) => car.lap) },
      CarIdxLapCompleted: {
        value: this.cars.map((car) => (car.lap < 0 ? -1 : car.lap - 1)),
      },
      CarIdxLapDistPct: {
        value: this.cars.map((car) => (car.lap < 0 ? -1 : car.pct)),
      },
      CarIdxLastLapTime: { value: this.cars.map((car) => car.lastLapTime) },
      CarIdxPosition: { value: this.cars.map((car) => car.position) },
      CarIdxClassPosition: {
        value: this.cars.map((car) => car.classPosition),
      },
      CarIdxOnPitRoad: { value: this.cars.map((car) => car.onPitRoad) },
      CarIdxTrackSurface: { value: this.cars.map((car) => car.surface) },
      CarIdxSessionFlags: { value: this.cars.map((car) => car.flags) },
      CarIdxTireCompound: { value: this.cars.map(() => 1) },
    };
    if (this.lmu) {
      frame.LmuCarIdxLastLapInvalid = {
        value: this.cars.map((_, carIdx) => this.lastLapInvalid[carIdx]),
      };
      frame.LmuCarIdxPitState = {
        value: this.cars.map((car) =>
          car.surface === TrackLocation.InPitStall ? 3 : car.onPitRoad ? 2 : 0
        ),
      };
      frame.LmuCarIdxEnergyRemaining = { value: [...this.energy] };
      frame.LmuCarIdxEnergyIsVirtual = {
        value: this.cars.map((_, carIdx) => carIdx % 2 === 0),
      };
      frame.LmuCarIdxWheelCompounds = {
        value: this.cars.flatMap(() => [0, 0, 1, 1]),
      };
      frame.LmuCarIdxLastSectorTimes = {
        value: this.cars.flatMap((car) =>
          car.lastLapTime > 0
            ? [
                car.lastLapTime * 0.3,
                car.lastLapTime * 0.3,
                car.lastLapTime * 0.4,
              ]
            : [null, null, null]
        ),
      };
    }
    return frame as unknown as Telemetry;
  }

  /** Moves every car on by one frame. */
  step(): void {
    this.time += this.dt;
    this.cars.forEach((car, carIdx) => {
      if (car.lap < 0 || car.halted) return;
      const before = car.pct;
      car.pct += this.dt / car.pace;
      // Seconds from the frame before to the line, at this pace.
      const toLine = (1 - before) * car.pace;
      const crossedAt = this.time - this.dt + toLine;
      if (this.timeLag < 0 && !car.timeIsOut && toLine <= -this.timeLag) {
        // A time published before the count moves, as LMU's can be.
        car.timeIsOut = true;
        this.publishTime(carIdx, car.lap, crossedAt - car.lapStartedAt);
      }
      if (car.pct < 1) return;
      car.pct -= 1;
      const driven = crossedAt - car.lapStartedAt;
      const lap = car.lap;
      car.lap += 1;
      car.lapStartedAt = crossedAt;
      if (car.timeIsOut) {
        car.timeIsOut = false;
        return;
      }
      if (this.timeLag > 0) {
        const value = this.simTime(carIdx, lap, driven);
        if (value !== undefined) {
          this.due.push({ at: crossedAt + this.timeLag, carIdx, value });
        }
      } else {
        this.publishTime(carIdx, lap, driven);
      }
    });
    for (let index = this.due.length - 1; index >= 0; index -= 1) {
      const entry = this.due[index];
      if (entry.at > this.time) continue;
      this.cars[entry.carIdx].lastLapTime = entry.value;
      this.due.splice(index, 1);
    }
  }

  private simTime(
    carIdx: number,
    lap: number,
    driven: number
  ): number | undefined {
    this.lastLapInvalid[carIdx] = this.notCounted.has(`${carIdx}:${lap}`);
    return this.timeFor(carIdx, lap, driven);
  }

  private publishTime(carIdx: number, lap: number, driven: number): void {
    const value = this.simTime(carIdx, lap, driven);
    if (value !== undefined) this.cars[carIdx].lastLapTime = value;
  }
}

export interface Recorded {
  recorder: RaceHistoryRecorder;
  starts: RaceStart[];
  ended: number;
  /** Every call the recorder made about a lap, in order. */
  lapCalls: { lap: RaceLap; settled: boolean; lapTime: number | null }[];
  stintCalls: RaceStint[];
  changeCalls: RaceDriverChange[];
  infoChanges: number;
  replaced: number[];
}

/** A recorder with a listener that keeps everything it is told. */
export const recorded = (
  options: Partial<RaceHistoryRecorderOptions> = {}
): Recorded => {
  const out: Recorded = {
    recorder: undefined as unknown as RaceHistoryRecorder,
    starts: [],
    ended: 0,
    lapCalls: [],
    stintCalls: [],
    changeCalls: [],
    infoChanges: 0,
    replaced: [],
  };
  const listener: RaceHistoryListener = {
    onRaceStarted: (start) => out.starts.push(start),
    onLap: (lap, settled) =>
      out.lapCalls.push({ lap, settled, lapTime: lap.lapTime }),
    onStint: (stint) => out.stintCalls.push(stint),
    onDriverChange: (change) => out.changeCalls.push(change),
    onRaceInfoChanged: () => {
      out.infoChanges += 1;
    },
    onCarReplaced: (carIdx) => out.replaced.push(carIdx),
    onRaceEnded: () => {
      out.ended += 1;
    },
  };
  let clock = Date.UTC(2026, 10, 16, 12, 0, 0);
  out.recorder = new RaceHistoryRecorder(listener, {
    simulator: () => 'iracing',
    sessionIdsAreUnique: () => true,
    now: () => (clock += 1000),
    bootId: 'boot',
    ...options,
  });
  return out;
};

/** Whatever takes the frames: the recorder, or the runtime that hosts it. */
export interface FrameSink {
  onFrame(frame: Telemetry): void;
}

/**
 * Runs a field into a recorder for a number of seconds. `each` is called
 * before every frame, to stage what happens on it.
 */
export const drive = (
  field: Field,
  recorder: FrameSink,
  seconds: number,
  each?: (field: Field) => void
): void => {
  const until = field.time + seconds;
  while (field.time < until - 1e-9) {
    field.step();
    each?.(field);
    recorder.onFrame(field.frame());
  }
};

/** Drives until a car has completed a number of laps. */
export const driveLaps = (
  field: Field,
  recorder: FrameSink,
  carIdx: number,
  laps: number,
  each?: (field: Field) => void
): void => {
  const target = field.cars[carIdx].lap + laps;
  let guard = 0;
  while (field.cars[carIdx].lap < target) {
    field.step();
    each?.(field);
    recorder.onFrame(field.frame());
    guard += 1;
    if (guard > 2_000_000) throw new Error('The car never completed its laps');
  }
};

/** Puts a car into the pit lane, and out again. */
export const enterPits = (car: FieldCar): void => {
  car.onPitRoad = true;
  car.surface = TrackLocation.ApproachingPits;
};
export const standInBox = (car: FieldCar): void => {
  car.halted = true;
  car.surface = TrackLocation.InPitStall;
};
export const leaveBox = (car: FieldCar): void => {
  car.halted = false;
  car.surface = TrackLocation.ApproachingPits;
};
export const leavePits = (car: FieldCar): void => {
  car.halted = false;
  car.onPitRoad = false;
  car.surface = TrackLocation.OnTrack;
};
