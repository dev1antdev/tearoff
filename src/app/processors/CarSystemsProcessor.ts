import type {
  CarSystemAdjustment,
  CarSystemsSnapshot,
  Session,
  SessionLifecycleEvent,
  Telemetry,
} from '@irdashies/types';
import {
  CAR_SYSTEM_ADJUSTMENTS,
  LMU_DIAL_KEYS,
  SessionState,
} from '@irdashies/types';
import type { TelemetryProcessor } from './TelemetryProcessor';

type Cell = { value?: unknown[] } | undefined;

const cell = (frame: Telemetry, key: string): Cell =>
  (frame as Record<string, Cell>)[key];

const number = (frame: Telemetry, key: string): number | undefined => {
  const value = cell(frame, key)?.value?.[0];
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
};

const boolean = (frame: Telemetry, key: string): boolean =>
  cell(frame, key)?.value?.[0] === true;

/** True or false as the frame states it, or undefined when it does not. */
const flag = (frame: Telemetry, key: string): boolean | undefined => {
  const value = cell(frame, key)?.value?.[0];
  return typeof value === 'boolean' ? value : undefined;
};

/** The row whose light each "intervening now" flag drives. */
const ACTIVE_FLAG: Readonly<Record<string, string>> = {
  // Published by both sims.
  dcABS: 'BrakeABSactive',
  // LMU alone; iRacing has no traction-control-active flag.
  dcTractionControl: 'LmuTcActive',
};

/** Where each dial's maximum sits in LmuDialMax. */
const DIAL_MAX_INDEX: ReadonlyMap<string, number> = new Map(
  LMU_DIAL_KEYS.map((key, index) => [key, index])
);

const BRAKE_BIAS = 'dcBrakeBias';

/** Below this the car is at rest, m/s. */
const AT_REST_MS = 0.1;

/**
 * Publishes the player car's adjustable systems.
 *
 * Two things drive the design, both established from recorded sessions rather
 * than assumed:
 *
 * **The set is per-car and is only visible from inside the car.** A Formula Vee
 * exposes brake bias alone; a GTP car exposes a dozen. Out of the car iRacing
 * publishes a reduced set — sessions captured while spectating carry only
 * dcStarter — so an out-of-car frame cannot be used to conclude that a car
 * lacks ABS. The discovered set is therefore latched on the first in-car frame
 * and kept, so the display does not empty out when the player hops out, spectates
 * or watches a replay.
 *
 * **Scales differ and some are signed.** Most run 0..n with 0 meaning off, but
 * dcABS reads negative on every GTP-class car in the recorded sessions - -5 and
 * -3 on the Cadillac V-Series.R, -2 on the BMW M Hybrid V8. A negative value
 * anywhere in a session proves the scale has a negative side, on which 0 is an
 * ordinary setting rather than off. That is tracked per variable.
 *
 * Observation alone is not enough for a scale centred on zero, though: the
 * neutral setting would read as off until the driver first crossed into
 * negative, and a session spent entirely in the middle of the range would never
 * correct itself. Those carry `signed: true` in the catalogue and are trusted
 * from the first frame.
 *
 * **A dial the driver moves is told apart from a value that merely differs.**
 * `lastChange` is set only when a row reads differently on two consecutive
 * ticks in the car. The first tick in the car re-baselines without a word, so
 * a setup loaded in the garage, a new session and getting back in from the
 * monitor are not reported as the driver turning something.
 */
export class CarSystemsProcessor implements TelemetryProcessor<CarSystemsSnapshot> {
  readonly channel = 'car-systems.snapshot';
  // Adjustments move when a dial is turned. Sampling faster buys nothing and
  // the snapshot only republishes when a value actually changes.
  readonly tickRateHz = 10;

