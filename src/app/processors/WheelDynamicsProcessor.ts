import type {
  Session,
  SessionLifecycleEvent,
  Telemetry,
  WheelDynamicsSnapshot,
} from '@irdashies/types';
import type { TelemetryProcessor } from './TelemetryProcessor';

const WHEEL_COUNT = 4;
const LF = 0;
const RF = 1;
const LR = 2;
const RR = 3;

/**
 * Time constants of the exponential averages, seconds. TinyPedal states its
 * averages as "N samples" at a 20 ms tick, a factor of 2 / (N + 1) a step;
 * the same average written for any frame rate has the time constant
 * -0.02 / ln(1 - 2 / (N + 1)): 0.10 s for 10 samples, 0.20 s for 20, 0.50 s
 * for 50.
 */
const TAU_WHEEL_S = 0.1;
const TAU_AXLE_TOE_S = 0.2;
const TAU_ROLL_SHARE_S = 0.5;

/** A longer gap than this between two ticks is averaged as if it were this. */
const MAX_STEP_S = 0.25;

/**
 * The four suspension forces together have to carry this much before a
 * share of them means anything: a car on its jacks reads next to nothing.
 */
const MIN_SUSPENSION_LOAD_N = 1000;

const RIDE_DECIMALS = 1;
const TRAVEL_DECIMALS = 1;
const DEFLECTION_DECIMALS = 1;
const ANGLE_DECIMALS = 2;
const SHARE_DECIMALS = 3;
/** The total load is published to the nearest ten newtons. */
const LOAD_STEP_N = 10;

/** The per-wheel frame keys this channel is built from. */
type WheelKey =
  | 'LmuWheelRideHeight'
  | 'LmuSuspensionPosition'
  | 'LmuSuspensionForce'
  | 'LmuTyreLoad'
  | 'LmuTyreDeflection'
  | 'LmuWheelCamber'
  | 'LmuWheelToe';

/** The snapshot's array fields, each backed by a buffer that is reused. */
type ArrayField =
  | 'rideHeightMm'
  | 'suspensionPositionMm'
  | 'loadShare'
  | 'tyreDeflectionMm'
  | 'camberDeg'
  | 'toeDeg'
  | 'toeTotalDeg'
  | 'rollMm';

const ARRAY_FIELDS: readonly ArrayField[] = [
  'rideHeightMm',
  'suspensionPositionMm',
  'loadShare',
  'tyreDeflectionMm',
  'camberDeg',
  'toeDeg',
  'toeTotalDeg',
  'rollMm',
];

type ScalarField = 'loadTotalN' | 'rakeMm' | 'rollShareFront';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/**
 * Four finite readings under a key, or undefined. The frame's own array is
 * handed back, so nothing is allocated.
 */
const fourWheels = (
  frame: Telemetry,
  key: WheelKey
): readonly number[] | undefined => {
  const value: unknown = frame[key]?.value;
  if (!Array.isArray(value) || value.length < WHEEL_COUNT) return undefined;
  for (let wheel = 0; wheel < WHEEL_COUNT; wheel += 1) {
    const reading: unknown = value[wheel];
    if (typeof reading !== 'number' || !Number.isFinite(reading)) {
      return undefined;
    }
  }
  return value as readonly number[];
};

const scalar = (frame: Telemetry, key: keyof Telemetry): number | undefined => {
  const value: unknown = frame[key]?.value?.[0];
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
};

/**
 * Rounds to the precision the widgets show. The trailing `+ 0` turns a
 * negative zero into zero, so a value that rounds to nothing is one value.
 */
const round = (value: number, decimals: number): number => {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale + 0;
};

/** How far an average moves toward a new sample over `dt` seconds. */
const gain = (dt: number, tau: number): number => 1 - Math.exp(-dt / tau);

/** A reading that cannot push the road down counts as no load at all. */
const carried = (newtons: number): number => (newtons > 0 ? newtons : 0);

