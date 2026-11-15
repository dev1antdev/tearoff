import {
  STANDARD_GRAVITY,
  type BrakingLiveZone,
  type BrakingSnapshot,
  type BrakingZone,
  type Session,
  type SessionLifecycleEvent,
  type Telemetry,
} from '@irdashies/types';
import type { TelemetryProcessor } from './TelemetryProcessor';
import { ImpactClock } from './impactClock';
import { PeakHold } from './peakHold';
import {
  WHEEL_LOCK_SLIP,
  createWheelSlipState,
  hasWheelRadius,
  learnWheelRadius,
  resetWheelSlip,
  seedWheelRadius,
  wheelSlipRatio,
} from './wheelSlip';

/** Raw pedal travel above which the driver is braking. */
const PEDAL_ON = 0.02;
/** A zone starts above this speed, m/s. */
const ZONE_START_SPEED = 10;
/** And ends when the car is slower than this, whatever the pedal does. */
const ZONE_END_SPEED = 3;
/** The pedal may come back within this long and the zone carries on. */
const RELEASE_GRACE_S = 0.25;
/** What a zone has to last and reach to count. */
const ZONE_MIN_DURATION_S = 0.3;
const ZONE_MIN_PEAK_G = 0.5;
/** Seconds the rolling best stands with no new best or runner-up. */
const REFERENCE_HOLD_S = 60;
/** A longer step than this between frames is a gap: it adds nothing. */
const MAX_STEP_S = 0.2;
/** Slack for comparing times that are sums of hundredths. */
const TIME_EPSILON = 1e-6;
const WHEEL_COUNT = 4;

type Frame = Record<string, { value?: unknown[] } | undefined>;

const number = (frame: Frame, key: string): number | undefined => {
  const value = frame[key]?.value?.[0];
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
};

const flag = (frame: Frame, key: string): boolean =>
  frame[key]?.value?.[0] === true;

/** All four wheels of a per-wheel channel, or undefined. */
const wheels = (frame: Frame, key: string): number[] | undefined => {
  const value = frame[key]?.value;
  if (!Array.isArray(value) || value.length < WHEEL_COUNT) return undefined;
  for (let wheel = 0; wheel < WHEEL_COUNT; wheel += 1) {
    if (typeof value[wheel] !== 'number' || !Number.isFinite(value[wheel])) {
      return undefined;
    }
  }
  return value as number[];
};

const round = (value: number, decimals: number): number => {
  const scale = 10 ** decimals;
  const rounded = Math.round(value * scale) / scale;
  // -0 and 0 are different values to a strict comparison.
  return rounded === 0 ? 0 : rounded;
};

/**
 * Measures the player's braking zones: how hard each one peaked, how far and
 * how long it ran, and how it compares with the best of the last minute.
 *
 * A zone runs from the brake going on to the brake coming off, so it has a
 * distance and a time. It is taken from every frame, which is why the
 * processor declares no tick rate: a peak and a distance cannot be had from a
 * sample of the frames. It publishes only when a figure it rounds has moved,
 * and between zones nothing does.
 *
 * Under Le Mans Ultimate it also adds up how long a wheel of each axle was
 * locked on the lap in progress, from how fast the sim says each wheel turns.
 * iRacing publishes no wheel speeds, and `lockS` is null there.
 *
 * The bests are kept while no window shows the channel (the host suspends
 * the processor instead of dropping it), and a zone that was in progress when
 * the frames stopped is discarded.
 */
export class BrakingProcessor implements TelemetryProcessor<BrakingSnapshot> {
  readonly channel = 'braking.snapshot';
  readonly tickRateHz = 'event';

  /** The rolling best: a peak and its runner-up, fed with whole zones. */
  private readonly reference = new PeakHold(REFERENCE_HOLD_S, true);
  private readonly impacts = new ImpactClock();
  private readonly slip = createWheelSlipState();
  /** Seconds each wheel has been locked on this lap: LF, RF, LR, RR. */
  private readonly lock = [0, 0, 0, 0];
  /** What the snapshot's `lockS` points at while there is a reading. */
  private readonly lockS = [0, 0];
  /** LapCompleted on the last frame that stated it. */
  private lap: number | undefined;
  /** A lap went by: the next brake application zeroes the lock times. */
  private lockResetDue = false;

  private lastTime: number | undefined;
  private lastSpeed = 0;
  private wasInGarage = false;
  private sessionBest = 0;

