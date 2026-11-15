import { describe, expect, it } from 'vitest';
import {
  createWheelSlipState,
  hasWheelRadius,
  learnWheelRadius,
  resetWheelSlip,
  seedWheelRadius,
  wheelSlipRatio,
} from './wheelSlip';

/** Le Mans Ultimate's sign: negative rolling forwards. */
const rolling = (front: number, rear = front): number[] => [
  -front,
  -front,
  -rear,
  -rear,
];

describe('the rolling radius', () => {
  it('is unknown until it is seeded or learnt', () => {
    const state = createWheelSlipState();

    expect(state.radius).toEqual([0, 0]);
    expect(hasWheelRadius(state, 0)).toBe(false);
    expect(hasWheelRadius(state, 3)).toBe(false);
  });

  it('is seeded per axle from the static radius', () => {
    const state = createWheelSlipState();
    seedWheelRadius(state, [0.34, 0.34, 0.36, 0.36]);

    expect(state.radius).toEqual([0.34, 0.36]);
    expect(hasWheelRadius(state, 1)).toBe(true);
    expect(hasWheelRadius(state, 2)).toBe(true);
  });

  it('is not put back to the seed while the static radius stands', () => {
    const state = createWheelSlipState();
    seedWheelRadius(state, [0.34, 0.34, 0.36, 0.36]);
    state.radius[0] = 0.337;

    seedWheelRadius(state, [0.34, 0.34, 0.36, 0.36]);

    expect(state.radius[0]).toBe(0.337);
  });

  it('is seeded again when the static radius changes', () => {
    const state = createWheelSlipState();
    seedWheelRadius(state, [0.34, 0.34, 0.36, 0.36]);
    state.radius[0] = 0.337;
    state.radius[1] = 0.341;

    // Different fronts; the rears are the same tyres.
    seedWheelRadius(state, [0.35, 0.35, 0.36, 0.36]);

    expect(state.radius).toEqual([0.35, 0.341]);
  });

  it('ignores a static radius that is missing or not a size', () => {
    const state = createWheelSlipState();
    seedWheelRadius(state, undefined);
    seedWheelRadius(state, [0.34, 0.34]);
    seedWheelRadius(state, [0, 0, Number.NaN, 0.36]);

    expect(state.radius).toEqual([0, 0]);
  });

  it('moves a tenth of the way to speed over rotation on a straight', () => {
    const state = createWheelSlipState();
    seedWheelRadius(state, [0.34, 0.34, 0.36, 0.36]);

    // 50 m/s at 150 rad/s is a radius of a third of a metre.
    learnWheelRadius(state, rolling(150), 50, 0, 0);

    expect(state.radius[0]).toBeCloseTo(0.34 + (1 / 3 - 0.34) * 0.1, 10);
    expect(state.radius[1]).toBeCloseTo(0.36 + (1 / 3 - 0.36) * 0.1, 10);
  });

  it('settles on the radius the car is rolling on', () => {
    const state = createWheelSlipState();
    seedWheelRadius(state, [0.34, 0.34, 0.36, 0.36]);

    for (let frame = 0; frame < 200; frame += 1) {
      learnWheelRadius(state, rolling(50 / 0.337, 50 / 0.341), 50, 0.2, 0.3);
    }

    expect(state.radius[0]).toBeCloseTo(0.337, 6);
    expect(state.radius[1]).toBeCloseTo(0.341, 6);
  });

  it('learns less the harder the car is cornering or braking', () => {
    const cornering = createWheelSlipState();
    const braking = createWheelSlipState();
    seedWheelRadius(cornering, [0.34, 0.34, 0.36, 0.36]);
    seedWheelRadius(braking, [0.34, 0.34, 0.36, 0.36]);

    // 2 / (40 x 10) is a two-hundredth of the difference.
    learnWheelRadius(cornering, rolling(150), 50, -10, 0);
    learnWheelRadius(braking, rolling(150), 50, 0, -10);

    const expected = 0.34 + (1 / 3 - 0.34) * 0.005;
    expect(cornering.radius[0]).toBeCloseTo(expected, 10);
    expect(braking.radius[0]).toBeCloseTo(expected, 10);
  });

  it('takes the first straight outright when nothing seeded it', () => {
    const state = createWheelSlipState();

    learnWheelRadius(state, rolling(150), 50, 0, 0);

    expect(state.radius[0]).toBeCloseTo(1 / 3, 10);
    expect(state.radius[1]).toBeCloseTo(1 / 3, 10);
  });

  it('does not learn from an axle whose wheels disagree', () => {
    const state = createWheelSlipState();
    seedWheelRadius(state, [0.34, 0.34, 0.36, 0.36]);

    // The fronts half a percent apart, as in a corner; the rears together.
    learnWheelRadius(state, [-150, -150.75, -150, -150], 50, 0, 0);

    expect(state.radius[0]).toBe(0.34);
    expect(state.radius[1]).not.toBe(0.36);
  });

  it('does not learn from a locked wheel, a slow axle or a slow car', () => {
    const state = createWheelSlipState();
    seedWheelRadius(state, [0.34, 0.34, 0.36, 0.36]);

    learnWheelRadius(state, [-10, -100, -3, -3], 34, 0, -15);
    expect(state.radius).toEqual([0.34, 0.36]);

    learnWheelRadius(state, rolling(100), 0.9, 0, 0);
    expect(state.radius).toEqual([0.34, 0.36]);
  });

  it('reads wheels turning the other way round the same', () => {
    const forwards = createWheelSlipState();
    const reversed = createWheelSlipState();

    learnWheelRadius(forwards, [-150, -150, -150, -150], 50, 0, 0);
    learnWheelRadius(reversed, [150, 150, 150, 150], 50, 0, 0);

    expect(reversed.radius).toEqual(forwards.radius);
  });

  it('is forgotten on reset, seed included', () => {
    const state = createWheelSlipState();
    seedWheelRadius(state, [0.34, 0.34, 0.36, 0.36]);

    resetWheelSlip(state);
    expect(state.radius).toEqual([0, 0]);

    // The same tyres seed it again.
    seedWheelRadius(state, [0.34, 0.34, 0.36, 0.36]);
    expect(state.radius).toEqual([0.34, 0.36]);
  });
});

