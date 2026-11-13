import type {
  Driver,
  ReferenceLap,
  ReferenceLapsSnapshot,
  Session,
  SessionLifecycleEvent,
  Telemetry,
} from '@irdashies/types';
import type { TelemetryProcessor } from './TelemetryProcessor';

const TARGET_SPACING_METERS = 10;
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
 * Where the player's own best lap per track and car is kept across sessions.
 *
 * Keyed by the car model rather than a class or series, because it is the
 * player's lap in that car and nobody else's. The simulator is the adapter's
 * business: the same track id means different things in each.
 */
export interface PlayerReferenceLapPersistence {
  load(trackId: number, carKey: string): ReferenceLap | null;
  save(trackId: number, carKey: string, lap: ReferenceLap): void;
}

const noPlayerPersistence: PlayerReferenceLapPersistence = {
  load: () => null,
  save: () => undefined,
};

const numericValue = (
  frame: Telemetry,
  key: keyof Telemetry
): number | null => {
  const value = frame[key]?.value?.[0];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

const trackLengthFrom = (session: Session): number => {
  const [value, unit] = session.WeekendInfo?.TrackLength?.split(' ') ?? [];
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return 0;
  return unit === 'km' ? parsed * 1000 : parsed;
};

/**
 * Longest gap between two frames that the line crossing is placed inside.
 * Past this the two frames are not neighbours and the later one is used as is.
 */
const MAX_CROSSING_GAP_SECONDS = 0.5;

/**
 * When the car crossed the line, between the last frame before it and the
 * first one after.
 *
 * Taking the later frame's time, as this once did, starts every lap up to a
 * frame late -- 16 ms at 60 Hz -- and by a different amount each lap, which a
 * delta between two laps then carries for its whole length. The crossing is
 * placed by distance instead: the car covers the two sides of the line at
 * very nearly one speed.
 */
const crossingTime = (
  previousPct: number | undefined,
  trackPct: number,
  previousTime: number | null,
  sessionTime: number
): number => {
  if (previousTime === null || previousPct === undefined) return sessionTime;
  if (!(previousPct > 0.5) || !(trackPct < 0.5)) return sessionTime;
  const elapsed = sessionTime - previousTime;
  if (!(elapsed > 0) || elapsed > MAX_CROSSING_GAP_SECONDS) return sessionTime;
  const before = 1 - previousPct;
  const span = before + trackPct;
  return span > 0 ? previousTime + (before / span) * elapsed : sessionTime;
};

/** Where a lap is far enough from the line that LMU's void flag is its own. */
const INVALIDATION_START_PCT = 0.05;

const bucketIndex = (trackPct: number, pointsCount: number): number =>
  Math.min(Math.max(Math.floor(trackPct * pointsCount), 0), pointsCount - 1);

/**
 * A lap fraction of exactly 0 is not a position. Le Mans Ultimate reports it
 * for a car that has not reached the line yet -- waiting on the grid, or
 * rolling up to the start -- and holds it there until the car crosses. A lap
 * timed from such a frame would count the wait as part of the lap, so no lap
 * starts on one. A moving car is never sampled at exactly 0.
 */
const isHeldAtLine = (trackPct: number): boolean => trackPct === 0;

const createLap = (
  pointsCount: number,
  interval: number,
  sessionTime: number,
  trackPct: number,
  clean: boolean
): ReferenceLap => ({
  startTime: trackPct <= interval ? sessionTime : Number.MAX_SAFE_INTEGER,
  finishTime: -1,
  times: new Float32Array(pointsCount),
  pointPos: new Float32Array(pointsCount).fill(-1),
  tangents: new Float32Array(pointsCount),
  interval,
  pointsCount,
  lastTrackedPct: trackPct,
  isCleanLap: trackPct <= interval && clean && !isHeldAtLine(trackPct),
});

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
  /** Whether the player has been at the wheel for all of their current lap. */
  private playerLapOwn = false;
  /** The player's incident count when their current lap began. */
  private playerLapIncidents: number | null = null;
  private latest: ReferenceLapsSnapshot = this.emptySnapshot();

  constructor(
    private readonly persistence: ReferenceLapPersistence,
    private readonly playerPersistence: PlayerReferenceLapPersistence = noPlayerPersistence
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
    this.playerCarIdx = session.DriverInfo?.DriverCarIdx ?? -1;
    const player = drivers.find(
      (driver) => driver?.CarIdx === this.playerCarIdx
    );
    // LMU's CarPath is the livery file, so two entries of one car differ
    // there; it names the model separately. iRacing's CarPath is the model.
    const playerCarKey = player?.CarModel ?? player?.CarPath ?? '';
    if (trackId <= 0 || trackLength <= 0) return;
    if (sessionIdentity === this.sessionIdentity) {
      const classLapsLoaded = this.loadPersistedForDrivers(
        session.DriverInfo?.PaceCarIdx ?? -1
      );
      const playerLapChanged = this.loadPlayerAllTime(playerCarKey);
      if (classLapsLoaded || playerLapChanged) this.publish();
      return;
    }
    this.seriesId = seriesId;
    this.trackId = trackId;
    this.sessionIdentity = sessionIdentity;
    this.pointsCount = Math.ceil(trackLength / TARGET_SPACING_METERS);
    this.interval = Number.parseFloat((1 / this.pointsCount).toFixed(6));
    this.activeLaps.clear();
    this.bestLaps.clear();
    this.persistedLaps.clear();
    this.loadedClassIds.clear();
    this.prevPcts.length = 0;
    this.prevFrameTime = null;
    // A different track: whatever was held belongs to the last one.
    this.playerAllTime = null;
    this.playerCarKey = '';
    this.loadPersistedForDrivers(session.DriverInfo?.PaceCarIdx ?? -1);
    this.loadPlayerAllTime(playerCarKey);
    this.publish();
  }

  onFrame(frame: Telemetry): void {
    if (!this.aggregationEnabled || this.pointsCount === 0) return;
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
    if (
      !Array.isArray(distances) ||
      distances.length === 0 ||
      sessionTime === null
    ) {
      return;
    }
    // Both only decide whether a lap may be kept as the player's all-time
    // best. A team-mate's stint, or an AI driving the car, sets laps in the
    // player's car that are not the player's; and iRacing counts an incident
    // for the off-track that makes a lap quick.
    const onTrack = frame.IsOnTrack?.value?.[0] as unknown;
    const playerDriving = onTrack === true || onTrack === 1;
    const playerIncidents = numericValue(frame, 'PlayerCarMyIncidentCount');

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
      const isPlayer = carIdx === this.playerCarIdx;
      if (isPlayer && !playerDriving) this.playerLapOwn = false;
      // The void flag is ignored just after the line, where it may still be
      // the previous lap's: it stays set for the rest of a voided lap, so a
      // cut early in the lap is caught once past it.
      const invalidated =
        carIdx === this.playerCarIdx &&
        playerLapInvalidated &&
        trackPct >= INVALIDATION_START_PCT;
      const clean = !pitRoad?.[carIdx] && !invalidated;
      const active = this.activeLaps.get(carIdx);
      if (!active) {
        this.activeLaps.set(
          carIdx,
          createLap(
            this.pointsCount,
            this.interval,
            sessionTime,
            trackPct,
            clean
          )
        );
        if (isPlayer) {
          this.playerLapOwn = playerDriving;
          this.playerLapIncidents = playerIncidents;
        }
        continue;
      }
      if (active.lastTrackedPct > 0.95 && trackPct < 0.05) {
        const crossedAt = crossingTime(
          previousPct,
          trackPct,
          this.prevFrameTime,
          sessionTime
        );
        active.finishTime = crossedAt;
        this.promote(
          driver,
          active,
          isPlayer &&
            this.playerLapOwn &&
            playerIncidents === this.playerLapIncidents
        );
        this.activeLaps.set(
          carIdx,
          createLap(this.pointsCount, this.interval, crossedAt, trackPct, clean)
        );
        if (isPlayer) {
          this.playerLapOwn = playerDriving;
          this.playerLapIncidents = playerIncidents;
        }
        continue;
      }
      if (!clean) active.isCleanLap = false;
      const key = bucketIndex(trackPct, this.pointsCount);
      if (active.pointPos[key] !== -1) continue;
      if (key > 0 && active.pointPos[key - 1] === -1) active.isCleanLap = false;
      if (active.isCleanLap) {
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
    this.activeLaps.clear();
    this.prevPcts.length = 0;
    this.prevFrameTime = null;
  }

  /**
   * @param ownCleanLap True when this is the player's lap, driven by them
   *   from line to line without an incident. Only such a lap may become the
   *   all-time best; the session best takes any clean lap, as it always did.
   */
  private promote(
    driver: Driver,
    lap: ReferenceLap,
    ownCleanLap = false
  ): void {
    const lapTime = lap.finishTime - lap.startTime;
    // Deliberately not gated on CarClassID: bestLaps is keyed by CarIdx and
    // nothing on this path needs a class. iRacing reports CarClassID 0 in test
    // sessions, which is a real session rather than missing data — gating
    // promotion on it silently disabled every bestLaps consumer there (Delta
    // Speed, SectorDelta's ghost). The class is still required for
    // *persistence*, which is keyed by it.
    if (!lap.isCleanLap || lap.pointPos.includes(-1) || lapTime <= 0) return;
    const classId = driver.CarClassID;
    const persisted = classId > 0 ? this.persistedLaps.get(classId) : undefined;
    const persistedTime = persisted
      ? persisted.finishTime - persisted.startTime
      : null;
    if (persistedTime && persistedTime / lapTime < VALID_PACE_RATIO) return;
    const best = this.bestLaps.get(driver.CarIdx);
    const bestTime = best ? best.finishTime - best.startTime : null;
    const isSessionBest = !bestTime || lapTime < bestTime;
    // Judged on its own, not only when the lap is also the session best: the
    // session best may be a lap that cannot be the all-time one -- a
    // team-mate's, or one with an incident on it -- and a clean lap a little
    // slower than that can still beat the all-time lap held.
    const isAllTimeBest = ownCleanLap && this.beatsPlayerAllTime(lapTime);
    if (!isSessionBest && !isAllTimeBest) return;
    precomputeTangents(lap);
    if (isAllTimeBest) this.keepPlayerAllTime(lap);
    if (!isSessionBest) {
      this.publish();
      return;
    }
    this.bestLaps.set(driver.CarIdx, lap);
    // classId > 0 guards persistence only. The disk key is
    // seriesId_trackId_classId, so class-0 laps from different cars in offline
    // test sessions would all collide on one key and overwrite each other.
    if (classId > 0 && (!persistedTime || lapTime < persistedTime)) {
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
    this.publish();
  }

  /** Whether a lap of this length would be the player's all-time best. */
  private beatsPlayerAllTime(lapTime: number): boolean {
    if (!this.playerCarKey) return false;
    const held = this.playerAllTime;
    return !held || lapTime < held.finishTime - held.startTime;
  }

  /** Holds a lap as the player's all-time best and hands it to the store. */
  private keepPlayerAllTime(lap: ReferenceLap): void {
    this.playerAllTime = lap;
    if (this.persistenceEnabled) {
      this.playerPersistence.save(this.trackId, this.playerCarKey, lap);
    }
  }

  /**
   * Loads the player's all-time lap for the car they are in, once it is
   * known which car that is. Returns whether the held lap changed.
   */
  private loadPlayerAllTime(carKey: string): boolean {
    let changed = false;
    if (carKey !== this.playerCarKey) {
      this.playerCarKey = carKey;
      if (this.playerAllTime) {
        this.playerAllTime = null;
        changed = true;
      }
    }
    if (this.playerAllTime || !carKey) return changed;
    const lap = this.playerPersistence.load(this.trackId, carKey);
    // A lap recorded against a different track length has a different number
    // of points and cannot be read at this one's distances.
    if (
      !lap ||
      lap.pointsCount !== this.pointsCount ||
      !(lap.finishTime > lap.startTime) ||
      lap.pointPos.includes(-1)
    ) {
      return changed;
    }
    precomputeTangents(lap);
    this.playerAllTime = lap;
    return true;
  }

  private loadPersistedForDrivers(paceCarIdx: number): boolean {
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
    this.activeLaps.clear();
    this.bestLaps.clear();
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
      sessionNum: this.sessionNum,
      version: this.latest.version + 1,
    };
  }

  private emptySnapshot(): ReferenceLapsSnapshot {
    return {
      bestLaps: [],
      persistedLaps: [],
      playerAllTimeLap: null,
      sessionNum: null,
      version: 0,
    };
  }
}
