import { asRead, createHeldCell, holdCell } from './heldCell';
import { isReading } from './readings';
import { TYRE_WHEEL_COUNT } from './tyreState';

/**
 * The player's wheels and suspension, and the last knock the chassis took,
 * from the player's block of LMU's telemetry.
 *
 * Units and signs were measured on a recorded LMGT3 race and checked against
 * the car's setup screen, not taken from the rFactor 2 header:
 *
 * - ride height, suspension travel, tyre deflection and the third springs
 *   arrive in metres and go out in millimetres;
 * - camber and toe arrive in radians and go out in degrees, with the sim's
 *   signs: camber is negative with the top of the wheel leaning in, on both
 *   sides, and toe is positive for a wheel pointing to the right, so toe-in
 *   is positive on a left wheel and negative on a right one. The fronts' toe
 *   includes the steering angle;
 * - wheel rotation is radians a second, negative rolling forwards;
 * - the static tyre radius arrives in whole centimetres and goes out in
 *   metres.
 *
 * Wheels are LF, RF, LR, RR throughout.
 *
 * A reading the sim does not publish is left at 0 on all four wheels: the
 * recorded sim does that with tyre load for every car, and with camber, toe
 * and the third springs for every car but the player's. So a quantity that is
 * never 0 on all four wheels of a real car is left out when it reads that
 * way, and a consumer can tell "withheld" from "zero". Suspension force, tyre
 * deflection and wheel rotation are not among them: a car on its jacks, off
 * the ground or standing still reads 0 for those, and it is published.
 */

/** The fields of a shared-memory read the wheel channels are built from. */
export interface LmuWheelDynamicsSource {
  wheelRideHeight?: ArrayLike<number>;
  suspensionDeflection?: ArrayLike<number>;
  suspensionForce?: ArrayLike<number>;
  tyreLoad?: ArrayLike<number>;
  tyreVerticalDeflection?: ArrayLike<number>;
  wheelCamber?: ArrayLike<number>;
  wheelToe?: ArrayLike<number>;
  wheelRotation?: ArrayLike<number>;
  tyreStaticRadius?: ArrayLike<number>;
  wheelSurfaceType?: ArrayLike<number>;
  front3rdDeflection?: number;
  rear3rdDeflection?: number;
  lastImpactET?: number;
  lastImpactMagnitude?: number;
}

type Wheels = ArrayLike<number> | undefined;

const MM_PER_M = 1000;
const DEG_PER_RAD = 180 / Math.PI;
const CM_PER_M = 100;

/** Whether the read carries a number for each of the four wheels. */
const hasFourWheels = (raw: Wheels): raw is ArrayLike<number> => {
  if (!raw || raw.length < TYRE_WHEEL_COUNT) return false;
  for (let wheel = 0; wheel < TYRE_WHEEL_COUNT; wheel += 1) {
    if (!Number.isFinite(raw[wheel])) return false;
  }
  return true;
};

/** Every wheel at exactly 0, which is how the sim leaves what it withholds. */
const allZero = (raw: ArrayLike<number>): boolean =>
  raw[0] === 0 && raw[1] === 0 && raw[2] === 0 && raw[3] === 0;

const scaled = (raw: ArrayLike<number>, scale: number): number[] => {
  const out = new Array<number>(TYRE_WHEEL_COUNT);
  for (let wheel = 0; wheel < TYRE_WHEEL_COUNT; wheel += 1) {
    out[wheel] = raw[wheel] * scale;
  }
  return out;
};

/**
 * Four readings of a quantity for which 0 is a reading. Undefined unless all
 * four wheels read, so a consumer never handles a car with three.
 */
const wheelReadings = (raw: Wheels, scale: number): number[] | undefined =>
  hasFourWheels(raw) ? scaled(raw, scale) : undefined;

/** The same for a quantity that is never 0 on all four wheels of a car. */
const publishedWheelReadings = (
  raw: Wheels,
  scale: number
): number[] | undefined =>
  hasFourWheels(raw) && !allZero(raw) ? scaled(raw, scale) : undefined;

/**
 * Ride height at each wheel, mm. Not floored at 0: the recorded car reads
 * 1.5 mm below the road on two frames.
 */
export const lmuWheelRideHeights = (raw: Wheels): number[] | undefined =>
  publishedWheelReadings(raw, MM_PER_M);

/**
 * Suspension travel at each wheel, mm. The recorded car never reads below
 * 50 mm, with a wheel in the air included, so four zeros are a block the sim
 * has not written and not four dampers.
 */
export const lmuSuspensionPositions = (raw: Wheels): number[] | undefined =>
  publishedWheelReadings(raw, MM_PER_M);

/** Pushrod load at each wheel, N. Negative on a drooping wheel. */
export const lmuSuspensionForces = (raw: Wheels): number[] | undefined =>
  wheelReadings(raw, 1);

/**
 * Tyre load at each wheel, N, when the sim publishes one: at least one wheel
 * above 0. The recorded sim leaves it at 0 for every car.
 */
export const lmuTyreLoads = (raw: Wheels): number[] | undefined =>
  hasFourWheels(raw) && (raw[0] > 0 || raw[1] > 0 || raw[2] > 0 || raw[3] > 0)
    ? scaled(raw, 1)
    : undefined;

/** How far each tyre is squashed, mm. 0 is a wheel off the ground. */
export const lmuTyreDeflections = (raw: Wheels): number[] | undefined =>
  wheelReadings(raw, MM_PER_M);

