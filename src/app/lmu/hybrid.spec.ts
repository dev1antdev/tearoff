import { describe, expect, it } from 'vitest';
import { lmuLiftAndCoast, writeLmuHybrid } from './hybrid';
import type { LmuHybridSource } from './hybrid';

type Frame = Record<string, { value: unknown[] }>;

/**
 * A Hypercar deploying out of a corner. No recording holds one, so the
 * figures are of the size the units would give if they are what TinyPedal
 * takes them for: a 200 kW motor, a battery three quarters full.
 */
const deploying = (): Required<LmuHybridSource> => ({
  batteryChargeFraction: 0.74,
  electricBoostMotorState: 2,
  electricBoostMotorTorque: 212.5,
  electricBoostMotorRPM: 9150,
  electricBoostMotorTemperature: 68.4,
  electricBoostWaterTemperature: 51.2,
  liftAndCoastProgress: 0,
});

/** The recorded LMGT3: no hybrid, everything at 0. */
const noHybrid = (): Required<LmuHybridSource> => ({
  batteryChargeFraction: 0,
  electricBoostMotorState: 0,
  electricBoostMotorTorque: 0,
  electricBoostMotorRPM: 0,
  electricBoostMotorTemperature: 0,
  electricBoostWaterTemperature: 0,
  liftAndCoastProgress: 0,
});

const write = (raw: LmuHybridSource): Frame => {
  const frame: Frame = {};
  writeLmuHybrid(frame, raw);
  return frame;
};

describe('lmuLiftAndCoast', () => {
  it('is the byte over 255', () => {
    expect(lmuLiftAndCoast(255)).toBe(1);
    expect(lmuLiftAndCoast(0)).toBe(0);
    expect(lmuLiftAndCoast(51)).toBeCloseTo(0.2, 9);
  });

  it('has no answer without a reading', () => {
    expect(lmuLiftAndCoast(undefined)).toBeUndefined();
    expect(lmuLiftAndCoast(Number.NaN)).toBeUndefined();
    expect(lmuLiftAndCoast(-1)).toBeUndefined();
  });
});

describe('writeLmuHybrid', () => {
  it('publishes the battery and the motor of a car with a hybrid', () => {
    const frame = write(deploying());

    expect(frame.LmuMotorState.value).toEqual([2]);
    expect(frame.LmuBatteryCharge.value).toEqual([0.74]);
    // As the sim states them: no conversion until the units are confirmed.
    expect(frame.LmuMotorTorque.value).toEqual([212.5]);
    expect(frame.LmuMotorRPM.value).toEqual([9150]);
    expect(frame.LmuMotorTemp.value).toEqual([68.4]);
    expect(frame.LmuMotorCoolantTemp.value).toEqual([51.2]);
  });

  it.each([
    [1, 'inactive'],
    [2, 'deploying'],
    [3, 'regenerating'],
  ])('publishes the readings in state %i, %s', (state) => {
    const frame = write({ ...deploying(), electricBoostMotorState: state });

    expect(frame.LmuMotorState.value).toEqual([state]);
    expect(frame.LmuBatteryCharge).toBeDefined();
    expect(frame.LmuMotorTemp).toBeDefined();
  });

  it('keeps a real zero on a car that has a hybrid', () => {
    // A flat battery and a motor at rest are readings.
    const frame = write({
      ...deploying(),
      electricBoostMotorState: 1,
      batteryChargeFraction: 0,
      electricBoostMotorTorque: 0,
      electricBoostMotorRPM: 0,
    });

    expect(frame.LmuBatteryCharge.value).toEqual([0]);
    expect(frame.LmuMotorTorque.value).toEqual([0]);
    expect(frame.LmuMotorRPM.value).toEqual([0]);
  });

  it('says a car has no hybrid, and publishes no battery or motor for it', () => {
    // The sim leaves all five at 0, and a 0 would be drawn as a flat battery
    // and a motor at freezing point.
    const frame = write(noHybrid());

    expect(frame.LmuMotorState.value).toEqual([0]);
    expect(frame.LmuBatteryCharge).toBeUndefined();
    expect(frame.LmuMotorTorque).toBeUndefined();
    expect(frame.LmuMotorRPM).toBeUndefined();
    expect(frame.LmuMotorTemp).toBeUndefined();
    expect(frame.LmuMotorCoolantTemp).toBeUndefined();
  });

  it('publishes a charge above 0 for a car that states no motor state', () => {
    // TinyPedal allows for a car like this and infers the motor state from
    // the charge moving, which takes the charge being on the frame.
    const frame = write({
      ...noHybrid(),
      batteryChargeFraction: 0.41,
    });

    expect(frame.LmuMotorState.value).toEqual([0]);
    expect(frame.LmuBatteryCharge.value).toEqual([0.41]);
    // The motor's readings are still nothing to go by.
    expect(frame.LmuMotorTorque).toBeUndefined();
    expect(frame.LmuMotorTemp).toBeUndefined();
  });

  it('publishes lift and coast as a fraction, whatever the car', () => {
    expect(
      write({ ...deploying(), liftAndCoastProgress: 102 }).LmuLiftAndCoast.value
    ).toEqual([0.4]);
    // Not lifting is a reading too.
    expect(write(noHybrid()).LmuLiftAndCoast.value).toEqual([0]);
  });

  it('publishes nothing with no player car', () => {
    // The sim writes none of the fields then.
    expect(write({})).toEqual({});
  });

  it.each([
    ['batteryChargeFraction', 'LmuBatteryCharge'],
    ['electricBoostMotorTorque', 'LmuMotorTorque'],
    ['electricBoostMotorRPM', 'LmuMotorRPM'],
    ['electricBoostMotorTemperature', 'LmuMotorTemp'],
    ['electricBoostWaterTemperature', 'LmuMotorCoolantTemp'],
    ['liftAndCoastProgress', 'LmuLiftAndCoast'],
  ] as const)('leaves out only %s’s key when it is missing', (field, key) => {
    const frame = write({ ...deploying(), [field]: undefined });

    expect(frame[key]).toBeUndefined();
    // Seven keys in all, less the one.
    expect(Object.keys(frame)).toHaveLength(6);
  });

  it('publishes no battery or motor when the motor state is missing', () => {
    // Without the state there is no telling a hybrid at 0 from no hybrid.
    const frame = write({ ...deploying(), electricBoostMotorState: undefined });

    expect(Object.keys(frame)).toEqual(['LmuLiftAndCoast']);
  });
});
