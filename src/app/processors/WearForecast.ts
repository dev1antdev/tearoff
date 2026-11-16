import type {
  BrakeLimitStore,
  WearForecastTuning,
  WearRateSource,
  WearSnapshot,
  WearWheelSnapshot,
} from '@irdashies/types';
import { EMPTY_WEAR, WEAR_MAX_LAPS } from '@irdashies/types';
import {
  BRAKE_CHANGE_RISE_MM,
  WHEEL_COUNT,
  type MeterReading,
  type WearCurves,
} from './LapCostMeter';
import type { LedgerRates } from './ledgerRates';
import {
  BrakeFailureWatch,
  classBrakeFailureMm,
  DISPROVED_BY_MM,
  FAILURE_PEDAL,
  FAILURE_SPEED_MS,
  isPlausibleFailure,
  resolveBrakeFailure,
  type BrakeFailureThickness,
} from './brakeFailure';

/**
 * How long the tyres and the brake discs of the player's car will last.
 *
 * Three questions asked of two parts: how much is left, how fast it is
 * going, and how many laps that makes. What is left is the sim's own
 * reading. How fast comes from the ledger: the median of the last clean
 * laps on the tyre now fitted, or of the stint for the discs, so one lock-up
 * does not swing the forecast. Before there is such a lap the session's
 * laps stand in, then what this track and car cost in earlier sessions, and
 * failing all of that the lap under way, projected to its end; the snapshot
 * says which it was, so an estimate is not read as a measurement. With none
 * of them there is no forecast, and the figures are null.
 *
 * Where a tyre or a disc is finished the sim does not say. The tread floor
 * and the failure thickness are settings; see `brakeFailure.ts` for where a
 * failure thickness comes from when the setting is left at 0.
 *
 * Disc thickness arrives over the sim's REST API. When it stops answering
 * the brake figures go null rather than hold the last reading, which would
 * look like discs that no longer wear.
 *
 * Pure: no I/O and no clock of its own, the same snapshot from the same
 * frames. `observe` runs on every frame and allocates nothing; `refresh`
 * builds the snapshot a few times a second, and only while a window reads
 * it.
 */

/** The lap under way is projected to its end once this much of it is done. */
export const PROJECTION_MIN_FRACTION = 0.25;
/**
 * Session seconds without an answer from the REST API after which a disc
 * reading is no longer a reading. The poller asks at least every five.
 */
export const BRAKE_STALE_AFTER_S = 15;