/** Camber at each wheel, degrees: negative with the top leaning in. */
export const lmuWheelCambers = (raw: Wheels): number[] | undefined =>
  publishedWheelReadings(raw, DEG_PER_RAD);

/**
 * Toe at each wheel, degrees: positive pointing right. The fronts include
 * the steering angle.
 */
export const lmuWheelToes = (raw: Wheels): number[] | undefined =>
  publishedWheelReadings(raw, DEG_PER_RAD);

/** Wheel rotation, rad/s: negative rolling forwards, 0 standing still. */
export const lmuWheelRotations = (raw: Wheels): number[] | undefined =>
  wheelReadings(raw, 1);

/**
 * Third-spring deflection, mm: front, then rear. On a car with no third
 * spring the sim fills each with the mean of that axle's two suspension
 * travels.
 */
export const lmuThirdSpringDeflections = (
  front: number | undefined,
  rear: number | undefined
): number[] | undefined =>
  isReading(front) && isReading(rear) && (front !== 0 || rear !== 0)
    ? [front * MM_PER_M, rear * MM_PER_M]
    : undefined;

const radiusInMetres = (centimetres: number): number => centimetres / CM_PER_M;

/** Four tyres, each with a radius: 0 is no tyre to measure. */
const hasFourRadii = (raw: Wheels): raw is ArrayLike<number> =>
  hasFourWheels(raw) && raw[0] > 0 && raw[1] > 0 && raw[2] > 0 && raw[3] > 0;

/** Fixed for a set of tyres, so held between frames. */
const heldStaticRadius = createHeldCell<number>();
/** Moves as a wheel crosses a kerb or leaves the road, not every frame. */
const heldSurfaceType = createHeldCell<number>();

/**
 * Writes the wheel and chassis channels onto a telemetry frame.
 *
 * - LmuWheelRideHeight, LmuSuspensionPosition, LmuTyreDeflection: mm.
 * - LmuSuspensionForce, LmuTyreLoad: N.
 * - LmuWheelCamber, LmuWheelToe: degrees, the sim's signs.
 * - LmuWheelRotation: rad/s.
 * - LmuTyreStaticRadius: m.
 * - LmuWheelSurfaceType: what each wheel is on, as the sim numbers it. By the
 *   rFactor 2 header 0 dry, 1 wet, 2 grass, 3 dirt, 4 gravel, 5 kerb,
 *   6 special; as recorded, 4 is reported on dirt and gravel alike.
 * - LmuThirdSpringDeflection: mm, front then rear.
 * - LmuLastImpactTime: when the car last took an impact, seconds on the
 *   clock SessionTime runs on. 0 until the first, and it keeps its value
 *   until the next, so a new impact is a change of this number.
 * - LmuLastImpactMagnitude: how hard that impact was. Unitless: the recorded
 *   five run from 40, a brush, to 3,017, which dented the nose.
 *
 * With no player car the sim writes none of the fields and nothing is
 * published.
 */
export function writeLmuWheelDynamics(
  frame: Record<string, { value: unknown[] }>,
  raw: LmuWheelDynamicsSource
): void {
  const rideHeights = lmuWheelRideHeights(raw.wheelRideHeight);
  if (rideHeights) frame.LmuWheelRideHeight = { value: rideHeights };
  const positions = lmuSuspensionPositions(raw.suspensionDeflection);
  if (positions) frame.LmuSuspensionPosition = { value: positions };
  const forces = lmuSuspensionForces(raw.suspensionForce);
  if (forces) frame.LmuSuspensionForce = { value: forces };
  const loads = lmuTyreLoads(raw.tyreLoad);
  if (loads) frame.LmuTyreLoad = { value: loads };
  const deflections = lmuTyreDeflections(raw.tyreVerticalDeflection);
  if (deflections) frame.LmuTyreDeflection = { value: deflections };
  const cambers = lmuWheelCambers(raw.wheelCamber);
  if (cambers) frame.LmuWheelCamber = { value: cambers };
  const toes = lmuWheelToes(raw.wheelToe);
  if (toes) frame.LmuWheelToe = { value: toes };
  const rotations = lmuWheelRotations(raw.wheelRotation);
  if (rotations) frame.LmuWheelRotation = { value: rotations };

  if (hasFourRadii(raw.tyreStaticRadius)) {
    frame.LmuTyreStaticRadius = holdCell(
      heldStaticRadius,
      raw.tyreStaticRadius,
      TYRE_WHEEL_COUNT,
      radiusInMetres,
      undefined
    );
  }
  if (hasFourWheels(raw.wheelSurfaceType)) {
    frame.LmuWheelSurfaceType = holdCell(
      heldSurfaceType,
      raw.wheelSurfaceType,
      TYRE_WHEEL_COUNT,
      asRead,
      undefined
    );
  }

  const thirdSprings = lmuThirdSpringDeflections(
    raw.front3rdDeflection,
    raw.rear3rdDeflection
  );
  if (thirdSprings) frame.LmuThirdSpringDeflection = { value: thirdSprings };
  if (isReading(raw.lastImpactET)) {
    frame.LmuLastImpactTime = { value: [raw.lastImpactET] };
  }
  if (isReading(raw.lastImpactMagnitude)) {
    frame.LmuLastImpactMagnitude = { value: [raw.lastImpactMagnitude] };
  }
}
