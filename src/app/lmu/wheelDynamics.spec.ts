import { describe, expect, it } from 'vitest';
import {
  lmuSuspensionForces,
  lmuSuspensionPositions,
  lmuThirdSpringDeflections,
  lmuTyreDeflections,
  lmuTyreLoads,
  lmuWheelCambers,
  lmuWheelRideHeights,
  lmuWheelRotations,
  lmuWheelToes,
  writeLmuWheelDynamics,
} from './wheelDynamics';
import type { LmuWheelDynamicsSource } from './wheelDynamics';

type Frame = Record<string, { value: unknown[] }>;

/**
 * The recorded LMGT3 in a left-hand corner, as the sim publishes it: LF, RF,
 * LR, RR, in metres, newtons, radians and radians a second. The right-hand
 * side carries the load and rides lower, the fronts' toe is mostly steering
 * angle, the right front is on a kerb, and tyre load is the zero the sim
 * leaves it at.
 */
const cornering = (): Required<LmuWheelDynamicsSource> => ({
  wheelRideHeight: new Float64Array([0.054, 0.05, 0.063, 0.059]),
  suspensionDeflection: new Float64Array([0.058, 0.071, 0.069, 0.084]),
  suspensionForce: new Float64Array([3600, 5100, 4300, 6000]),
  tyreLoad: new Float64Array([0, 0, 0, 0]),
  tyreVerticalDeflection: new Float64Array([0.014, 0.019, 0.017, 0.022]),
  wheelCamber: new Float64Array([-0.0349, -0.0381, -0.0297, -0.0281]),
  wheelToe: new Float64Array([-0.0898, -0.0843, 0.0018, -0.0018]),
  wheelRotation: new Float64Array([-153.9, -156.6, -147.2, -149.8]),
  tyreStaticRadius: new Uint8Array([34, 34, 36, 36]),
  wheelSurfaceType: new Uint8Array([0, 5, 0, 0]),
  front3rdDeflection: 0.0645,
  rear3rdDeflection: 0.0765,
  lastImpactET: 240.72,
  lastImpactMagnitude: 3016.93,
});

const write = (raw: LmuWheelDynamicsSource): Frame => {
  const frame: Frame = {};
  writeLmuWheelDynamics(frame, raw);
  return frame;
};

const expectWheels = (actual: unknown, expected: number[], digits = 6) => {
  const values = actual as number[] | undefined;
  expect(values).toHaveLength(expected.length);
  expected.forEach((value, wheel) =>
    expect(values?.[wheel]).toBeCloseTo(value, digits)
  );
};

