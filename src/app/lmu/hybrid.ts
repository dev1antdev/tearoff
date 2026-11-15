import { isReading } from './readings';

/**
 * The player's hybrid system and lift-and-coast, from the player's block of
 * LMU's telemetry.
 *
 * No recording holds a car with a hybrid. The one there is has an LMGT3,
 * whose motor reads "not available" and whose other hybrid fields read 0
 * throughout, so everything here beyond that state is unconfirmed: the
 * meanings are TinyPedal's reading of the same fields, and the values are
 * published in the units that reading gives them, unconverted, until a
 * Hypercar is recorded.
 */

/** The fields of a shared-memory read the hybrid channels are built from. */
export interface LmuHybridSource {
  batteryChargeFraction?: number;
  electricBoostMotorState?: number;
  electricBoostMotorTorque?: number;
  electricBoostMotorRPM?: number;
  electricBoostMotorTemperature?: number;
  electricBoostWaterTemperature?: number;
  liftAndCoastProgress?: number;
}

/** The motor state of a car that has no hybrid system. */
export const LMU_MOTOR_NOT_AVAILABLE = 0;

/** The sim quantises lift-and-coast progress to a byte. */
const LIFT_AND_COAST_SCALE = 255;

/**
 * Lift-and-coast progress as a fraction, or undefined for no reading.
 *
 * The byte over 255, as TinyPedal converts it and as the sim quantises a
 * car's fuel.
 */
export const lmuLiftAndCoast = (raw: number | undefined): number | undefined =>
  isReading(raw) && raw >= 0
    ? Math.min(raw / LIFT_AND_COAST_SCALE, 1)
    : undefined;

/**
 * Writes the hybrid channels onto a telemetry frame.
 *
 * - LmuMotorState: 0 not available, 1 inactive, 2 deploying, 3 regenerating.
 *   Published whenever the sim states one, 0 included: that is what says the
 *   car has no hybrid.
 * - LmuBatteryCharge: 0..1.
 * - LmuMotorTorque (Nm), LmuMotorRPM (rev/min), LmuMotorTemp and
 *   LmuMotorCoolantTemp (Celsius): units unconfirmed, see above.
 * - LmuLiftAndCoast: 0..1.
 *
 * The battery and the four motor readings are published only for a car with
 * a hybrid system. Without one the sim leaves them at 0, and a 0 here would
 * be drawn as a flat battery and a motor at freezing point on a car that has
 * neither. With no player car the sim writes none of this and nothing is
 * published.
 */
export function writeLmuHybrid(
  frame: Record<string, { value: unknown[] }>,
  raw: LmuHybridSource
): void {
  const state = raw.electricBoostMotorState;
  if (isReading(state)) {
    frame.LmuMotorState = { value: [state] };
    if (state !== LMU_MOTOR_NOT_AVAILABLE) {
      if (isReading(raw.batteryChargeFraction)) {
        frame.LmuBatteryCharge = { value: [raw.batteryChargeFraction] };
      }
      if (isReading(raw.electricBoostMotorTorque)) {
        frame.LmuMotorTorque = { value: [raw.electricBoostMotorTorque] };
      }
      if (isReading(raw.electricBoostMotorRPM)) {
        frame.LmuMotorRPM = { value: [raw.electricBoostMotorRPM] };
      }
      if (isReading(raw.electricBoostMotorTemperature)) {
        frame.LmuMotorTemp = { value: [raw.electricBoostMotorTemperature] };
      }
      if (isReading(raw.electricBoostWaterTemperature)) {
        frame.LmuMotorCoolantTemp = {
          value: [raw.electricBoostWaterTemperature],
        };
      }
    }
  }

  const liftAndCoast = lmuLiftAndCoast(raw.liftAndCoastProgress);
  if (liftAndCoast !== undefined) {
    frame.LmuLiftAndCoast = { value: [liftAndCoast] };
  }
}