  private zoneActive = false;
  private zoneStartedAt = 0;
  private zoneEntrySpeed = 0;
  private zoneDistance = 0;
  private zonePeak = 0;
  private zoneAbs = 0;
  /** The rolling best as it stood when the zone began. */
  private zoneReference = 0;
  /** The pedal is off and the zone is waiting to see whether it comes back. */
  private releasePending = false;
  private releaseAt = 0;
  private releaseSpeed = 0;
  private releaseDistance = 0;
  private releaseAbs = 0;

  /** Reused for every zone, so a zone in progress allocates nothing. */
  private readonly liveZone: BrakingLiveZone = {
    peakG: 0,
    distanceM: 0,
    durationS: 0,
    entrySpeed: 0,
  };
  /** The zone the snapshot last went out with. */
  private publishedZone: BrakingZone | null = null;

  private readonly latest: BrakingSnapshot = {
    available: false,
    live: null,
    last: null,
    referenceG: 0,
    sessionBestG: 0,
    zoneCount: 0,
    lockS: null,
    sessionNum: null,
    version: 0,
  };

  /**
   * Deliberately does nothing: the host calls this on every session publish,
   * and nothing here depends on session data.
   */
  init(session: Session): void {
    void session;
  }

  onFrame(telemetry: Telemetry): void {
    const frame = telemetry as unknown as Frame;
    const t = number(frame, 'SessionTime');
    if (t === undefined) return;

    let changed = false;

    const inGarage = flag(frame, 'IsInGarage');
    if (inGarage && !this.wasInGarage) changed = this.clear();
    this.wasInGarage = inGarage;

    if (this.lastTime !== undefined && t < this.lastTime) {
      // The clock went back: whatever was being measured has no end.
      this.zoneActive = false;
      this.lastTime = undefined;
    }
    const dt = this.lastTime === undefined ? 0 : t - this.lastTime;
    const step = dt > 0 && dt <= MAX_STEP_S ? dt : 0;

    const speed = number(frame, 'Speed') ?? 0;
    const longAccel = number(frame, 'LongAccel');
    const pedal = number(frame, 'BrakeRaw') ?? number(frame, 'Brake') ?? 0;
    const pedalDown = pedal > PEDAL_ON;
    const isOnTrack = flag(frame, 'IsOnTrack');
    const onPitRoad = flag(frame, 'OnPitRoad');
    // Deceleration, so that braking is the positive direction.
    const g = longAccel === undefined ? 0 : -longAccel / STANDARD_GRAVITY;

    const recentlyHit = this.impacts.observe(telemetry, t);
    this.reference.expire(t);

    if (this.zoneActive) {
      if (recentlyHit) {
        // A zone that ran into something measured the something.
        this.zoneActive = false;
      } else {
        this.continueZone(
          t,
          step,
          speed,
          g,
          pedalDown,
          flag(frame, 'BrakeABSactive'),
          speed < ZONE_END_SPEED || !isOnTrack || onPitRoad
        );
      }
    }

    if (
      !this.zoneActive &&
      pedalDown &&
      longAccel !== undefined &&
      speed > ZONE_START_SPEED &&
      isOnTrack &&
      !onPitRoad &&
      !recentlyHit
    ) {
      // The best the zone is measured against, as it stands on this frame.
      changed = this.publishReference() || changed;
      this.zoneActive = true;
      this.zoneStartedAt = t;
      this.zoneEntrySpeed = speed;
      this.zoneDistance = 0;
      this.zonePeak = Math.max(g, 0);
      this.zoneAbs = 0;
      this.zoneReference = this.reference.peak;
      this.releasePending = false;
    }

    const lockAvailable = this.trackWheelLock(frame, speed, pedalDown, step);

    this.lastTime = t;
    this.lastSpeed = speed;

    const sessionNum = number(frame, 'SessionNum') ?? null;
    if (sessionNum !== null && sessionNum !== this.latest.sessionNum) {
      this.latest.sessionNum = sessionNum;
      changed = true;
    }
    const available = longAccel !== undefined && isOnTrack;
    if (available !== this.latest.available) {
      this.latest.available = available;
      changed = true;
    }
    changed = this.publishZone(t) || changed;
    changed = this.publishLock(lockAvailable) || changed;
    if (changed) this.latest.version += 1;
  }