describe('the wheel converters', () => {
  it('turns ride height from metres into millimetres', () => {
    // 0.054 m is the 5.4 cm front ride height of the recorded setup.
    expectWheels(
      lmuWheelRideHeights(new Float64Array([0.054, 0.05, 0.063, 0.059])),
      [54, 50, 63, 59]
    );
  });

  it('keeps a ride height below the road, which the sim does report', () => {
    // 1.5 mm under it on two frames of the recording.
    expectWheels(
      lmuWheelRideHeights(new Float64Array([0.012, -0.0015, 0.02, 0.018])),
      [12, -1.5, 20, 18]
    );
  });

  it('turns suspension travel and tyre deflection into millimetres', () => {
    expectWheels(
      lmuSuspensionPositions(new Float64Array([0.058, 0.071, 0.069, 0.084])),
      [58, 71, 69, 84]
    );
    expectWheels(
      lmuTyreDeflections(new Float64Array([0.014, 0.019, 0.017, 0.022])),
      [14, 19, 17, 22]
    );
  });

  it('turns camber from radians into degrees, keeping the sim’s sign', () => {
    // -0.0349 rad is the -2.0 degrees of the recorded setup: negative with
    // the top of the wheel leaning in, on the left and on the right.
    const cambers = lmuWheelCambers(
      new Float64Array([-0.0349, -0.0381, -0.0297, -0.0281])
    );

    expectWheels(cambers, [-2.0, -2.18, -1.7, -1.61], 2);
  });

  it('turns toe from radians into degrees, positive pointing right', () => {
    // Toe-in at the rear: positive on the left wheel, negative on the right.
    // Steering left turns both fronts negative.
    const toes = lmuWheelToes(
      new Float64Array([-0.0898, -0.0843, 0.0018, -0.0018])
    );

    expectWheels(toes, [-5.145, -4.83, 0.103, -0.103], 3);
  });

  it('passes suspension force and wheel rotation through', () => {
    // Newtons and radians a second already. A drooping wheel pulls.
    expect(
      lmuSuspensionForces(new Float64Array([-420, 5100, 4300, 6000]))
    ).toEqual([-420, 5100, 4300, 6000]);
    // Negative rolling forwards.
    expect(
      lmuWheelRotations(new Float64Array([-153.9, -156.6, -147.2, -149.8]))
    ).toEqual([-153.9, -156.6, -147.2, -149.8]);
  });

  it('keeps the wheel order: LF, RF, LR, RR', () => {
    expect(lmuSuspensionForces(new Float64Array([1, 2, 3, 4]))).toEqual([
      1, 2, 3, 4,
    ]);
    expectWheels(
      lmuWheelRideHeights(new Float64Array([0.001, 0.002, 0.003, 0.004])),
      [1, 2, 3, 4]
    );
  });

  it('publishes tyre load only when the sim does', () => {
    // Zero on every wheel of every car recorded so far: withheld, not a car
    // with no weight on it.
    expect(lmuTyreLoads(new Float64Array([0, 0, 0, 0]))).toBeUndefined();
    // One wheel above 0 is a sim that has started publishing it; a wheel in
    // the air then reads 0 beside the others.
    expect(lmuTyreLoads(new Float64Array([0, 4200, 3100, 5200]))).toEqual([
      0, 4200, 3100, 5200,
    ]);
  });

  it.each([
    ['ride height', lmuWheelRideHeights],
    ['suspension travel', lmuSuspensionPositions],
    ['camber', lmuWheelCambers],
    ['toe', lmuWheelToes],
  ])('leaves %s out when all four wheels read exactly 0', (_name, read) => {
    // What the sim leaves a reading it does not publish at, and what a block
    // it has not written holds.
    expect(read(new Float64Array(4))).toBeUndefined();
    // One wheel at 0 beside three that read is a reading.
    expect(read(new Float64Array([0, 0.01, 0.01, 0.01]))).toHaveLength(4);
  });

  it.each([
    ['suspension force', lmuSuspensionForces],
    ['tyre deflection', lmuTyreDeflections],
    ['wheel rotation', lmuWheelRotations],
  ])('keeps four zeros of %s, which a real car can read', (_name, read) => {
    // On its jacks, off the ground, standing still.
    expect(read(new Float64Array(4))).toEqual([0, 0, 0, 0]);
  });

  it('keeps a tyre deflection of 0 for a wheel in the air', () => {
    expectWheels(
      lmuTyreDeflections(new Float64Array([0, 0.019, 0.017, 0.022])),
      [0, 19, 17, 22]
    );
  });

  it.each([
    ['ride height', lmuWheelRideHeights],
    ['suspension travel', lmuSuspensionPositions],
    ['suspension force', lmuSuspensionForces],
    ['tyre load', lmuTyreLoads],
    ['tyre deflection', lmuTyreDeflections],
    ['camber', lmuWheelCambers],
    ['toe', lmuWheelToes],
    ['wheel rotation', lmuWheelRotations],
  ])('reads no %s unless all four wheels are there', (_name, read) => {
    expect(read(undefined)).toBeUndefined();
    // A three-element array is a car with three wheels.
    expect(read(new Float64Array([0.05, 0.05, 0.05]))).toBeUndefined();
    expect(
      read(new Float64Array([0.05, 0.05, Number.NaN, 0.05]))
    ).toBeUndefined();
  });

  it('turns the third springs into millimetres, front then rear', () => {
    const thirdSprings = lmuThirdSpringDeflections(0.0645, 0.0765);

    expectWheels(thirdSprings, [64.5, 76.5]);
  });

  it('reads no third springs unless both are there', () => {
    expect(lmuThirdSpringDeflections(undefined, 0.0765)).toBeUndefined();
    expect(lmuThirdSpringDeflections(0.0645, undefined)).toBeUndefined();
    // Both at 0 is the sim not publishing them.
    expect(lmuThirdSpringDeflections(0, 0)).toBeUndefined();
  });
});

