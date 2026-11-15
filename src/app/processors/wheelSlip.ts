/**
 * Rolling radius and slip ratio of the player's wheels.
 *
 * The sim states how fast each wheel turns and how fast the car travels, but
 * not the radius that relates the two: the tyre's static radius is given in
 * whole centimetres, and a loaded tyre rolls on less than that. So the radius
 * is learnt per axle while the car runs straight, and a wheel's slip is how
 * far its rim speed sits from the car's speed.
 *
 * One estimate for every display, so that two of them never disagree about
 * whether a wheel is locked.
 *
 * Wheels are LF, RF, LR, RR; axles are front, rear. Wheel rotation is rad/s
 * and may carry either sign (Le Mans Ultimate reads negative rolling
 * forwards): only its size is used, and an axle whose wheels turn opposite
 * ways is not learnt from.
 */

/** Below this the car is not moving enough for a ratio to mean anything. */
export const SLIP_MIN_SPEED = 1;
/** An axle turning slower than this, rad/s, teaches nothing. */
const LEARN_MIN_ROTATION = 4;
/** The two wheels of an axle agree to within this share: a straight line. */
const LEARN_MAX_WHEEL_DIFFERENCE = 0.002;
/** A wheel is locked when its slip ratio is below minus this. */
export const WHEEL_LOCK_SLIP = 0.3;

const AXLES = 2;

export interface WheelSlipState {
  /** Learnt rolling radius per axle, m: front, rear. 0 while unknown. */
  readonly radius: number[];
  /** The static radius each axle was last seeded from, m. 0 for none. */
  readonly seed: number[];
}

export const createWheelSlipState = (): WheelSlipState => ({
  radius: [0, 0],
  seed: [0, 0],
});

export const resetWheelSlip = (state: WheelSlipState): void => {
  for (let axle = 0; axle < AXLES; axle += 1) {
    state.radius[axle] = 0;
    state.seed[axle] = 0;
  }
};

const positive = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;

/**
 * Starts each axle's radius from the tyres' static radius (m, per wheel), so
 * that the first braking zone of a stint is not measured against nothing.
 * An axle is seeded again only when its static radius changes: a different
 * set of tyres. Readings that are missing or not above 0 are ignored.
 */
export const seedWheelRadius = (
  state: WheelSlipState,
  staticRadius: ArrayLike<unknown> | undefined
): void => {
  if (!staticRadius || staticRadius.length < AXLES * 2) return;
  for (let axle = 0; axle < AXLES; axle += 1) {
    const left = positive(staticRadius[axle * 2]);
    const right = positive(staticRadius[axle * 2 + 1]);
    if (left === 0 || right === 0) continue;
    const seed = (left + right) / 2;
    if (seed === state.seed[axle]) continue;
    state.seed[axle] = seed;
    state.radius[axle] = seed;
  }
};

/**
 * Moves each axle's radius towards speed over rotation, on a frame in which
 * the axle is rolling straight: the car above 1 m/s, the axle's mean rotation
 * beyond 4 rad/s, and its two wheels within 0.2 % of each other.
 *
 * The step is 2 / max(40 x |lateral|, 40 x |longitudinal|, 20) of the
 * difference, with the accelerations in m/s2: a tenth at most, and less the
 * harder the car is cornering, braking or accelerating, when the tyres are
 * slipping and the ratio says least about the radius.
 */
export const learnWheelRadius = (
  state: WheelSlipState,
  rotation: ArrayLike<number>,
  speed: number,
  latAccel: number,
  longAccel: number
): void => {
  if (!(speed > SLIP_MIN_SPEED)) return;
  const step =
    2 / Math.max(40 * Math.abs(latAccel), 40 * Math.abs(longAccel), 20);
  if (!Number.isFinite(step)) return;
  for (let axle = 0; axle < AXLES; axle += 1) {
    const left = rotation[axle * 2];
    const right = rotation[axle * 2 + 1];
    const mean = Math.abs((left + right) / 2);
    if (!(mean > LEARN_MIN_ROTATION)) continue;
    if (!(Math.abs(left - right) / mean < LEARN_MAX_WHEEL_DIFFERENCE)) continue;
    const target = speed / mean;
    const current = state.radius[axle];
    state.radius[axle] =
      current > 0 ? current + (target - current) * step : target;
  }
};

/** Whether the axle a wheel is on has a radius to measure against. */
export const hasWheelRadius = (state: WheelSlipState, wheel: number): boolean =>
  state.radius[wheel >> 1] > 0;

/**
 * A wheel's slip ratio: rim speed over road speed, minus 1. 0 is rolling
 * freely, -1 a locked wheel, above 0 a spinning one.
 *
 * 0 below 1 m/s, and 0 while the wheel's axle has no radius: an unknown
 * radius is not a locked wheel. `hasWheelRadius` tells the two apart.
 */
export const wheelSlipRatio = (
  state: WheelSlipState,
  wheel: number,
  rotation: number,
  speed: number
): number => {
  const radius = state.radius[wheel >> 1];
  if (!(speed > SLIP_MIN_SPEED) || !(radius > 0)) return 0;
  return (Math.abs(rotation) * radius) / speed - 1;
};
