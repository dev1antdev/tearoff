import type {
  FuelProjectionSnapshot,
  LapTimesSnapshot,
  PitExitPass,
  PitLaneModel,
  PitLaneTrackData,
  PitRejoinRival,
  PitStopParts,
  PitStopSnapshot,
  ReferenceLap,
  ReferenceLapsSnapshot,
  Session,
  SessionLifecycleEvent,
  Telemetry,
} from '@irdashies/types';
import {
  lmuPenaltyBadge,
  PIT_EXIT_PASSES_MAX,
  PIT_REJOIN_LADDER_BEHIND_S,
  PIT_REJOIN_LADDER_MAX,
  PIT_STOP_PART_KEYS,
  TrackLocation,
} from '@irdashies/types';
import { averageLapUsage } from '@irdashies/shared';
import { trackLengthFrom } from './lapTiming';
import {
  driveAtLimitS,
  lapFractionBetween,
  median,
  parsePitSpeedLimitMs,
  pitEntryFrom,
  pitExitFrom,
  pitLaneLengthM,
  PitSpeedLimitMeter,
  trackTimeBetweenS,
  withSpeedLimit,
  withStopSample,
  type LineCrossing,
} from './pitLaneModel';
import {
  ENTRY_EDGE_MIN_SPEED_MS,
  isPitLapVisit,
  isStandingStill,
  isStopVisit,
} from './pitVisit';
import type { TelemetryProcessor } from './TelemetryProcessor';
import { isAwayFromWheel } from './watchedCar';

/**
 * Where the pit lane model of a track is kept. Answers from memory: a
 * processor cannot wait for a disk.
 */
export interface PitLaneModelStore {
  /**
   * The cached record, or null: there is none, or the file has not been
   * read yet, and `revision` moves when it has. Not to be written to.
   */
  get(trackId: string): PitLaneTrackData | null;
  /** Merges learned values; the async debounced write is behind it. */
  save(trackId: string, update: Partial<PitLaneTrackData>): void;
  /** Moves whenever get() may answer differently: load finished, reset, file reload. */
  revision(): number;
}

/**
 * A model kept for as long as the app runs and no longer: what stands in
 * where there is no file to keep it in (a tape, a demo, a spec).
 */
export const createMemoryPitLaneModelStore = (
  initial: Readonly<Record<string, PitLaneTrackData>> = {}
): PitLaneModelStore => {
  const records = new Map<string, PitLaneTrackData>(Object.entries(initial));
  let revision = 0;
  return {
    get: (trackId) => records.get(trackId) ?? null,
    save: (trackId, update) => {
      records.set(trackId, {
        ...(records.get(trackId) ?? { pitEntryPct: null, pitExitPct: null }),
        ...update,
      });
      revision += 1;
    },
    revision: () => revision,
  };
};

export interface PitStopEstimateProcessorOptions {
  store?: PitLaneModelStore;
  /** The fuel projection of the same car: what is aboard and what a lap costs. */
  fuel?: () => FuelProjectionSnapshot | undefined;
  /** Every car's pace. */
  lapTimes?: () => LapTimesSnapshot | undefined;
  /** Every car's best lap of the session, to read a stretch of track off. */
  referenceLaps?: () => ReferenceLapsSnapshot | undefined;
  /** A recorded source: nothing it shows is kept. */
  sourceReplay?: boolean;
}

/** What the store keys a track by: the session's TrackID, as a number. */
const TRACK_ID_PATTERN = /^[1-9]\d{0,9}$/;
/** LMU's pit state for a car that has asked for a stop, and one at rest. */
const PIT_STATE_REQUESTED = 1;
const PIT_STATE_STOPPED = 3;
/** iRacing's pit service flag for "fuel will be added". */
const PIT_SV_FUEL_FILL = 0x10;
/** A full budget of virtual energy, in the percent it is counted in. */
const ENERGY_PERCENT = 100;
/**
 * Two frames further apart than this are not neighbours, and no line is
 * read off a car between them, s.
 */
const MAX_NEIGHBOUR_GAP_S = 1;
/**
 * The most of a lap a car covers between two neighbouring frames. Further,
 * and it was moved: a car put back in its pit box from out on the circuit
 * goes onto pit road without crossing the entry line.
 */
const MAX_STEP_PCT = 0.02;
/** The least a car ahead is said to be ahead by, s: one step of the gap. */
const AHEAD_MIN_GAP_S = 0.1;
/** A measured limit replaces a stored one that is further off than this, m/s. */
const LIMIT_REMEASURE_MS = 0.25;

type Cells = Record<string, { value?: readonly unknown[] } | undefined>;

const cells = (frame: Telemetry): Cells => frame as unknown as Cells;

const list = (
  frame: Telemetry,
  key: string
): readonly unknown[] | undefined => {
  const value = cells(frame)[key]?.value;
  return Array.isArray(value) ? value : undefined;
};

