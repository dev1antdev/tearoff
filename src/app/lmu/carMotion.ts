import { isVec3 } from './readings';

/**
 * How the player's car is placed and moving: where it is in the world, which
 * way it points, its velocity and its acceleration.
 *
 * The velocity, the heading and the two accelerations go out under iRacing's
 * names and in iRacing's axes and signs, so one reader serves both sims:
 * forwards, to the left and up are positive.
 *
 * LMU's car axes are +x to the car's left, +y up and +z to the rear. Measured
 * on the recorded race, not taken from the rFactor 2 header: the car travels
 * at -z (17 to 64 m/s), braking reads +z (a mean of 18 m/s2 with the brake
 * above 0.8), and a left-hand corner reads +x (a mean of 13 m/s2). Only the
 * longitudinal axis needs turning round.
 */

/** The fields of a shared-memory read the motion channels are built from. */
export interface LmuCarMotionSource {
  pos?: ArrayLike<number>;
  localVel?: ArrayLike<number>;
  localAccel?: ArrayLike<number>;
  vehOriX?: ArrayLike<number>;
  vehOriZ?: ArrayLike<number>;
  vehTelemetryAvailable?: ArrayLike<number>;
}

const TWO_PI = 2 * Math.PI;

/**
 * A car's heading as YawNorth states it: radians clockwise from the world's
 * +Z axis, seen from above, 0 up to 2 pi. Undefined without an orientation.
 *
 * `oriX` and `oriZ` are the x and z of the third row of the sim's orientation
 * matrix, which is all of it the addon exports per car. A car's nose points
 * along (oriX, -oriZ) in the world's X and Z: on the recorded race the
 * heading this gives stays on the direction the car is travelling in.
 *
 * LMU states no north, so +Z stands for it. Nothing can be checked against
 * that: the sim simulates no wind, which is the one thing iRacing's widgets
 * turn against this heading.
 */
export const lmuYawNorth = (
  oriX: number | undefined,
  oriZ: number | undefined
): number | undefined => {
  if (
    typeof oriX !== 'number' ||
    typeof oriZ !== 'number' ||
    !Number.isFinite(oriX) ||
    !Number.isFinite(oriZ) ||
    (oriX === 0 && oriZ === 0)
  ) {
    return undefined;
  }
  const yaw = Math.PI - Math.atan2(oriX, oriZ);
  return yaw >= TWO_PI ? yaw - TWO_PI : yaw;
};

/**
 * Writes the motion channels onto a telemetry frame.
 *
 * - LmuPlayerWorldPos: [x, y, z] in metres on the world's axes, Y up, so
 *   [1] is the car's elevation.
 * - YawNorth: see lmuYawNorth.
 * - VelocityX, VelocityY, VelocityZ: m/s forwards, to the left and up.
 * - LatAccel: m/s2, positive accelerating to the left, as in a left-hand
 *   corner.
 * - LongAccel: m/s2, positive accelerating forwards, so braking is negative.
 *
 * `playerIdx` is the player's slot, -1 for none. With no player car the sim
 * writes none of the fields and nothing is published, the heading included:
 * it used to go out as a constant 0, which is a car pointing north.
 */
export function writeLmuCarMotion(
  frame: Record<string, { value: unknown[] }>,
  raw: LmuCarMotionSource,
  playerIdx: number
): void {
  if (isVec3(raw.pos)) {
    frame.LmuPlayerWorldPos = { value: [raw.pos[0], raw.pos[1], raw.pos[2]] };
  }
  if (playerIdx >= 0 && raw.vehTelemetryAvailable?.[playerIdx] === 1) {
    const yawNorth = lmuYawNorth(
      raw.vehOriX?.[playerIdx],
      raw.vehOriZ?.[playerIdx]
    );
    if (yawNorth !== undefined) frame.YawNorth = { value: [yawNorth] };
  }
  if (isVec3(raw.localVel)) {
    frame.VelocityX = { value: [-raw.localVel[2]] };
    frame.VelocityY = { value: [raw.localVel[0]] };
    frame.VelocityZ = { value: [raw.localVel[1]] };
  }
  if (isVec3(raw.localAccel)) {
    frame.LatAccel = { value: [raw.localAccel[0]] };
    frame.LongAccel = { value: [-raw.localAccel[2]] };
  }
}
