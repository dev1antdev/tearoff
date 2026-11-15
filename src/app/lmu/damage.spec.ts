import { describe, expect, it } from 'vitest';
import { writeLmuDamage } from './damage';
import type { LmuDamageSource } from './damage';

type Frame = Record<string, { value: unknown[] }>;

/**
 * The recorded car after its hardest knock: an impact 2.45 m ahead of the
 * car's origin and a little to its right, which raised the first dent
 * level. Nothing detached, nothing flat.
 */
const dented = (): Required<LmuDamageSource> => ({
  dentSeverity: new Uint8Array([1, 0, 0, 0, 0, 0, 0, 0]),
  detached: false,
  overheating: false,
  lastImpactPos: new Float64Array([-0.567, -0.153, -2.453]),
  tyreFlat: new Uint8Array([0, 0, 0, 0]),
  wheelDetached: new Uint8Array([0, 0, 0, 0]),
});

const write = (raw: LmuDamageSource): Frame => {
  const frame: Frame = {};
  writeLmuDamage(frame, raw);
  return frame;
};

describe('writeLmuDamage', () => {
  it('publishes the dent level of each of the eight body parts', () => {
    expect(write(dented()).LmuDentSeverity.value).toEqual([
      1, 0, 0, 0, 0, 0, 0, 0,
    ]);
    expect(
      write({
        ...dented(),
        dentSeverity: new Uint8Array([2, 1, 0, 0, 0, 0, 1, 0]),
      }).LmuDentSeverity.value
    ).toEqual([2, 1, 0, 0, 0, 0, 1, 0]);
  });

  it('publishes where the last impact landed, in the sim’s car axes', () => {
    // x, y, z as the sim has them: the nose is negative z.
    expect(write(dented()).LmuLastImpactPos.value).toEqual([
      -0.567, -0.153, -2.453,
    ]);
  });

  it('publishes zeros for the position until the first impact', () => {
    // What the sim holds before anything has hit the car; LmuLastImpactTime
    // is 0 with it, and that is what says there has been none.
    const frame = write({
      ...dented(),
      lastImpactPos: new Float64Array([0, 0, 0]),
    });

    expect(frame.LmuLastImpactPos.value).toEqual([0, 0, 0]);
  });

  it('publishes the two warnings as booleans', () => {
    const fine = write(dented());
    expect(fine.LmuBodyDetached.value).toEqual([false]);
    expect(fine.LmuOverheating.value).toEqual([false]);

    const broken = write({ ...dented(), detached: true, overheating: true });
    expect(broken.LmuBodyDetached.value).toEqual([true]);
    expect(broken.LmuOverheating.value).toEqual([true]);
  });

  it('publishes a flat tyre and a lost wheel per wheel, LF RF LR RR', () => {
    const frame = write({
      ...dented(),
      // The right front is flat, and the left rear has come off.
      tyreFlat: new Uint8Array([0, 1, 0, 0]),
      wheelDetached: new Uint8Array([0, 0, 1, 0]),
    });

    expect(frame.LmuTyreFlat.value).toEqual([false, true, false, false]);
    expect(frame.LmuWheelDetached.value).toEqual([false, false, true, false]);
  });

  it('publishes nothing with no player car', () => {
    // The sim writes none of the fields then, and absent is not undamaged.
    expect(write({})).toEqual({});
  });

  it.each([
    ['dentSeverity', 'LmuDentSeverity'],
    ['detached', 'LmuBodyDetached'],
    ['overheating', 'LmuOverheating'],
    ['lastImpactPos', 'LmuLastImpactPos'],
    ['tyreFlat', 'LmuTyreFlat'],
    ['wheelDetached', 'LmuWheelDetached'],
  ] as const)('leaves out only %s’s key when it is missing', (field, key) => {
    const frame = write({ ...dented(), [field]: undefined });

    expect(frame[key]).toBeUndefined();
    expect(Object.keys(frame)).toHaveLength(5);
  });

  it('reads nothing from a position or a set of wheels that is short', () => {
    const frame = write({
      ...dented(),
      lastImpactPos: new Float64Array([-0.567, -0.153]),
      tyreFlat: new Uint8Array([0, 1, 0]),
      wheelDetached: new Uint8Array([]),
      dentSeverity: new Uint8Array([]),
    });

    expect(frame.LmuLastImpactPos).toBeUndefined();
    expect(frame.LmuTyreFlat).toBeUndefined();
    expect(frame.LmuWheelDetached).toBeUndefined();
    expect(frame.LmuDentSeverity).toBeUndefined();
  });

  it('publishes the same cells from frame to frame while nothing moves', () => {
    // Damage moves a handful of times a race, and this runs 64 times a
    // second.
    const first = write(dented());
    const second = write(dented());

    expect(second.LmuDentSeverity).toBe(first.LmuDentSeverity);
    expect(second.LmuLastImpactPos).toBe(first.LmuLastImpactPos);
    expect(second.LmuTyreFlat).toBe(first.LmuTyreFlat);
    expect(second.LmuWheelDetached).toBe(first.LmuWheelDetached);
  });

  it('publishes a new cell on a new impact, leaving the old one as it was', () => {
    const before = write(dented());
    const after = write({
      ...dented(),
      lastImpactPos: new Float64Array([0.048, -0.102, -2.538]),
      dentSeverity: new Uint8Array([2, 0, 0, 0, 0, 0, 0, 0]),
    });

    expect(after.LmuLastImpactPos).not.toBe(before.LmuLastImpactPos);
    expect(after.LmuLastImpactPos.value).toEqual([0.048, -0.102, -2.538]);
    expect(before.LmuLastImpactPos.value).toEqual([-0.567, -0.153, -2.453]);
    expect(after.LmuDentSeverity.value[0]).toBe(2);
    expect(before.LmuDentSeverity.value[0]).toBe(1);
    // The wheels did not change.
    expect(after.LmuTyreFlat).toBe(before.LmuTyreFlat);
  });
});