/**
 * The player's wheels and the attitude of the chassis, for the tyre and
 * chassis widgets.
 *
 * Reads the Lmu* wheel keys the LMU mapper fills from shared memory. They
 * are absent whenever the player has no car, and under a sim that publishes
 * none, and each field of the snapshot is null while its own key is absent.
 *
 * Ride height, suspension travel, tyre deflection and the load share are the
 * readings of the tick, rounded. Camber, toe, rake, roll and the roll share
 * are exponential averages over the session clock, so they read the same at
 * any frame rate: a paused sim, whose clock stands still, moves none of them,
 * and a clock that steps backwards starts each from its next sample.
 *
 * Every array in the snapshot is allocated once and written in place.
 */
export class WheelDynamicsProcessor implements TelemetryProcessor<WheelDynamicsSnapshot> {
  readonly channel = 'wheel-dynamics.snapshot';
  // The averages are measured at the positional rate; the channel hands
  // widgets ten a second.
  readonly tickRateHz = 25;

  private readonly buffers: Record<ArrayField, number[]> = {
    rideHeightMm: [0, 0, 0, 0],
    suspensionPositionMm: [0, 0, 0, 0],
    loadShare: [0, 0, 0, 0],
    tyreDeflectionMm: [0, 0, 0, 0],
    camberDeg: [0, 0, 0, 0],
    toeDeg: [0, 0, 0, 0],
    toeTotalDeg: [0, 0],
    rollMm: [0, 0],
  };

  private readonly latest: Mutable<WheelDynamicsSnapshot> = {
    available: false,
    rideHeightMm: null,
    suspensionPositionMm: null,
    loadShare: null,
    loadSource: null,
    loadTotalN: null,
    tyreDeflectionMm: null,
    camberDeg: null,
    toeDeg: null,
    toeTotalDeg: null,
    rakeMm: null,
    rollMm: null,
    rollShareFront: null,
    sessionNum: null,
    version: 0,
  };

  /** The averages at full precision; the snapshot holds them rounded. */
  private readonly camber = [0, 0, 0, 0];
  private readonly toe = [0, 0, 0, 0];
  private readonly toeTotal = [0, 0];
  private readonly roll = [0, 0];
  private rake = 0;
  private rollShare = 0.5;
  /** Whether each group of averages has had its first sample. */
  private camberSeeded = false;
  private toeSeeded = false;
  private attitudeSeeded = false;

  /** SessionTime at the previous tick. */
  private lastTime: number | undefined;
  /** Values on their way into the snapshot, reused every tick. */
  private readonly scratch = [0, 0, 0, 0];

  /**
   * Deliberately does nothing: the host calls this on every session publish,
   * and nothing here depends on session data.
   */
  init(session: Session): void {
    void session;
  }

  onFrame(frame: Telemetry): void {
    let changed = false;

    const sessionNum = scalar(frame, 'SessionNum');
    if (sessionNum !== undefined && sessionNum !== this.latest.sessionNum) {
      this.latest.sessionNum = sessionNum;
      changed = true;
    }

    // Seconds since the previous tick. Without a clock a tick counts for its
    // nominal length; a clock that went backwards re-seeds every average.
    const time = scalar(frame, 'SessionTime');
    const elapsed =
      time === undefined || this.lastTime === undefined
        ? 1 / this.tickRateHz
        : time - this.lastTime;
    if (elapsed < 0) this.unseed();
    const dt = Math.min(Math.max(elapsed, 0), MAX_STEP_S);
    this.lastTime = time;
    const wheelGain = gain(dt, TAU_WHEEL_S);

    const travel = fourWheels(frame, 'LmuSuspensionPosition');
    const available = travel !== undefined;
    if (available !== this.latest.available) {
      this.latest.available = available;
      changed = true;
    }
    changed =
      this.readings('suspensionPositionMm', travel, TRAVEL_DECIMALS) || changed;
    changed =
      this.readings(
        'tyreDeflectionMm',
        fourWheels(frame, 'LmuTyreDeflection'),
        DEFLECTION_DECIMALS
      ) || changed;
    changed = this.loadShare(frame) || changed;
    changed =
      this.attitude(fourWheels(frame, 'LmuWheelRideHeight'), dt, wheelGain) ||
      changed;
    changed =
      this.camberAngles(fourWheels(frame, 'LmuWheelCamber'), wheelGain) ||
      changed;
    changed =
      this.toeAngles(fourWheels(frame, 'LmuWheelToe'), dt, wheelGain) ||
      changed;

    if (changed) this.latest.version += 1;
  }

