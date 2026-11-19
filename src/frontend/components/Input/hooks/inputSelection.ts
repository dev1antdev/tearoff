import type {
  DriverControlsSnapshot,
  InputConfig,
  LayoutNode,
} from '@irdashies/types';
import { resolveSpeedUnit, speedFromMs } from '@irdashies/utils/units';
import { getInputLayoutTree } from '../layout';

export interface InputValues {
  /** The pedals of the chosen input source, for the trace and the bars. */
  brake?: number;
  throttle?: number;
  clutch?: number;
  /**
   * Pedal travel whatever the source, for the narrow strip of a
   * side-by-side bar and the full-travel marker.
   */
  brakePedal?: number;
  throttlePedal?: number;
  clutchPedal?: number;
  /** What the car received, for the wide strip of a side-by-side bar. */
  brakeCar?: number;
  throttleCar?: number;
  clutchCar?: number;
  gear?: number;
  speed?: number;
  unit?: number;
  /** Radians, already rescaled to a manual wheel range when one is set. */
  steer?: number;
  /** Lock-to-lock rotation the steering meter is drawn against, degrees. */
  steerRangeDeg?: number;
  frontWheelAngleDeg?: number;
  /** Slower than 1 m/s, for a rotation arc drawn only at a standstill. */
  stationary?: boolean;
  ffb?: number;
  brakeAbsActive?: boolean;
  tcActive?: boolean;
  /** Keep sampling a visible trace even when every control is held steady. */
  traceTick?: number;
}

export const EMPTY_INPUTS: InputValues = {};

/** Below this the car counts as standing still for the rotation arc. */
const STATIONARY_SPEED_MS = 1;

const positive = (value: number | undefined): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined;

/** iRacing's clutch reads 1 with the pedal up; the widget draws pedal travel. */
const pressed = (clutch: number | undefined): number | undefined =>
  clutch === undefined ? undefined : 1 - clutch;

