import type {
  Session,
  SessionLifecycleEvent,
  Telemetry,
  TyreStateSnapshot,
  TyreWheelState,
} from '@irdashies/types';
import type { TelemetryProcessor } from './TelemetryProcessor';

const WHEEL_COUNT = 4;
const ZONE_COUNT = 3;
/** iRacing-shaped corner prefixes, in the sim's wheel order. */
const CORNERS = ['LF', 'RF', 'LR', 'RR'] as const;
/** No compound reported for the wheel. */
const COMPOUND_UNKNOWN = -1;

const numbers = (
  frame: Telemetry,
  key: keyof Telemetry
): readonly unknown[] | undefined => {
  const value = frame[key]?.value;
  return Array.isArray(value) ? value : undefined;
};

const finite = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const scalar = (frame: Telemetry, key: string): number | undefined =>
  finite(
    (frame as Record<string, { value?: unknown[] } | undefined>)[key]
      ?.value?.[0]
  );

/**
 * Rounds to the precision the widget shows. A snapshot is only republished
 * when a rounded value moves, so sensor noise in the fourth decimal does not
 * wake the renderer five times a second.
 */
const round = (value: number, decimals: number): number => {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
};

const TEMPERATURE_DECIMALS = 1;
const PRESSURE_DECIMALS = 1;
const TREAD_DECIMALS = 3;

/**
 * Time constant of the pressure averages the deviation is taken from,
 * seconds. TinyPedal averages over 500 of its 20 ms ticks, which is the same
 * 5 s.
 */
const PRESSURE_AVERAGE_TAU_S = 5;
/** A longer gap than this between two ticks is averaged as if it were this. */
const MAX_STEP_S = 1;
/**
 * A pressure that moves this far between two ticks is another tyre, not the
 * same one warming up: the averages start again from the new readings.
 */
const TYRE_CHANGE_KPA = 15;
/** Stands in a list of pressures for a wheel that gave none. */
const NO_PRESSURE = Number.NaN;

const emptyWheel = (): TyreWheelState => ({
  surfaceTempC: null,
  innerLayerTempC: null,
  carcassTempC: null,
  optimalTempC: null,
  pressureKpa: null,
  pressureDeviationKpa: null,
  treadRemaining: null,
  brakeTempC: null,
  compound: COMPOUND_UNKNOWN,
});

/**
 * Publishes the player's tyres and brakes for the tyre widget.
 *
 * Reads the Lmu* wheel channels the LMU mapper fills from shared memory. They
 * are absent whenever the player has no car -- at the monitor, spectating, or
 * under a sim that does not publish them at all -- and the snapshot then says
 * `available: false` rather than holding the last reading: a tyre temperature
 * from before the driver got out is not a reading of anything.
 *
 * One figure is not a reading of the tick: how far each wheel's pressure sits
 * below the highest of the four. It is taken from an average of each
 * pressure over the session clock, so that a kerb or a hot corner does not
 * make it jump, and the averages are dropped with the readings.
 *
 * Through a team-mate's stint the mapper fills them from the block of the
 * user's own entry, as far as the sim writes that block for a car the user
 * is not in: the brake temperatures, and the tread for a car simulated on
 * this machine. The snapshot is available then, with the tyre temperatures
 * and pressures null, which the widget draws as its placeholders. With no
 * pressure to average there is no deviation either, and the averages start
 * again from the user's own tyres when they are back in the car.
 */
export class TyreStateProcessor implements TelemetryProcessor<TyreStateSnapshot> {
  readonly channel = 'tyre-state.snapshot';
  // Rubber and brake discs move over seconds. Five a second is already faster
  // than the number can be read.
  readonly tickRateHz = 5;

  private readonly wheels: TyreWheelState[] = Array.from(
    { length: WHEEL_COUNT },
    emptyWheel
  );
  private readonly latest: TyreStateSnapshot = {
    available: false,
    wheels: this.wheels,
    sessionNum: null,
    version: 0,
  };

