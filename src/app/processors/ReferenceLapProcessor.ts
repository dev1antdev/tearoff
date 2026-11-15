import type {
  Driver,
  ReferenceLap,
  ReferenceLapsSnapshot,
  Session,
  SessionLifecycleEvent,
  Telemetry,
} from '@irdashies/types';
import type { TelemetryProcessor } from './TelemetryProcessor';
import { isAwayFromWheel } from './watchedCar';
import {
  bucketIndex,
  crossingTime,
  intervalFor,
  isHeldAtLine,
  isLineCrossing,
  pointsCountFor,
  trackLengthFrom,
} from './lapTiming';

const VALID_PACE_RATIO = 0.85;
/** Conversion from the m/s of the raw `Speed` channel to the km/h we store. */
const MS_TO_KPH = 3.6;

export interface ReferenceLapPersistence {
  load(seriesId: number, trackId: number, classId: number): ReferenceLap | null;
  save(
    seriesId: number,
    trackId: number,
    classId: number,
    lap: ReferenceLap
  ): void;
}

/**
 * Where the player's all-time reference lap for a track and car comes from:
 * the lap library, which records every lap the player completes and says
 * which one the reference is -- the quickest clean lap, or one chosen by hand.
 *
 * This processor only reads it. It does not decide which lap qualifies, so
 * there is one answer to that and it is the library's.
 */
export interface PlayerReferenceLapSource {
  /**
   * The reference lap, or null when there is none or none is known yet.
   * Tangents may be left zeroed; they are derived here.
   *
   * Must hand back the same object for as long as the lap is the same one:
   * a new object is taken for a new lap and published as such.
   */
  load(
    trackId: number,
    carKey: string,
    pointsCount: number
  ): ReferenceLap | null;
  /** Moves whenever what `load` returns may have changed. */
  revision(): number;
}

const noPlayerLaps: PlayerReferenceLapSource = {
  load: () => null,
  revision: () => 0,
};

/**
 * Which of the player's stints is under way, from the player's ledger, so
 * that the best lap of a stint ends where the stint does and there is one
 * answer to where that is: a service, the garage, another driver or the
 * session, and not a drive-through.
 */
export interface PlayerStintSource {
  /** The stint under way, or '' with none. Another value is another stint. */
  stintId(): string;
  /** Its ordinal in the session, from 1; 0 with none. */
  stintOrdinal(): number;
}

/**
 * Below this, in metres per second, a car in the pits has stopped. Without
 * a ledger to say where a stint ends, that is where one does: a car that
 * drives through the pit lane has not started another.
 */
const STINT_STOP_SPEED_MS = 0.1;

/** Whether a lap was begun at a line crossing that was seen. */
const isTimed = (lap: ReferenceLap): boolean =>
  lap.startTime !== Number.MAX_SAFE_INTEGER;

const lapTimeOf = (lap: ReferenceLap): number => lap.finishTime - lap.startTime;

