import type {
  DriverControlsSnapshot,
  Session,
  SessionLifecycleEvent,
  Telemetry,
} from '@irdashies/types';
import type { TelemetryProcessor } from './TelemetryProcessor';

const rawValue = (frame: Telemetry, key: string): unknown =>
  (frame as unknown as Record<string, { value?: unknown[] } | undefined>)[key]
    ?.value?.[0];

const numberValue = (frame: Telemetry, key: string): number | undefined => {
  const current = rawValue(frame, key);
  return typeof current === 'number' ? current : undefined;
};

const booleanValue = (frame: Telemetry, key: string): boolean | undefined => {
  const current = rawValue(frame, key);
  return typeof current === 'boolean' ? current : undefined;
};

/** A reading held to the precision it is shown at, so that noise below it
 *  does not publish a snapshot of its own. */
const roundedValue = (
  frame: Telemetry,
  key: string,
  perUnit: number
): number | undefined => {
  const current = numberValue(frame, key);
  return current === undefined
    ? undefined
    : Math.round(current * perUnit) / perUnit;
};

const BRAKE_LINE_PRESSURE_KEYS = [
  'LFbrakeLinePress',
  'RFbrakeLinePress',
  'LRbrakeLinePress',
  'RRbrakeLinePress',
] as const;

/**
 * What the largest brake pressure seen starts at. Above zero so that the
 * first reading divides by something; small enough that any real application
 * replaces it at once.
 */
const INITIAL_PRESSURE_MAXIMUM = 0.01;

export class DriverControlsProcessor implements TelemetryProcessor<DriverControlsSnapshot> {
  readonly channel = 'driver-controls.snapshot';
  readonly tickRateHz = 60;

  private readonly latest: DriverControlsSnapshot = { version: 0 };
  /**
   * The largest summed brake line pressure seen this session. The sims state
   * the pressure in units of their own and no maximum, so the hardest
   * application so far is the scale: a first, light one reads as full until
   * a harder one follows.
   */
  private pressureMaximum = INITIAL_PRESSURE_MAXIMUM;

  init(session: Session): void {
    const shiftRpm = session.DriverInfo?.DriverCarSLShiftRPM;
    const blinkRpm = session.DriverInfo?.DriverCarSLBlinkRPM;
    const shiftChanged = this.set('shiftRpm', shiftRpm);
    const blinkChanged = this.set('blinkRpm', blinkRpm);
    if (shiftChanged || blinkChanged) this.latest.version += 1;
  }

  onFrame(frame: Telemetry): void {
    let changed = false;
    changed = this.set('brake', numberValue(frame, 'Brake')) || changed;
    changed = this.set('brakeRaw', numberValue(frame, 'BrakeRaw')) || changed;
    changed = this.set('throttle', numberValue(frame, 'Throttle')) || changed;
    changed =
      this.set('throttleRaw', numberValue(frame, 'ThrottleRaw')) || changed;
    changed = this.set('clutch', numberValue(frame, 'Clutch')) || changed;
    changed = this.set('clutchRaw', numberValue(frame, 'ClutchRaw')) || changed;
    changed = this.set('gear', numberValue(frame, 'Gear')) || changed;
    changed = this.set('speed', numberValue(frame, 'Speed')) || changed;
    changed =
      this.set('displayUnits', numberValue(frame, 'DisplayUnits')) || changed;
    changed =
      this.set(
        'steeringWheelAngle',
        numberValue(frame, 'SteeringWheelAngle')
      ) || changed;
    changed =
      this.set('brakeAbsActive', booleanValue(frame, 'BrakeABSactive')) ||
      changed;
    // LMU's own key: iRacing has no flag for traction control cutting, so
    // under it this stays absent rather than false.
    changed =
      this.set('tcActive', booleanValue(frame, 'LmuTcActive')) || changed;
    changed =
      this.set('steeringRangeDeg', this.steeringRangeDeg(frame)) || changed;
    changed =
      this.set('ffb', roundedValue(frame, 'SteeringWheelPctTorqueSign', 100)) ||
      changed;
    changed = this.set('brakePressure', this.brakePressure(frame)) || changed;
    changed =
      this.set(
        'frontWheelAngleDeg',
        roundedValue(frame, 'LmuFrontWheelAngle', 10)
      ) || changed;
    changed = this.set('rpm', numberValue(frame, 'RPM')) || changed;
    changed =
      this.set('shiftGrindRpm', numberValue(frame, 'ShiftGrindRPM')) || changed;
    changed = this.set('oilTemp', numberValue(frame, 'OilTemp')) || changed;
    changed = this.set('waterTemp', numberValue(frame, 'WaterTemp')) || changed;
    changed =
      this.set('engineWarnings', numberValue(frame, 'EngineWarnings')) ||
      changed;
    if (changed) this.latest.version += 1;
  }

  onLifecycle(event: SessionLifecycleEvent): void {
    if (event.type === 'enter') return;
    this.latest.brake = undefined;
    this.latest.brakeRaw = undefined;
    this.latest.throttle = undefined;
    this.latest.throttleRaw = undefined;
    this.latest.clutch = undefined;
    this.latest.clutchRaw = undefined;
    this.latest.gear = undefined;
    this.latest.speed = undefined;
    this.latest.displayUnits = undefined;
    this.latest.steeringWheelAngle = undefined;
    this.latest.brakeAbsActive = undefined;
    this.latest.tcActive = undefined;
    this.latest.steeringRangeDeg = undefined;
    this.latest.ffb = undefined;
    this.latest.brakePressure = undefined;
    this.latest.frontWheelAngleDeg = undefined;
    this.pressureMaximum = INITIAL_PRESSURE_MAXIMUM;
    this.latest.rpm = undefined;
    this.latest.shiftGrindRpm = undefined;
    this.latest.oilTemp = undefined;
    this.latest.waterTemp = undefined;
    this.latest.engineWarnings = undefined;
    this.latest.shiftRpm = undefined;
    this.latest.blinkRpm = undefined;
    this.latest.version += 1;
  }

  snapshot(): DriverControlsSnapshot {
    return this.latest;
  }

  /**
   * SteeringWheelAngleMax is the wheel's rotation lock to lock, in radians,
   * under both sims. Absent when the sim states none.
   */
  private steeringRangeDeg(frame: Telemetry): number | undefined {
    const range = numberValue(frame, 'SteeringWheelAngleMax');
    return range !== undefined && range > 0
      ? Math.round((range * 180) / Math.PI)
      : undefined;
  }

  /** The four line pressures summed, over the largest sum seen so far. */
  private brakePressure(frame: Telemetry): number | undefined {
    let sum = 0;
    let wheels = 0;
    for (const key of BRAKE_LINE_PRESSURE_KEYS) {
      const pressure = numberValue(frame, key);
      if (pressure === undefined) continue;
      sum += pressure;
      wheels += 1;
    }
    if (wheels === 0) return undefined;
    if (sum > this.pressureMaximum) this.pressureMaximum = sum;
    return Math.round((Math.max(0, sum) / this.pressureMaximum) * 100) / 100;
  }

  private set<K extends Exclude<keyof DriverControlsSnapshot, 'version'>>(
    key: K,
    value: DriverControlsSnapshot[K]
  ): boolean {
    if (this.latest[key] === value) return false;
    this.latest[key] = value;
    return true;
  }
}
