import type {
  CruiseSnapshot,
  Session,
  SessionLifecycleEvent,
  Telemetry,
} from '@irdashies/types';
import { trackLengthFrom } from './lapTiming';
import type { TelemetryProcessor } from './TelemetryProcessor';

/** Metres and seconds driven on one track in one car. */
export interface DrivingTotals {
  metres: number;
  seconds: number;
}

/**
 * Where the all-time totals are kept. Answers from memory: a processor
 * cannot wait for a disk.
 */
export interface DrivingTotalsPersistence {
  /**
   * Stored totals, or null when none are known yet. Synchronous. Once it
   * answers, every increment added before is in the answer.
   */
  load(
    simulator: string,
    trackId: number,
    carKey: string
  ): DrivingTotals | null;
  /** Adds an increment to the stored totals. */
  add(
    simulator: string,
    trackId: number,
    carKey: string,
    metres: number,
    seconds: number
  ): void;
}

/**
 * Nothing stored and nothing kept: a tape, a demo, or a build with no store
 * behind it. The totals are then those of the run.
 */
export const noDrivingTotals: DrivingTotalsPersistence = {
  load: () => ({ metres: 0, seconds: 0 }),
  add: () => undefined,
};

/** A longer step than this between frames is a pause, a jump or a restart. */
const MAX_STEP_S = 0.5;
/** Below this the car is standing: no time is counted and it has no drift. */
const MOVING_MS = 1;
/** Seconds of driving after which what has been driven is handed over. */
const FLUSH_AFTER_S = 30;
/** What the odometer prints to. */
const ODOMETER_STEP_M = 100;

type Frame = Record<string, { value?: unknown[] } | undefined>;

const numberAt = (frame: Frame, key: string, index = 0): number | undefined => {
  const value = frame[key]?.value?.[index];
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
};

const flag = (frame: Frame, key: string): boolean => {
  const value = frame[key]?.value?.[0];
  return value === true || value === 1;
};

const DEGREES = 180 / Math.PI;

/**
 * A compass heading in whole degrees, 0..359, from radians clockwise from
 * north: 359.6 is north again.
 */
export const headingDegrees = (yawNorth: number): number => {
  const rounded = Math.round(yawNorth * DEGREES) % 360;
  // The 0 added turns a negative zero into the zero it compares equal to.
  return (rounded < 0 ? rounded + 360 : rounded) + 0;
};

/**
 * The angle between where the car points and where it is going, degrees to
 * one decimal: positive with the nose to the right of the path, which is the
 * car moving towards its own left. 0 for a car that is standing.
 */
export const driftDegrees = (
  velocityForward: number,
  velocityLeft: number
): number => {
  if (Math.hypot(velocityForward, velocityLeft) < MOVING_MS) return 0;
  const rounded =
    Math.round(Math.atan2(velocityLeft, velocityForward) * DEGREES * 10) / 10;
  return rounded === 0 ? 0 : rounded;
};

type Reading =
  | 'available'
  | 'headingDeg'
  | 'driftDeg'
  | 'elevationM'
  | 'lapDistanceM'
  | 'sessionNum';

/**
 * Publishes where the player's car points and how far it has been driven,
 * for the cruise block.
 *
 * The readings are the frame's own: the heading from YawNorth, the drift
 * angle from the car's velocity along and across itself, the height from the
 * car's world position where the sim states one (Le Mans Ultimate), and the
 * distance into the lap from the lap fraction and the length of the track.
 *
 * The metres are the car's speed added up over the session clock, and the
 * seconds are that clock while the car is moving. They are counted only at
 * the wheel, only between frames that follow one another, and not in a
 * replay. What has been driven is handed to the store every thirty seconds
 * of driving, when the session changes and when the sim goes away, each
 * metre once; the all-time figures are what the store held when the track
 * and car became known plus everything driven since.
 *
 * The distances and times go out at full precision, and the channel moves
 * when a figure the widget prints does: a degree, a metre of the lap, a
 * tenth of a kilometre, a second.
 */
export class CruiseProcessor implements TelemetryProcessor<
  CruiseSnapshot,
  'cruise.snapshot'