const numericValue = (
  frame: Telemetry,
  key: keyof Telemetry
): number | null => {
  const value = frame[key]?.value?.[0];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

/** Where a lap is far enough from the line that LMU's void flag is its own. */
const INVALIDATION_START_PCT = 0.05;

/** `WeekendInfo.SimMode` as the Le Mans Ultimate session mapping writes it. */
const LMU_SIM_MODE = 'Le Mans Ultimate';

/**
 * Whether the session has class references at all: laps kept per class, to
 * measure a car against before it has a lap of its own.
 *
 * Under iRacing they are stored per series, and a session without a series
 * -- an AI race, a hosted or league session -- keeps the class's best lap of
 * the session in the stored one's place. Le Mans Ultimate has no series to
 * store one under, and nothing to key a stand-in by either: its class ids
 * are the order the sim first listed the classes in, so 0 is a class like
 * any other, which the store's own rule leaves without a lap, and an id
 * says nothing from one session to the next. Filled all the same, the
 * "stored class reference" there was another car's lap from the session for
 * two classes of a recorded race and absent for the third. So it has none,
 * and its consumers fall back as they do whenever a class has no lap.
 */
const hasClassReferences = (session: Session): boolean =>
  session.WeekendInfo?.SimMode !== LMU_SIM_MODE;

/**
 * A lap to sample from this frame on. `crossedAt` is when the car crossed
 * the line to begin it, or null for a car first seen with its lap already
 * under way.
 *
 * Only a lap begun at a crossing this recorder saw is timed. A car first
 * seen just past the line looks like one that has just crossed it, but when
 * it crossed is not known: it may have been standing there, and under Le
 * Mans Ultimate the position may be the first that scoring has given it
 * since a rolling start, with the line as much as a fifth of a second
 * behind. Timed from first sight, the opening lap of a recorded race became
 * the player's session best at 89.8 s, and the lap after it, 86.7 s, read
 * three and a half seconds up on a reference that was never a flying lap.
 */
const createLap = (
  pointsCount: number,
  interval: number,
  crossedAt: number | null,
  trackPct: number,
  clean: boolean
): ReferenceLap => {
  // The first stretch has to be sampled as well, and exactly 0 after a
  // crossing is the sim taking the car's position away, not a place past
  // the line.
  const timed =
    crossedAt !== null && trackPct <= interval && !isHeldAtLine(trackPct);
  return {
    startTime: timed ? crossedAt : Number.MAX_SAFE_INTEGER,
    finishTime: -1,
    times: new Float32Array(pointsCount),
    pointPos: new Float32Array(pointsCount).fill(-1),
    tangents: new Float32Array(pointsCount),
    interval,
    pointsCount,
    lastTrackedPct: trackPct,
    isCleanLap: timed && clean,
  };
};

const precomputeTangents = (lap: ReferenceLap): void => {
  const { pointPos: x, times: y, tangents } = lap;
  const count = x.length;
  if (count < 2) return;
  const deltas = new Float32Array(count - 1);
  for (let index = 0; index < count - 1; index += 1) {
    deltas[index] = (y[index + 1] - y[index]) / (x[index + 1] - x[index]);
  }
  const lapTime = lap.finishTime - lap.startTime;
  const before =
    (y[0] - (y[count - 1] - lapTime)) / (x[0] - (x[count - 1] - 1));
  const after = (y[0] + lapTime - y[count - 1]) / (x[0] + 1 - x[count - 1]);
  const assign = (
    index: number,
    left: number,
    right: number,
    leftWidth: number,
    rightWidth: number
  ) => {
    if (left * right <= 0) {
      tangents[index] = 0;
      return;
    }
    const firstWeight = 2 * rightWidth + leftWidth;
    const secondWeight = rightWidth + 2 * leftWidth;
    tangents[index] =
      (firstWeight + secondWeight) /
      (firstWeight / left + secondWeight / right);
  };
  assign(0, before, deltas[0], x[0] - (x[count - 1] - 1), x[1] - x[0]);
  for (let index = 1; index < count - 1; index += 1) {
    assign(
      index,
      deltas[index - 1],
      deltas[index],
      x[index] - x[index - 1],
      x[index + 1] - x[index]
    );
  }
  assign(
    count - 1,
    deltas[count - 2],
    after,
    x[count - 1] - x[count - 2],
    x[0] + 1 - x[count - 1]
  );
};

export class ReferenceLapProcessor implements TelemetryProcessor<ReferenceLapsSnapshot> {
  readonly channel = 'reference-laps.snapshot';
  readonly tickRateHz = 'event';

  private activeLaps = new Map<number, ReferenceLap>();
  private bestLaps = new Map<number, ReferenceLap>();
  private persistedLaps = new Map<number, ReferenceLap>();
  private loadedClassIds = new Set<number>();
  /** False where `persistedLaps` stays empty; see `hasClassReferences`. */
  private classReferences = true;
  private drivers: (Driver | undefined)[] = [];
  /** Only needed to record speeds — iRacing has no CarIdxSpeed. */
  private playerCarIdx = -1;
  private seriesId = -1;
  private trackId = -1;
  private sessionIdentity = '';
  private pointsCount = 0;
  private interval = 0;
  private sessionNum: number | null = null;
  private aggregationEnabled = true;
  private persistenceEnabled = true;
  /** Each car's lap fraction on the previous frame, to place a crossing. */
  private prevPcts: number[] = [];
  private prevFrameTime: number | null = null;
  /** The player's car model, which the all-time lap is kept under. */
  private playerCarKey = '';
  private playerAllTime: ReferenceLap | null = null;
  /** The source's revision when the all-time lap was last read from it. */
  private playerRevision = -1;
  /**
   * Whether somebody other than the user drove any of the lap the player's
   * car is on. Such a lap is the car's and not the user's, and does not
   * become their session best. True until the car has been seen crossing
   * the line with the user at the wheel.
   */
  private playerLapWatched = true;
  /**
   * Whether the lap the player's car is on still has every point of its
   * curve: begun at a crossing, never on pit road, no stretch skipped. Not
   * the same as clean: a lap the sim has voided is sampled to its end, to
   * be the last lap, and is no best of anything.
   */
  private playerLapSampled = false;
  /** The player's last whole lap, voided or not. */
  private playerLastLap: ReferenceLap | null = null;
  /** The car the last lap and the stint's best were driven in. */
  private playerLapsCarIdx = -1;
  private playerLapsCarKey = '';
  /** The player's best clean lap of the stint under way. */
  private playerStintBest: ReferenceLap | null = null;
  private playerStintId = 0;
  /** The ledger's stint the stint best is kept for; undefined until asked. */
  private stintKey: string | undefined;
  /** Without a ledger: the car has stood in the pits and not left them yet. */
  private stoppedInPits = false;
  private latest: ReferenceLapsSnapshot = this.emptySnapshot();

  constructor(
    private readonly persistence: ReferenceLapPersistence,
    private readonly playerLaps: PlayerReferenceLapSource = noPlayerLaps,
    /**
     * Where the player's stints begin. Without it a stint ends when the car
     * stops in the pits.
     */
    private readonly stints?: PlayerStintSource
  ) {}

  init(session: Session): void {
    const seriesId = session.WeekendInfo?.SeriesID ?? -1;
    const trackId = session.WeekendInfo?.TrackID ?? -1;
    const trackLength = trackLengthFrom(session);
    const sessionIdentity = `${seriesId}:${trackId}:${session.WeekendInfo?.SubSessionID ?? -1}:${trackLength}`;
    const drivers = (session.DriverInfo?.Drivers ?? []) as (
      Driver | undefined
    )[];
    this.drivers = drivers;
    this.classReferences = hasClassReferences(session);
    const playerCarIdx = session.DriverInfo?.DriverCarIdx ?? -1;
    const player = drivers.find((driver) => driver?.CarIdx === playerCarIdx);
    // LMU's CarPath is the livery file, so two entries of one car differ
    // there; it names the model separately. iRacing's CarPath is the model.
    const playerCarKey = player?.CarModel ?? player?.CarPath ?? '';
    // Another car's lap in progress says nothing of who is driving it.
    if (playerCarIdx !== this.playerCarIdx) this.playerLapWatched = true;
    this.playerCarIdx = playerCarIdx;
    // The last lap and the stint's best were driven in the car they were
    // driven in. A session that for a moment names no player, or no car for
    // them, says nothing about that: only another car does.
    const anotherCar =
      (playerCarIdx >= 0 &&
        this.playerLapsCarIdx >= 0 &&
        playerCarIdx !== this.playerLapsCarIdx) ||
      (playerCarKey !== '' &&
        this.playerLapsCarKey !== '' &&
        playerCarKey !== this.playerLapsCarKey);
    if (playerCarIdx >= 0) this.playerLapsCarIdx = playerCarIdx;
    if (playerCarKey !== '') this.playerLapsCarKey = playerCarKey;
    const playerLapsDropped = anotherCar && this.dropPlayerLaps();
    if (trackId <= 0 || trackLength <= 0) {
      if (playerLapsDropped) this.publish();
      return;
    }
    if (sessionIdentity === this.sessionIdentity) {
      const classLapsLoaded = this.loadPersistedForDrivers(
        session.DriverInfo?.PaceCarIdx ?? -1
      );
      const playerLapChanged = this.loadPlayerAllTime(playerCarKey);
      if (classLapsLoaded || playerLapChanged || playerLapsDropped) {
        this.publish();
      }
      return;
    }
    this.seriesId = seriesId;
    this.trackId = trackId;
    this.sessionIdentity = sessionIdentity;
    this.pointsCount = pointsCountFor(trackLength);
    this.interval = intervalFor(this.pointsCount);
    this.activeLaps.clear();
    this.bestLaps.clear();
    this.persistedLaps.clear();
    this.loadedClassIds.clear();
    this.prevPcts.length = 0;
    this.prevFrameTime = null;
    // A different track: whatever was held belongs to the last one.
    this.playerAllTime = null;
    this.dropPlayerLaps();
    this.loadPersistedForDrivers(session.DriverInfo?.PaceCarIdx ?? -1);
    this.loadPlayerAllTime(playerCarKey);
    this.publish();
  }

  onFrame(frame: Telemetry): void {
    if (!this.aggregationEnabled || this.pointsCount === 0) return;
    // The library has recorded a lap, or one was deleted or chosen by hand:
    // whichever it is, the reference may be a different lap now.
    if (
      this.playerLaps.revision() !== this.playerRevision &&
      this.loadPlayerAllTime(this.playerCarKey)
    ) {
      this.publish();
    }
    const sessionNum = numericValue(frame, 'SessionNum');
    if (
      this.sessionNum !== null &&
      sessionNum !== null &&
      sessionNum !== this.sessionNum
    ) {
      this.resetSession(sessionNum);
    }
    this.sessionNum = sessionNum;
    const distances = frame.CarIdxLapDistPct?.value;
    const pitRoad = frame.CarIdxOnPitRoad?.value;
    const sessionTime = numericValue(frame, 'SessionTime');
    // Raw m/s, player-only — converted to km/h when written below.
    const playerSpeedMs = numericValue(frame, 'Speed');
    // LMU only, and only for the player: the sim voids a lap for a track cut
    // without a pit visit. iRacing publishes no such var.
    const playerLapInvalidated = frame.LmuLapInvalidated?.value?.[0] === true;
    // A team-mate at the wheel of the player's car. Their lap is timed like
    // any other car's, but the best lap kept for the player's car is the
    // one the player's own laps are measured against, and stays theirs.
    const playerAway = isAwayFromWheel(frame);
    if (
      !Array.isArray(distances) ||
      distances.length === 0 ||
      sessionTime === null
    ) {
      return;
    }
    if (this.followStint(frame, playerSpeedMs)) this.publish();

    for (const driver of this.drivers) {
      if (!driver) continue;
      const carIdx = driver.CarIdx;
      const trackPct = distances[carIdx];
      if (
        typeof trackPct !== 'number' ||
        !Number.isFinite(trackPct) ||
        trackPct < 0
      ) {
        this.prevPcts[carIdx] = -1;
        continue;
      }
      const previousPct = this.prevPcts[carIdx];
      this.prevPcts[carIdx] = trackPct;
      // The void flag is ignored just after the line, where it may still be
      // the previous lap's: it stays set for the rest of a voided lap, so a
      // cut early in the lap is caught once past it.
      const invalidated =
        carIdx === this.playerCarIdx &&
        playerLapInvalidated &&
        trackPct >= INVALIDATION_START_PCT;
      const onPitRoad = Boolean(pitRoad?.[carIdx]);
      const clean = !onPitRoad && !invalidated;
      const isPlayer = carIdx === this.playerCarIdx;
      const active = this.activeLaps.get(carIdx);
      if (!active) {
        // First sight of the car: its lap began before anything was seen.
        if (isPlayer) {
          this.playerLapWatched = true;
          this.playerLapSampled = false;
        }
        this.activeLaps.set(
          carIdx,
          createLap(this.pointsCount, this.interval, null, trackPct, clean)
        );
        continue;
      }
      if (isLineCrossing(active.lastTrackedPct, trackPct)) {
        const crossedAt = crossingTime(
          previousPct,
          trackPct,
          this.prevFrameTime,
          sessionTime
        );
        active.finishTime = crossedAt;
        // One snapshot for all a crossing changes: the session best, and for
        // the player the last lap and the stint's best with it.
        const changed = isPlayer
          ? this.completePlayerLap(
              driver,
              active,
              !(this.playerLapWatched || playerAway)
            )
          : this.promote(driver, active);
        if (changed) this.publish();
        // The frame that crosses the line is the new lap's first.
        const next = createLap(
          this.pointsCount,
          this.interval,
          crossedAt,
          trackPct,
          clean
        );
        if (isPlayer) {
          this.playerLapWatched = playerAway;
          this.playerLapSampled = isTimed(next) && !onPitRoad;
        }
        this.activeLaps.set(carIdx, next);
        continue;
      }
      if (isPlayer && playerAway) this.playerLapWatched = true;
      if (!clean) active.isCleanLap = false;
      // The pit lane ends the player's curve. A lap the sim has voided is
      // sampled on: it is still what was just driven.
      if (isPlayer && onPitRoad) this.playerLapSampled = false;
      const key = bucketIndex(trackPct, this.pointsCount);
      if (active.pointPos[key] !== -1) continue;
      if (key > 0 && active.pointPos[key - 1] === -1) {
        active.isCleanLap = false;
        if (isPlayer) this.playerLapSampled = false;
      }
      if (isPlayer ? this.playerLapSampled : active.isCleanLap) {
        active.times[key] = sessionTime - active.startTime;
        active.pointPos[key] = trackPct;

        // Speed is player-only (no CarIdxSpeed in iRacing). Written from the
        // same tick as times/pointPos above so the speed/position pairing
        // carries no skew. Allocated lazily so 63 opponents don't each carry a
        // dead buffer, and so a lap already in progress when the player's car
        // index becomes known still starts recording.
        if (carIdx === this.playerCarIdx && playerSpeedMs !== null) {
          active.speedsKph ??= new Float32Array(this.pointsCount);
          active.speedsKph[key] = playerSpeedMs * MS_TO_KPH;
        }
      }
      active.lastTrackedPct = trackPct;
    }
    this.prevFrameTime = sessionTime;
  }

  onLifecycle(event: SessionLifecycleEvent): void {
    if (event.type === 'enter') {
      this.resetSession(null);
      this.aggregationEnabled = !event.replay;
      this.persistenceEnabled = !event.replay;
      return;
    }
    this.resetSession(null);
    if (event.type === 'disconnect') this.aggregationEnabled = false;
  }

  snapshot(): ReferenceLapsSnapshot {
    return this.latest;
  }

  /** Discards an incomplete lap when processing demand is paused. */
  pause(): void {
    this.playerLapWatched = true;
    this.playerLapSampled = false;
    this.activeLaps.clear();
    this.prevPcts.length = 0;
    this.prevFrameTime = null;
  }

  /**
   * Notices a new stint of the player's and drops the best lap of the one
   * before. Returns whether anything published has changed.
   */
  private followStint(frame: Telemetry, speedMs: number | null): boolean {
    if (this.stints) {
      const id = this.stints.stintId();
      if (id === this.stintKey) return false;
      this.stintKey = id;
      // Between two stints the best of the one just ended stays on show.
      if (id === '') return false;
      return this.beginStint(this.stints.stintOrdinal());
    }
    if (this.playerCarIdx < 0) return false;
    const cells = frame as unknown as Record<
      string,
      { value?: readonly unknown[] } | undefined
    >;
    const inPits =
      cells.CarIdxOnPitRoad?.value?.[this.playerCarIdx] === true ||
      cells.IsInGarage?.value?.[0] === true ||
      cells.LmuCarIdxInGarage?.value?.[this.playerCarIdx] === true;
    if (!inPits) {
      this.stoppedInPits = false;
      return false;
    }
    // One stint for one stop, however long the car creeps about its box.
    if (this.stoppedInPits || speedMs === null) return false;
    if (Math.abs(speedMs) >= STINT_STOP_SPEED_MS) return false;
    this.stoppedInPits = true;
    return this.beginStint(this.playerStintId + 1);
  }

  private beginStint(stintId: number): boolean {
    const changed =
      stintId !== this.playerStintId || this.playerStintBest !== null;
    this.playerStintId = stintId;
    this.playerStintBest = null;
    return changed;
  }

  /** Forgets the player's last lap and stint. Returns whether any was held. */
  private dropPlayerLaps(): boolean {
    const held =
      this.playerLastLap !== null ||
      this.playerStintBest !== null ||
      this.playerStintId !== 0;
    this.playerLastLap = null;
    this.playerStintBest = null;
    this.playerStintId = 0;
    this.stintKey = undefined;
    this.stoppedInPits = false;
    return held;
  }

  /**
   * The player's car has finished a lap. Returns whether anything published
   * has changed.
   *
   * A lap somebody else drove any of is the car's and not the user's: it is
   * no best of theirs and not their last lap either. Nor is a lap that was
   * not seen from the line -- the one that opens a race under Le Mans
   * Ultimate among them -- or one that touched pit road: neither has a
   * whole curve.
   */
  private completePlayerLap(
    driver: Driver,
    lap: ReferenceLap,
    own: boolean
  ): boolean {
    if (!own) return false;
    const sessionBest = this.promote(driver, lap);
    const lapTime = lapTimeOf(lap);
    if (!this.playerLapSampled || lap.pointPos.includes(-1) || lapTime <= 0) {
      return sessionBest;
    }
    if (!sessionBest) {
      precomputeTangents(lap);
      // Only the session best feeds the speed delta; on any other lap the
      // speeds would be a quarter of the curve sent to every window for
      // nothing to read.
      delete lap.speedsKph;
    }
    this.playerLastLap = lap;
    const stintBest = this.playerStintBest;
    if (
      this.isFitForBest(driver, lap) &&
      (stintBest === null || lapTime < lapTimeOf(stintBest))
    ) {
      this.playerStintBest = lap;
    }
    return true;
  }

  /**
   * Whether a finished lap can be a best at all: clean, with its whole
   * curve, and not so far off the class reference that it was not a racing
   * lap.
   */
  private isFitForBest(driver: Driver, lap: ReferenceLap): boolean {
    const lapTime = lapTimeOf(lap);
    if (!lap.isCleanLap || lap.pointPos.includes(-1) || lapTime <= 0) {
      return false;
    }
    const classId = driver.CarClassID;
    const persisted = classId > 0 ? this.persistedLaps.get(classId) : undefined;
    const persistedTime = persisted ? lapTimeOf(persisted) : null;
    return !(persistedTime && persistedTime / lapTime < VALID_PACE_RATIO);
  }

  /**
   * Offers a finished lap as its car's best of the session. Returns whether
   * it was taken; the caller publishes.
   */
  private promote(driver: Driver, lap: ReferenceLap): boolean {
    const lapTime = lapTimeOf(lap);
    // Deliberately not gated on CarClassID: bestLaps is keyed by CarIdx and
    // nothing on this path needs a class. iRacing reports CarClassID 0 in test
    // sessions, which is a real session rather than missing data — gating
    // promotion on it silently disabled every bestLaps consumer there (Delta
    // Speed, SectorDelta's ghost). The class is still required for
    // *persistence*, which is keyed by it.
    if (!this.isFitForBest(driver, lap)) return false;
    const classId = driver.CarClassID;
    const persisted = classId > 0 ? this.persistedLaps.get(classId) : undefined;
    const persistedTime = persisted ? lapTimeOf(persisted) : null;
    const best = this.bestLaps.get(driver.CarIdx);
    const bestTime = best ? lapTimeOf(best) : null;
    if (bestTime && lapTime >= bestTime) return false;
    precomputeTangents(lap);
    this.bestLaps.set(driver.CarIdx, lap);
    // classId > 0 guards persistence only. The disk key is
    // seriesId_trackId_classId, so class-0 laps from different cars in offline
    // test sessions would all collide on one key and overwrite each other.
    // Where there are no class references, the lap is the car's own best and
    // nothing more.
    if (
      this.classReferences &&
      classId > 0 &&
      (!persistedTime || lapTime < persistedTime)
    ) {
      this.persistedLaps.set(classId, lap);
      if (this.persistenceEnabled && this.seriesId > 0) {
        // speedsKph is dropped on the way to disk. Only the in-session best
        // feeds the speed delta, and a lap loaded from disk is only ever
        // consulted as the class ghost, which is deliberately rejected as a
        // speed reference. Persisting it would grow the pretty-printed JSON by
        // a third — ~58KB per lap at Nordschleife bucket counts — for an array
        // nothing reads back. Copied rather than deleted in place: this same
        // object is the live entry in bestLaps.
        const persistable: ReferenceLap = { ...lap };
        delete persistable.speedsKph;
        this.persistence.save(
          this.seriesId,
          this.trackId,
          classId,
          persistable
        );
      }
    }
    return true;
  }

  /**
   * Reads the player's all-time lap for the car they are in from the lap
   * library. Returns whether the lap held is now a different one.
   */
  private loadPlayerAllTime(carKey: string): boolean {
    this.playerCarKey = carKey;
    this.playerRevision = this.playerLaps.revision();
    const found = carKey
      ? this.playerLaps.load(this.trackId, carKey, this.pointsCount)
      : null;
    // A lap recorded against a different track length has a different number
    // of points and cannot be read at this one's distances.
    const lap =
      found &&
      found.pointsCount === this.pointsCount &&
      found.finishTime > found.startTime &&
      !found.pointPos.includes(-1)
        ? found
        : null;
    if (lap === this.playerAllTime) return false;
    if (lap) precomputeTangents(lap);
    this.playerAllTime = lap;
    return true;
  }

  private loadPersistedForDrivers(paceCarIdx: number): boolean {
    if (!this.classReferences) return false;
    const paceClassId = this.drivers[paceCarIdx]?.CarClassID ?? -1;
    let changed = false;
    for (const driver of this.drivers) {
      const classId = driver?.CarClassID;
      if (
        !classId ||
        classId <= 0 ||
        classId === paceClassId ||
        this.loadedClassIds.has(classId)
      ) {
        continue;
      }
      this.loadedClassIds.add(classId);
      const lap =
        this.seriesId > 0
          ? this.persistence.load(this.seriesId, this.trackId, classId)
          : null;
      if (lap) {
        this.persistedLaps.set(classId, lap);
        changed = true;
      }
    }
    return changed;
  }

  private resetSession(sessionNum: number | null): void {
    this.playerLapWatched = true;
    this.playerLapSampled = false;
    this.activeLaps.clear();
    this.bestLaps.clear();
    // The last lap and the stint belong to the session that has ended.
    this.dropPlayerLaps();
    this.prevPcts.length = 0;
    this.prevFrameTime = null;
    this.sessionNum = sessionNum;
    this.publish();
  }

  private publish(): void {
    this.latest = {
      bestLaps: [...this.bestLaps],
      persistedLaps: [...this.persistedLaps],
      playerAllTimeLap: this.playerAllTime,
      // The same object as the session best where they are the same lap, so
      // a window is sent that curve once.
      playerLastLap: this.playerLastLap,
      playerStintBestLap: this.playerStintBest,
      playerStintId: this.playerStintId,
      sessionNum: this.sessionNum,
      version: this.latest.version + 1,
    };
  }

  private emptySnapshot(): ReferenceLapsSnapshot {
    return {
      bestLaps: [],
      persistedLaps: [],
      playerAllTimeLap: null,
      playerLastLap: null,
      playerStintBestLap: null,
      playerStintId: 0,
      sessionNum: null,
      version: 0,
    };
  }
}