  /** Each wheel's averaged pressure, kPa; meaningful while `averaging`. */
  private readonly pressureAverages = [0, 0, 0, 0];
  /** The pressures of the previous tick, to tell a tyre change by. */
  private readonly lastPressures = [0, 0, 0, 0];
  private averaging = false;
  /** SessionTime at the previous tick. */
  private lastTime: number | undefined;
  /** This tick's pressures, kPa, reused every tick; NaN is no reading. */
  private readonly pressures = [
    NO_PRESSURE,
    NO_PRESSURE,
    NO_PRESSURE,
    NO_PRESSURE,
  ];
  private readonly deviations: (number | null)[] = [null, null, null, null];

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

    const surface = numbers(frame, 'LmuTyreSurfaceTemp');
    const brakes = numbers(frame, 'LmuBrakeTemp');
    // The tyres of the player's own car, or failing them the brakes, which
    // are what the sim goes on writing for a car somebody else is driving.
    const available =
      (surface !== undefined && surface.length >= 12) ||
      (brakes !== undefined && brakes.length >= WHEEL_COUNT);
    if (available !== this.latest.available) {
      this.latest.available = available;
      changed = true;
    }
    if (!available) {
      if (changed) {
        // Drop the readings with the flag, so a consumer that ignores the
        // flag still cannot draw a stale tyre.
        for (let wheel = 0; wheel < WHEEL_COUNT; wheel += 1) {
          this.wheels[wheel] = emptyWheel();
        }
        this.latest.version += 1;
      }
      this.dropPressureAverages();
      return;
    }

    const innerLayer = numbers(frame, 'LmuTyreInnerLayerTemp');
    const carcass = numbers(frame, 'LmuTyreCarcassTemp');
    const optimal = numbers(frame, 'LmuTyreOptimalTemp');
    const compounds = numbers(frame, 'LmuCarIdxWheelCompounds');
    const playerCarIdx = scalar(frame, 'PlayerCarIdx');

    // Named "cold" after iRacing's channel, but LMU fills it with the live
    // pressure, in kPa.
    for (let wheel = 0; wheel < WHEEL_COUNT; wheel += 1) {
      this.pressures[wheel] =
        scalar(frame, `${CORNERS[wheel]}coldPressure`) ?? NO_PRESSURE;
    }
    this.updatePressureDeviations(scalar(frame, 'SessionTime'));

    for (let wheel = 0; wheel < WHEEL_COUNT; wheel += 1) {
      const corner = CORNERS[wheel];
      const next: TyreWheelState = {
        surfaceTempC: this.zones(surface, wheel),
        innerLayerTempC: this.zones(innerLayer, wheel),
        carcassTempC: this.temperature(carcass?.[wheel]),
        optimalTempC: this.temperature(optimal?.[wheel]),
        pressureKpa: this.rounded(
          finite(this.pressures[wheel]),
          PRESSURE_DECIMALS
        ),
        pressureDeviationKpa: this.deviations[wheel],
        treadRemaining: this.rounded(
          scalar(frame, `${corner}wearM`),
          TREAD_DECIMALS
        ),
        brakeTempC: this.temperature(brakes?.[wheel]),
        compound:
          playerCarIdx !== undefined && playerCarIdx >= 0
            ? (finite(compounds?.[playerCarIdx * WHEEL_COUNT + wheel]) ??
              COMPOUND_UNKNOWN)
            : COMPOUND_UNKNOWN,
      };
      if (!this.sameWheel(this.wheels[wheel], next)) {
        this.wheels[wheel] = next;
        changed = true;
      }
    }

