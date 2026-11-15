import { describe, expect, it } from 'vitest';
import type { Session, Telemetry } from '@irdashies/types';
import { DriverControlsProcessor } from './DriverControlsProcessor';

const frame = (values: Record<string, number | boolean>): Telemetry =>
  Object.fromEntries(
    Object.entries(values).map(([key, current]) => [key, { value: [current] }])
  ) as unknown as Telemetry;

describe('DriverControlsProcessor', () => {
  it('projects full-precision input and engine values', () => {
    const processor = new DriverControlsProcessor();
    processor.init({} as Session);
    processor.onFrame(
      frame({
        Brake: 0.123456,
        BrakeRaw: 0.223456,
        Throttle: 0.765432,
        Clutch: 0.25,
        Gear: 3,
        Speed: 52.4,
        SteeringWheelAngle: -0.4321,
        BrakeABSactive: true,
        RPM: 6342,
      })
    );

    expect(processor.snapshot()).toMatchObject({
      brake: 0.123456,
      brakeRaw: 0.223456,
      throttle: 0.765432,
      clutch: 0.25,
      gear: 3,
      speed: 52.4,
      steeringWheelAngle: -0.4321,
      brakeAbsActive: true,
      rpm: 6342,
      version: 1,
    });
  });

  it('publishes only changes and resets at lifecycle boundaries', () => {
    const processor = new DriverControlsProcessor();
    const telemetry = frame({ Gear: 2, RPM: 5000 });
    processor.onFrame(telemetry);
    expect(processor.snapshot().version).toBe(1);
    processor.onFrame(telemetry);
    expect(processor.snapshot().version).toBe(1);

    processor.onLifecycle({ type: 'sessionNumChange' });
    expect(processor.snapshot()).toMatchObject({
      gear: undefined,
      rpm: undefined,
      version: 2,
    });
  });

  it('marks traction control cutting from the sim that reports it', () => {
    const processor = new DriverControlsProcessor();
    processor.onFrame(
      frame({ Throttle: 0.4, ThrottleRaw: 1, LmuTcActive: true })
    );
    expect(processor.snapshot()).toMatchObject({
      throttle: 0.4,
      throttleRaw: 1,
      tcActive: true,
    });

    processor.onFrame(
      frame({ Throttle: 1, ThrottleRaw: 1, LmuTcActive: false })
    );
    expect(processor.snapshot().tcActive).toBe(false);
  });

  it('leaves traction control absent, not off, under a sim with no flag for it', () => {
    // iRacing: the dial and its switch, but nothing for the cut itself.
    const processor = new DriverControlsProcessor();
    processor.onFrame(
      frame({ Throttle: 0.4, dcTractionControl: 3, BrakeABSactive: false })
    );

    expect(processor.snapshot().brakeAbsActive).toBe(false);
    expect(processor.snapshot().tcActive).toBeUndefined();
  });

  it('states the steering range lock to lock in whole degrees', () => {
    const processor = new DriverControlsProcessor();
    // 476 degrees, as the Le Mans Ultimate mapper publishes the recorded
    // LMGT3, and iRacing's MX-5 Cup as recorded.
    processor.onFrame(frame({ SteeringWheelAngleMax: 8.308 }));
    expect(processor.snapshot().steeringRangeDeg).toBe(476);
    processor.onFrame(frame({ SteeringWheelAngleMax: 17.279 }));
    expect(processor.snapshot().steeringRangeDeg).toBe(990);

    // A sim that states none says so by leaving it out.
    processor.onFrame(frame({ SteeringWheelAngleMax: 0 }));
    expect(processor.snapshot().steeringRangeDeg).toBeUndefined();
    processor.onFrame(frame({ Gear: 1 }));
    expect(processor.snapshot().steeringRangeDeg).toBeUndefined();
  });

  it('rounds force feedback to what is shown, so that noise below it publishes nothing', () => {
    const processor = new DriverControlsProcessor();
    processor.onFrame(frame({ SteeringWheelPctTorqueSign: 0.917 }));
    expect(processor.snapshot().ffb).toBe(0.92);

    processor.onFrame(frame({ SteeringWheelPctTorqueSign: 0.9171 }));
    const version = processor.snapshot().version;
    processor.onFrame(frame({ SteeringWheelPctTorqueSign: 0.9174 }));
    expect(processor.snapshot().version).toBe(version);

    // Clipping keeps its sign.
    processor.onFrame(frame({ SteeringWheelPctTorqueSign: -1.018 }));
    expect(processor.snapshot().ffb).toBe(-1.02);
    expect(processor.snapshot().version).toBe(version + 1);
  });

  it('scales the summed brake pressure by the hardest application of the session', () => {
    const processor = new DriverControlsProcessor();
    const pressures = (lf: number, rf: number, lr: number, rr: number) =>
      frame({
        LFbrakeLinePress: lf,
        RFbrakeLinePress: rf,
        LRbrakeLinePress: lr,
        RRbrakeLinePress: rr,
      });

    // Off the brake there is a reading, and it is zero.
    processor.onFrame(pressures(0, 0, 0, 0));
    expect(processor.snapshot().brakePressure).toBe(0);
    // The first application is the scale, however light.
    processor.onFrame(pressures(0.2, 0.2, 0.1, 0.1));
    expect(processor.snapshot().brakePressure).toBe(1);
    // A harder one replaces it.
    processor.onFrame(pressures(0.4, 0.4, 0.2, 0.2));
    expect(processor.snapshot().brakePressure).toBe(1);
    processor.onFrame(pressures(0.2, 0.2, 0.1, 0.1));
    expect(processor.snapshot().brakePressure).toBe(0.5);

    // A new session starts the scale again.
    processor.onLifecycle({ type: 'disconnect' });
    expect(processor.snapshot().brakePressure).toBeUndefined();
    processor.onFrame(pressures(0.2, 0.2, 0.1, 0.1));
    expect(processor.snapshot().brakePressure).toBe(1);
    processor.onLifecycle({ type: 'sessionNumChange' });
    processor.onFrame(pressures(0.1, 0.1, 0.05, 0.05));
    expect(processor.snapshot().brakePressure).toBe(1);
  });

  it('leaves the brake pressure absent for a car that states none', () => {
    const processor = new DriverControlsProcessor();
    processor.onFrame(frame({ Brake: 0.5 }));

    expect(processor.snapshot().brakePressure).toBeUndefined();
  });

  it('publishes the front wheel angle to one decimal, where the sim has one', () => {
    const processor = new DriverControlsProcessor();
    processor.onFrame(frame({ LmuFrontWheelAngle: 8.4321 }));
    expect(processor.snapshot().frontWheelAngleDeg).toBe(8.4);

    const version = processor.snapshot().version;
    processor.onFrame(frame({ LmuFrontWheelAngle: 8.4444 }));
    expect(processor.snapshot().version).toBe(version);

    processor.onFrame(frame({ Gear: 1 }));
    expect(processor.snapshot().frontWheelAngleDeg).toBeUndefined();
  });

  it('clears the steering and assist readings with the rest of the snapshot', () => {
    const processor = new DriverControlsProcessor();
    processor.onFrame(
      frame({
        LmuTcActive: true,
        SteeringWheelAngleMax: 8.308,
        SteeringWheelPctTorqueSign: 0.5,
        LmuFrontWheelAngle: 3,
      })
    );
    processor.onLifecycle({ type: 'sessionNumChange' });

    expect(processor.snapshot()).toMatchObject({
      tcActive: undefined,
      steeringRangeDeg: undefined,
      ffb: undefined,
      frontWheelAngleDeg: undefined,
    });
  });
});