describe('writeLmuWheelDynamics', () => {
  it('publishes every reading the car gives, in the frame’s units', () => {
    const frame = write(cornering());

    expectWheels(frame.LmuWheelRideHeight.value, [54, 50, 63, 59]);
    expectWheels(frame.LmuSuspensionPosition.value, [58, 71, 69, 84]);
    expect(frame.LmuSuspensionForce.value).toEqual([3600, 5100, 4300, 6000]);
    expectWheels(frame.LmuTyreDeflection.value, [14, 19, 17, 22]);
    expectWheels(frame.LmuWheelCamber.value, [-2.0, -2.18, -1.7, -1.61], 2);
    expectWheels(frame.LmuWheelToe.value, [-5.145, -4.83, 0.103, -0.103], 3);
    expect(frame.LmuWheelRotation.value).toEqual([
      -153.9, -156.6, -147.2, -149.8,
    ]);
    expectWheels(frame.LmuThirdSpringDeflection.value, [64.5, 76.5]);
    expect(frame.LmuLastImpactTime.value).toEqual([240.72]);
    expect(frame.LmuLastImpactMagnitude.value).toEqual([3016.93]);
  });

  it('turns the static tyre radius from whole centimetres into metres', () => {
    // 34 cm front and 36 cm rear on the recorded car.
    expect(write(cornering()).LmuTyreStaticRadius.value).toEqual([
      0.34, 0.34, 0.36, 0.36,
    ]);
  });

  it('publishes what each wheel is on as the sim numbers it', () => {
    // The right front on a kerb, which is 5.
    expect(write(cornering()).LmuWheelSurfaceType.value).toEqual([0, 5, 0, 0]);
  });

  it('publishes no tyre load while the sim withholds it', () => {
    expect(write(cornering()).LmuTyreLoad).toBeUndefined();
    expect(
      write({
        ...cornering(),
        tyreLoad: new Float64Array([3900, 5600, 4500, 6400]),
      }).LmuTyreLoad.value
    ).toEqual([3900, 5600, 4500, 6400]);
  });

  it('publishes an impact time and magnitude of 0 before the first impact', () => {
    // 0 is what says there has been none: a new impact is a change of the
    // time, so it has to be there to change.
    const frame = write({
      ...cornering(),
      lastImpactET: 0,
      lastImpactMagnitude: 0,
    });

    expect(frame.LmuLastImpactTime.value).toEqual([0]);
    expect(frame.LmuLastImpactMagnitude.value).toEqual([0]);
  });

  it('publishes nothing with no player car', () => {
    // The sim writes none of the fields then.
    expect(write({})).toEqual({});
  });

  it('publishes no wheel readings from a block the sim has not written', () => {
    // Every field there and every value 0. A car standing on nothing reads
    // 0 for force, deflection and rotation, and those are all that go out.
    const frame = write({
      wheelRideHeight: new Float64Array(4),
      suspensionDeflection: new Float64Array(4),
      suspensionForce: new Float64Array(4),
      tyreLoad: new Float64Array(4),
      tyreVerticalDeflection: new Float64Array(4),
      wheelCamber: new Float64Array(4),
      wheelToe: new Float64Array(4),
      wheelRotation: new Float64Array(4),
      tyreStaticRadius: new Uint8Array(4),
      front3rdDeflection: 0,
      rear3rdDeflection: 0,
    });

    expect(Object.keys(frame).sort()).toEqual([
      'LmuSuspensionForce',
      'LmuTyreDeflection',
      'LmuWheelRotation',
    ]);
  });

  it.each([
    ['wheelRideHeight', 'LmuWheelRideHeight'],
    ['suspensionDeflection', 'LmuSuspensionPosition'],
    ['suspensionForce', 'LmuSuspensionForce'],
    ['tyreVerticalDeflection', 'LmuTyreDeflection'],
    ['wheelCamber', 'LmuWheelCamber'],
    ['wheelToe', 'LmuWheelToe'],
    ['wheelRotation', 'LmuWheelRotation'],
    ['tyreStaticRadius', 'LmuTyreStaticRadius'],
    ['wheelSurfaceType', 'LmuWheelSurfaceType'],
    ['front3rdDeflection', 'LmuThirdSpringDeflection'],
    ['rear3rdDeflection', 'LmuThirdSpringDeflection'],
    ['lastImpactET', 'LmuLastImpactTime'],
    ['lastImpactMagnitude', 'LmuLastImpactMagnitude'],
  ] as const)('leaves out only %s’s key when it is missing', (field, key) => {
    const frame = write({ ...cornering(), [field]: undefined });

    expect(frame[key]).toBeUndefined();
    // Twelve keys from the cornering car, which has no tyre load, less one.
    expect(Object.keys(frame)).toHaveLength(11);
  });

  it('reads no radius from a wheel that states none', () => {
    const frame = write({
      ...cornering(),
      tyreStaticRadius: new Uint8Array([34, 34, 0, 36]),
    });

    expect(frame.LmuTyreStaticRadius).toBeUndefined();
  });

  it('publishes the radius and the surface in the same cells while they stand', () => {
    // The radius is fixed for a set of tyres and the surface changes at a
    // kerb, not on each of the 64 frames a second.
    const first = write(cornering());
    const second = write(cornering());

    expect(second.LmuTyreStaticRadius).toBe(first.LmuTyreStaticRadius);
    expect(second.LmuWheelSurfaceType).toBe(first.LmuWheelSurfaceType);
  });

  it('publishes a new surface cell when a wheel changes surface', () => {
    const onKerb = write(cornering());
    const offKerb = write({
      ...cornering(),
      wheelSurfaceType: new Uint8Array([0, 0, 0, 0]),
    });

    expect(offKerb.LmuWheelSurfaceType).not.toBe(onKerb.LmuWheelSurfaceType);
    expect(offKerb.LmuWheelSurfaceType.value).toEqual([0, 0, 0, 0]);
    // The frame before keeps what it was given.
    expect(onKerb.LmuWheelSurfaceType.value).toEqual([0, 5, 0, 0]);
  });

  it('builds the readings that move every frame afresh', () => {
    // These change on every frame, and a frame handed on must not change
    // under whoever still holds it.
    const first = write(cornering());
    const second = write(cornering());

    expect(second.LmuWheelRideHeight.value).not.toBe(
      first.LmuWheelRideHeight.value
    );
    expect(second.LmuWheelRideHeight.value).toEqual(
      first.LmuWheelRideHeight.value
    );
  });
});