const scalar = (frame: Telemetry, key: string): number | null => {
  const value = cells(frame)[key]?.value?.[0];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

const flag = (frame: Telemetry, key: string): boolean => {
  const value = cells(frame)[key]?.value?.[0];
  return value === true || value === 1;
};

const numberAt = (
  values: readonly unknown[] | undefined,
  index: number
): number | null => {
  const value = values?.[index];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

const flagAt = (
  values: readonly unknown[] | undefined,
  index: number
): boolean => values?.[index] === true || values?.[index] === 1;

const round = (value: number, decimals: number): number => {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
};

const rounded = (value: number | null, decimals: number): number | null =>
  value === null ? null : round(value, decimals);

/** Writes one field; true when it moved. */
const put = <T, K extends keyof T>(target: T, key: K, value: T[K]): boolean => {
  if (target[key] === value) return false;
  target[key] = value;
  return true;
};

type Estimate = PitStopSnapshot['estimate'];
type Timer = PitStopSnapshot['timer'];
type Refuel = NonNullable<PitStopSnapshot['refuel']>;
interface Rejoin {
  position: number;
  classPosition: number;
  ladder: PitRejoinRival[];
  driveToExitS: number | null;
  passes: PitExitPass[];
}

const emptyLane = (): PitLaneModel => ({
  entryPct: null,
  exitPct: null,
  lengthM: null,
  speedLimitMs: null,
  speedLimitSource: null,
  driveAtLimitS: null,
  driveMeasuredS: null,
  trackTimeS: null,
});

const emptyParts = (): PitStopParts => ({
  fuel: 0,
  energy: 0,
  tyres: 0,
  damage: 0,
  driverSwap: 0,
  brakes: 0,
  brakeDucts: 0,
  penalties: 0,
});

/**
 * The player's next pit stop: how long it will stand and what it is made
 * of, the pit lane it is driven through, a timer for the visit under way,
 * what goes into the tank, and the cars that will be around on the way out.
 *
 * It is about the car the user is entered in. Through a team-mate's stint
 * the single-car keys go on describing that car, so the timer and the
 * rejoin go on too; what the sim's estimate reads then has not been seen.
 *
 * The estimate is the sim's own under Le Mans Ultimate. iRacing gives none,
 * so there it is the median of the player's earlier stops on this track in
 * this car, and never less than the repair the car is waiting for.
 *
 * The pit lane is learned and kept per track (`PitLaneModelStore`): its two
 * lines from any car seen crossing them, its speed limit off the limiter,
 * and the time the player's own stops took to drive. Nothing is kept from a
 * recorded source.
 *
 * A visit is timed only from an entry line crossed at speed: a car put in
 * the lane, or leaving its garage, has no anchors and records nothing.
 * Standing is told by `pitVisit.ts`, as it is for the stint record.
 *
 * Deterministic for a sequence of frames, sessions and lifecycle events
 * given what the store and the three snapshots answer.
 */
export class PitStopEstimateProcessor implements TelemetryProcessor<
  PitStopSnapshot,
  'pit-stop.snapshot'
> {
  readonly channel = 'pit-stop.snapshot';
  // Sortable, not positional: gaps and a stop time, read to a tenth.
  readonly tickRateHz = 5;

  private readonly store: PitLaneModelStore;
  private readonly fuelSnapshot: () => FuelProjectionSnapshot | undefined;
  private readonly lapTimesSnapshot: () => LapTimesSnapshot | undefined;
  private readonly referenceSnapshot: () => ReferenceLapsSnapshot | undefined;
  private sourceReplay: boolean;

  // The track and the session's own facts.
  private trackId: string | null = null;
  private trackLengthM = 0;
  private sessionLimitMs: number | null = null;
  private driverCarIdx = -1;
  private carKey: string | null = null;
  /** CarClassID and CarClassEstLapTime per car slot, from the session. */
  private readonly sessionClass: number[] = [];
  private readonly estimatedLap: number[] = [];
  private readonly raceSessions = new Set<number>();

  // The stored model, and what has been learned since it was last read.
  private record: PitLaneTrackData | null = null;
  private storeRevision: number | null = null;
  private learnedEntryPct: number | null = null;
  private learnedExitPct: number | null = null;
  private driveMeasuredS: number | null = null;
  private learnedStandingS: number | null = null;
  private learnedSamples = 0;
  private readonly limitMeter = new PitSpeedLimitMeter();

  // Every car on the frame before, for a line to be read off.
  private readonly previousOnPitRoad: boolean[] = [];
  private readonly previousSurface: number[] = [];
  private readonly previousPct: number[] = [];
  private previousCars = 0;
  private previousCarsAt = 0;
  private readonly crossing: LineCrossing = {
    wasOnPitRoad: false,
    isOnPitRoad: false,
    wasInStall: false,
    previousPct: -1,
    currentPct: -1,
  };

  // The visit under way.
  private lastTime: number | null = null;
  /** On pit road on the last frame the car was running; null when it was not. */
  private wasOnPitRoad: boolean | null = null;
  private wasStanding = false;
  private visitLap = 0;
  /** The user was at the wheel for the whole of the visit so far. */
  private visitAtWheel = false;
  /** The standing estimate on the last frame out on the circuit. */
  private trackStandingS: number | null = null;

  // Reference laps by car, rebuilt when their snapshot moves.
  private referenceVersion: number | null = null;
  private readonly referenceByCar = new Map<number, ReferenceLap>();

  // Scratch for the two sorted lists, indexed by car slot.
  private readonly sortKey: number[] = [];
  private readonly paceOf: number[] = [];
  private readonly order: number[] = [];
  private readonly bySortKey = (a: number, b: number): number =>
    this.sortKey[a] - this.sortKey[b];
  /** The frame's class and pit road arrays, while its rejoin is written. */
  private frameClasses: readonly unknown[] | undefined;
  private framePitRoad: readonly unknown[] | undefined;

  private readonly lane = emptyLane();
  private readonly parts = emptyParts();
  private readonly estimate: Estimate = {
    source: null,
    standingS: null,
    parts: null,
    optionalRepairS: null,
    samples: 0,
    penalty: null,
  };
  private readonly timer: Timer = {
    enteredAt: null,
    stoppedAt: null,
    standingS: 0,
    exitedAt: null,
  };
  private readonly refuel: Refuel = {
    isVirtualEnergy: false,
    target: null,
    aboard: 0,
    toAdd: null,
    toFinish: null,
    runLaps: null,
    runMinutes: null,
  };
  private readonly rejoin: Rejoin = {
    position: 0,
    classPosition: 0,
    ladder: [],
    driveToExitS: null,
    passes: [],
  };
  private readonly latest: PitStopSnapshot = {
    phase: 'idle',
    requested: false,
    lane: this.lane,
    estimate: this.estimate,
    planned: null,
    timer: this.timer,
    last: null,
    refuel: null,
    rejoin: null,
    sessionNum: null,
    version: 0,
  };

  constructor(options: PitStopEstimateProcessorOptions = {}) {
    this.store = options.store ?? createMemoryPitLaneModelStore();
    this.fuelSnapshot = options.fuel ?? (() => undefined);
    this.lapTimesSnapshot = options.lapTimes ?? (() => undefined);
    this.referenceSnapshot = options.referenceLaps ?? (() => undefined);
    this.sourceReplay = options.sourceReplay ?? false;
  }

  /** Called by the host when it learns what kind of source it is fed by. */
  setSourceReplay(replay: boolean): void {
    this.sourceReplay = replay;
  }

  init(session: Session): void {
    const rawId = session?.WeekendInfo?.TrackID;
    const id = rawId === undefined || rawId === null ? '' : String(rawId);
    const trackId = TRACK_ID_PATTERN.test(id) ? id : null;
    if (trackId !== this.trackId) {
      this.trackId = trackId;
      this.forgetTrack();
    }
    this.trackLengthM = session ? trackLengthFrom(session) : 0;
    this.sessionLimitMs = parsePitSpeedLimitMs(
      session?.WeekendInfo?.TrackPitSpeedLimit
    );

    const driverInfo = session?.DriverInfo;
    this.driverCarIdx =
      typeof driverInfo?.DriverCarIdx === 'number'
        ? driverInfo.DriverCarIdx
        : -1;
    this.sessionClass.length = 0;
    this.estimatedLap.length = 0;
    let carKey: string | null = null;
    for (const driver of driverInfo?.Drivers ?? []) {
      const carIdx = driver?.CarIdx;
      if (typeof carIdx !== 'number' || carIdx < 0) continue;
      this.sessionClass[carIdx] = driver.CarClassID;
      this.estimatedLap[carIdx] = driver.CarClassEstLapTime;
      if (carIdx === this.driverCarIdx) {
        carKey = driver.CarModel ?? driver.CarPath ?? null;
      }
    }
    if (carKey !== this.carKey) {
      this.carKey = carKey;
      this.readTimings();
    }

    this.raceSessions.clear();
    for (const entry of session?.SessionInfo?.Sessions ?? []) {
      if (entry?.SessionType === 'Race') {
        this.raceSessions.add(entry.SessionNum);
      }
    }
  }

  onFrame(frame: Telemetry): void {
    const now = scalar(frame, 'SessionTime');
    if (now === null) return;

    let changed = false;
    const sessionNum = scalar(frame, 'SessionNum');
    if (sessionNum !== null && sessionNum !== this.latest.sessionNum) {
      if (this.latest.sessionNum !== null) this.clearSession();
      this.latest.sessionNum = sessionNum;
      changed = true;
    }
    // A clock that ran backwards is a session started again.
    if (this.lastTime !== null && now < this.lastTime) {
      this.clearSession();
      changed = true;
    }
    this.lastTime = now;

    if (this.store.revision() !== this.storeRevision) this.readRecord();

    // Le Mans Ultimate's frames say so themselves; nothing else carries the
    // key.
    const isLmu = cells(frame).LmuGamePhase !== undefined;
    const playerCarIdx = scalar(frame, 'PlayerCarIdx');
    const own =
      playerCarIdx !== null && playerCarIdx >= 0
        ? playerCarIdx
        : this.driverCarIdx;
    const surfaces = list(frame, 'CarIdxTrackSurface');
    const ownSurface = own >= 0 ? numberAt(surfaces, own) : null;
    const hasCar = own >= 0 && ownSurface !== TrackLocation.NotInWorld;
    const atWheel = flag(frame, 'IsOnTrack');
    const garage =
      flag(frame, 'IsInGarage') ||
      (own >= 0 && flagAt(list(frame, 'LmuCarIdxInGarage'), own));
    // At the wheel, or watching while somebody else has the car out.
    const running =
      atWheel || (isAwayFromWheel(frame) && flag(frame, 'LmuWatching'));
    const active = hasCar && running && !garage && !flag(frame, 'LmuDataStale');

    const onPitRoad = active && flag(frame, 'OnPitRoad');
    const speed = scalar(frame, 'Speed');
    const pitStates = list(frame, 'LmuCarIdxPitState');
    const ownPitState = own >= 0 ? numberAt(pitStates, own) : null;
    // The car's own speed where the frame has one; without it -- a team
    // car the sim sends no telemetry for -- the sim's word that it is at
    // rest.
    const standing =
      onPitRoad &&
      (speed !== null
        ? isStandingStill(this.wasStanding, speed)
        : ownPitState === PIT_STATE_STOPPED);
    const pct = scalar(frame, 'LapDistPct');
    const pace = this.paceOfCar(own);

    changed = this.learnLines(frame, now) || changed;
    changed = this.writeLane(isLmu, own, pace) || changed;
    changed = this.writeEstimate(frame, isLmu, own, hasCar) || changed;
    changed =
      put(this.latest, 'requested', ownPitState === PIT_STATE_REQUESTED) ||
      changed;

    if (!active) {
      // The garage ends the visit without a result. Anything else that takes
      // the car away -- a frame the sim has stopped writing, the moment of
      // a driver change -- says nothing about it, and the anchors are kept
      // for the car to come back to.
      if (garage) changed = this.clearVisit() || changed;
      this.wasOnPitRoad = null;
      this.wasStanding = false;
      this.limitMeter.reset();
    } else {
      changed =
        this.followVisit(now, onPitRoad, standing, speed, atWheel, frame) ||
        changed;
      if (isLmu && atWheel && speed !== null) {
        this.measureLimit(frame, now, onPitRoad, speed);
      }
      if (!onPitRoad) this.trackStandingS = this.estimate.standingS;
    }

    const phase = !active
      ? 'idle'
      : !onPitRoad
        ? 'planning'
        : standing
          ? 'service'
          : 'lane';
    changed = put(this.latest, 'phase', phase) || changed;

    changed = this.writeRefuel(frame, isLmu, own, hasCar, pace) || changed;
    changed =
      this.writeRejoin(frame, now, own, hasCar, onPitRoad, pct, pace) ||
      changed;

    if (changed) this.latest.version += 1;
  }

  onLifecycle(event: SessionLifecycleEvent): void {
    this.clearSession();
    if (event.type === 'disconnect') {
      this.trackId = null;
      this.trackLengthM = 0;
      this.sessionLimitMs = null;
      this.driverCarIdx = -1;
      this.carKey = null;
      this.sessionClass.length = 0;
      this.estimatedLap.length = 0;
      this.raceSessions.clear();
      this.forgetTrack();
      Object.assign(this.lane, emptyLane());
    }
    if (event.type !== 'sessionNumChange') this.latest.sessionNum = null;
    this.latest.version += 1;
  }

  snapshot(): PitStopSnapshot {
    return this.latest;
  }

  /** The pace of a car, s: its recent laps, else its class's estimate. */
  private paceOfCar(carIdx: number): number | null {
    if (carIdx < 0) return null;
    const measured = this.lapTimesSnapshot()?.lapTimes[carIdx];
    if (typeof measured === 'number' && measured > 0) return measured;
    const estimate = this.estimatedLap[carIdx];
    return typeof estimate === 'number' && estimate > 0 ? estimate : null;
  }

  private referenceOf(carIdx: number): ReferenceLap | undefined {
    const snapshot = this.referenceSnapshot();
    const version = snapshot?.version ?? null;
    if (version !== this.referenceVersion) {
      this.referenceVersion = version;
      this.referenceByCar.clear();
      for (const [car, lap] of snapshot?.bestLaps ?? []) {
        this.referenceByCar.set(car, lap);
      }
    }
    return this.referenceByCar.get(carIdx);
  }

  /** Reads the track's record again, and the figures taken from it. */
  private readRecord(): void {
    this.storeRevision = this.store.revision();
    this.record = this.trackId ? this.store.get(this.trackId) : null;
    // The store has spoken: what it holds is the model, and a line learned
    // before it answered is only kept where the store still has none. A
    // track reset from the settings clears both.
    if (this.record?.pitEntryPct != null || this.record === null) {
      this.learnedEntryPct = null;
    }
    if (this.record?.pitExitPct != null || this.record === null) {
      this.learnedExitPct = null;
    }
    this.readTimings();
  }

  private readTimings(): void {
    const timing = this.record?.timing;
    this.driveMeasuredS = median(timing?.driveS ?? []);
    const standing =
      this.carKey !== null &&
      timing &&
      Object.hasOwn(timing.standingS, this.carKey)
        ? timing.standingS[this.carKey]
        : [];
    this.learnedStandingS = median(standing);
    this.learnedSamples = standing.length;
  }

  private forgetTrack(): void {
    this.record = null;
    this.storeRevision = null;
    this.learnedEntryPct = null;
    this.learnedExitPct = null;
    this.driveMeasuredS = null;
    this.learnedStandingS = null;
    this.learnedSamples = 0;
    this.previousCars = 0;
    this.limitMeter.reset();
  }

  private get entryPct(): number | null {
    return this.record?.pitEntryPct ?? this.learnedEntryPct;
  }

  private get exitPct(): number | null {
    return this.record?.pitExitPct ?? this.learnedExitPct;
  }

  /** Whether what is seen now may be kept for the next session. */
  private get recording(): boolean {
    return !this.sourceReplay && this.trackId !== null;
  }

  /**
   * Looks for a car crossing a line the model still lacks, among every car
   * on the frame; true when one was found.
   */
  private learnLines(frame: Telemetry, now: number): boolean {
    const needsEntry = this.entryPct === null;
    const needsExit = this.exitPct === null;
    if ((!needsEntry && !needsExit) || this.trackId === null) {
      this.previousCars = 0;
      return false;
    }
    const pitRoad = list(frame, 'CarIdxOnPitRoad');
    const pcts = list(frame, 'CarIdxLapDistPct');
    const surfaces = list(frame, 'CarIdxTrackSurface');
    if (!pitRoad || !pcts) return false;

    let learned = false;
    const neighbours =
      this.previousCars > 0 &&
      now > this.previousCarsAt &&
      now - this.previousCarsAt <= MAX_NEIGHBOUR_GAP_S;
    const cars = pitRoad.length;
    const crossing = this.crossing;
    for (let carIdx = 0; carIdx < cars; carIdx += 1) {
      const onPitRoad = flagAt(pitRoad, carIdx);
      const currentPct = numberAt(pcts, carIdx) ?? -1;
      if (neighbours && carIdx < this.previousCars) {
        crossing.wasOnPitRoad = this.previousOnPitRoad[carIdx];
        crossing.isOnPitRoad = onPitRoad;
        crossing.wasInStall =
          this.previousSurface[carIdx] === TrackLocation.InPitStall;
        crossing.previousPct = this.previousPct[carIdx];
        crossing.currentPct = currentPct;
        const moved =
          crossing.previousPct >= 0 &&
          currentPct >= 0 &&
          lapFractionBetween(crossing.previousPct, currentPct) <= MAX_STEP_PCT;
        if (moved && crossing.wasOnPitRoad !== onPitRoad) {
          if (needsEntry && this.learnedEntryPct === null) {
            const entry = pitEntryFrom(crossing);
            if (entry !== null) {
              this.learnedEntryPct = round(entry, 4);
              if (this.recording && this.trackId) {
                this.store.save(this.trackId, {
                  pitEntryPct: this.learnedEntryPct,
                });
              }
              learned = true;
            }
          }
          if (needsExit && this.learnedExitPct === null) {
            const exit = pitExitFrom(crossing);
            if (exit !== null) {
              this.learnedExitPct = round(exit, 4);
              if (this.recording && this.trackId) {
                this.store.save(this.trackId, {
                  pitExitPct: this.learnedExitPct,
                });
              }
              learned = true;
            }
          }
        }
      }
      this.previousOnPitRoad[carIdx] = onPitRoad;
      this.previousSurface[carIdx] =
        numberAt(surfaces, carIdx) ?? TrackLocation.NotInWorld;
      this.previousPct[carIdx] = currentPct;
    }
    this.previousCars = cars;
    this.previousCarsAt = now;
    return learned;
  }

  /** The lane model as it stands; true when a published figure moved. */
  private writeLane(isLmu: boolean, own: number, pace: number | null): boolean {
    const lane = this.lane;
    const entry = this.entryPct;
    const exit = this.exitPct;
    const measured = this.record?.timing?.speedLimitMs ?? null;
    const limit = measured ?? this.sessionLimitMs;
    const length = pitLaneLengthM(entry, exit, this.trackLengthM);

    let changed = put(lane, 'entryPct', entry);
    changed = put(lane, 'exitPct', exit) || changed;
    changed = put(lane, 'lengthM', rounded(length, 1)) || changed;
    changed = put(lane, 'speedLimitMs', rounded(limit, 2)) || changed;
    changed =
      put(
        lane,
        'speedLimitSource',
        measured !== null
          ? 'measured'
          : limit === null
            ? null
            : isLmu
              ? 'assumed'
              : 'sim'
      ) || changed;
    changed =
      put(lane, 'driveAtLimitS', rounded(driveAtLimitS(length, limit), 1)) ||
      changed;
    changed =
      put(lane, 'driveMeasuredS', rounded(this.driveMeasuredS, 1)) || changed;
    changed =
      put(
        lane,
        'trackTimeS',
        entry !== null && exit !== null && own >= 0
          ? rounded(
              trackTimeBetweenS(entry, exit, pace, this.referenceOf(own)),
              1
            )
          : null
      ) || changed;
    return changed;
  }

  /** The stop the sim or the player's own history expects. */
  private writeEstimate(
    frame: Telemetry,
    isLmu: boolean,
    own: number,
    hasCar: boolean
  ): boolean {
    const estimate = this.estimate;
    if (!hasCar) return this.clearEstimate();

    if (isLmu) {
      const total = scalar(frame, 'LmuPitStopTime');
      const breakdown = list(frame, 'LmuPitStopParts');
      const penalties = numberAt(list(frame, 'LmuCarIdxPenalties'), own) ?? 0;
      let changed = put(estimate, 'source', total === null ? null : 'sim');
      changed =
        put(
          estimate,
          'penalty',
          penalties > 0
            ? (lmuPenaltyBadge(
                numberAt(list(frame, 'LmuCarIdxPenaltyKind'), own) ?? undefined,
                true,
                penalties,
                scalar(frame, 'LmuPenaltySeconds') ?? undefined
              ) ?? null)
            : null
        ) || changed;
      changed =
        put(
          estimate,
          'standingS',
          total === null ? null : round(Math.max(0, total), 1)
        ) || changed;
      changed = put(estimate, 'optionalRepairS', null) || changed;
      changed = put(estimate, 'samples', 0) || changed;
      if (breakdown && breakdown.length >= PIT_STOP_PART_KEYS.length) {
        for (let index = 0; index < PIT_STOP_PART_KEYS.length; index += 1) {
          const seconds = numberAt(breakdown, index) ?? 0;
          changed =
            put(
              this.parts,
              PIT_STOP_PART_KEYS[index],
              round(Math.max(0, seconds), 1)
            ) || changed;
        }
        changed = put(estimate, 'parts', this.parts) || changed;
      } else {
        changed = put(estimate, 'parts', null) || changed;
      }
      return changed;
    }

    // iRacing: no estimate, so the player's own stops here in this car, and
    // never less than the repair the car is waiting for.
    const repair = Math.max(0, scalar(frame, 'PitRepairLeft') ?? 0);
    const optional = Math.max(0, scalar(frame, 'PitOptRepairLeft') ?? 0);
    const standing =
      this.learnedStandingS !== null
        ? Math.max(this.learnedStandingS, repair)
        : repair > 0
          ? repair
          : null;
    let changed = put(estimate, 'source', standing === null ? null : 'learned');
    changed = put(estimate, 'standingS', rounded(standing, 1)) || changed;
    changed = put(estimate, 'optionalRepairS', round(optional, 1)) || changed;
    changed = put(estimate, 'samples', this.learnedSamples) || changed;
    changed = put(estimate, 'penalty', null) || changed;
    for (const key of PIT_STOP_PART_KEYS) {
      changed =
        put(this.parts, key, key === 'damage' ? round(repair, 1) : 0) ||
        changed;
    }
    changed = put(estimate, 'parts', this.parts) || changed;
    return changed;
  }

  private clearEstimate(): boolean {
    const estimate = this.estimate;
    let changed = put(estimate, 'source', null);
    changed = put(estimate, 'standingS', null) || changed;
    changed = put(estimate, 'parts', null) || changed;
    changed = put(estimate, 'optionalRepairS', null) || changed;
    changed = put(estimate, 'samples', 0) || changed;
    changed = put(estimate, 'penalty', null) || changed;
    return changed;
  }

  /** One frame of a car that is running: the timer and its edges. */
  private followVisit(
    now: number,
    onPitRoad: boolean,
    standing: boolean,
    speed: number | null,
    atWheel: boolean,
    frame: Telemetry
  ): boolean {
    const timer = this.timer;
    const was = this.wasOnPitRoad;
    let changed = false;

    if (onPitRoad && was === false) {
      // Over the entry line. Slower than walking pace it was put there.
      if (speed === null || speed > ENTRY_EDGE_MIN_SPEED_MS) {
        timer.enteredAt = round(now, 2);
        timer.stoppedAt = null;
        timer.standingS = 0;
        timer.exitedAt = null;
        this.visitLap = Math.max(0, scalar(frame, 'LapCompleted') ?? 0);
        this.visitAtWheel = atWheel;
        // The figure as it stood out on the circuit: what the sim's
        // estimate does once the car is in the lane has not been seen.
        const standingS = this.trackStandingS ?? this.estimate.standingS;
        this.latest.planned = {
          standingS,
          driveS:
            standingS !== null && standingS > 0
              ? (this.lane.driveMeasuredS ?? this.lane.driveAtLimitS)
              : this.lane.driveAtLimitS,
        };
        changed = true;
      } else {
        changed = this.clearVisit() || changed;
      }
    }

    const timing = timer.enteredAt !== null && timer.exitedAt === null;
    if (timing && onPitRoad) {
      this.visitAtWheel &&= atWheel;
      if (standing && timer.stoppedAt === null) {
        timer.stoppedAt = round(now, 2);
        changed = true;
      } else if (!standing && timer.stoppedAt !== null) {
        timer.standingS = round(timer.standingS + now - timer.stoppedAt, 2);
        timer.stoppedAt = null;
        changed = true;
      }
    } else if (timing && was === true) {
      // Over the exit line.
      if (timer.stoppedAt !== null) {
        timer.standingS = round(timer.standingS + now - timer.stoppedAt, 2);
        timer.stoppedAt = null;
      }
      const enteredAt = timer.enteredAt ?? now;
      const laneS = now - enteredAt;
      if (isPitLapVisit(laneS)) {
        timer.exitedAt = round(now, 2);
        this.latest.last = {
          laneS: round(laneS, 1),
          standingS: round(timer.standingS, 1),
          plannedStandingS: this.latest.planned?.standingS ?? null,
          lap: this.visitLap,
        };
        if (isStopVisit(timer.standingS) && this.visitAtWheel) {
          this.keepStop(laneS - timer.standingS, timer.standingS);
        }
      } else {
        // A brush with the line: not a visit, and nothing to show for it.
        timer.enteredAt = null;
        timer.standingS = 0;
      }
      this.latest.planned = null;
      changed = true;
    } else if (timing) {
      // Out on the circuit with a visit still open: its exit was not seen.
      changed = this.clearVisit() || changed;
    }

    this.wasOnPitRoad = onPitRoad;
    this.wasStanding = standing;
    return changed;
  }

  /** Files a stop's drive and standing times with the track. */
  private keepStop(driveS: number, standingS: number): void {
    if (!this.recording || !this.trackId) return;
    this.store.save(this.trackId, {
      timing: withStopSample(
        this.record?.timing,
        this.carKey,
        driveS,
        standingS
      ),
    });
  }

  /** Reads the limit off the limiter and keeps it where it is news. */
  private measureLimit(
    frame: Telemetry,
    now: number,
    onPitRoad: boolean,
    speed: number
  ): void {
    const limit = this.limitMeter.sample({
      sessionTime: now,
      onPitRoad,
      limiterOn: flag(frame, 'dcPitSpeedLimiterToggle'),
      throttle: scalar(frame, 'ThrottleRaw') ?? 0,
      brake: scalar(frame, 'BrakeRaw') ?? 1,
      speed,
    });
    if (limit === null || !this.recording || !this.trackId) return;
    const stored = this.record?.timing?.speedLimitMs ?? null;
    if (stored !== null && Math.abs(stored - limit) <= LIMIT_REMEASURE_MS) {
      return;
    }
    this.store.save(this.trackId, {
      timing: withSpeedLimit(this.record?.timing, limit),
    });
  }

  /** What the stop puts in, and how far that goes. */
  private writeRefuel(
    frame: Telemetry,
    isLmu: boolean,
    own: number,
    hasCar: boolean,
    pace: number | null
  ): boolean {
    const fuel = this.fuelSnapshot();
    if (!hasCar || !fuel) return put(this.latest, 'refuel', null);

    const refuel = this.refuel;
    const onEnergy = fuel.budget === 'virtualEnergy';
    const target = isLmu ? scalar(frame, 'LmuRefuelTarget') : null;
    const isVirtualEnergy =
      target !== null
        ? flag(frame, 'LmuRefuelTargetIsVirtualEnergy')
        : onEnergy;

    // Aboard and per lap, in the unit the level is set in.
    let aboard: number;
    let perLap: number;
    if (isVirtualEnergy === onEnergy) {
      aboard = fuel.fuelLevel;
      perLap = averageLapUsage(fuel.completedLaps);
    } else if (isVirtualEnergy) {
      // The menu is in energy and the projection has not seen it yet.
      const left = numberAt(list(frame, 'LmuCarIdxEnergyRemaining'), own);
      aboard = left !== null && left >= 0 ? left * ENERGY_PERCENT : 0;
      perLap = 0;
    } else {
      aboard = fuel.tank?.level ?? 0;
      perLap = fuel.tank?.perLap ?? 0;
    }

    let toAdd: number | null;
    let levelAfter: number | null;
    if (isLmu) {
      toAdd = target === null ? null : Math.max(target - aboard, 0);
      levelAfter = target;
    } else {
      // iRacing states an amount to add, and only when fuel is ticked.
      const amount = scalar(frame, 'PitSvFuel');
      const ticked =
        ((scalar(frame, 'PitSvFlags') ?? 0) & PIT_SV_FUEL_FILL) !== 0;
      toAdd = amount === null ? null : ticked ? Math.max(amount, 0) : 0;
      levelAfter = toAdd === null ? null : aboard + toAdd;
    }
    const runLaps =
      levelAfter !== null && perLap > 0 ? levelAfter / perLap : null;

    let changed = put(refuel, 'isVirtualEnergy', isVirtualEnergy);
    changed = put(refuel, 'target', rounded(target, 1)) || changed;
    changed = put(refuel, 'aboard', round(aboard, 1)) || changed;
    changed = put(refuel, 'toAdd', rounded(toAdd, 1)) || changed;
    changed =
      put(
        refuel,
        'toFinish',
        fuel.hasValidRaceEstimate && perLap > 0
          ? round(fuel.estimatedLapsRemaining * perLap - aboard, 1)
          : null
      ) || changed;
    changed = put(refuel, 'runLaps', rounded(runLaps, 1)) || changed;
    changed =
      put(
        refuel,
        'runMinutes',
        runLaps !== null && pace !== null
          ? round((runLaps * pace) / 60, 1)
          : null
      ) || changed;
    changed = put(this.latest, 'refuel', refuel) || changed;
    return changed;
  }

  /** Where the car is in the race, and who is around its pit exit. */
  private writeRejoin(
    frame: Telemetry,
    now: number,
    own: number,
    hasCar: boolean,
    onPitRoad: boolean,
    pct: number | null,
    pace: number | null
  ): boolean {
    if (!hasCar) {
      this.rejoin.ladder.length = 0;
      this.rejoin.passes.length = 0;
      return put(this.latest, 'rejoin', null);
    }
    const rejoin = this.rejoin;
    const positions = list(frame, 'CarIdxPosition');
    const classPositions = list(frame, 'CarIdxClassPosition');
    this.frameClasses = list(frame, 'CarIdxClass');
    this.framePitRoad = list(frame, 'CarIdxOnPitRoad');
    const ownClass = this.classOf(own);

    let changed = put(rejoin, 'position', numberAt(positions, own) ?? 0);
    changed =
      put(rejoin, 'classPosition', numberAt(classPositions, own) ?? 0) ||
      changed;
    changed = this.writeLadder(frame, own, ownClass, positions) || changed;
    changed =
      put(
        rejoin,
        'driveToExitS',
        rounded(this.driveToExit(own, onPitRoad, pct, pace), 1)
      ) || changed;
    changed = this.writePasses(frame, now, own, ownClass) || changed;
    changed = put(this.latest, 'rejoin', rejoin) || changed;
    this.frameClasses = undefined;
    this.framePitRoad = undefined;
    return changed;
  }

  /** A car's class: the frame's where it carries one, else the session's. */
  private classOf(carIdx: number): number | null {
    return (
      numberAt(this.frameClasses, carIdx) ?? this.sessionClass[carIdx] ?? null
    );
  }

  /** Writes one rung of the ladder in place; true when it moved. */
  private writeRival(
    index: number,
    carIdx: number,
    ownClass: number | null
  ): boolean {
    const ladder = this.rejoin.ladder;
    let entry = ladder[index];
    let changed = false;
    if (!entry) {
      entry = { carIdx: -1, gapS: 0, sameClass: false, inPit: false };
      ladder[index] = entry;
      changed = true;
    }
    changed = put(entry, 'carIdx', carIdx) || changed;
    changed = put(entry, 'gapS', this.sortKey[carIdx]) || changed;
    changed =
      put(entry, 'sameClass', this.classOf(carIdx) === ownClass) || changed;
    changed = put(entry, 'inPit', flagAt(this.framePitRoad, carIdx)) || changed;
    return changed;
  }

  /**
   * The cars the stop is measured against: the nearest ahead overall and
   * in class, then those behind out to four minutes, by race gap.
   */
  private writeLadder(
    frame: Telemetry,
    own: number,
    ownClass: number | null,
    positions: readonly unknown[] | undefined
  ): boolean {
    const ladder = this.rejoin.ladder;
    const gaps = list(frame, 'CarIdxF2Time');
    const sessionNum = this.latest.sessionNum;
    const ownGap = numberAt(gaps, own);
    const ownPosition = numberAt(positions, own) ?? 0;
    if (
      !gaps ||
      ownGap === null ||
      ownPosition <= 0 ||
      sessionNum === null ||
      !this.raceSessions.has(sessionNum)
    ) {
      if (ladder.length === 0) return false;
      ladder.length = 0;
      return true;
    }
    const surfaces = list(frame, 'CarIdxTrackSurface');
    const order = this.order;
    order.length = 0;
    let ahead = -1;
    let aheadInClass = -1;
    for (let carIdx = 0; carIdx < gaps.length; carIdx += 1) {
      if (carIdx === own) continue;
      const position = numberAt(positions, carIdx) ?? 0;
      const time = numberAt(gaps, carIdx);
      if (position <= 0 || time === null) continue;
      if (numberAt(surfaces, carIdx) === TrackLocation.NotInWorld) continue;
      let gap = round(time - ownGap, 1);
      // A dead heat on the clock is settled by the order the sim has them
      // in, and a car ahead is given a gap that says so: the sign is how a
      // reader tells the two sides apart.
      const isAhead = gap < 0 || (gap === 0 && position < ownPosition);
      if (isAhead && gap === 0) gap = -AHEAD_MIN_GAP_S;
      this.sortKey[carIdx] = gap;
      if (isAhead) {
        if (ahead < 0 || gap > this.sortKey[ahead]) ahead = carIdx;
        if (
          this.classOf(carIdx) === ownClass &&
          (aheadInClass < 0 || gap > this.sortKey[aheadInClass])
        ) {
          aheadInClass = carIdx;
        }
      } else if (gap <= PIT_REJOIN_LADDER_BEHIND_S) {
        order.push(carIdx);
      }
    }
    order.sort(this.bySortKey);
    const aheadCount =
      (ahead >= 0 ? 1 : 0) +
      (aheadInClass >= 0 && aheadInClass !== ahead ? 1 : 0);
    order.length = Math.min(order.length, PIT_REJOIN_LADDER_MAX - aheadCount);

    let changed = false;
    let count = 0;
    // The further one first, so the whole list runs by gap.
    if (aheadInClass >= 0 && aheadInClass !== ahead) {
      changed = this.writeRival(count, aheadInClass, ownClass) || changed;
      count += 1;
    }
    if (ahead >= 0) {
      changed = this.writeRival(count, ahead, ownClass) || changed;
      count += 1;
    }
    for (const carIdx of order) {
      changed = this.writeRival(count, carIdx, ownClass) || changed;
      count += 1;
    }
    if (ladder.length !== count) {
      ladder.length = count;
      changed = true;
    }
    return changed;
  }

  /**
   * Seconds from where the car is to the pit exit line, through the lane
   * at the limit and without standing. Null until the lane is known.
   */
  private driveToExit(
    own: number,
    onPitRoad: boolean,
    pct: number | null,
    pace: number | null
  ): number | null {
    const entry = this.entryPct;
    const exit = this.exitPct;
    const limit = this.lane.speedLimitMs;
    if (entry === null || exit === null || pct === null || !(pct >= 0)) {
      return null;
    }
    if (limit === null || !(limit > 0) || !(this.trackLengthM > 0)) return null;
    const laneShare = lapFractionBetween(entry, exit);
    if (onPitRoad) {
      // Between the lines; a hair before the first or past the second
      // reads as the whole lane or none of it.
      const left = lapFractionBetween(pct, exit);
      const share = left > laneShare ? (left > 0.5 ? 0 : laneShare) : left;
      return (share * this.trackLengthM) / limit;
    }
    const toEntry = trackTimeBetweenS(pct, entry, pace, this.referenceOf(own));
    return toEntry === null
      ? null
      : toEntry + (laneShare * this.trackLengthM) / limit;
  }

  /** Every car out on the circuit and when it next passes the pit exit. */
  private writePasses(
    frame: Telemetry,
    now: number,
    own: number,
    ownClass: number | null
  ): boolean {
    const passes = this.rejoin.passes;
    const exit = this.exitPct;
    const pcts = list(frame, 'CarIdxLapDistPct');
    if (exit === null || !pcts) {
      if (passes.length === 0) return false;
      passes.length = 0;
      return true;
    }
    const surfaces = list(frame, 'CarIdxTrackSurface');
    const order = this.order;
    order.length = 0;
    for (let carIdx = 0; carIdx < pcts.length; carIdx += 1) {
      if (carIdx === own || flagAt(this.framePitRoad, carIdx)) continue;
      const surface = numberAt(surfaces, carIdx);
      if (
        surface === TrackLocation.NotInWorld ||
        surface === TrackLocation.InPitStall
      ) {
        continue;
      }
      const carPct = numberAt(pcts, carIdx);
      const carPace = this.paceOfCar(carIdx);
      if (carPct === null || carPct < 0 || carPace === null) continue;
      const seconds = trackTimeBetweenS(
        carPct,
        exit,
        carPace,
        this.referenceOf(carIdx)
      );
      if (seconds === null) continue;
      this.sortKey[carIdx] = round(now + seconds, 1);
      this.paceOf[carIdx] = round(carPace, 1);
      order.push(carIdx);
    }
    order.sort(this.bySortKey);
    order.length = Math.min(order.length, PIT_EXIT_PASSES_MAX);

    let changed = false;
    for (let index = 0; index < order.length; index += 1) {
      const carIdx = order[index];
      let entry = passes[index];
      if (!entry) {
        entry = { carIdx: -1, passAt: 0, lapTimeS: 0, sameClass: false };
        passes[index] = entry;
        changed = true;
      }
      changed = put(entry, 'carIdx', carIdx) || changed;
      changed = put(entry, 'passAt', this.sortKey[carIdx]) || changed;
      changed = put(entry, 'lapTimeS', this.paceOf[carIdx]) || changed;
      changed =
        put(entry, 'sameClass', this.classOf(carIdx) === ownClass) || changed;
    }
    if (passes.length !== order.length) {
      passes.length = order.length;
      changed = true;
    }
    return changed;
  }

  /** Takes the timer and the plan down; true when there was one. */
  private clearVisit(): boolean {
    const timer = this.timer;
    const had =
      timer.enteredAt !== null ||
      timer.stoppedAt !== null ||
      timer.exitedAt !== null ||
      timer.standingS !== 0 ||
      this.latest.planned !== null;
    timer.enteredAt = null;
    timer.stoppedAt = null;
    timer.standingS = 0;
    timer.exitedAt = null;
    this.latest.planned = null;
    return had;
  }

  /** Everything that belongs to a session; the lane model is the track's. */
  private clearSession(): void {
    this.clearVisit();
    this.clearEstimate();
    this.latest.last = null;
    this.latest.refuel = null;
    this.latest.rejoin = null;
    this.rejoin.ladder.length = 0;
    this.rejoin.passes.length = 0;
    this.latest.phase = 'idle';
    this.latest.requested = false;
    this.lastTime = null;
    this.wasOnPitRoad = null;
    this.wasStanding = false;
    this.trackStandingS = null;
    this.previousCars = 0;
    this.limitMeter.reset();
  }
}
