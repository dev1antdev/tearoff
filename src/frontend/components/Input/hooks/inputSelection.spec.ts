import { describe, expect, it } from 'vitest';
import {
  getWidgetDefaultConfig,
  type DriverControlsSnapshot,
} from '@irdashies/types';
import { createInputSelector } from './inputSelection';

const config = () => structuredClone(getWidgetDefaultConfig('input'));
const frame = (
  changes: Partial<DriverControlsSnapshot> = {}
): DriverControlsSnapshot => ({
  brake: 0.2,
  throttle: 0.5,
  clutch: 0.9,
  gear: 3,
  speed: 10,
  steeringWheelAngle: 0.1,
  displayUnits: 1,
  brakeAbsActive: false,
  version: 1,
  ...changes,
});
const gearConfig = () => {
  const settings = config();
  settings.layoutTree = {
    id: 'gear',
    type: 'box',
    direction: 'row',
    widgets: ['gear'],
  };
  return settings;
};

describe('Input selection', () => {
  it.each([undefined, false, true])(
    'defaults trace steering when includeSteer is %s',
    (includeSteer) => {
      const settings = config();
      settings.layoutTree = {
        id: 'trace',
        type: 'box',
        direction: 'row',
        widgets: ['trace'],
      };
      settings.trace.includeSteer = includeSteer;
      const selected = createInputSelector(settings)(frame());
      expect(selected.steer).toBe(includeSteer === false ? undefined : 0.1);
    }
  );

  it('ignores RPM, unused pedals and version changes for a gear-only layout', () => {
    const select = createInputSelector(gearConfig());
    const first = select(frame());
    expect(select(frame({ version: 2, rpm: 7000, brake: 0.8 }))).toBe(first);
    expect(first.brake).toBeUndefined();
    expect(select(frame({ gear: 4 }))).not.toBe(first);
  });

  it('updates speed only when its displayed integer changes', () => {
    const select = createInputSelector(gearConfig());
    const first = select(frame({ speed: 10.01 }));
    expect(select(frame({ speed: 10.02, version: 2 }))).toBe(first);
    expect(select(frame({ speed: 10.2 }))).not.toBe(first);
  });

  it('uses the selected speed unit and reacts to auto-unit changes', () => {
    const settings = gearConfig();
    settings.gear.unit = 'mph';
    const select = createInputSelector(settings);
    const first = select(frame({ speed: 10.01 }));
    expect(select(frame({ speed: 10.02, displayUnits: 0 }))).toBe(first);
    const auto = createInputSelector(gearConfig());
    expect(auto(frame({ displayUnits: 0 })).unit).toBe(0);
    expect(auto(frame({ displayUnits: 1 })).unit).toBe(1);
  });

  it('does not wake a gear-only layout when hidden speed changes', () => {
    const settings = gearConfig();
    settings.gear.showspeed = false;
    const select = createInputSelector(settings);
    const first = select(frame());
    expect(select(frame({ speed: 100, displayUnits: 0 }))).toBe(first);
  });

  it('keeps full pedal and steering precision and inverts clutch', () => {
    const select = createInputSelector(config());
    const first = select(frame());
    expect(first.clutch).toBeCloseTo(0.1);
    const next = select(
      frame({ brake: 0.200001, steeringWheelAngle: 0.100001 })
    );
    expect(next.brake).toBe(0.200001);
    expect(next.steer).toBe(0.100001);
    expect(next).not.toBe(first);
  });

  it('uses raw pedals only when requested', () => {
    const settings = config();
    settings.useRawValues = true;
    const select = createInputSelector(settings);
    expect(
      select(
        frame({ brakeRaw: 0.123456, throttleRaw: 0.234567, clutchRaw: 0.3 })
      )
    ).toMatchObject({ brake: 0.123456, throttle: 0.234567, clutch: 0.7 });
  });

  it('advances visible trace samples even when controls are held constant', () => {
    const select = createInputSelector(config());
    const first = select(frame());
    const next = select(frame({ version: 2 }));
    expect(next).not.toBe(first);
    expect(next.traceTick).toBe(2);
  });

  it('reads the actual saved tree, including the ring gear display', () => {
    const settings = config();
    settings.steer.config = { style: 'ring', color: 'light' };
    settings.layoutTree = {
      id: 'ring',
      type: 'box',
      direction: 'row',
      widgets: ['steer'],
    };
    const select = createInputSelector(settings);
    expect(select(frame())).toMatchObject({ gear: 3, speed: 10, steer: 0.1 });
    expect(select(frame()).traceTick).toBeUndefined();
  });
});