  onLifecycle(event: SessionLifecycleEvent): void {
    // Only the player's own live car is described here, and LMU has no replay
    // source, so there is nothing to switch on 'enter'.
    if (event.type === 'enter') return;
    let changed = this.latest.available || this.latest.sessionNum !== null;
    this.latest.available = false;
    this.latest.sessionNum = null;
    for (const field of ARRAY_FIELDS) {
      changed = this.clearArray(field) || changed;
    }
    changed = this.clearLoad() || changed;
    changed = this.setScalar('rakeMm', null) || changed;
    changed = this.setScalar('rollShareFront', null) || changed;
    this.unseed();
    this.lastTime = undefined;
    if (changed) this.latest.version += 1;
  }

  snapshot(): WheelDynamicsSnapshot {
    return this.latest;
  }

  private unseed(): void {
    this.camberSeeded = false;
    this.toeSeeded = false;
    this.attitudeSeeded = false;
  }

  /** A field that is the tick's four readings, rounded. */
  private readings(
    field: ArrayField,
    source: readonly number[] | undefined,
    decimals: number
  ): boolean {
    if (!source) return this.clearArray(field);
    return this.commit(field, source, WHEEL_COUNT, decimals);
  }

  /**
   * Each wheel's share of the load on all four: from tyre load where the sim
   * publishes it, else from suspension force, which is the pushrod load and
   * so an estimate (see WheelDynamicsSnapshot.loadShare).
   */
  private loadShare(frame: Telemetry): boolean {
    let source: WheelDynamicsSnapshot['loadSource'] = 'tyreLoad';
    let loads = fourWheels(frame, 'LmuTyreLoad');
    let total = loads ? this.totalCarried(loads) : 0;
    if (!loads || total <= 0) {
      source = 'suspensionForce';
      loads = fourWheels(frame, 'LmuSuspensionForce');
      total = loads ? this.totalCarried(loads) : 0;
      if (!loads || total <= MIN_SUSPENSION_LOAD_N) return this.clearLoad();
    }

    for (let wheel = 0; wheel < WHEEL_COUNT; wheel += 1) {
      this.scratch[wheel] = carried(loads[wheel]) / total;
    }
    let changed = this.commit(
      'loadShare',
      this.scratch,
      WHEEL_COUNT,
      SHARE_DECIMALS
    );
    if (this.latest.loadSource !== source) {
      this.latest.loadSource = source;
      changed = true;
    }
    return (
      this.setScalar(
        'loadTotalN',
        Math.round(total / LOAD_STEP_N) * LOAD_STEP_N
      ) || changed
    );
  }

  private totalCarried(loads: readonly number[]): number {
    return (
      carried(loads[LF]) +
      carried(loads[RF]) +
      carried(loads[LR]) +
      carried(loads[RR])
    );
  }

  private clearLoad(): boolean {
    let changed = this.clearArray('loadShare');
    if (this.latest.loadSource !== null) {
      this.latest.loadSource = null;
      changed = true;
    }
    return this.setScalar('loadTotalN', null) || changed;
  }

  /**
   * Ride height at the four corners, and what it says of the chassis: rake,
   * roll at each axle and the front axle's part of the roll. In millimetres:
   * the angles need a wheelbase and track widths the sim does not publish,
   * so the renderer makes them from its settings.
   */
  private attitude(
    heights: readonly number[] | undefined,
    dt: number,
    wheelGain: number
  ): boolean {
    if (!heights) {
      this.attitudeSeeded = false;
      let cleared = this.clearArray('rideHeightMm');
      cleared = this.clearArray('rollMm') || cleared;
      cleared = this.setScalar('rakeMm', null) || cleared;
      return this.setScalar('rollShareFront', null) || cleared;
    }

    const rake = (heights[LR] + heights[RR] - heights[LF] - heights[RF]) / 2;
    const rollFront = heights[RF] - heights[LF];
    const rollRear = heights[RR] - heights[LR];
    // Both axles leaning the same way share the roll between them; leaning
    // opposite ways, or not at all, there is no share to state.
    const share =
      rollFront * rollRear > 0 ? rollFront / (rollFront + rollRear) : 0.5;

    if (!this.attitudeSeeded) {
      this.attitudeSeeded = true;
      this.rake = rake;
      this.roll[0] = rollFront;
      this.roll[1] = rollRear;
      this.rollShare = share;
    } else {
      this.rake += wheelGain * (rake - this.rake);
      this.roll[0] += wheelGain * (rollFront - this.roll[0]);
      this.roll[1] += wheelGain * (rollRear - this.roll[1]);
      this.rollShare += gain(dt, TAU_ROLL_SHARE_S) * (share - this.rollShare);
    }

    let changed = this.commit(
      'rideHeightMm',
      heights,
      WHEEL_COUNT,
      RIDE_DECIMALS
    );
    changed = this.commit('rollMm', this.roll, 2, RIDE_DECIMALS) || changed;
    changed =
      this.setScalar('rakeMm', round(this.rake, RIDE_DECIMALS)) || changed;
    return (
      this.setScalar('rollShareFront', round(this.rollShare, SHARE_DECIMALS)) ||
      changed
    );
  }