    if (changed) this.latest.version += 1;
  }

  onLifecycle(event: SessionLifecycleEvent): void {
    // A replay publishes whatever car the camera follows; live telemetry from
    // the player's own car is all this channel describes, and LMU has no
    // replay source at all, so there is nothing to switch off on 'enter'.
    if (event.type === 'enter') return;
    for (let wheel = 0; wheel < WHEEL_COUNT; wheel += 1) {
      this.wheels[wheel] = emptyWheel();
    }
    this.latest.available = false;
    this.latest.sessionNum = null;
    this.latest.version += 1;
    this.dropPressureAverages();
  }

  snapshot(): TyreStateSnapshot {
    return this.latest;
  }

  private dropPressureAverages(): void {
    this.averaging = false;
    this.lastTime = undefined;
  }

  /**
   * Moves each wheel's averaged pressure toward this tick's reading and
   * fills `deviations` with how far each average sits below the highest.
   *
   * The averages start from the first readings rather than from zero, so the
   * figure is right from the first tick. They start again when the session
   * clock steps backwards and when a tyre is changed, and they are dropped,
   * with nothing published, while any of the four wheels has no reading.
   */
  private updatePressureDeviations(time: number | undefined): void {
    let allRead = true;
    for (let wheel = 0; wheel < WHEEL_COUNT; wheel += 1) {
      if (Number.isNaN(this.pressures[wheel])) allRead = false;
    }
    if (!allRead) {
      this.dropPressureAverages();
      this.deviations.fill(null);
      return;
    }

    // Seconds since the previous tick; without a clock, a tick's nominal
    // length. A clock that stands still, as in a paused sim, moves nothing.
    const elapsed =
      time === undefined || this.lastTime === undefined
        ? 1 / this.tickRateHz
        : time - this.lastTime;
    this.lastTime = time;

    let restart = !this.averaging || elapsed < 0;
    for (let wheel = 0; wheel < WHEEL_COUNT && !restart; wheel += 1) {
      restart =
        Math.abs(this.pressures[wheel] - this.lastPressures[wheel]) >
        TYRE_CHANGE_KPA;
    }

    const gain =
      1 - Math.exp(-Math.min(elapsed, MAX_STEP_S) / PRESSURE_AVERAGE_TAU_S);
    let highest = Number.NEGATIVE_INFINITY;
    for (let wheel = 0; wheel < WHEEL_COUNT; wheel += 1) {
      const pressure = this.pressures[wheel];
      this.lastPressures[wheel] = pressure;
      this.pressureAverages[wheel] = restart
        ? pressure
        : this.pressureAverages[wheel] +
          gain * (pressure - this.pressureAverages[wheel]);
      highest = Math.max(highest, this.pressureAverages[wheel]);
    }
    this.averaging = true;

    for (let wheel = 0; wheel < WHEEL_COUNT; wheel += 1) {
      this.deviations[wheel] = round(
        highest - this.pressureAverages[wheel],
        PRESSURE_DECIMALS
      );
    }
  }

  private rounded(value: number | undefined, decimals: number): number | null {
    return value === undefined ? null : round(value, decimals);
  }

  private temperature(value: unknown): number | null {
    return this.rounded(finite(value), TEMPERATURE_DECIMALS);
  }

  /** The three zones of one wheel, or null unless all three read. */
  private zones(
    source: readonly unknown[] | undefined,
    wheel: number
  ): number[] | null {
    if (!source) return null;
    const out: number[] = [];
    for (let zone = 0; zone < ZONE_COUNT; zone += 1) {
      const value = finite(source[wheel * ZONE_COUNT + zone]);
      if (value === undefined) return null;
      out.push(round(value, TEMPERATURE_DECIMALS));
    }
    return out;
  }

  private sameZones(
    a: readonly number[] | null,
    b: readonly number[] | null
  ): boolean {
    if (a === null || b === null) return a === b;
    return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
  }

  private sameWheel(a: TyreWheelState, b: TyreWheelState): boolean {
    return (
      this.sameZones(a.surfaceTempC, b.surfaceTempC) &&
      this.sameZones(a.innerLayerTempC, b.innerLayerTempC) &&
      a.carcassTempC === b.carcassTempC &&
      a.optimalTempC === b.optimalTempC &&
      a.pressureKpa === b.pressureKpa &&
      a.pressureDeviationKpa === b.pressureDeviationKpa &&
      a.treadRemaining === b.treadRemaining &&
      a.brakeTempC === b.brakeTempC &&
      a.compound === b.compound
    );
  }
}