describe('Input selection: the input source', () => {
  // A moment with traction control cutting: the pedal is flat and the car
  // gets less than half of it.
  const cutting = (changes: Partial<DriverControlsSnapshot> = {}) =>
    frame({
      throttle: 0.4,
      throttleRaw: 1,
      brake: 0.1,
      brakeRaw: 0.15,
      clutch: 1,
      clutchRaw: 0.8,
      tcActive: true,
      ...changes,
    });
  const source = (useRawValues: unknown) => {
    const settings = config();
    settings.useRawValues = useRawValues as boolean;
    return createInputSelector(settings);
  };

  it('shows what the car receives as Car and what is pressed as Pedals', () => {
    expect(source(false)(cutting())).toMatchObject({
      throttle: 0.4,
      brake: 0.1,
      clutch: 0,
    });
    expect(source(true)(cutting())).toMatchObject({
      throttle: 1,
      brake: 0.15,
    });
    expect(source(true)(cutting()).clutch).toBeCloseTo(0.2);
  });

  it('falls back to the car when Pedals has no raw inputs, as for a watched car', () => {
    const watched = cutting({
      throttleRaw: undefined,
      brakeRaw: undefined,
      clutchRaw: undefined,
    });

    expect(source(true)(watched)).toMatchObject({
      throttle: 0.4,
      brake: 0.1,
      clutch: 0,
    });
  });

  it('falls back to the pedals when Car has nothing, as for a sim that publishes only them', () => {
    const pedalsOnly = cutting({
      throttle: undefined,
      brake: undefined,
      clutch: undefined,
    });
    const selected = source(false)(pedalsOnly);

    expect(selected).toMatchObject({ throttle: 1, brake: 0.15 });
    expect(selected.clutch).toBeCloseTo(0.2);
  });

  it('draws nothing only when neither source has a value', () => {
    const neither = cutting({ throttle: undefined, throttleRaw: undefined });

    expect(source(false)(neither).throttle).toBeUndefined();
    expect(source(true)(neither).throttle).toBeUndefined();
  });

  it.each([undefined, null, 'true', 1, {}])(
    'reads a stored value of %j as Car: only true is Pedals',
    (stored) => {
      expect(source(stored)(cutting()).throttle).toBe(0.4);
    }
  );
});

describe('Input selection: the traction control mark', () => {
  const cutting = frame({ throttle: 0.4, throttleRaw: 1, tcActive: true });

  it('is read in both sources while the throttle is shown', () => {
    const car = config();
    const pedals = config();
    pedals.useRawValues = true;

    expect(createInputSelector(car)(cutting).tcActive).toBe(true);
    expect(createInputSelector(pedals)(cutting).tcActive).toBe(true);
  });

  it('is on for a config saved before the setting existed', () => {
    const settings = config();
    delete settings.trace.includeTc;
    delete settings.bar.includeTc;

    expect(createInputSelector(settings)(cutting).tcActive).toBe(true);
  });

  it('is read for the bar alone and for the trace alone', () => {
    const barOnly = config();
    barOnly.trace.includeTc = false;
    const traceOnly = config();
    traceOnly.bar.includeTc = false;

    expect(createInputSelector(barOnly)(cutting).tcActive).toBe(true);
    expect(createInputSelector(traceOnly)(cutting).tcActive).toBe(true);
  });

  it('is not read when switched off or when no throttle is shown', () => {
    const off = config();
    off.trace.includeTc = false;
    off.bar.includeTc = false;
    const noThrottle = config();
    noThrottle.trace.includeThrottle = false;
    noThrottle.bar.includeThrottle = false;

    expect(createInputSelector(off)(cutting).tcActive).toBeUndefined();
    expect(createInputSelector(noThrottle)(cutting).tcActive).toBeUndefined();
    // And so a change of it wakes nothing.
    const select = createInputSelector(gearConfig());
    expect(select(frame({ tcActive: true }))).toBe(
      select(frame({ tcActive: false }))
    );
  });

  it('stays absent under a sim that does not report it', () => {
    expect(createInputSelector(config())(frame()).tcActive).toBeUndefined();
  });
});

