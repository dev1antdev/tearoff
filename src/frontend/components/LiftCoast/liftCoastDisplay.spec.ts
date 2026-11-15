import { describe, expect, it } from 'vitest';
import {
  getWidgetDefaultConfig,
  type DriverControlsSnapshot,
  type LiftCoastConfig,
} from '@irdashies/types';
import {
  clampLightCount,
  createLiftCoastSelector,
  lightTone,
} from './liftCoastDisplay';

const DEFAULTS = getWidgetDefaultConfig('liftcoast');

/** Ten lights, critical above 0.8: the defaults. */
const select = (
  snapshot: Partial<DriverControlsSnapshot>,
  config: Partial<LiftCoastConfig> = {}
) =>
  createLiftCoastSelector({ ...DEFAULTS, ...config })({
    version: 1,
    ...snapshot,
  });

/** The fraction the mapper publishes for a byte of the sim's. */
const byte = (value: number) => value / 255;

describe('the lift-and-coast strip', () => {
  it('is dark without a signal', () => {
    expect(select({ liftAndCoast: 0 })).toEqual({
      lit: 0,
      critical: false,
      override: null,
    });
  });

  it('is dark under a sim or an addon that publishes no signal', () => {
    expect(select({})).toEqual({ lit: 0, critical: false, override: null });
  });

  it.each([
    // The smallest signal there is lights one light.
    [1, 1, false],
    [128, 6, false],
    // 0.8 exactly: eight lights, and still below the critical share.
    [204, 8, false],
    // One step past it: the ninth light, and the colour changes.
    [205, 9, true],
    [255, 10, true],
  ])('byte %i lights %i of ten', (value, lit, critical) => {
    expect(select({ liftAndCoast: byte(value) })).toEqual({
      lit,
      critical,
      override: null,
    });
  });

  it('lights half the strip at half the signal', () => {
    expect(select({ liftAndCoast: 0.5 })).toMatchObject({
      lit: 5,
      critical: false,
    });
  });

  it('never lights one light more than the share comes to', () => {
    // 0.2 of 15 is 3.0000000000000004 as the machine multiplies it.
    expect(select({ liftAndCoast: byte(51) }, { ledCount: 15 }).lit).toBe(3);
    expect(select({ liftAndCoast: byte(153) }, { ledCount: 20 }).lit).toBe(12);
  });

  it('changes colour where the critical share is set', () => {
    expect(
      select({ liftAndCoast: 0.6 }, { criticalFraction: 0.5 }).critical
    ).toBe(true);
    expect(
      select({ liftAndCoast: 0.95 }, { criticalFraction: 1 }).critical
    ).toBe(false);
  });

  it('gives the whole strip to traction control while it cuts', () => {
    expect(select({ liftAndCoast: 0.6, tcActive: true })).toEqual({
      lit: 10,
      critical: false,
      override: 'tc',
    });
  });

  it('gives it to ABS over traction control', () => {
    expect(select({ tcActive: true, brakeAbsActive: true }).override).toBe(
      'abs'
    );
  });

  it('shows the progressive stage through an assist that is switched off', () => {
    expect(
      select({ liftAndCoast: 0.6, tcActive: true }, { showTc: false })
    ).toEqual({ lit: 6, critical: false, override: null });
    expect(
      select({ liftAndCoast: 0.6, brakeAbsActive: true }, { showAbs: false })
    ).toEqual({ lit: 6, critical: false, override: null });
  });

  it('lights nothing progressive with that stage switched off', () => {
    expect(select({ liftAndCoast: 0.9 }, { showLiftAndCoast: false })).toEqual({
      lit: 0,
      critical: false,
      override: null,
    });
    // The assists still have the strip.
    expect(
      select({ liftAndCoast: 0.9, tcActive: true }, { showLiftAndCoast: false })
        .override
    ).toBe('tc');
  });

  describe('with a slip ratio, once something publishes one', () => {
    const lock = { showWheelLock: true };
    const slip = { showWheelSlip: true };

    it('calls a lock on a wheel well under road speed with the brake on', () => {
      expect(
        select({ slipRatioMin: -0.35, brakeRaw: 0.5 }, lock).override
      ).toBe('lock');
    });

    it('leaves a wheel that ABS is working on to ABS', () => {
      expect(
        select(
          { slipRatioMin: -0.35, brakeRaw: 0.5, brakeAbsActive: true },
          lock
        ).override
      ).toBe('abs');
    });

    it('calls no lock off the brake, or short of the threshold', () => {
      expect(
        select({ slipRatioMin: -0.35, brakeRaw: 0.01 }, lock).override
      ).toBeNull();
      expect(
        select({ slipRatioMin: -0.25, brakeRaw: 0.5 }, lock).override
      ).toBeNull();
    });

    it('calls wheelspin on a wheel over road speed with the throttle on', () => {
      expect(
        select({ slipRatioMax: 0.2, throttleRaw: 0.8 }, slip).override
      ).toBe('slip');
    });

    it('calls no wheelspin with the throttle all but closed', () => {
      expect(
        select({ slipRatioMax: 0.2, throttleRaw: 0.01 }, slip).override
      ).toBeNull();
    });

    it('leaves a wheel that traction control is cutting to traction control', () => {
      expect(
        select({ slipRatioMax: 0.2, throttleRaw: 0.8, tcActive: true }, slip)
          .override
      ).toBe('tc');
    });

    it('ignores both while their stages are off, as they are by default', () => {
      expect(select({ slipRatioMin: -0.9, brakeRaw: 1 }).override).toBeNull();
      expect(select({ slipRatioMax: 0.9, throttleRaw: 1 }).override).toBeNull();
    });
  });

  it('returns the same object while no light changes', () => {
    const selector = createLiftCoastSelector(DEFAULTS);
    const first = selector({ liftAndCoast: byte(100), version: 1 });
    // Three bytes further up, still four lights.
    const second = selector({
      liftAndCoast: byte(102),
      throttle: 0.3,
      version: 2,
    });
    expect(second).toBe(first);

    const third = selector({ liftAndCoast: byte(103), version: 3 });
    expect(third).not.toBe(first);
    expect(third.lit).toBe(5);
  });

  it('colours each light from the state of the strip', () => {
    const building = { lit: 3, critical: false, override: null };
    expect(lightTone(building, 2)).toBe('low');
    expect(lightTone(building, 3)).toBe('off');
    expect(lightTone({ ...building, critical: true }, 0)).toBe('critical');
    // An override has every light, lit or not.
    expect(lightTone({ lit: 10, critical: false, override: 'abs' }, 9)).toBe(
      'abs'
    );
  });

  it('keeps a saved light count inside what the strip can draw', () => {
    expect(clampLightCount(1)).toBe(3);
    expect(clampLightCount(64)).toBe(20);
    expect(clampLightCount(7.6)).toBe(8);
    expect(clampLightCount(undefined)).toBe(10);
    expect(clampLightCount(Number.NaN)).toBe(10);
  });
});
