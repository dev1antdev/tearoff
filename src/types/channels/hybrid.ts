/**
 * What the hybrid motor is doing: 0 unknown, 1 idle, 2 deploying,
 * 3 regenerating. The numbers are Le Mans Ultimate's own, as TinyPedal reads
 * them; no recording holds a car that reports anything but 0.
 */
export type HybridMotorState = 0 | 1 | 2 | 3;

export const HYBRID_MOTOR_UNKNOWN = 0;
export const HYBRID_MOTOR_IDLE = 1;
export const HYBRID_MOTOR_DEPLOYING = 2;
export const HYBRID_MOTOR_REGENERATING = 3;

/**
 * The motor's own readings. Every unit here is unconfirmed: they are the
 * units TinyPedal takes the same fields to be in, and no recording holds a
 * car with a hybrid to check them against.
 */
export interface HybridMotorReadings {
  /** Newton metres, 1 decimal, signed: negative while regenerating. */
  torqueNm: number | null;
  /** Revolutions per minute, whole. */
  rpm: number | null;
  /** Torque times speed, kilowatts, 1 decimal; 0 while torque is not positive. */
  powerKw: number | null;
  /**
   * Celsius, 1 decimal. Whether the sim writes Celsius or Kelvin is not
   * known, so a reading above 200 is taken as Kelvin and converted: a motor
   * reads 20 to 40 at rest in the one unit and about 300 in the other, and
   * none runs at 200 C. Null where the sim writes exactly 0.
   */
  motorTempC: number | null;
  /** As motorTempC; null for a unit with no coolant circuit. */
  coolantTempC: number | null;
  /**
   * The sim's regeneration reading, 1 decimal, signed. Taken as kilowatts
   * because TinyPedal does; what it measures is unconfirmed.
   */
  regenKw: number | null;
}

/**
 * The hybrid battery and motor of the player's car.
 *
 * Le Mans Ultimate only for now. Under iRacing the charge would come from
 * EnergyERSBatteryPct, which waits for a capture of a hybrid car to confirm
 * its name and scale.
 *
 * Nothing here has been seen on a recording: the one there is holds a GT3
 * with no hybrid, for which `available` stays false and nothing else is
 * ever written.
 */
export interface HybridSnapshot {
  /**
   * False until the car has shown, from inside the car, a motor state other
   * than 0 or a charge above 0 that moves. The widget draws nothing while
   * false.
   */
  available: boolean;
  /** Battery charge, percent 0..100, 2 decimals. Null without a reading. */
  chargePct: number | null;
  /** The motor state after the fallback below. */
  motorState: HybridMotorState;
  /**
   * True when the sim reported no state and it was inferred from the charge
   * moving: deploying on a fall, regenerating on a rise, idle once it holds.
   */
  motorStateInferred: boolean;
  /** Percentage points used and recovered so far this lap, 2 decimals. */
  drainLapPct: number;
  regenLapPct: number;
  /** The same for the last completed lap; null before one is completed. */
  drainLastLapPct: number | null;
  regenLastLapPct: number | null;
  /**
   * Estimated net change over this whole lap, percentage points, signed,
   * 2 decimals; null until a lap driven from the line, clear of the pits,
   * has given a reference to measure against.
   */
  netLapEstimatePct: number | null;
  /** Seconds the motor has deployed this lap, 1 decimal. */
  deployTimeLapS: number;
  /**
   * Seconds since the last deployment ended, 1 decimal; null while
   * deploying and before the first deployment.
   */
  sinceDeployS: number | null;
  /**
   * Whole seconds into the current lap, capped at 30. Only for the window
   * after the line in which the widget still shows last lap's totals, so it
   * stops changing after 30 s.
   */
  lapElapsedS: number;
  motor: HybridMotorReadings;
  /**
   * The sim's mStateOfCharge as it stands, 3 decimals. Not the charge above:
   * what it means is unknown, and it is carried only to be compared.
   */
  stateOfCharge: number | null;
  sessionNum: number | null;
  version: number;
}