describe('the slip ratio', () => {
  const seeded = () => {
    const state = createWheelSlipState();
    seedWheelRadius(state, [0.34, 0.34, 0.36, 0.36]);
    return state;
  };

  it('is zero for a wheel rolling at the speed of the car', () => {
    expect(wheelSlipRatio(seeded(), 0, -100, 34)).toBeCloseTo(0, 10);
  });

  it('is minus one for a locked wheel', () => {
    expect(wheelSlipRatio(seeded(), 0, 0, 34)).toBe(-1);
  });

  it('is negative for a wheel turning slower than the road', () => {
    // A tenth of the rim speed the car is doing.
    expect(wheelSlipRatio(seeded(), 1, -10, 34)).toBeCloseTo(-0.9, 10);
  });

  it('is positive for a spinning wheel', () => {
    expect(wheelSlipRatio(seeded(), 2, -150, 36)).toBeCloseTo(0.5, 10);
  });

  it('uses the radius of the axle the wheel is on', () => {
    const state = seeded();

    expect(wheelSlipRatio(state, 1, -100, 34)).toBeCloseTo(0, 10);
    expect(wheelSlipRatio(state, 3, -100, 34)).toBeCloseTo(0.36 / 0.34 - 1, 10);
  });

  it('is zero below one metre a second', () => {
    expect(wheelSlipRatio(seeded(), 0, 0, 1)).toBe(0);
    expect(wheelSlipRatio(seeded(), 0, 0, 0)).toBe(0);
  });

  it('is zero, not a lock, while the axle has no radius', () => {
    const state = createWheelSlipState();

    expect(wheelSlipRatio(state, 0, -100, 34)).toBe(0);
    expect(hasWheelRadius(state, 0)).toBe(false);
  });
});
