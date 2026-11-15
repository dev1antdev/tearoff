import { beforeAll, describe, expect, it } from 'vitest';
import type { Telemetry } from '@irdashies/types';
import {
  LMU_CURATED_TAPE_PATH,
  lmuTapeAvailable,
  playLmuTape,
} from '../../testing/lmuTape';
import {
  WHEEL_LOCK_SLIP,
  createWheelSlipState,
  learnWheelRadius,
  seedWheelRadius,
  wheelSlipRatio,
} from './wheelSlip';

/**
 * The rolling radius and the slip ratio on the recorded Le Mans Ultimate
 * race: an LMGT3 with ABS, whose tyres the sim states as 34 cm at the front
 * and 36 cm at the rear.
 *
 * Windows only, like the other tape specs.
 */

const numbers = (telemetry: Telemetry, key: keyof Telemetry): number[] =>
  (telemetry[key]?.value as number[] | undefined) ?? [];

const number = (telemetry: Telemetry, key: keyof Telemetry): number =>
  numbers(telemetry, key)[0] ?? 0;

interface Range {
  min: number;
  max: number;
}

interface Recording {
  frames: number;
  seeded: number[];
  /** The learnt radius per axle over the last 200 s of the recording. */
  radius: Range[];
  final: number[];
  /** Slip ratio of any wheel with the raw brake above 0.02. */
  braking: Range;
  /** Frames under braking with a wheel past the lock threshold. */
  lockedFrames: number;
  /** Slip ratio of the driven wheels at full throttle. */
  rearUnderPower: Range;
  /** Mean size of the slip ratio over every wheel and frame. */
  meanMagnitude: number;
}

const play = async (): Promise<Recording> => {
  const state = createWheelSlipState();
  const tape: Recording = {
    frames: 0,
    seeded: [],
    radius: [
      { min: Infinity, max: -Infinity },
      { min: Infinity, max: -Infinity },
    ],
    final: [],
    braking: { min: Infinity, max: -Infinity },
    lockedFrames: 0,
    rearUnderPower: { min: Infinity, max: -Infinity },
    meanMagnitude: 0,
  };
  let magnitude = 0;
  await playLmuTape({
    tapePath: LMU_CURATED_TAPE_PATH,
    speed: 20,
    onFrame: ({ raw, telemetry, sessionTime }) => {
      const rotation = numbers(telemetry, 'LmuWheelRotation');
      const speed = number(telemetry, 'Speed');
      seedWheelRadius(state, telemetry.LmuTyreStaticRadius?.value);
      if (tape.frames === 0) tape.seeded = [...state.radius];
      learnWheelRadius(
        state,
        rotation,
        speed,
        number(telemetry, 'LatAccel'),
        number(telemetry, 'LongAccel')
      );
      tape.frames += 1;

      if (sessionTime > 180) {
        state.radius.forEach((radius, axle) => {
          tape.radius[axle].min = Math.min(tape.radius[axle].min, radius);
          tape.radius[axle].max = Math.max(tape.radius[axle].max, radius);
        });
      }

      const braking = (raw.unfilteredBrake ?? 0) > 0.02;
      const flatOut = (raw.unfilteredThrottle ?? 0) >= 1;
      let locked = false;
      for (let wheel = 0; wheel < 4; wheel += 1) {
        const slip = wheelSlipRatio(state, wheel, rotation[wheel], speed);
        magnitude += Math.abs(slip);
        if (braking) {
          tape.braking.min = Math.min(tape.braking.min, slip);
          tape.braking.max = Math.max(tape.braking.max, slip);
          if (slip < -WHEEL_LOCK_SLIP) locked = true;
        }
        if (flatOut && wheel >= 2) {
          tape.rearUnderPower.min = Math.min(tape.rearUnderPower.min, slip);
          tape.rearUnderPower.max = Math.max(tape.rearUnderPower.max, slip);
        }
      }
      if (locked) tape.lockedFrames += 1;
    },
  });
  tape.final = [...state.radius];
  tape.meanMagnitude = magnitude / (tape.frames * 4);
  return tape;
};

describe.skipIf(!lmuTapeAvailable())(
  'the rolling radius and slip ratio on a recorded LMU race',
  () => {
    let tape: Recording;

    beforeAll(async () => {
      tape = await play();
    }, 120_000);

    it('starts from the static radius the sim states', () => {
      expect(tape.frames).toBeGreaterThan(14_900);
      expect(tape.seeded).toEqual([0.34, 0.36]);
    });

    it('learns 0.337 m at the front and 0.341 m at the rear', () => {
      expect(tape.final[0]).toBeCloseTo(0.337, 2);
      expect(tape.final[1]).toBeCloseTo(0.341, 2);
      // The undriven fronts hold it to a millimetre and a half from 180 s
      // on: 0.3365 to 0.3379.
      expect(tape.radius[0].min).toBeGreaterThan(0.335);
      expect(tape.radius[0].max).toBeLessThan(0.3395);
      // The driven rears wander further, 0.3374 to 0.3475: a straight taken
      // under power teaches a radius a little too large.
      expect(tape.radius[1].min).toBeGreaterThan(0.335);
      expect(tape.radius[1].max).toBeLessThan(0.35);
    });

    it('finds no locked wheel under braking: the car has ABS', () => {
      expect(tape.lockedFrames).toBe(0);
      expect(tape.braking.min).toBeGreaterThan(-WHEEL_LOCK_SLIP);
      // The ABS lets a wheel slow against the road, all the same.
      expect(tape.braking.min).toBeLessThan(-0.05);
    });

    it('reads the driven wheels spinning up a little under power', () => {
      expect(tape.rearUnderPower.max).toBeGreaterThan(0.02);
      expect(tape.rearUnderPower.max).toBeLessThan(0.5);
    });

    it('sits close to zero for most of a lap', () => {
      expect(tape.meanMagnitude).toBeLessThan(0.03);
    });
  }
);