  onLifecycle(event: SessionLifecycleEvent): void {
    if (event.type === 'enter') return;
    this.clear();
    this.wasInGarage = false;
    this.lastTime = undefined;
    this.impacts.reset();
    if (event.type === 'disconnect') {
      // The next connection may be another car on other tyres.
      resetWheelSlip(this.slip);
      this.latest.available = false;
      this.latest.lockS = null;
      this.latest.sessionNum = null;
    }
    this.latest.version += 1;
  }

  /**
   * The host stops sending frames while no window shows the channel. The
   * bests are kept; a zone in progress cannot be finished from frames that
   * never came, and the step to the first frame after is not one.
   */
  pause(): void {
    this.zoneActive = false;
    this.lastTime = undefined;
    if (this.latest.live !== null) {
      this.latest.live = null;
      this.latest.version += 1;
    }
  }

  snapshot(): BrakingSnapshot {
    return this.latest;
  }

  /** One more frame of the zone in progress, which may be its last. */
  private continueZone(
    t: number,
    step: number,
    speed: number,
    g: number,
    pedalDown: boolean,
    absActive: boolean,
    leaving: boolean
  ): void {
    if (step > 0) {
      this.zoneDistance += ((speed + this.lastSpeed) / 2) * step;
      if (absActive) this.zoneAbs += step;
    }

    if (pedalDown) {
      if (
        this.releasePending &&
        t - this.releaseAt > RELEASE_GRACE_S + TIME_EPSILON
      ) {
        // Back on the pedal too late to be the same stop, with no frame in
        // between to end it on: it ended where the pedal came off, and this
        // frame starts another.
        this.finishZone(
          this.releaseAt,
          this.releaseSpeed,
          this.releaseDistance,
          this.releaseAbs
        );
        return;
      }
      // Braking, or pumping the pedal: one zone.
      this.releasePending = false;
      if (g > this.zonePeak) this.zonePeak = g;
    } else if (!this.releasePending) {
      this.releasePending = true;
      this.releaseAt = t;
      this.releaseSpeed = speed;
      this.releaseDistance = this.zoneDistance;
      this.releaseAbs = this.zoneAbs;
    }

    if (this.releasePending) {
      if (leaving || t - this.releaseAt >= RELEASE_GRACE_S - TIME_EPSILON) {
        this.finishZone(
          this.releaseAt,
          this.releaseSpeed,
          this.releaseDistance,
          this.releaseAbs
        );
      }
    } else if (leaving) {
      // Stopped, off the track or into the pit lane with the brake still on.
      this.finishZone(t, speed, this.zoneDistance, this.zoneAbs);
    }
  }

  /**
   * Ends the zone in progress with the figures it had at `endedAt`, and
   * keeps it if it lasted and peaked enough to count.
   */
  private finishZone(
    endedAt: number,
    exitSpeed: number,
    distance: number,
    abs: number
  ): void {
    this.zoneActive = false;
    this.releasePending = false;
    const duration = endedAt - this.zoneStartedAt;
    if (
      duration < ZONE_MIN_DURATION_S - TIME_EPSILON ||
      this.zonePeak < ZONE_MIN_PEAK_G
    ) {
      return;
    }

    const peakG = round(this.zonePeak, 2);
    this.latest.last = {
      peakG,
      averageG: round(
        (this.zoneEntrySpeed - exitSpeed) / duration / STANDARD_GRAVITY,
        2
      ),
      distanceM: round(distance, 0),
      durationS: round(duration, 2),
      entrySpeed: round(this.zoneEntrySpeed, 1),
      exitSpeed: round(exitSpeed, 1),
      absS: round(abs, 1),
      // From the two figures as printed, so that the three agree on screen.
      deltaG: round(peakG - round(this.zoneReference, 2), 2),
      endedAt,
    };
    this.latest.zoneCount += 1;
    if (this.zonePeak > this.sessionBest) this.sessionBest = this.zonePeak;
    this.reference.offer(this.zonePeak, endedAt);
  }

  /** Copies the rolling best into the snapshot; true when it moved. */
  private publishReference(): boolean {
    const referenceG = round(this.reference.peak, 2);
    if (referenceG === this.latest.referenceG) return false;
    this.latest.referenceG = referenceG;
    return true;
  }

