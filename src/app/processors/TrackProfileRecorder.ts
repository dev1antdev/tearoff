import type {
  Session,
  Telemetry,
  TrackProfileDemand,
  TrackProfileKey,
  TrackProfileLap,
} from '@irdashies/types';
import { TRACK_PROFILE_MAX_POINTS } from '@irdashies/types';
import {
  bucketIndex,
  isHeldAtLine,
  isLineCrossing,
  pointsCountFor,
  trackLengthFrom,
} from './lapTiming';
import {
  indexLag,
  PositionHistory,
  simSectorStartedAt,
} from './sectorIndexLag';

/** Where clean laps go. The recorder itself keeps nothing. */
export interface TrackProfileSink {
  /** Asked at each line crossing: what a lap begun now would be good for. */
  wants(key: TrackProfileKey): TrackProfileDemand;
  recordLap(key: TrackProfileKey, lap: TrackProfileLap): void;
}

export interface TrackProfileRecorderOptions {
  /** 'iracing' or 'lmu'. */
  simulator: string;
}

/**
 * How a lap's heights are come by under a simulator: read off the car's
 * world position where the sim states one, which is Le Mans Ultimate, and
 * added up from its vertical speed otherwise.
 */
export const trackProfileLapSource = (
  simulator: string
): TrackProfileLap['source'] =>
  simulator === 'lmu' ? 'recorded' : 'integrated';

/**
 * Whether a simulator's session says where its sectors start. iRacing's
 * does. Le Mans Ultimate times three sectors and places none of them, so the
 * session mapped from it carries even thirds and the real starts are learned
 * from the car: the same sim whose position is read rather than added up.
 */
export const sessionStatesSectorStarts = (simulator: string): boolean =>
  trackProfileLapSource(simulator) !== 'recorded';

/** Where a lap is far enough from the line that LMU's void flag is its own. */
const INVALIDATION_START_PCT = 0.05;
/**
 * Further back than this in one step is not driving: the car was returned to
 * its pit, or the sim reset it. A spin that rolls backwards stays inside it.
 */
const BACKWARD_JUMP_METERS = 50;
/** Further forward than this in one step is not driving either. */
const FORWARD_JUMP_PCT = 0.25;
/**
 * The longest step between two frames that vertical speed is added up
 * across. Past it the sim was paused or frames were lost, and the height
 * the sum has reached is no longer the car's.
 */
const MAX_INTEGRATION_GAP_SECONDS = 0.5;
/** Le Mans Ultimate times a lap in three sectors, on every track. */
const SIM_SECTOR_COUNT = 3;
/** Decimals of a lap a sector start is kept to: 14 cm at Le Mans. */
const SECTOR_PCT_SCALE = 100_000;