/** Select only visible controls, retaining the source clock for trace sampling. */
export function createInputSelector(config: InputConfig) {
  const elements = new Set<string>();
  const visit = (node: LayoutNode) => {
    if (node.type === 'box') node.widgets.forEach((id) => elements.add(id));
    else node.children.forEach(visit);
  };
  visit(getInputLayoutTree(config));
  const trace = elements.has('trace');
  const bar = elements.has('bar');
  const steer = elements.has('steer');
  const meter = elements.has('steermeter');
  const style = config.steer.config?.style;
  const ring = style === 'ring';
  // Both rings draw only the ring: no wheel angle or stationary arc.
  const plainWheel = !ring && style !== 'dial';
  const gear = elements.has('gear') || (steer && ring);
  const brakeBar = bar && config.bar.includeBrake;
  const throttleBar = bar && config.bar.includeThrottle;
  const clutchBar = bar && config.bar.includeClutch;
  const brakeWanted = (trace && config.trace.includeBrake) || brakeBar;
  const throttleWanted = (trace && config.trace.includeThrottle) || throttleBar;
  const clutchWanted = (trace && config.trace.includeClutch) || clutchBar;
  const absWanted =
    elements.has('abs') ||
    (trace && config.trace.includeBrake && config.trace.includeAbs) ||
    (brakeBar && config.bar.includeAbs);
  const tcWanted =
    (trace &&
      config.trace.includeThrottle &&
      (config.trace.includeTc ?? true)) ||
    (throttleBar && (config.bar.includeTc ?? true));
  // Both strips of a side-by-side bar, and the pedal travel the full-travel
  // marker lights on, are read whatever the input source is.
  const dual = bar && config.bar.dual === true;
  const pedalWanted = dual || (bar && (config.bar.showMaxMarker ?? true));
  const pressureWanted = dual && config.bar.brakeFromPressure === true;
  const ffbWanted = bar && config.bar.includeFfb === true;
  const steerWanted =
    steer || meter || (trace && (config.trace.includeSteer ?? true));
  const manualRangeDeg = positive(config.steer.rangeDeg);
  const wheelAngleWanted =
    steer && plainWheel && config.steer.showWheelAngle === true;
  const stationaryWanted =
    steer && plainWheel && config.steer.rotationArc === 'stationary';
  const gearWanted = gear || !!config.gearFlash?.enabled;
  const speedWanted = gear && config.gear.showspeed;
  // Stored data is untrusted: only a true reads as the Pedals source.
  const pedalsSource = config.useRawValues === true;
  let previous: InputValues | undefined;
  let previousSpeedText: string | undefined;

  return (snapshot: DriverControlsSnapshot): InputValues => {
    // Where the chosen source has no value the other one stands in: a sim
    // that publishes only one of them, or a watched car with no raw pedals.
    const brake = !brakeWanted
      ? undefined
      : pedalsSource
        ? (snapshot.brakeRaw ?? snapshot.brake)
        : (snapshot.brake ?? snapshot.brakeRaw);
    const throttle = !throttleWanted
      ? undefined
      : pedalsSource
        ? (snapshot.throttleRaw ?? snapshot.throttle)
        : (snapshot.throttle ?? snapshot.throttleRaw);
    const clutch = !clutchWanted
      ? undefined
      : pressed(
          pedalsSource
            ? (snapshot.clutchRaw ?? snapshot.clutch)
            : (snapshot.clutch ?? snapshot.clutchRaw)
        );
    const brakePedal =
      pedalWanted && brakeBar
        ? (snapshot.brakeRaw ?? snapshot.brake)
        : undefined;
    const throttlePedal =
      pedalWanted && throttleBar
        ? (snapshot.throttleRaw ?? snapshot.throttle)
        : undefined;
    const clutchPedal =
      pedalWanted && clutchBar
        ? pressed(snapshot.clutchRaw ?? snapshot.clutch)
        : undefined;
    const brakeCar = !(dual && brakeBar)
      ? undefined
      : ((pressureWanted ? snapshot.brakePressure : undefined) ??
        snapshot.brake ??
        snapshot.brakeRaw);
    const throttleCar =
      dual && throttleBar
        ? (snapshot.throttle ?? snapshot.throttleRaw)
        : undefined;
    const clutchCar =
      dual && clutchBar
        ? pressed(snapshot.clutch ?? snapshot.clutchRaw)
        : undefined;
    const simRangeDeg = positive(snapshot.steeringRangeDeg);
    const simAngle = steerWanted ? snapshot.steeringWheelAngle : undefined;
    // The sim's angle is a share of the lock at its own range: a wheel with
    // another range has turned the same share of its own.
    const angle =
      simAngle !== undefined && manualRangeDeg && simRangeDeg
        ? (simAngle * manualRangeDeg) / simRangeDeg
        : simAngle;
    const steerRangeDeg = meter ? (manualRangeDeg ?? simRangeDeg) : undefined;
    const frontWheelAngleDeg = wheelAngleWanted
      ? snapshot.frontWheelAngleDeg
      : undefined;
    const stationary = stationaryWanted
      ? (snapshot.speed ?? 0) < STATIONARY_SPEED_MS
      : undefined;
    const ffb = ffbWanted ? snapshot.ffb : undefined;
    const brakeAbsActive = absWanted ? snapshot.brakeAbsActive : undefined;
    const tcActive = tcWanted ? snapshot.tcActive : undefined;
    const currentGear = gearWanted ? snapshot.gear : undefined;
    const unit =
      speedWanted && config.gear.unit === 'auto'
        ? snapshot.displayUnits
        : undefined;
    const speed = speedWanted ? snapshot.speed : undefined;
    const speedText = speedWanted
      ? speedFromMs(
          speed ?? 0,
          resolveSpeedUnit(config.gear.unit, unit)
        ).toFixed(0)
      : undefined;
    const traceTick = trace ? snapshot.version : undefined;
    if (
      previous &&
      previous.brake === brake &&
      previous.throttle === throttle &&
      previous.clutch === clutch &&
      previous.brakePedal === brakePedal &&
      previous.throttlePedal === throttlePedal &&
      previous.clutchPedal === clutchPedal &&
      previous.brakeCar === brakeCar &&
      previous.throttleCar === throttleCar &&
      previous.clutchCar === clutchCar &&
      previous.steer === angle &&
      previous.steerRangeDeg === steerRangeDeg &&
      previous.frontWheelAngleDeg === frontWheelAngleDeg &&
      previous.stationary === stationary &&
      previous.ffb === ffb &&
      previous.brakeAbsActive === brakeAbsActive &&
      previous.tcActive === tcActive &&
      previous.gear === currentGear &&
      previous.unit === unit &&
      previousSpeedText === speedText &&
      previous.traceTick === traceTick
    )
      return previous;

    previousSpeedText = speedText;
    // Allocate only when a displayed signal or the trace sampling clock changes.
    previous = {
      brake,
      throttle,
      clutch,
      brakePedal,
      throttlePedal,
      clutchPedal,
      brakeCar,
      throttleCar,
      clutchCar,
      steer: angle,
      steerRangeDeg,
      frontWheelAngleDeg,
      stationary,
      ffb,
      brakeAbsActive,
      tcActive,
      gear: currentGear,
      unit,
      speed,
      traceTick,
    };
    return previous;
  };
}