describe('Input selection: the bars', () => {
  const moment = frame({
    throttle: 0.4,
    throttleRaw: 1,
    brake: 0.6,
    brakeRaw: 0.7,
    clutch: 1,
    clutchRaw: 0.8,
    brakePressure: 0.55,
    ffb: -0.62,
  });

  it('selects exactly what it always did with the additions off', () => {
    const settings = config();
    settings.bar.showMaxMarker = false;
    const selected = createInputSelector(settings)(moment);

    // Compared without the keys that are present but undefined.
    expect(JSON.parse(JSON.stringify(selected))).toEqual({
      brake: 0.6,
      throttle: 0.4,
      clutch: 0,
      steer: 0.1,
      brakeAbsActive: false,
      gear: 3,
      unit: 1,
      speed: 10,
      traceTick: 1,
    });
  });

  it('reads the pedal travel for the full-travel marker in either source', () => {
    const selected = createInputSelector(config())(moment);

    // The Car source still shows what the car received...
    expect(selected).toMatchObject({ throttle: 0.4, brake: 0.6 });
    // ...and the marker goes by the pedal.
    expect(selected).toMatchObject({ throttlePedal: 1, brakePedal: 0.7 });
    expect(selected.clutchPedal).toBeCloseTo(0.2);
    expect(selected.throttleCar).toBeUndefined();
  });

  it.each([false, true])(
    'reads both strips for side-by-side bars with useRawValues %s',
    (useRawValues) => {
      const settings = config();
      settings.useRawValues = useRawValues;
      settings.bar.dual = true;
      const selected = createInputSelector(settings)(moment);

      expect(selected).toMatchObject({
        throttlePedal: 1,
        throttleCar: 0.4,
        brakePedal: 0.7,
        brakeCar: 0.6,
        clutchCar: 0,
      });
      expect(selected.clutchPedal).toBeCloseTo(0.2);
    }
  );

  it('shows the brake pressure as the car strip when asked, and the brake without a reading', () => {
    const settings = config();
    settings.bar.dual = true;
    settings.bar.brakeFromPressure = true;
    const select = createInputSelector(settings);

    expect(select(moment).brakeCar).toBe(0.55);
    expect(select({ ...moment, brakePressure: undefined }).brakeCar).toBe(0.6);
    // Not without the side-by-side bars.
    settings.bar.dual = false;
    expect(createInputSelector(settings)(moment).brakeCar).toBeUndefined();
  });

  it('gives both strips the one value there is for a watched car', () => {
    const settings = config();
    settings.bar.dual = true;
    const selected = createInputSelector(settings)({
      ...moment,
      throttleRaw: undefined,
    });

    expect(selected).toMatchObject({ throttlePedal: 0.4, throttleCar: 0.4 });
  });

  it('reads force feedback only for its bar', () => {
    const settings = config();
    expect(createInputSelector(settings)(moment).ffb).toBeUndefined();

    settings.bar.includeFfb = true;
    expect(createInputSelector(settings)(moment).ffb).toBe(-0.62);
  });

  it('reads nothing for a bar that is not shown', () => {
    const settings = config();
    settings.bar.dual = true;
    settings.bar.includeThrottle = false;
    const selected = createInputSelector(settings)(moment);

    expect(selected.throttlePedal).toBeUndefined();
    expect(selected.throttleCar).toBeUndefined();
    // The trace still draws it.
    expect(selected.throttle).toBe(0.4);
  });
});

