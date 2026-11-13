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

const emptyWheel = (): TyreWheelState => ({
  surfaceTempC: null,
  innerLayerTempC: null,
  carcassTempC: null,
  optimalTempC: null,
  pressureKpa: null,
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
    const available = surface !== undefined && surface.length >= 12;
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
      return;
    }

    const innerLayer = numbers(frame, 'LmuTyreInnerLayerTemp');
    const carcass = numbers(frame, 'LmuTyreCarcassTemp');
    const optimal = numbers(frame, 'LmuTyreOptimalTemp');
    const brakes = numbers(frame, 'LmuBrakeTemp');
    const compounds = numbers(frame, 'LmuCarIdxWheelCompounds');
    const playerCarIdx = scalar(frame, 'PlayerCarIdx');

    for (let wheel = 0; wheel < WHEEL_COUNT; wheel += 1) {
      const corner = CORNERS[wheel];
      const next: TyreWheelState = {
        surfaceTempC: this.zones(surface, wheel),
        innerLayerTempC: this.zones(innerLayer, wheel),
        carcassTempC: this.temperature(carcass?.[wheel]),
        optimalTempC: this.temperature(optimal?.[wheel]),
        // Named "cold" after iRacing's channel, but LMU fills it with the live
        // pressure, in kPa.
        pressureKpa: this.rounded(
          scalar(frame, `${corner}coldPressure`),
          PRESSURE_DECIMALS
        ),
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
  }

  snapshot(): TyreStateSnapshot {
    return this.latest;
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
      a.treadRemaining === b.treadRemaining &&
      a.brakeTempC === b.brakeTempC &&
      a.compound === b.compound
    );
  }
}