  private enabled = true;
  /** Variables seen on an in-car frame, in CAR_SYSTEM_ADJUSTMENTS order. */
  private discoveredKeys: string[] = [];
  /** Variables observed negative at any point: their scale is signed. */
  private readonly signedKeys = new Set<string>();
  /**
   * What each row read on the tick before this one, kept only while that tick
   * was in the car. Empty after any tick out of it, which is what makes the
   * next tick in the car a silent one.
   */
  private readonly lastInCarValues = new Map<string, number>();
  /** The brake bias the car last had at rest in the pits. */
  private brakeBiasBaseline: number | null = null;
  /** Counts dial movements. Never reset, see CarSystemChange.seq. */
  private changeSeq = 0;
  private readonly latest: CarSystemsSnapshot & {
    adjustments: CarSystemAdjustment[];
  } = {
    adjustments: [],
    discovered: false,
    lastChange: null,
    sessionNum: null,
    version: 0,
  };

  // The adjustment set is discovered from telemetry, not from session info.
  /**
   * Deliberately does nothing. ProcessorHost calls this on every session
   * update, not once at startup, and iRacing republishes session data every
   * second or two - so resetting here wiped the discovered set and the values
   * constantly, and the table blinked empty until the next frame refilled it.
   * Clearing state belongs in onLifecycle, which fires on the events that
   * actually invalidate it.
   */
  init(session: Session): void {
    void session;
  }

  onFrame(frame: Telemetry): void {
    if (!this.enabled) return;

    // A frame that omits SessionNum says nothing about which session this is,
    // so it must not be read as a change. Treating the absent value as null and
    // comparing it against the stored one reset the whole table on any frame
    // that happened to arrive without it.
    const sessionNum = number(frame, 'SessionNum');
    if (sessionNum !== undefined) {
      if (
        this.latest.sessionNum !== null &&
        sessionNum !== this.latest.sessionNum
      ) {
        this.reset(sessionNum);
      } else if (this.latest.sessionNum === null) {
        this.latest.sessionNum = sessionNum;
      }
    }

    // Being in the car is what makes the full set visible. The pit box counts;
    // the garage and replay playback do not, matching useDrivingState. Nor does
    // LMU's monitor: a car left in the pit lane or stall keeps its pit flags
    // set while the player sits there, which is why LmuOutOfCar exists.
    const inCar =
      (boolean(frame, 'IsOnTrack') ||
        boolean(frame, 'PlayerCarInPitStall') ||
        boolean(frame, 'OnPitRoad')) &&
      !boolean(frame, 'IsInGarage') &&
      !boolean(frame, 'IsReplayPlaying') &&
      !boolean(frame, 'LmuOutOfCar');

    if (inCar) {
      const present = CAR_SYSTEM_ADJUSTMENTS.filter(
        ({ key }) => number(frame, key) !== undefined
      ).map(({ key }) => key);
      // Union rather than replacement: a car can publish a variable a frame
      // later than the rest, and losing a row mid-session reads as a fault.
      for (const key of present) {
        if (!this.discoveredKeys.includes(key)) this.discoveredKeys.push(key);
      }
      if (present.length > 0) this.latest.discovered = true;
    } else {
      this.lastInCarValues.clear();
    }

    if (!this.latest.discovered) return;

    this.updateBrakeBiasBaseline(frame);
    const dialMax = cell(frame, 'LmuDialMax')?.value;

    let changed = false;
    const next: CarSystemAdjustment[] = [];
    for (const definition of CAR_SYSTEM_ADJUSTMENTS) {
      const { key } = definition;
      if (!this.discoveredKeys.includes(key)) continue;
      const value = number(frame, key);
      if (value === undefined) {
        // Out of the car the value stops being published. Keep the last known
        // reading rather than dropping the row.
        const previous = this.latest.adjustments.find((a) => a.key === key);
        // A system cannot be intervening in a car nobody is reading, so the
        // light does not stay on with the reading.
        if (previous) {
          next.push(
            previous.active ? { ...previous, active: false } : previous
          );
        }
        this.lastInCarValues.delete(key);
        continue;
      }
      if (value < 0) this.signedKeys.add(key);
      // A declared signed scale is trusted from the first frame; observing a
      // negative is the fallback for the ones not known in advance.
      const isSigned = definition.signed === true || this.signedKeys.has(key);
      const adjustment: CarSystemAdjustment = {
        key,
        label: definition.label,
        value,
        isOff: value === 0 && !isSigned && definition.offAtZero !== false,
        precision: definition.precision,
        unit: definition.unit,
      };

      // Members are added only where they apply, so a row that has none of
      // them is the same object it always was.
      const maxIndex = DIAL_MAX_INDEX.get(key);
      const max = maxIndex === undefined ? undefined : dialMax?.[maxIndex];
      if (typeof max === 'number' && max > 0) adjustment.max = max;
      const activeFlag = ACTIVE_FLAG[key];
      const active = activeFlag ? flag(frame, activeFlag) : undefined;
      if (active !== undefined) adjustment.active = active;
      if (key === BRAKE_BIAS && this.brakeBiasBaseline !== null) {
        adjustment.baselineDelta = value - this.brakeBiasBaseline;
      }
      next.push(adjustment);

      if (inCar) {
        const before = this.lastInCarValues.get(key);
        if (before !== undefined && before !== value) {
          this.changeSeq += 1;
          this.latest.lastChange = {
            key,
            from: before,
            to: value,
            seq: this.changeSeq,
          };
          changed = true;
        }
        this.lastInCarValues.set(key, value);
      }
    }

    if (changed || this.changed(next)) {
      this.latest.adjustments = next;
      this.latest.version += 1;
    }
  }