describe('Input selection: the steering', () => {
  const radians = (deg: number) => (deg * Math.PI) / 180;
  const degrees = (rad: number | undefined) => ((rad ?? 0) * 180) / Math.PI;
  const turned = frame({
    steeringWheelAngle: radians(119),
    steeringRangeDeg: 476,
    frontWheelAngleDeg: 8.6,
    speed: 0.4,
  });
  const meterConfig = () => {
    const settings = config();
    settings.layoutTree = {
      id: 'meter',
      type: 'box',
      direction: 'row',
      widgets: ['steermeter'],
    };
    return settings;
  };

  it('draws the angle as the sim gives it with no manual range', () => {
    expect(degrees(createInputSelector(config())(turned).steer)).toBeCloseTo(
      119
    );
  });

  it('rescales the angle to a manual range', () => {
    const settings = config();
    settings.steer.rangeDeg = 900;

    // Half the lock of a 476 degree wheel is half the lock of a 900 one.
    expect(degrees(createInputSelector(settings)(turned).steer)).toBeCloseTo(
      225
    );
  });

  it.each([0, -900, Number.NaN, undefined])(
    'ignores a manual range of %s',
    (rangeDeg) => {
      const settings = config();
      settings.steer.rangeDeg = rangeDeg;

      expect(degrees(createInputSelector(settings)(turned).steer)).toBeCloseTo(
        119
      );
    }
  );

  it('leaves the angle alone when the sim states no range to rescale from', () => {
    const settings = config();
    settings.steer.rangeDeg = 900;
    const selected = createInputSelector(settings)({
      ...turned,
      steeringRangeDeg: undefined,
    });

    expect(degrees(selected.steer)).toBeCloseTo(119);
  });

  it('reads the angle and the range for the steering meter alone', () => {
    const selected = createInputSelector(meterConfig())(turned);

    expect(degrees(selected.steer)).toBeCloseTo(119);
    expect(selected.steerRangeDeg).toBe(476);
    expect(selected.throttle).toBeUndefined();
    expect(selected.traceTick).toBeUndefined();

    const manual = meterConfig();
    manual.steer.rangeDeg = 900;
    expect(createInputSelector(manual)(turned).steerRangeDeg).toBe(900);
    // No meter, no range.
    expect(createInputSelector(config())(turned).steerRangeDeg).toBeUndefined();
  });

  it('reads the front wheel angle only when asked, and never for the ring', () => {
    const settings = config();
    expect(
      createInputSelector(settings)(turned).frontWheelAngleDeg
    ).toBeUndefined();

    settings.steer.showWheelAngle = true;
    expect(createInputSelector(settings)(turned).frontWheelAngleDeg).toBe(8.6);
    // iRacing publishes no wheel angle, so there is nothing to draw.
    expect(
      createInputSelector(settings)({
        ...turned,
        frontWheelAngleDeg: undefined,
      }).frontWheelAngleDeg
    ).toBeUndefined();

    settings.steer.config = { style: 'ring', color: 'light' };
    expect(
      createInputSelector(settings)(turned).frontWheelAngleDeg
    ).toBeUndefined();
  });

  it('says whether the car is stationary only for an arc drawn at a standstill', () => {
    const settings = config();
    expect(createInputSelector(settings)(turned).stationary).toBeUndefined();
    settings.steer.rotationArc = 'always';
    expect(createInputSelector(settings)(turned).stationary).toBeUndefined();

    settings.steer.rotationArc = 'stationary';
    settings.gear.showspeed = false;
    settings.layoutTree = {
      id: 'steer',
      type: 'box',
      direction: 'row',
      widgets: ['steer'],
    };
    const select = createInputSelector(settings);
    const parked = select(turned);
    expect(parked.stationary).toBe(true);
    // Still below 1 m/s: nothing to redraw.
    expect(select({ ...turned, speed: 0.9 })).toBe(parked);
    const moving = select({ ...turned, speed: 1 });
    expect(moving.stationary).toBe(false);
    expect(select({ ...turned, speed: 60 })).toBe(moving);
  });
});
