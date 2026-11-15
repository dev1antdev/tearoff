import { describe, expect, it } from 'vitest';
import { lmuYawNorth, writeLmuCarMotion } from './carMotion';
import type { LmuCarMotionSource } from './carMotion';

type Frame = Record<string, { value: unknown[] }>;

const PLAYER = 1;

/**
 * A frame of the recorded race, 31 s in: the car at 37.9 m/s, heading
 * south-east, sliding a little to its left and climbing. The player is in
 * slot 1; the slots either side face other ways.
 */
const driving = (): Required<LmuCarMotionSource> => ({
  pos: [-67.015, -15.121, 4.616],
  localVel: [0.7145, 0.2348, -37.8671],
  localAccel: [3.4, 0.6, -1.9],
  vehOriX: new Float64Array([0, 0.7021, -1]),
  vehOriZ: new Float64Array([1, 0.7118, 0]),
  vehTelemetryAvailable: new Uint8Array([1, 1, 1]),
});

const write = (raw: LmuCarMotionSource, playerIdx = PLAYER): Frame => {
  const frame: Frame = {};
  writeLmuCarMotion(frame, raw, playerIdx);
  return frame;
};

describe('lmuYawNorth', () => {
  // A car's nose points along (oriX, -oriZ) in the world's X and Z.
  it.each([
    ['along +Z', 0, -1, 0],
    ['along +X', 1, 0, Math.PI / 2],
    ['along -Z', 0, 1, Math.PI],
    ['along -X', -1, 0, (3 * Math.PI) / 2],
  ])('is clockwise from +Z: a nose %s', (_name, oriX, oriZ, expected) => {
    expect(lmuYawNorth(oriX, oriZ)).toBeCloseTo(expected, 12);
  });

  it('gives the heading of the recorded frame', () => {
    // Between +X and -Z, a little nearer +X: 135.4 degrees.
    expect(lmuYawNorth(0.7021, 0.7118)).toBeCloseTo(2.363, 3);
  });

  it('stays below a full turn', () => {
    // Either side of +Z, where the angle wraps.
    expect(lmuYawNorth(-0, -1)).toBe(0);
    const justShort = lmuYawNorth(-1e-9, -1) as number;
    expect(justShort).toBeLessThan(2 * Math.PI);
    expect(justShort).toBeGreaterThan(6.28);
    expect(lmuYawNorth(1e-9, -1)).toBeCloseTo(0, 6);
  });

  it('does not depend on the length of the vector', () => {
    // A car that is pitched or rolled has a shorter one.
    expect(lmuYawNorth(0.35, 0.35)).toBeCloseTo(
      lmuYawNorth(0.7, 0.7) as number,
      12
    );
  });

  it('has no heading without an orientation', () => {
    expect(lmuYawNorth(undefined, 1)).toBeUndefined();
    expect(lmuYawNorth(0, undefined)).toBeUndefined();
    expect(lmuYawNorth(Number.NaN, 1)).toBeUndefined();
    // What a slot the sim has not written holds.
    expect(lmuYawNorth(0, 0)).toBeUndefined();
  });
});

describe('writeLmuCarMotion', () => {
  it('publishes the position on the world’s axes, elevation second', () => {
    expect(write(driving()).LmuPlayerWorldPos.value).toEqual([
      -67.015, -15.121, 4.616,
    ]);
  });

  it('publishes the player’s heading, not another car’s', () => {
    const frame = write(driving());

    expect(frame.YawNorth.value[0]).toBeCloseTo(2.363, 3);
    // Slot 0 faces -Z and slot 2 faces -X.
    expect(write(driving(), 0).YawNorth.value[0]).toBeCloseTo(Math.PI, 12);
    expect(write(driving(), 2).YawNorth.value[0]).toBeCloseTo(
      (3 * Math.PI) / 2,
      12
    );
  });

  it('turns velocity into iRacing’s axes: forwards, to the left, up', () => {
    // The sim's are to the left, up and to the rear, so a car going
    // forwards reads a negative z.
    const frame = write(driving());

    expect(frame.VelocityX.value).toEqual([37.8671]);
    expect(frame.VelocityY.value).toEqual([0.7145]);
    expect(frame.VelocityZ.value).toEqual([0.2348]);
  });

  it('reads braking as negative and accelerating as positive', () => {
    // The sim's z is to the rear: the recorded car reads +18.1 m/s2 under
    // braking and -3.7 flat out. iRacing's LongAccel is the other way up.
    const braking = write({ ...driving(), localAccel: [-0.4, 0.3, 18.1] });
    const flatOut = write({ ...driving(), localAccel: [0.2, 0.1, -3.7] });

    expect(braking.LongAccel.value).toEqual([-18.1]);
    expect(flatOut.LongAccel.value).toEqual([3.7]);
  });

  it('reads a left-hand corner as positive lateral acceleration', () => {
    // The sim's x is to the left already, as iRacing's LatAccel is.
    const left = write({ ...driving(), localAccel: [15.2, 0.4, -0.8] });
    const right = write({ ...driving(), localAccel: [-14.6, 0.4, -0.8] });

    expect(left.LatAccel.value).toEqual([15.2]);
    expect(right.LatAccel.value).toEqual([-14.6]);
  });

  it('publishes nothing with no player car', () => {
    // The sim writes no position, velocity or acceleration then, and the
    // per-car orientations are other people's.
    const { vehOriX, vehOriZ, vehTelemetryAvailable } = driving();

    expect(write({ vehOriX, vehOriZ, vehTelemetryAvailable }, -1)).toEqual({});
  });

  it('publishes no heading for a player the sim sends no telemetry for', () => {
    const frame = write({
      ...driving(),
      vehTelemetryAvailable: new Uint8Array([1, 0, 1]),
    });

    expect(frame.YawNorth).toBeUndefined();
    // The player's own block is still there.
    expect(frame.LmuPlayerWorldPos).toBeDefined();
  });

  it('publishes no heading from an orientation that was never written', () => {
    const frame = write({
      ...driving(),
      vehOriX: new Float64Array(3),
      vehOriZ: new Float64Array(3),
    });

    expect(frame.YawNorth).toBeUndefined();
  });

  it.each([
    ['pos', ['LmuPlayerWorldPos']],
    ['localVel', ['VelocityX', 'VelocityY', 'VelocityZ']],
    ['localAccel', ['LatAccel', 'LongAccel']],
    ['vehOriX', ['YawNorth']],
    ['vehOriZ', ['YawNorth']],
    ['vehTelemetryAvailable', ['YawNorth']],
  ] as const)('leaves out only %s’s keys when it is missing', (field, keys) => {
    const frame = write({ ...driving(), [field]: undefined });

    for (const key of keys) expect(frame[key]).toBeUndefined();
    // Seven keys in all.
    expect(Object.keys(frame)).toHaveLength(7 - keys.length);
  });

  it('reads nothing from a vector that is short', () => {
    const frame = write({
      ...driving(),
      pos: [-67.015, -15.121],
      localVel: [0.7145],
      localAccel: [],
    });

    expect(Object.keys(frame)).toEqual(['YawNorth']);
  });
});
