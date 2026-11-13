import { describe, expect, it } from 'vitest';
import {
  lmuTyreOptimalTemperatures,
  lmuTyreZoneTemperatures,
  lmuWheelTemperatures,
} from './tyreState';

const kelvin = (celsius: number) => celsius + 273.15;

describe('lmuWheelTemperatures', () => {
  it('converts Kelvin to Celsius per wheel', () => {
    // A recorded GT3 brake ran 434 to 950: Kelvin, whatever the inherited
    // rFactor 2 header says about Celsius.
    const result = lmuWheelTemperatures(
      new Float64Array([434.0972, 950.545, 600, 500])
    );

    expect(result?.[0]).toBeCloseTo(160.9472);
    expect(result?.[1]).toBeCloseTo(677.395);
  });

  it('reads nothing from an unwritten block', () => {
    // Zero is what a struct holds before the sim writes it, and an empty
    // reading must not be drawn as a tyre at -273 C.
    expect(lmuWheelTemperatures(new Float64Array(4))).toBeUndefined();
  });

  it('reads nothing when one wheel is missing', () => {
    expect(
      lmuWheelTemperatures(new Float64Array([350, 350, 0, 350]))
    ).toBeUndefined();
  });

  it('reads nothing from a short or absent array', () => {
    expect(lmuWheelTemperatures(new Float64Array([350, 350]))).toBeUndefined();
    expect(lmuWheelTemperatures(undefined)).toBeUndefined();
  });
});

describe('lmuTyreZoneTemperatures', () => {
  // Left, centre, right as the car sees them, per wheel: LF, RF, LR, RR.
  const raw = new Float64Array(
    [
      [60, 70, 80],
      [61, 71, 81],
      [62, 72, 82],
      [63, 73, 83],
    ]
      .flat()
      .map(kelvin)
  );

  it('keeps left-to-right as outer-to-inner on the left wheels', () => {
    const zones = lmuTyreZoneTemperatures(raw);

    expect(zones?.slice(0, 3).map(Math.round)).toEqual([60, 70, 80]);
    expect(zones?.slice(6, 9).map(Math.round)).toEqual([62, 72, 82]);
  });

  it('reverses the zones on the right wheels', () => {
    // The right wheel's left zone faces the middle of the car: it is the
    // inner shoulder, so it moves to the end.
    const zones = lmuTyreZoneTemperatures(raw);

    expect(zones?.slice(3, 6).map(Math.round)).toEqual([81, 71, 61]);
    expect(zones?.slice(9, 12).map(Math.round)).toEqual([83, 73, 63]);
  });

  it('reads nothing unless every zone of every wheel is there', () => {
    const partial = Float64Array.from(raw);
    partial[7] = 0;

    expect(lmuTyreZoneTemperatures(partial)).toBeUndefined();
    expect(lmuTyreZoneTemperatures(new Float64Array(4))).toBeUndefined();
    expect(lmuTyreZoneTemperatures(undefined)).toBeUndefined();
  });
});

describe('lmuTyreOptimalTemperatures', () => {
  it('passes the value through, which is Celsius already', () => {
    // A steady 92 on the recorded medium compound.
    expect(
      lmuTyreOptimalTemperatures(new Float64Array([92, 92, 92, 92]))
    ).toEqual([92, 92, 92, 92]);
  });

  it('reads nothing when the sim states no optimum', () => {
    expect(lmuTyreOptimalTemperatures(new Float64Array(4))).toBeUndefined();
    expect(lmuTyreOptimalTemperatures(undefined)).toBeUndefined();
  });
});