  private camberAngles(
    cambers: readonly number[] | undefined,
    wheelGain: number
  ): boolean {
    if (!cambers) {
      this.camberSeeded = false;
      return this.clearArray('camberDeg');
    }
    for (let wheel = 0; wheel < WHEEL_COUNT; wheel += 1) {
      this.camber[wheel] = this.camberSeeded
        ? this.camber[wheel] + wheelGain * (cambers[wheel] - this.camber[wheel])
        : cambers[wheel];
    }
    this.camberSeeded = true;
    return this.commit('camberDeg', this.camber, WHEEL_COUNT, ANGLE_DECIMALS);
  }

  /**
   * Toe per wheel with the right-hand wheels turned round, so that toe-in is
   * positive on both sides, and per axle as left minus right, which is the
   * total toe and cancels the steering angle the fronts carry.
   */
  private toeAngles(
    toes: readonly number[] | undefined,
    dt: number,
    wheelGain: number
  ): boolean {
    if (!toes) {
      this.toeSeeded = false;
      const cleared = this.clearArray('toeDeg');
      return this.clearArray('toeTotalDeg') || cleared;
    }
    const axleGain = gain(dt, TAU_AXLE_TOE_S);
    for (let wheel = 0; wheel < WHEEL_COUNT; wheel += 1) {
      // The sim's toe is positive for a wheel pointing right.
      const toeIn = wheel === RF || wheel === RR ? -toes[wheel] : toes[wheel];
      this.toe[wheel] = this.toeSeeded
        ? this.toe[wheel] + wheelGain * (toeIn - this.toe[wheel])
        : toeIn;
    }
    const front = toes[LF] - toes[RF];
    const rear = toes[LR] - toes[RR];
    this.toeTotal[0] = this.toeSeeded
      ? this.toeTotal[0] + axleGain * (front - this.toeTotal[0])
      : front;
    this.toeTotal[1] = this.toeSeeded
      ? this.toeTotal[1] + axleGain * (rear - this.toeTotal[1])
      : rear;
    this.toeSeeded = true;

    const changed = this.commit(
      'toeDeg',
      this.toe,
      WHEEL_COUNT,
      ANGLE_DECIMALS
    );
    return (
      this.commit('toeTotalDeg', this.toeTotal, 2, ANGLE_DECIMALS) || changed
    );
  }

  /**
   * Writes rounded values into a field's own buffer and says whether the
   * snapshot moved: a value changed, or the field was null until now.
   */
  private commit(
    field: ArrayField,
    values: readonly number[],
    count: number,
    decimals: number
  ): boolean {
    const buffer = this.buffers[field];
    let changed = this.latest[field] === null;
    for (let index = 0; index < count; index += 1) {
      const next = round(values[index], decimals);
      if (changed || buffer[index] !== next) {
        buffer[index] = next;
        changed = true;
      }
    }
    if (this.latest[field] === null) this.latest[field] = buffer;
    return changed;
  }

  private clearArray(field: ArrayField): boolean {
    if (this.latest[field] === null) return false;
    this.latest[field] = null;
    return true;
  }

  private setScalar(field: ScalarField, value: number | null): boolean {
    if (this.latest[field] === value) return false;
    this.latest[field] = value;
    return true;
  }
}