  /** Copies the zone figures into the snapshot; true when one moved. */
  private publishZone(t: number): boolean {
    let changed = false;
    if (this.zoneActive) {
      const live = this.liveZone;
      const peakG = round(this.zonePeak, 2);
      const distanceM = round(this.zoneDistance, 0);
      const durationS = round(t - this.zoneStartedAt, 1);
      const entrySpeed = round(this.zoneEntrySpeed, 1);
      if (
        this.latest.live === null ||
        live.peakG !== peakG ||
        live.distanceM !== distanceM ||
        live.durationS !== durationS ||
        live.entrySpeed !== entrySpeed
      ) {
        live.peakG = peakG;
        live.distanceM = distanceM;
        live.durationS = durationS;
        live.entrySpeed = entrySpeed;
        this.latest.live = live;
        changed = true;
      }
    } else {
      if (this.latest.live !== null) {
        this.latest.live = null;
        changed = true;
      }
      // Only between zones: while one is live the snapshot keeps the best
      // the zone is being measured against.
      changed = this.publishReference() || changed;
    }

    const sessionBestG = round(this.sessionBest, 2);
    if (sessionBestG !== this.latest.sessionBestG) {
      this.latest.sessionBestG = sessionBestG;
      changed = true;
    }
    // A zone that qualified is a new object, and the count moved with it.
    if (this.latest.last !== this.publishedZone) {
      this.publishedZone = this.latest.last;
      changed = true;
    }
    return changed;
  }

  /**
   * Learns the rolling radius and adds up how long each wheel was locked
   * under braking. False when the sim publishes no wheel rotation.
   */
  private trackWheelLock(
    frame: Frame,
    speed: number,
    pedalDown: boolean,
    step: number
  ): boolean {
    const lap = number(frame, 'LapCompleted');
    if (lap !== undefined && lap !== this.lap) {
      if (this.lap !== undefined) this.lockResetDue = true;
      this.lap = lap;
    }

    const rotation = wheels(frame, 'LmuWheelRotation');
    if (!rotation) return false;

    seedWheelRadius(this.slip, frame.LmuTyreStaticRadius?.value);
    learnWheelRadius(
      this.slip,
      rotation,
      speed,
      number(frame, 'LatAccel') ?? 0,
      number(frame, 'LongAccel') ?? 0
    );

    if (pedalDown) {
      if (this.lockResetDue) {
        // The first brake application of the new lap.
        this.lockResetDue = false;
        this.lock.fill(0);
      }
      if (step > 0) {
        for (let wheel = 0; wheel < WHEEL_COUNT; wheel += 1) {
          if (
            hasWheelRadius(this.slip, wheel) &&
            wheelSlipRatio(this.slip, wheel, rotation[wheel], speed) <
              -WHEEL_LOCK_SLIP
          ) {
            this.lock[wheel] += step;
          }
        }
      }
    }
    return true;
  }

  /** Copies the lock times into the snapshot; true when one moved. */
  private publishLock(lockAvailable: boolean): boolean {
    if (!lockAvailable) {
      if (this.latest.lockS === null) return false;
      this.latest.lockS = null;
      return true;
    }
    const front = round(Math.max(this.lock[0], this.lock[1]), 1);
    const rear = round(Math.max(this.lock[2], this.lock[3]), 1);
    if (
      this.latest.lockS !== null &&
      this.lockS[0] === front &&
      this.lockS[1] === rear
    ) {
      return false;
    }
    this.lockS[0] = front;
    this.lockS[1] = rear;
    this.latest.lockS = this.lockS;
    return true;
  }

  /**
   * Forgets the zones, the bests and the lock times. True when the snapshot
   * changed.
   */
  private clear(): boolean {
    this.zoneActive = false;
    this.releasePending = false;
    this.reference.reset();
    this.sessionBest = 0;
    this.lock.fill(0);
    this.lockResetDue = false;
    this.lap = undefined;
    this.publishedZone = null;

    const lockShown =
      this.latest.lockS !== null &&
      (this.lockS[0] !== 0 || this.lockS[1] !== 0);
    this.lockS[0] = 0;
    this.lockS[1] = 0;

    const changed =
      lockShown ||
      this.latest.live !== null ||
      this.latest.last !== null ||
      this.latest.referenceG !== 0 ||
      this.latest.sessionBestG !== 0 ||
      this.latest.zoneCount !== 0;
    this.latest.live = null;
    this.latest.last = null;
    this.latest.referenceG = 0;
    this.latest.sessionBestG = 0;
    this.latest.zoneCount = 0;
    return changed;
  }
}