const numberAt = (
  frame: Telemetry,
  key: keyof Telemetry,
  index = 0
): number | null => {
  const value = (frame[key]?.value as unknown[] | undefined)?.[index];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

const flagAt = (frame: Telemetry, key: keyof Telemetry, index = 0): boolean => {
  const value = (frame[key]?.value as unknown[] | undefined)?.[index];
  return value === true || value === 1;
};

/**
 * The world-up part of a car's velocity, m/s, from iRacing's body-frame
 * velocity (forwards, to the left, up) and its pitch and roll in radians.
 *
 * iRacing states no height in live telemetry, so a lap's elevation is this
 * added up over time. The whole vector is used and not speed times the sine
 * of pitch, which keeps braking dive and squat out of it. The signs are the
 * ones that close a lap of the recorded race at Road America: pitch is
 * positive nose-down, and with the car rolled the way Roll counts positive
 * a velocity to the left points upwards. Each lap there ends within 0.1 m
 * of where it began and spans the circuit's 53 m; with the pitch sign
 * turned it ends 90 m up, and with the roll sign turned 0.3 m down.
 */
export const verticalSpeed = (
  forwards: number,
  toTheLeft: number,
  upwards: number,
  pitch: number,
  roll: number
): number =>
  -forwards * Math.sin(pitch) +
  Math.cos(pitch) * (upwards * Math.cos(roll) + toTheLeft * Math.sin(roll));

/**
 * The sector the sim says the player is in, or null where it does not say:
 * under iRacing, which states the boundaries instead.
 */
const simSectorIdxOf = (frame: Telemetry): number | null => {
  const value = frame.LmuSectorIdx?.value?.[0];
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value < SIM_SECTOR_COUNT
    ? value
    : null;
};

/** Sector starts as lap fractions, or null unless they begin at 0 and rise. */
const sectorStartsOf = (session: Session): number[] | null => {
  const starts = (session.SplitTimeInfo?.Sectors ?? [])
    .map((sector) => sector?.SectorStartPct)
    .filter((start): start is number => typeof start === 'number')
    .sort((a, b) => a - b);
  if (starts.length === 0 || starts[0] !== 0) return null;
  for (let index = 1; index < starts.length; index += 1) {
    if (!(starts[index] > starts[index - 1]) || !(starts[index] < 1)) {
      return null;
    }
  }
  return starts;
};

/** The lap being driven, from the crossing that began it. */
interface ActiveLap {
  /** It would give the track its first elevation. */
  first: boolean;
  /** Buckets sampled so far. */
  sampled: number;
  /** The lap fraction last seen. */
  pct: number;
  /** The height the lap began at: the world's under LMU, 0 when added up. */
  startHeight: number;
  /** The height on the last frame, on the same scale. */
  height: number;
  /** The vertical speed on the last frame, for the sum; null before one. */
  lastVerticalSpeed: number | null;
  /** The sim's sector index on the last frame. */
  sectorIdx: number | null;
  /** Where the second and third sectors were seen to start; NaN until then. */
  secondSectorPct: number;
  thirdSectorPct: number;
  /** The index moved in a way that is not a sector driven to its end. */
  sectorsBroken: boolean;
}

/**
 * Samples the player's clean laps for the track profile: the height of the
 * road every ten metres, and under Le Mans Ultimate the line of the road and
 * where the sim's sectors start.
 *
 * A lap is taken between two line crossings that were both seen, into the
 * same ten-metre buckets, with the same teleport and pit-road checks, as
 * the lap library's recorder. Only a lap that could become part of the
 * profile is carried to its end: one that touches pit road, is voided,
 * jumps, skips a bucket or is not the player's own driving is dropped where
 * it happens.
 *
 * Under LMU a bucket holds the car's world position on the frame that first
 * lands in it. iRacing states no position, so the height there is the car's
 * vertical speed added up from the line, and what the sum is out by at the
 * next crossing is taken back out evenly along the lap, so the profile
 * closes.
 *
 * Deterministic and without I/O: what becomes of a lap is the sink's.
 */
export class TrackProfileRecorder {
  private readonly usesWorldPosition: boolean;
  private playerCarIdx = -1;
  private key: TrackProfileKey | null = null;
  private identity = '';
  private backwardJumpPct = 0;
  /** The session's own sector starts, where it states real ones. */
  private sessionSectors: number[] | null = null;

  private enabled = true;
  private sessionNum: number | null = null;
  private active: ActiveLap | null = null;
  private prevPct: number | null = null;
  private prevTime: number | null = null;

  /** Reused from lap to lap: one entry per bucket. */
  private seen = new Uint8Array(0);
  private pointPos = new Float32Array(0);
  private elevation = new Float32Array(0);
  private x = new Float32Array(0);
  private z = new Float32Array(0);
  private readonly history = new PositionHistory();

  constructor(
    private readonly sink: TrackProfileSink,
    private readonly options: TrackProfileRecorderOptions
  ) {
    this.usesWorldPosition =
      trackProfileLapSource(options.simulator) === 'recorded';
  }

  /** The track the session names, or null while it names none. */
  trackKey(): TrackProfileKey | null {
    return this.key;
  }

  /** Stops or resumes recording. A lap under way when stopped is dropped. */
  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    this.abandonLap();
  }

  onEnter(): void {
    this.abandonLap();
    this.sessionNum = null;
  }

  onDisconnect(): void {
    this.abandonLap();
    this.sessionNum = null;
  }

  /**
   * How far round the lap that would give this track its first elevation
   * the player is, 0..1; null when no such lap is under way.
   */
  progress(): number | null {
    return this.active?.first ? this.active.pct : null;
  }

  onSession(session: Session): void {
    const playerCarIdx = session.DriverInfo?.DriverCarIdx ?? -1;
    const trackId = session.WeekendInfo?.TrackID;
    const trackLengthM = trackLengthFrom(session);
    const pointsCount = trackLengthM > 0 ? pointsCountFor(trackLengthM) : 0;
    if (playerCarIdx !== this.playerCarIdx) {
      // Out of the car, or into another slot: the lap under way is over.
      this.playerCarIdx = playerCarIdx;
      this.abandonLap();
    }
    this.sessionSectors = this.usesWorldPosition
      ? null
      : sectorStartsOf(session);
    const identity = [trackId ?? -1, trackLengthM].join('|');
    if (identity === this.identity) return;
    // Another track, or the same one at another length.
    this.identity = identity;
    this.abandonLap();
    if (
      typeof trackId !== 'number' ||
      pointsCount < 1 ||
      pointsCount > TRACK_PROFILE_MAX_POINTS
    ) {
      this.key = null;
      return;
    }
    const weekend = session.WeekendInfo;
    this.key = {
      simulator: this.options.simulator,
      trackId,
      trackName: weekend?.TrackDisplayName || weekend?.TrackName || 'Unknown',
      trackLengthM,
      pointsCount,
    };
    this.backwardJumpPct = BACKWARD_JUMP_METERS / trackLengthM;
    this.seen = new Uint8Array(pointsCount);
    this.pointPos = new Float32Array(pointsCount);
    this.elevation = new Float32Array(pointsCount);
    this.x = new Float32Array(pointsCount);
    this.z = new Float32Array(pointsCount);
  }

  onFrame(frame: Telemetry): void {
    const key = this.key;
    if (!this.enabled || !key || this.playerCarIdx < 0) return;
    const sessionTime = numberAt(frame, 'SessionTime');
    if (sessionTime === null) return;
    const sessionNum = numberAt(frame, 'SessionNum');
    if (sessionNum !== this.sessionNum) {
      this.sessionNum = sessionNum;
      this.abandonLap();
    }

    const trackPct = numberAt(frame, 'CarIdxLapDistPct', this.playerCarIdx);
    const prevPct = this.prevPct;
    const prevTime = this.prevTime;
    this.prevTime = sessionTime;
    if (
      trackPct === null ||
      trackPct < 0 ||
      trackPct > 1 ||
      isHeldAtLine(trackPct)
    ) {
      this.abandonLap();
      return;
    }
    this.prevPct = trackPct;
    if (prevPct === null || prevTime === null) return;
    // The clock ran backwards: a restart, or a replay being scrubbed.
    if (sessionTime < prevTime) {
      this.active = null;
      return;
    }
    const elapsed = sessionTime - prevTime;

    if (isLineCrossing(prevPct, trackPct)) {
      const finishing = this.active;
      // The frame that reveals the crossing ends one lap and is the first
      // sample of the next, so a lap starts and ends at the same place.
      if (finishing && this.advance(finishing, frame, elapsed)) {
        this.finishLap(key, finishing);
      }
      const starting = this.startLap(key, frame);
      this.active =
        starting && this.sample(starting, key, trackPct, sessionTime, frame)
          ? starting
          : null;
      return;
    }

    const lap = this.active;
    if (!lap) return;
    const moved = trackPct - prevPct;
    if (
      moved < -this.backwardJumpPct ||
      moved > FORWARD_JUMP_PCT ||
      !this.advance(lap, frame, elapsed) ||
      !this.sample(lap, key, trackPct, sessionTime, frame)
    ) {
      // Put back in the pits, reset, or no longer a lap worth keeping.
      this.active = null;
    }
  }

  /** A new lap at the line, or null when the track wants none. */
  private startLap(key: TrackProfileKey, frame: Telemetry): ActiveLap | null {
    const demand = this.sink.wants(key);
    if (demand === 'none') return null;
    let startHeight = 0;
    if (this.usesWorldPosition) {
      const height = numberAt(frame, 'LmuPlayerWorldPos', 1);
      if (height === null) return null;
      startHeight = height;
    }
    this.seen.fill(0);
    this.history.clear();
    return {
      first: demand === 'first',
      sampled: 0,
      pct: 0,
      startHeight,
      height: startHeight,
      lastVerticalSpeed: null,
      sectorIdx: null,
      secondSectorPct: Number.NaN,
      thirdSectorPct: Number.NaN,
      sectorsBroken: false,
    };
  }

  /**
   * Moves the lap's height on to this frame. False when it cannot be: the
   * sim gave no reading, or too long went by to add up across.
   */
  private advance(lap: ActiveLap, frame: Telemetry, elapsed: number): boolean {
    if (this.usesWorldPosition) {
      const height = numberAt(frame, 'LmuPlayerWorldPos', 1);
      if (height === null) return false;
      lap.height = height;
      return true;
    }
    const forwards = numberAt(frame, 'VelocityX');
    const toTheLeft = numberAt(frame, 'VelocityY');
    const upwards = numberAt(frame, 'VelocityZ');
    const pitch = numberAt(frame, 'Pitch');
    const roll = numberAt(frame, 'Roll');
    if (
      forwards === null ||
      toTheLeft === null ||
      upwards === null ||
      pitch === null ||
      roll === null ||
      elapsed > MAX_INTEGRATION_GAP_SECONDS
    ) {
      return false;
    }
    const speed = verticalSpeed(forwards, toTheLeft, upwards, pitch, roll);
    // The mean of the two frames' speeds over the time between them.
    lap.height += ((lap.lastVerticalSpeed ?? speed) + speed) * 0.5 * elapsed;
    lap.lastVerticalSpeed = speed;
    return true;
  }

  /**
   * Takes one frame into the lap. False when the lap can no longer become
   * part of a profile.
   */
  private sample(
    lap: ActiveLap,
    key: TrackProfileKey,
    trackPct: number,
    sessionTime: number,
    frame: Telemetry
  ): boolean {
    if (flagAt(frame, 'CarIdxOnPitRoad', this.playerCarIdx)) return false;
    // The void flag is ignored just after the line, where it may still be
    // the previous lap's: it stays set for the rest of a voided lap, so a
    // cut early in the lap is caught once past it.
    if (
      flagAt(frame, 'LmuLapInvalidated') &&
      trackPct >= INVALIDATION_START_PCT
    ) {
      return false;
    }
    if (!flagAt(frame, 'IsOnTrack')) return false;
    lap.pct = trackPct;
    if (this.usesWorldPosition) {
      this.followSectors(lap, trackPct, sessionTime, frame);
    }

    const bucket = bucketIndex(trackPct, key.pointsCount);
    if (this.seen[bucket] === 1) return true;
    // A ten-metre stretch went by unsampled: the profile would have a hole.
    if (bucket > 0 && this.seen[bucket - 1] === 0) return false;
    if (this.usesWorldPosition) {
      const x = numberAt(frame, 'LmuPlayerWorldPos', 0);
      const z = numberAt(frame, 'LmuPlayerWorldPos', 2);
      if (x === null || z === null) return false;
      this.x[bucket] = x;
      this.z[bucket] = z;
    }
    this.seen[bucket] = 1;
    this.pointPos[bucket] = trackPct;
    this.elevation[bucket] = lap.height;
    lap.sampled += 1;
    return true;
  }

  /**
   * Notes where the sim moved the car into its second and third sectors,
   * each placed where the car was when it crossed rather than where it was
   * when the index said so a fifth of a second later.
   */
  private followSectors(
    lap: ActiveLap,
    trackPct: number,
    sessionTime: number,
    frame: Telemetry
  ): void {
    this.history.remember(sessionTime, trackPct);
    const sectorIdx = simSectorIdxOf(frame);
    const previousIdx = lap.sectorIdx;
    lap.sectorIdx = sectorIdx;
    if (sectorIdx === null || previousIdx === null) return;
    if (sectorIdx === previousIdx) return;
    if (sectorIdx === previousIdx + 1) {
      const entryTime =
        sessionTime -
        indexLag(
          numberAt(frame, 'LapCurrentLapTime'),
          simSectorStartedAt(frame.LmuCurrentSectorTimes?.value, sectorIdx)
        );
      const entryPct = this.history.positionAt(entryTime) ?? trackPct;
      if (sectorIdx === 1) lap.secondSectorPct = entryPct;
      else lap.thirdSectorPct = entryPct;
      return;
    }
    // Back to the first sector is the index catching up with the line.
    // Anything else is not a sector driven to its end.
    if (sectorIdx !== 0) lap.sectorsBroken = true;
  }

  private finishLap(key: TrackProfileKey, lap: ActiveLap): void {
    if (lap.sampled !== key.pointsCount) return;
    const residual = lap.height - lap.startHeight;
    const elevationM = Float32Array.from(this.elevation);
    if (!this.usesWorldPosition) {
      // What the sum is out by at the line, taken back out along the lap.
      for (let bucket = 0; bucket < elevationM.length; bucket += 1) {
        elevationM[bucket] -= residual * this.pointPos[bucket];
      }
    }
    const sectors = this.usesWorldPosition
      ? this.learnedSectors(lap)
      : this.sessionSectors;
    this.sink.recordLap(key, {
      source: this.usesWorldPosition ? 'recorded' : 'integrated',
      elevationM,
      xM: this.usesWorldPosition ? Float32Array.from(this.x) : null,
      zM: this.usesWorldPosition ? Float32Array.from(this.z) : null,
      closureM: Math.abs(residual),
      sectorStartPct: sectors,
      sectorSource: sectors
        ? this.usesWorldPosition
          ? 'learned'
          : 'session'
        : null,
    });
  }

  /** The three sector starts the lap saw, or null unless both are in order. */
  private learnedSectors(lap: ActiveLap): number[] | null {
    const second = lap.secondSectorPct;
    const third = lap.thirdSectorPct;
    if (lap.sectorsBroken || !(second > 0 && second < third && third < 1)) {
      return null;
    }
    return [
      0,
      Math.round(second * SECTOR_PCT_SCALE) / SECTOR_PCT_SCALE,
      Math.round(third * SECTOR_PCT_SCALE) / SECTOR_PCT_SCALE,
    ];
  }

  private abandonLap(): void {
    this.active = null;
    this.prevPct = null;
  }
}