> {
  readonly channel = 'cruise.snapshot';
  // Figures to read: ten a second is more than the eye takes in, and often
  // enough that the speed between two frames is the speed of either.
  readonly tickRateHz = 10;

  private trackId: number | null = null;
  private carKey = '';
  private trackLengthM = 0;
  /** What the store held when the track and car became known. */
  private stored: DrivingTotals | null = null;
  /** Handed to the store since then. */
  private handedMetres = 0;
  private handedSeconds = 0;
  /** Driven and not handed over yet. */
  private pendingMetres = 0;
  private pendingSeconds = 0;
  /** Seconds at the wheel since the last hand-over. */
  private drivenSinceFlush = 0;
  private lastTime: number | undefined;
  private replay = false;
  /** The four totals as the channel last moved for them, in printed steps. */
  private shownSessionMetres = 0;
  private shownSessionSeconds = 0;
  private shownTotalMetres: number | null = null;
  private shownTotalSeconds: number | null = null;

  private readonly latest: CruiseSnapshot = {
    available: false,
    headingDeg: null,
    driftDeg: null,
    elevationM: null,
    lapDistanceM: null,
    sessionMetres: 0,
    sessionSeconds: 0,
    totalMetres: null,
    totalSeconds: null,
    sessionNum: null,
    version: 0,
  };

  /**
   * @param simulator What the totals are filed under: 'iracing' or 'lmu'.
   *   Empty where there is no store behind the persistence.
   */
  constructor(
    private readonly persistence: DrivingTotalsPersistence = noDrivingTotals,
    private readonly simulator = ''
  ) {}

  init(session: Session): void {
    this.trackLengthM = trackLengthFrom(session);
    const playerCarIdx = session.DriverInfo?.DriverCarIdx ?? -1;
    const player = session.DriverInfo?.Drivers?.find(
      (driver) => driver?.CarIdx === playerCarIdx
    );
    // The lap library's identity: the car model, which under Le Mans
    // Ultimate is named apart from the livery file CarPath holds.
    const carKey =
      this.simulator === 'lmu'
        ? (player?.CarModel ?? '')
        : (player?.CarModel ?? player?.CarPath ?? '');
    const trackId = session.WeekendInfo?.TrackID;
    // Out of the car the sim may name no player at all. That is not another
    // car: what follows the return to it carries on under the same key.
    if (playerCarIdx < 0 || carKey === '' || typeof trackId !== 'number') {
      return;
    }
    if (trackId === this.trackId && carKey === this.carKey) return;
    // Another track or car: what was driven belongs to the one before.
    this.flush();
    this.trackId = trackId;
    this.carKey = carKey;
    this.stored = null;
    this.handedMetres = 0;
    this.handedSeconds = 0;
    this.loadStored();
    if (this.totalsMoved()) this.latest.version += 1;
  }

  onFrame(telemetry: Telemetry): void {
    const frame = telemetry as unknown as Frame;
    const time = numberAt(frame, 'SessionTime');
    if (time === undefined) return;
    const elapsed = this.lastTime === undefined ? 0 : time - this.lastTime;
    this.lastTime = time;

    const latest = this.latest;
    const onTrack = flag(frame, 'IsOnTrack');
    const speed = numberAt(frame, 'Speed');
    if (
      !this.replay &&
      onTrack &&
      speed !== undefined &&
      elapsed > 0 &&
      elapsed <= MAX_STEP_S
    ) {
      const metres = Math.abs(speed) * elapsed;
      const seconds = Math.abs(speed) > MOVING_MS ? elapsed : 0;
      latest.sessionMetres += metres;
      latest.sessionSeconds += seconds;
      this.pendingMetres += metres;
      this.pendingSeconds += seconds;
      this.drivenSinceFlush += elapsed;
      if (this.drivenSinceFlush >= FLUSH_AFTER_S) this.flush();
    }
    if (this.stored === null) this.loadStored();

    const yawNorth = numberAt(frame, 'YawNorth');
    const forward = numberAt(frame, 'VelocityX');
    const left = numberAt(frame, 'VelocityY');
    const height = numberAt(frame, 'LmuPlayerWorldPos', 1);

    let changed = this.set('available', onTrack);
    changed =
      this.set(
        'headingDeg',
        yawNorth === undefined ? null : headingDegrees(yawNorth)
      ) || changed;
    changed =
      this.set(
        'driftDeg',
        forward === undefined || left === undefined
          ? null
          : driftDegrees(forward, left)
      ) || changed;
    changed =
      this.set(
        'elevationM',
        height === undefined ? null : Math.round(height) + 0
      ) || changed;
    changed = this.set('lapDistanceM', this.lapDistance(frame)) || changed;
    const sessionNum = numberAt(frame, 'SessionNum');
    if (sessionNum !== undefined) {
      changed = this.set('sessionNum', sessionNum) || changed;
    }
    changed = this.totalsMoved() || changed;
    if (changed) latest.version += 1;
  }

  onLifecycle(event: SessionLifecycleEvent): void {
    this.lastTime = undefined;
    if (event.type === 'enter') {
      // A replay is somebody's driving played back: none of it is counted.
      this.replay = event.replay;
      return;
    }
    this.flush();
    const latest = this.latest;
    latest.sessionMetres = 0;
    latest.sessionSeconds = 0;
    if (event.type === 'disconnect') {
      this.trackId = null;
      this.carKey = '';
      this.trackLengthM = 0;
      this.stored = null;
      this.handedMetres = 0;
      this.handedSeconds = 0;
      this.pendingMetres = 0;
      this.pendingSeconds = 0;
      latest.available = false;
      latest.headingDeg = null;
      latest.driftDeg = null;
      latest.elevationM = null;
      latest.lapDistanceM = null;
      latest.sessionNum = null;
    }
    this.totalsMoved();
    latest.version += 1;
  }

  /**
   * The host stops sending frames while no window wants the channel. What
   * has been driven is handed over; the step to the first frame after is
   * not one.
   */
  pause(): void {
    this.flush();
    this.lastTime = undefined;
  }

  /** The host is dropping this instance: nothing driven is left behind. */
  dispose(): void {
    this.flush();
  }

  snapshot(): CruiseSnapshot {
    return this.latest;
  }

  /** Whole metres from the line, or null where the frame cannot say. */
  private lapDistance(frame: Frame): number | null {
    const lapDistPct = numberAt(frame, 'LapDistPct');
    if (lapDistPct !== undefined && lapDistPct >= 0 && this.trackLengthM > 0) {
      return Math.round(Math.min(lapDistPct, 1) * this.trackLengthM);
    }
    const lapDist = numberAt(frame, 'LapDist');
    return lapDist !== undefined && lapDist >= 0 ? Math.round(lapDist) : null;
  }

  /** Asks the store for the totals of this track and car, until it knows. */
  private loadStored(): void {
    if (this.trackId === null) return;
    const stored = this.persistence.load(
      this.simulator,
      this.trackId,
      this.carKey
    );
    if (!stored) return;
    // Everything handed over before now is in what the store answered.
    this.stored = { metres: stored.metres, seconds: stored.seconds };
    this.handedMetres = 0;
    this.handedSeconds = 0;
  }

  /** Hands what has been driven to the store, each metre once. */
  private flush(): void {
    this.drivenSinceFlush = 0;
    if (this.trackId === null) return;
    if (this.pendingMetres === 0 && this.pendingSeconds === 0) return;
    this.persistence.add(
      this.simulator,
      this.trackId,
      this.carKey,
      this.pendingMetres,
      this.pendingSeconds
    );
    this.handedMetres += this.pendingMetres;
    this.handedSeconds += this.pendingSeconds;
    this.pendingMetres = 0;
    this.pendingSeconds = 0;
  }

  /**
   * Works the all-time figures out, and says whether any of the four totals
   * moved by as much as the widget prints: a tenth of a kilometre, a second.
   */
  private totalsMoved(): boolean {
    const latest = this.latest;
    const stored = this.stored;
    latest.totalMetres = stored
      ? stored.metres + this.handedMetres + this.pendingMetres
      : null;
    latest.totalSeconds = stored
      ? stored.seconds + this.handedSeconds + this.pendingSeconds
      : null;

    const sessionMetres = Math.round(latest.sessionMetres / ODOMETER_STEP_M);
    const sessionSeconds = Math.floor(latest.sessionSeconds);
    const totalMetres =
      latest.totalMetres === null
        ? null
        : Math.round(latest.totalMetres / ODOMETER_STEP_M);
    const totalSeconds =
      latest.totalSeconds === null ? null : Math.floor(latest.totalSeconds);
    if (
      sessionMetres === this.shownSessionMetres &&
      sessionSeconds === this.shownSessionSeconds &&
      totalMetres === this.shownTotalMetres &&
      totalSeconds === this.shownTotalSeconds
    ) {
      return false;
    }
    this.shownSessionMetres = sessionMetres;
    this.shownSessionSeconds = sessionSeconds;
    this.shownTotalMetres = totalMetres;
    this.shownTotalSeconds = totalSeconds;
    return true;
  }

  private set<K extends Reading>(key: K, value: CruiseSnapshot[K]): boolean {
    if (this.latest[key] === value) return false;
    this.latest[key] = value;
    return true;
  }
}
