import { describe, expect, it } from 'vitest';
import {
  ENERGY_UNAVAILABLE,
  createLmuEnergyState,
  lmuEnergyChannels,
  lmuEnergyRemaining,
  lmuFuelFraction,
  resetLmuEnergyState,
} from './fuelEnergy';

describe('lmuFuelFraction', () => {
  it('divides the byte by 255, which is how the sim quantises it', () => {
    // Not a percentage, which an earlier note in this repo guessed at.
    expect(lmuFuelFraction(255)).toBe(1);
    expect(lmuFuelFraction(0)).toBe(0);
    expect(lmuFuelFraction(128)).toBeCloseTo(0.502, 3);
  });

  it('clamps a reading above the top of the scale', () => {
    expect(lmuFuelFraction(300)).toBe(1);
  });

  it('has no answer for a reading that cannot be fuel', () => {
    expect(lmuFuelFraction(-1)).toBeUndefined();
    expect(lmuFuelFraction(NaN)).toBeUndefined();
    expect(lmuFuelFraction(undefined)).toBeUndefined();
  });
});

describe('lmuEnergyRemaining', () => {
  it('prefers virtual energy, which is what limits an energy car', () => {
    // A Hypercar's stint ends on energy; its fuel figure is not the budget.
    expect(lmuEnergyRemaining(255, 0.42)).toBe(0.42);
  });

  it('falls back to fuel for a car with no virtual energy', () => {
    // A GTE reports 0 rather than nothing, so 0 has to mean "not an energy
    // car" here or every GTE would read empty.
    expect(lmuEnergyRemaining(255, 0)).toBe(1);
    expect(lmuEnergyRemaining(51, undefined)).toBeCloseTo(0.2, 6);
  });

  it('reports unavailable rather than empty when neither reads', () => {
    expect(lmuEnergyRemaining(0, 0)).toBe(ENERGY_UNAVAILABLE);
    expect(lmuEnergyRemaining(undefined, undefined)).toBe(ENERGY_UNAVAILABLE);
    expect(lmuEnergyRemaining(undefined, -1)).toBe(ENERGY_UNAVAILABLE);
  });

  it('clamps virtual energy to the fraction it claims to be', () => {
    expect(lmuEnergyRemaining(0, 1.5)).toBe(1);
  });
});

describe('lmuEnergyChannels', () => {
  it('reads both budgets per car and says which each figure is', () => {
    // Car 0 is energy-limited, car 1 runs on fuel, car 2 has neither.
    expect(lmuEnergyChannels([255, 51, 0], [0.42, 0, 0])).toEqual({
      remaining: [0.42, lmuFuelFraction(51), ENERGY_UNAVAILABLE],
      isVirtual: [true, false, false],
    });
  });

  it('covers every slot when one array is shorter', () => {
    expect(lmuEnergyChannels([255, 255], [0.5])).toEqual({
      remaining: [0.5, 1],
      isVirtual: [true, false],
    });
  });

  it('is empty when the sim reports nothing', () => {
    expect(lmuEnergyChannels(undefined, undefined)).toEqual({
      remaining: [],
      isVirtual: [],
    });
  });

  it('matches the recorded ELMS grid: GT3 on energy, prototypes on fuel', () => {
    // From the recorded session: the player's LMGT3 read 0.45 virtual energy
    // with a fuel byte of 95, an LMP2 in the same grid read exactly 0 with a
    // fuel byte of 109.
    const { remaining, isVirtual } = lmuEnergyChannels([95, 109], [0.45, 0]);

    expect(remaining[0]).toBe(0.45);
    expect(isVirtual[0]).toBe(true);
    expect(remaining[1]).toBeCloseTo(109 / 255, 6);
    expect(isVirtual[1]).toBe(false);
  });
});

/**
 * The memory that tells an energy car which has run dry from a car that never
 * had virtual energy. Both read 0.
 */
describe('lmuEnergyChannels with a state', () => {
  it('reads 0 for an energy car that has run out', () => {
    // Without the memory this fell back to fuel and showed a healthy figure
    // at the one moment the number mattered.
    const state = createLmuEnergyState();
    lmuEnergyChannels([200], [0.03], state);

    expect(lmuEnergyChannels([180], [0], state)).toEqual({
      remaining: [0],
      isVirtual: [true],
    });
  });

  it('still reads fuel for a car never seen with virtual energy', () => {
    const state = createLmuEnergyState();
    lmuEnergyChannels([200], [0], state);

    expect(lmuEnergyChannels([180], [0], state)).toEqual({
      remaining: [lmuFuelFraction(180)],
      isVirtual: [false],
    });
  });

  it('holds the last reading through a frame with no telemetry block', () => {
    // The sim writes -1 for a car it sent no telemetry for that frame. The
    // car has not turned into a fuel car in the meantime.
    const state = createLmuEnergyState();
    lmuEnergyChannels([200], [0.61], state);

    expect(lmuEnergyChannels([200], [-1], state)).toEqual({
      remaining: [0.61],
      isVirtual: [true],
    });
  });

  it('remembers each car separately', () => {
    const state = createLmuEnergyState();
    lmuEnergyChannels([200, 200], [0.5, 0], state);

    const { remaining, isVirtual } = lmuEnergyChannels(
      [100, 100],
      [0, 0],
      state
    );

    expect(isVirtual).toEqual([true, false]);
    expect(remaining[0]).toBe(0);
    expect(remaining[1]).toBeCloseTo(100 / 255, 6);
  });

  it('forgets everything when reset, as car slots are reused', () => {
    const state = createLmuEnergyState();
    lmuEnergyChannels([200], [0.5], state);
    resetLmuEnergyState(state);

    expect(lmuEnergyChannels([180], [0], state).isVirtual).toEqual([false]);
  });
});