  /**
   * The bias the car has standing still in the pits, which is the one its
   * setup gave it: taken at the first reading, and again whenever the car is
   * at rest on pit road, in its stall or before the session has gone green.
   * Stopping out on the track does not move it.
   */
  private updateBrakeBiasBaseline(frame: Telemetry): void {
    const bias = number(frame, BRAKE_BIAS);
    if (bias === undefined) return;
    if (this.brakeBiasBaseline === null) {
      this.brakeBiasBaseline = bias;
      return;
    }
    const speed = number(frame, 'Speed');
    if (speed === undefined || Math.abs(speed) >= AT_REST_MS) return;
    const sessionState = number(frame, 'SessionState');
    if (
      boolean(frame, 'OnPitRoad') ||
      boolean(frame, 'PlayerCarInPitStall') ||
      (sessionState !== undefined && sessionState < SessionState.Racing)
    ) {
      this.brakeBiasBaseline = bias;
    }
  }

  private changed(next: CarSystemAdjustment[]): boolean {
    const current = this.latest.adjustments;
    if (current.length !== next.length) return true;
    for (let i = 0; i < next.length; i += 1) {
      const a = current[i];
      const b = next[i];
      if (
        a.key !== b.key ||
        a.value !== b.value ||
        a.isOff !== b.isOff ||
        a.max !== b.max ||
        a.active !== b.active ||
        a.baselineDelta !== b.baselineDelta
      ) {
        return true;
      }
    }
    return false;
  }

  private reset(sessionNum: number | null): void {
    this.discoveredKeys = [];
    this.signedKeys.clear();
    this.lastInCarValues.clear();
    this.brakeBiasBaseline = null;
    this.latest.adjustments = [];
    this.latest.discovered = false;
    this.latest.lastChange = null;
    this.latest.sessionNum = sessionNum;
    this.latest.version += 1;
  }

  onLifecycle(event: SessionLifecycleEvent): void {
    if (event.type === 'enter') {
      // Scrubbing a replay replays old adjustment values, and the discovered
      // set would latch from whatever car the replay is following rather than
      // the player's. Neither is useful, so recording stops during one.
      this.enabled = !event.replay;
      if (event.replay) this.reset(null);
    } else {
      this.reset(null);
    }
  }

  snapshot(): CarSystemsSnapshot {
    return this.latest;
  }
}