const roundTo = (value: number | null, decimals: number): number | null => {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

/**
 * What a lap is heading for, given a reference lap: the reference's total,
 * moved by how much more or less this lap has worn than the reference had
 * at the same point. Never less than what has already gone.
 */
export const projectFromReference = (
  referenceTotal: number,
  referenceAtPoint: number,
  usedSoFar: number
): number => Math.max(usedSoFar, referenceTotal + usedSoFar - referenceAtPoint);

/**
 * What a lap is heading for, given only the lap before: that lap's wear at
 * the line, moving to this lap's own as it goes on, by the square of the lap
 * fraction. Once this lap has worn more than the last one did, its own.
 */
export const blendWithLastLap = (
  usedSoFar: number,
  lastLap: number,
  lapFraction: number
): number => {
  if (usedSoFar >= lastLap) return usedSoFar;
  const weight = clamp(lapFraction, 0, 1) ** 2;
  return lastLap * (1 - weight) + usedSoFar * weight;
};

/**
 * What a lap is heading for with nothing to compare it with: what has gone
 * so far over the share of the lap done. Null until a quarter is done.
 */
export const projectFromFraction = (
  usedSoFar: number,
  lapFraction: number
): number | null =>
  lapFraction >= PROJECTION_MIN_FRACTION
    ? usedSoFar / Math.min(lapFraction, 1)
    : null;

/**
 * Whole laps until a level reaches its floor at a wear per lap, at most
 * 999. Null without a rate; 0 at or below the floor.
 */
export const lapsLeftAt = (
  level: number,
  floor: number,
  perLap: number | null
): number | null => {
  if (perLap === null || !Number.isFinite(perLap)) return null;
  const usable = level - floor;
  if (usable <= 0) return 0;
  if (perLap <= 0) return WEAR_MAX_LAPS;
  // The margin keeps 42 / 0.5 at 84 when it arrives as 0.42 / 0.005.
  return Math.min(WEAR_MAX_LAPS, Math.floor(usable / perLap + 1e-9));
};

/** The level left after the laps the fuel or energy lasts; never below 0. */
export const levelAfter = (
  level: number,
  perLap: number | null,
  laps: number | null
): number | null =>
  perLap === null || laps === null ? null : Math.max(0, level - perLap * laps);

/**
 * Usable disc left, percent: thickness above the failure thickness over a
 * new disc's. Null without both ends.
 */
export const brakeLifePct = (
  thickness: number,
  failure: number | null,
  fresh: number | null
): number | null =>
  failure === null || fresh === null || fresh <= failure
    ? null
    : clamp((thickness - failure) / (fresh - failure), 0, 1) * 100;

/**
 * Wear at a point of a reference lap: from the nearest point at or before
 * it that the lap sampled, and 0 before its first.
 */
const curveAt = (
  values: Float32Array,
  curves: WearCurves,
  wheel: number,
  point: number
): number => {
  for (let index = Math.min(point, curves.points - 1); index >= 0; index -= 1) {
    if (curves.sampled[index] === 1) {
      return values[wheel * curves.points + index];
    }
  }
  return 0;
};

/** What the forecast takes from the meter: the lap under way and the curve. */
export interface WearMeter {
  /** Tread worn since the line, per wheel, 0..1. */
  lapTreadUsed(): ArrayLike<number>;
  /** Disc worn since the line, per wheel, millimetres. */
  lapBrakeUsed(): ArrayLike<number>;
  /** The wear curve of the last lap fit to be a reference, or null. */
  referenceCurves(): WearCurves | null;
}

/** What a frame says beside the meter's own reading. Reused by its owner. */
export interface WearFrame {
  /** False at the monitor, spectating and between sessions. */
  hasCar: boolean;
  /** A lap is under way, so the wear since the line is that lap's. */
  lapOpen: boolean;
  /** Lap fraction, 0..1; null when unknown. */
  lapPct: number | null;
  /** Brake pedal, 0..1. */
  brakePedal: number | null;
  /** LmuRestWearablesSeq; null when the frame carries none. */
  wearablesSeq: number | null;
  /** The sim says the tyre is flat: LF, RF, LR, RR. */
  flat: boolean[];
}

export const createWearFrame = (): WearFrame => ({
  hasCar: false,
  lapOpen: false,
  lapPct: null,
  brakePedal: null,
  wearablesSeq: null,
  flat: [false, false, false, false],
});

/** What the car is, for the discs. */
export interface WearCar {
  /** The lap library's key for the car; '' when unknown. */
  carKey: string;
  /** The class as the session names it. */
  className: string | null;
  /** Thickness of a new disc per wheel from the setup, millimetres. */
  brakeDiscNewMm: readonly number[] | null;
}

/** What a snapshot is built with, beside what the frames gave. */
export interface WearContext {
  rates: LedgerRates;
  /** Laps the fuel or energy lasts at the ledger's rates. */
  budgetLapsLeft: number | null;
  sessionNum: number | null;
  tuning: WearForecastTuning;
}

export interface WearForecastOptions {
  /** 'iracing' or 'lmu': part of the key a learned thickness is kept by. */
  simulator: string;
  /** Where a failure thickness learned from a failed brake is kept. */
  limits?: BrakeLimitStore;
}

const nulls = (): (number | null)[] => [null, null, null, null];

/** The snapshot with no player car: nothing read, nothing forecast. */
const unavailable = (
  sessionNum: number | null
): Omit<WearSnapshot, 'version'> => ({
  available: false,
  wheels: EMPTY_WEAR.wheels,
  paceLapTime: null,
  budgetLapsLeft: null,
  brakeNewMm: EMPTY_WEAR.brakeNewMm,
  brakeFailureMm: EMPTY_WEAR.brakeFailureMm,
  brakeFailureSource: EMPTY_WEAR.brakeFailureSource,
  brakeStale: false,
  sessionNum,
});

export class WearForecast {
  private readonly watch = new BrakeFailureWatch();

  private available = false;
  private time = 0;
  private readonly tread = nulls();
  private readonly brake = nulls();
  private readonly compound = [-1, -1, -1, -1];
  private readonly flat = [false, false, false, false];
  private lapOpen = false;
  private lapPct: number | null = null;
  private bucket = -1;

  /** Each disc's last reading, kept while the frames carry none. */
  private readonly lastDisc = nulls();
  /** The highest reading of each disc since it was fitted. */
  private readonly discMax = nulls();
  private seq: number | null = null;
  /** Session time of the last answer from the REST API. */
  private answeredAt = 0;

  /** What the last finished lap wore, where it is this tyre's or disc's. */
  private readonly lastLapTread = nulls();
  private readonly lastLapBrake = nulls();
  /** What the reference lap wore in all. */
  private readonly referenceTread = nulls();
  private readonly referenceBrake = nulls();
  /** The reference lap was driven on another tyre, or other discs. */
  private readonly treadReferenceStale = [false, false, false, false];
  private readonly brakeReferenceStale = [false, false, false, false];
  /** Wheels given another tyre during the lap under way, as bits. */
  private tyresChangedThisLap = 0;
  private discsChangedThisLap = 0;

  private car: WearCar = { carKey: '', className: null, brakeDiscNewMm: null };
  private classFailureMm: number | null = null;
  /**
   * Failure thickness learned in this connection, front and rear:
   * undefined before one, 0 once one was shown to be wrong.
   */
  private readonly learnedHere: (number | undefined)[] = [undefined, undefined];

  private latest: WearSnapshot = EMPTY_WEAR;
  private signature = '';
  private version = 0;

  constructor(
    private readonly meter: WearMeter,
    private readonly options: WearForecastOptions
  ) {}

  /** Forgets everything measured: a new connection, track or car. */
  reset(): void {
    this.available = false;
    this.tread.fill(null);
    this.brake.fill(null);
    this.compound.fill(-1);
    this.flat.fill(false);
    this.lapOpen = false;
    this.lapPct = null;
    this.bucket = -1;
    this.lastDisc.fill(null);
    this.discMax.fill(null);
    this.seq = null;
    this.lastLapTread.fill(null);
    this.lastLapBrake.fill(null);
    this.referenceTread.fill(null);
    this.referenceBrake.fill(null);
    this.treadReferenceStale.fill(false);
    this.brakeReferenceStale.fill(false);
    this.tyresChangedThisLap = 0;
    this.discsChangedThisLap = 0;
    this.learnedHere.fill(undefined);
    this.watch.reset();
  }

  /** The car as the session describes it. */
  setCar(car: WearCar): void {
    if (car.carKey !== this.car.carKey) this.learnedHere.fill(undefined);
    this.car = car;
    this.classFailureMm = classBrakeFailureMm(car.className);
  }

  /** Takes one frame: the meter's reading of it and what else it says. */
  observe(reading: MeterReading, frame: WearFrame): void {
    this.available = frame.hasCar;
    if (!frame.hasCar || reading.frozen) return;
    const time = reading.sessionTime;
    // A clock that went back is another session: answers are counted anew.
    if (time < this.answeredAt) this.answeredAt = time;
    this.time = time;
    this.lapOpen = frame.lapOpen;
    this.lapPct = frame.lapPct;
    this.bucket = reading.bucket;

    let changedAxles = 0;
    for (let wheel = 0; wheel < WHEEL_COUNT; wheel += 1) {
      this.tread[wheel] = reading.tread[wheel];
      this.compound[wheel] = reading.compound[wheel];
      this.flat[wheel] = frame.flat[wheel];
      const disc = reading.brake[wheel];
      this.brake[wheel] = disc;
      if (disc === null) continue;
      const before = this.lastDisc[wheel];
      this.lastDisc[wheel] = disc;
      if (before === null) continue;
      if (reading.inPits && disc - before > BRAKE_CHANGE_RISE_MM) {
        changedAxles |= 1 << (wheel >> 1);
      } else if (disc < before) {
        this.checkLearned(wheel >> 1, disc);
      }
    }
    if (changedAxles !== 0) this.noteBrakeChange(changedAxles);
    for (let wheel = 0; wheel < WHEEL_COUNT; wheel += 1) {
      const disc = this.brake[wheel];
      const highest = this.discMax[wheel];
      if (disc !== null && (highest === null || disc > highest)) {
        this.discMax[wheel] = disc;
      }
    }

    const seq = frame.wearablesSeq;
    if (seq !== this.seq) {
      this.seq = seq;
      this.answeredAt = time;
    }
    const braking =
      (frame.brakePedal ?? 0) > FAILURE_PEDAL &&
      Math.abs(reading.speed ?? 0) > FAILURE_SPEED_MS;
    const fired = this.watch.update(time, reading.brake, seq, braking);
    if (fired !== 0) this.noteFailures(fired);
  }

  /** Wheels were given another tyre: one bit each, LF 1, RF 2, LR 4, RR 8. */
  noteTyreChange(wheels: number): void {
    this.tyresChangedThisLap |= wheels;
    for (let wheel = 0; wheel < WHEEL_COUNT; wheel += 1) {
      if ((wheels & (1 << wheel)) === 0) continue;
      this.lastLapTread[wheel] = null;
      this.referenceTread[wheel] = null;
      this.treadReferenceStale[wheel] = true;
    }
  }

  /** A lap opened: what was changed before it is on the car for all of it. */
  noteLapOpened(): void {
    this.tyresChangedThisLap = 0;
    this.discsChangedThisLap = 0;
  }

  /**
   * A lap closed.
   *
   * @param keptCurve Its wear curve became the meter's reference.
   */
  noteLap(
    treadUsed: readonly (number | null)[],
    brakeUsed: readonly (number | null)[],
    keptCurve: boolean
  ): void {
    for (let wheel = 0; wheel < WHEEL_COUNT; wheel += 1) {
      const bit = 1 << wheel;
      // A lap a tyre or disc was changed on is no lap of the new one.
      const tread =
        (this.tyresChangedThisLap & bit) === 0
          ? (treadUsed[wheel] ?? null)
          : null;
      const brake =
        (this.discsChangedThisLap & bit) === 0
          ? (brakeUsed[wheel] ?? null)
          : null;
      this.lastLapTread[wheel] = tread;
      this.lastLapBrake[wheel] = brake;
      if (!keptCurve) continue;
      this.referenceTread[wheel] = tread;
      this.referenceBrake[wheel] = brake;
      this.treadReferenceStale[wheel] = false;
      this.brakeReferenceStale[wheel] = false;
    }
    this.tyresChangedThisLap = 0;
    this.discsChangedThisLap = 0;
  }

  /** The snapshot as last built. */
  snapshot(): WearSnapshot {
    return this.latest;
  }

  /**
   * Rebuilds the snapshot with its figures rounded to what is shown, and
   * moves the version only when one of them moved.
   */
  refresh(context: WearContext): WearSnapshot {
    const body = this.available
      ? this.build(context)
      : unavailable(context.sessionNum);
    const signature = JSON.stringify(body);
    if (signature !== this.signature) {
      this.signature = signature;
      this.version += 1;
      this.latest = { ...body, version: this.version };
    }
    return this.latest;
  }

  private build(context: WearContext): Omit<WearSnapshot, 'version'> {
    const { rates, tuning } = context;
    const stale = this.brakeStale();
    const failure = [this.failureFor(0, tuning), this.failureFor(1, tuning)];
    const floor = clamp(tuning.floorPct, 0, 100) / 100;
    const lapTread = this.meter.lapTreadUsed();
    const lapBrake = this.meter.lapBrakeUsed();
    const reference = this.meter.referenceCurves();

    const wheels: WearWheelSnapshot[] = [];
    for (let wheel = 0; wheel < WHEEL_COUNT; wheel += 1) {
      const snapshot: WearWheelSnapshot = {
        ...EMPTY_WEAR.wheels[wheel],
        compound: this.compound[wheel],
        flat: this.flat[wheel],
      };

      const bit = 1 << wheel;
      const tread = this.tread[wheel];
      if (tread !== null) {
        const used = this.lapOpen ? lapTread[wheel] : null;
        // What a wheel wore before its tyre was changed says nothing of
        // where the new one is heading.
        const projected = this.project(
          (this.tyresChangedThisLap & bit) === 0 ? used : null,
          reference && !this.treadReferenceStale[wheel]
            ? reference.tread
            : null,
          reference,
          this.referenceTread[wheel],
          this.lastLapTread[wheel],
          wheel
        );
        const measured = rates.tread[wheel];
        const perLap = measured ?? projected;
        const source: WearRateSource | null =
          measured !== null
            ? rates.treadSource[wheel]
            : projected !== null
              ? 'projected'
              : null;
        snapshot.treadPct = roundTo(tread * 100, 1);
        snapshot.treadLapPct = roundTo(used === null ? null : used * 100, 2);
        snapshot.treadProjectedPct = roundTo(
          projected === null ? null : projected * 100,
          2
        );
        snapshot.treadPerLapPct = roundTo(
          perLap === null ? null : perLap * 100,
          2
        );
        snapshot.treadRateSource = source;
        snapshot.treadLapsLeft = lapsLeftAt(tread, floor, perLap);
        const end = levelAfter(tread, perLap, context.budgetLapsLeft);
        snapshot.treadEndOfStintPct = roundTo(
          end === null ? null : end * 100,
          1
        );
      }

      const disc = stale ? null : this.brake[wheel];
      if (disc !== null) {
        const used = this.lapOpen ? lapBrake[wheel] : null;
        const projected = this.project(
          (this.discsChangedThisLap & bit) === 0 ? used : null,
          reference && !this.brakeReferenceStale[wheel]
            ? reference.brake
            : null,
          reference,
          this.referenceBrake[wheel],
          this.lastLapBrake[wheel],
          wheel
        );
        const measured = rates.brake[wheel];
        const perLap = measured ?? projected;
        const limit = failure[wheel >> 1].mm;
        snapshot.brakeMm = roundTo(disc, 2);
        snapshot.brakeLifePct = roundTo(
          brakeLifePct(disc, limit, this.freshMm(wheel)),
          1
        );
        snapshot.brakeLapMm = roundTo(used, 4);
        snapshot.brakePerLapMm = roundTo(perLap, 4);
        snapshot.brakeRateSource =
          measured !== null
            ? rates.source
            : projected !== null
              ? 'projected'
              : null;
        snapshot.brakeLapsLeft =
          limit === null ? null : lapsLeftAt(disc, limit, perLap);
        snapshot.brakeFailed =
          this.watch.stoppedAt(wheel) !== null ||
          (limit !== null && disc <= limit);
      }
      wheels.push(snapshot);
    }

    return {
      available: true,
      wheels,
      paceLapTime: roundTo(rates.lapTime, 1),
      budgetLapsLeft: roundTo(context.budgetLapsLeft, 1),
      brakeNewMm: [
        roundTo(this.freshAxleMm(0), 2),
        roundTo(this.freshAxleMm(1), 2),
      ],
      brakeFailureMm: failure.map(({ mm }) => roundTo(mm, 2)),
      brakeFailureSource: failure.map(({ source }) => source),
      brakeStale: stale,
      sessionNum: context.sessionNum,
    };
  }

  /**
   * What the lap under way is heading for on one wheel, by the best means
   * to hand: the reference lap, else the lap before, else the lap itself.
   */
  private project(
    used: number | null,
    curve: Float32Array | null,
    reference: WearCurves | null,
    referenceTotal: number | null,
    lastLap: number | null,
    wheel: number
  ): number | null {
    if (used === null) return null;
    if (curve && reference && this.bucket >= 0) {
      const total =
        referenceTotal ??
        curveAt(curve, reference, wheel, reference.points - 1);
      return projectFromReference(
        total,
        curveAt(curve, reference, wheel, this.bucket),
        used
      );
    }
    const pct = this.lapPct;
    if (pct === null) return null;
    return lastLap !== null
      ? blendWithLastLap(used, lastLap, pct)
      : projectFromFraction(used, pct);
  }

  /**
   * Whether the discs' readings have outlived the answers that carried
   * them. A frame without the answer counter cannot say, and is trusted.
   */
  private brakeStale(): boolean {
    return (
      this.seq !== null &&
      this.brake.some((disc) => disc !== null) &&
      this.time - this.answeredAt > BRAKE_STALE_AFTER_S
    );
  }

  /** A new disc's thickness: the setup's, or the highest reading seen. */
  private freshMm(wheel: number): number | null {
    const setup = this.car.brakeDiscNewMm?.[wheel];
    const seen = this.discMax[wheel];
    if (typeof setup !== 'number' || !(setup > 0)) return seen;
    return seen === null ? setup : Math.max(setup, seen);
  }

  private freshAxleMm(axle: number): number | null {
    const left = this.freshMm(axle * 2);
    const right = this.freshMm(axle * 2 + 1);
    if (left === null || right === null) return left ?? right;
    return Math.max(left, right);
  }

  private limitKey(axle: number): string | null {
    return this.car.carKey === ''
      ? null
      : `${this.options.simulator}|${this.car.carKey}|${
          axle === 0 ? 'front' : 'rear'
        }`;
  }

  /** The failure thickness learned for an axle of this car, or null. */
  private learnedFor(axle: number): number | null {
    const here = this.learnedHere[axle];
    if (here !== undefined) return here > 0 ? here : null;
    const key = this.limitKey(axle);
    const stored = key === null ? undefined : this.options.limits?.get(key);
    return typeof stored === 'number' && stored > 0 ? stored : null;
  }

  private failureFor(
    axle: number,
    tuning: WearForecastTuning
  ): BrakeFailureThickness {
    return resolveBrakeFailure(
      axle === 0 ? tuning.failureFrontMm : tuning.failureRearMm,
      this.learnedFor(axle),
      this.classFailureMm,
      this.freshAxleMm(axle)
    );
  }

  private learn(axle: number, mm: number): void {
    this.learnedHere[axle] = mm;
    const key = this.limitKey(axle);
    if (key !== null) this.options.limits?.set(key, mm);
  }

  /**
   * A disc that goes on wearing well below the thickness one was taken to
   * have failed at shows that it had not: the thickness is forgotten.
   */
  private checkLearned(axle: number, disc: number): void {
    const learned = this.learnedFor(axle);
    if (learned !== null && disc < learned - DISPROVED_BY_MM) {
      this.learn(axle, 0);
    }
  }

  /** New discs on an axle: its highest reading and its failures start over. */
  private noteBrakeChange(axles: number): void {
    for (let wheel = 0; wheel < WHEEL_COUNT; wheel += 1) {
      if ((axles & (1 << (wheel >> 1))) === 0) continue;
      this.discMax[wheel] = this.brake[wheel];
      this.lastLapBrake[wheel] = null;
      this.referenceBrake[wheel] = null;
      this.brakeReferenceStale[wheel] = true;
      this.discsChangedThisLap |= 1 << wheel;
      this.watch.clearWheel(wheel);
    }
  }

  /**
   * Discs that stopped wearing under braking. One that is all but new has
   * not worn out, whatever its reading does: it is let go. The others have
   * failed, and the thickness they stopped at is kept for their axle.
   */
  private noteFailures(wheels: number): void {
    for (let wheel = 0; wheel < WHEEL_COUNT; wheel += 1) {
      if ((wheels & (1 << wheel)) === 0) continue;
      const stopped = this.watch.stoppedAt(wheel);
      if (stopped === null) continue;
      if (isPlausibleFailure(stopped, this.freshMm(wheel))) {
        this.learn(wheel >> 1, stopped);
      } else {
        this.watch.clearWheel(wheel);
      }
    }
  }
}
