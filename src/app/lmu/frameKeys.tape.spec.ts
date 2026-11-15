import { beforeAll, describe, expect, it } from 'vitest';
import type { Telemetry } from '@irdashies/types';
import {
  LMU_CURATED_TAPE_PATH,
  lmuTapeAvailable,
  playLmuTape,
} from '../../testing/lmuTape';

/**
 * What the app publishes, on a recorded Le Mans Ultimate race, under the
 * frame keys built from the player's wheels, chassis, damage and hybrid
 * fields and from the per-car pit fields.
 *
 * The addon's own exports are pinned in native/lmu-tape-exports.spec.ts, in
 * the sim's units. This is the next step along: the same recording through
 * mapLmuTelemetry, in the units and signs the frame states, so a conversion
 * that is wrong shows here.
 *
 * The recording is four minutes of an offline race in an LMGT3: 38 cars, no
 * pit stop, no hybrid, five knocks to the nose.
 *
 * The replay hands each recorded frame out once, and playLmuTape reads the
 * session every half second: a read that takes the frame after it when that
 * frame is already due. So the mapper misses a few dozen of the 15,430
 * frames, a different few on each run, and at most the 480 that follow a
 * session read. Means and counts are therefore held to a tolerance, and an
 * extreme is pinned from the outside with room on the inside for the frame
 * that set it to be one of those missed. Every figure here was checked both
 * ways: with a few dozen of the 480 missed, and with all of them. The
 * impacts and the dent are states that stand once set, and are exact, but
 * for the one impact that stands for a single frame: see IMPACTS.
 *
 * Windows only, like the other tape specs.
 */

type Key = keyof Telemetry;

/** Per-wheel keys whose value moves on every frame. */
const WHEEL_KEYS = [
  'LmuWheelRideHeight',
  'LmuSuspensionPosition',
  'LmuSuspensionForce',
  'LmuTyreDeflection',
  'LmuWheelCamber',
  'LmuWheelToe',
  'LmuWheelRotation',
] as const satisfies readonly Key[];
type WheelKey = (typeof WHEEL_KEYS)[number];

/** Arrays that stand for many frames: one cell goes out until a value moves. */
const HELD_KEYS = [
  'LmuTyreStaticRadius',
  'LmuWheelSurfaceType',
  'LmuLastImpactPos',
  'LmuDentSeverity',
  'LmuTyreFlat',
  'LmuWheelDetached',
  'LmuCarIdxPitState',
  'LmuCarIdxPitStops',
  'LmuCarIdxInGarage',
] as const satisfies readonly Key[];
type HeldKey = (typeof HELD_KEYS)[number];

/** Keys the recorded car gives a reading for, on every frame. */
const PUBLISHED_KEYS = [
  ...WHEEL_KEYS,
  ...HELD_KEYS,
  'LmuThirdSpringDeflection',
  'LmuLastImpactTime',
  'LmuLastImpactMagnitude',
  'LmuBodyDetached',
  'LmuOverheating',
  'LmuMotorState',
  'LmuLiftAndCoast',
  'LmuSessionEndTime',
  'LmuPlayerWorldPos',
  'YawNorth',
  'VelocityX',
  'VelocityY',
  'VelocityZ',
  'LatAccel',
  'LongAccel',
] as const satisfies readonly Key[];

/** Keys it gives none for: the sim withholds tyre load, and it has no hybrid. */
const WITHHELD_KEYS = [
  'LmuTyreLoad',
  'LmuBatteryCharge',
  'LmuMotorTorque',
  'LmuMotorRPM',
  'LmuMotorTemp',
  'LmuMotorCoolantTemp',
] as const satisfies readonly Key[];

const COUNTED_KEYS = [...PUBLISHED_KEYS, ...WITHHELD_KEYS];
type CountedKey = (typeof COUNTED_KEYS)[number];

interface Range {
  min: number;
  max: number;
  sum: number;
  count: number;
}

const emptyRange = (): Range => ({
  min: Infinity,
  max: -Infinity,
  sum: 0,
  count: 0,
});

const widen = (range: Range, value: number) => {
  range.min = Math.min(range.min, value);
  range.max = Math.max(range.max, value);
  range.sum += value;
  range.count += 1;
};

const meanOf = (range: Range) => range.sum / range.count;

/** One entry per wheel in each array. */
interface WheelStats {
  ranges: Range[];
  /** Frames on which the wheel read exactly 0. */
  zeros: number[];
  /** Frames on which it read below 0. */
  negatives: number[];
}

const emptyWheelStats = (): WheelStats => ({
  ranges: [emptyRange(), emptyRange(), emptyRange(), emptyRange()],
  zeros: [0, 0, 0, 0],
  negatives: [0, 0, 0, 0],
});

interface Impact {
  /** SessionTime on the first frame to carry it. */
  seenAt: number;
  time: number;
  magnitude: number;
  position: number[];
}

interface Recording {
  frames: number;
  firstTime: number;
  lastTime: number;
  /** Frames on which each key was in the frame at all. */
  present: Record<CountedKey, number>;
  /** The different cells each held key went out in. */
  cells: Record<HeldKey, Set<unknown>>;
  wheels: Record<WheelKey, WheelStats>;
  staticRadii: Set<string>;
  /** Wheel-frames spent on each surface type. */
  surfaces: Record<number, number>;
  /** Front, then rear. */
  thirdSprings: Range[];
  /** Furthest a third-spring reading sat from the mean of its axle, mm. */
  thirdSpringError: number;
  /** What the impact keys held on the first frame, then each change. */
  impacts: Impact[];
  /** The dent levels on the first frame, then each change. */
  dents: { seenAt: number; levels: number[] }[];
  bodyDetachedFrames: number;
  overheatingFrames: number;
  flatWheelFrames: number;
  detachedWheelFrames: number;
  motorState: Range;
  liftAndCoast: Range;
  /** The different per-car arrays seen, as text. */
  pitStates: Set<string>;
  pitStops: Set<string>;
  inGarage: Set<string>;
  sessionEnds: Set<number>;
  /** x, y, z. */
  position: Range[];
  /** Metres from each frame's position to the next, summed. */
  pathLength: number;
  /** The same distance, from Speed and the frame clock. */
  speedDistance: number;
  yawNorth: Range;
  /** Radians between the heading and the direction of travel. */
  headingError: Range;
  /** Forwards, to the left, up. */
  velocity: Range[];
  /** Furthest the length of the velocity sat from Speed, m/s. */
  speedError: number;
  longAccelBraking: Range;
  longAccelFullThrottle: Range;
  latAccelSteeringLeft: Range;
  latAccelSteeringRight: Range;
}

const emptyRecording = (): Recording => ({
  frames: 0,
  firstTime: Number.NaN,
  lastTime: Number.NaN,
  present: Object.fromEntries(COUNTED_KEYS.map((key) => [key, 0])) as Record<
    CountedKey,
    number
  >,
  cells: Object.fromEntries(
    HELD_KEYS.map((key) => [key, new Set<unknown>()])
  ) as Record<HeldKey, Set<unknown>>,
  wheels: Object.fromEntries(
    WHEEL_KEYS.map((key) => [key, emptyWheelStats()])
  ) as Record<WheelKey, WheelStats>,
  staticRadii: new Set(),
  surfaces: {},
  thirdSprings: [emptyRange(), emptyRange()],
  thirdSpringError: 0,
  impacts: [],
  dents: [],
  bodyDetachedFrames: 0,
  overheatingFrames: 0,
  flatWheelFrames: 0,
  detachedWheelFrames: 0,
  motorState: emptyRange(),
  liftAndCoast: emptyRange(),
  pitStates: new Set(),
  pitStops: new Set(),
  inGarage: new Set(),
  sessionEnds: new Set(),
  position: [emptyRange(), emptyRange(), emptyRange()],
  pathLength: 0,
  speedDistance: 0,
  yawNorth: emptyRange(),
  headingError: emptyRange(),
  velocity: [emptyRange(), emptyRange(), emptyRange()],
  speedError: 0,
  longAccelBraking: emptyRange(),
  longAccelFullThrottle: emptyRange(),
  latAccelSteeringLeft: emptyRange(),
  latAccelSteeringRight: emptyRange(),
});

const numbers = (telemetry: Telemetry, key: Key): number[] | undefined =>
  telemetry[key]?.value as number[] | undefined;

const number = (telemetry: Telemetry, key: Key): number | undefined =>
  numbers(telemetry, key)?.[0];

const flags = (telemetry: Telemetry, key: Key): boolean[] | undefined =>
  telemetry[key]?.value as boolean[] | undefined;

/** The smaller angle between two headings, radians. */
const angleBetween = (a: number, b: number): number => {
  const turn = Math.abs(a - b) % (2 * Math.PI);
  return turn > Math.PI ? 2 * Math.PI - turn : turn;
};

/**
 * How far the wheel is turned, as a share of its range, before a frame
 * counts as cornering: a corner, and not a correction on a straight.
 */
const CORNERING_STEER = 0.1;

/**
 * The five impacts on the recording, all at the nose: when, how hard
 * (unitless) and where, in car axes, two to two and a half metres ahead of
 * the car's origin, which is negative z.
 *
 * The fourth and fifth are one brush, 20 ms apart. The fourth is in the
 * frame for a single frame before the fifth replaces it, and that frame is
 * one of those a session read can take, so a run may not see it.
 */
const IMPACTS = [
  { time: 147.2, magnitude: 1422.7, position: [-1.007, -0.139, -2.049] },
  { time: 240.72, magnitude: 3016.9, position: [-0.567, -0.153, -2.453] },
  { time: 278.34, magnitude: 1232.9, position: [0.048, -0.102, -2.538] },
  {
    time: 284.98,
    magnitude: 39.6,
    position: [0.523, -0.224, -2.499],
    singleFrame: true,
  },
  { time: 285.0, magnitude: 63.0, position: [0.499, -0.223, -2.5] },
];

/** Plays the tape once, keeping only what the cases below assert on. */
const readRecording = async (): Promise<Recording> => {
  const tape = emptyRecording();
  let previous: { time: number; position: number[] } | null = null;
  await playLmuTape({
    tapePath: LMU_CURATED_TAPE_PATH,
    speed: 20,
    onFrame: ({ raw, telemetry, sessionTime }) => {
      if (tape.frames === 0) tape.firstTime = sessionTime;
      tape.frames += 1;
      tape.lastTime = sessionTime;
      for (const key of COUNTED_KEYS) {
        if (telemetry[key] !== undefined) tape.present[key] += 1;
      }
      for (const key of HELD_KEYS) {
        if (telemetry[key] !== undefined) tape.cells[key].add(telemetry[key]);
      }

      for (const key of WHEEL_KEYS) {
        const values = numbers(telemetry, key);
        if (!values) continue;
        const stats = tape.wheels[key];
        for (let wheel = 0; wheel < 4; wheel += 1) {
          widen(stats.ranges[wheel], values[wheel]);
          if (values[wheel] === 0) stats.zeros[wheel] += 1;
          if (values[wheel] < 0) stats.negatives[wheel] += 1;
        }
      }

      const radii = numbers(telemetry, 'LmuTyreStaticRadius');
      if (radii) tape.staticRadii.add(radii.join(','));
      for (const surface of numbers(telemetry, 'LmuWheelSurfaceType') ?? []) {
        tape.surfaces[surface] = (tape.surfaces[surface] ?? 0) + 1;
      }

      const thirdSprings = numbers(telemetry, 'LmuThirdSpringDeflection');
      const travel = numbers(telemetry, 'LmuSuspensionPosition');
      if (thirdSprings && travel) {
        widen(tape.thirdSprings[0], thirdSprings[0]);
        widen(tape.thirdSprings[1], thirdSprings[1]);
        tape.thirdSpringError = Math.max(
          tape.thirdSpringError,
          Math.abs(thirdSprings[0] - (travel[0] + travel[1]) / 2),
          Math.abs(thirdSprings[1] - (travel[2] + travel[3]) / 2)
        );
      }

      const impactTime = number(telemetry, 'LmuLastImpactTime');
      const impactMagnitude = number(telemetry, 'LmuLastImpactMagnitude');
      const impactPosition = numbers(telemetry, 'LmuLastImpactPos');
      if (
        impactTime !== undefined &&
        impactMagnitude !== undefined &&
        impactPosition
      ) {
        const last = tape.impacts.at(-1);
        if (last?.time !== impactTime || last.magnitude !== impactMagnitude) {
          tape.impacts.push({
            seenAt: sessionTime,
            time: impactTime,
            magnitude: impactMagnitude,
            position: [...impactPosition],
          });
        }
      }

      const levels = numbers(telemetry, 'LmuDentSeverity');
      if (levels && tape.dents.at(-1)?.levels.join(',') !== levels.join(',')) {
        tape.dents.push({ seenAt: sessionTime, levels: [...levels] });
      }
      if (flags(telemetry, 'LmuBodyDetached')?.[0]) {
        tape.bodyDetachedFrames += 1;
      }
      if (flags(telemetry, 'LmuOverheating')?.[0]) tape.overheatingFrames += 1;
      for (const flat of flags(telemetry, 'LmuTyreFlat') ?? []) {
        if (flat) tape.flatWheelFrames += 1;
      }
      for (const detached of flags(telemetry, 'LmuWheelDetached') ?? []) {
        if (detached) tape.detachedWheelFrames += 1;
      }

      const motorState = number(telemetry, 'LmuMotorState');
      if (motorState !== undefined) widen(tape.motorState, motorState);
      const liftAndCoast = number(telemetry, 'LmuLiftAndCoast');
      if (liftAndCoast !== undefined) widen(tape.liftAndCoast, liftAndCoast);

      const pitStates = numbers(telemetry, 'LmuCarIdxPitState');
      if (pitStates) tape.pitStates.add(pitStates.join(','));
      const pitStops = numbers(telemetry, 'LmuCarIdxPitStops');
      if (pitStops) tape.pitStops.add(pitStops.join(','));
      const inGarage = flags(telemetry, 'LmuCarIdxInGarage');
      if (inGarage) tape.inGarage.add(inGarage.join(','));
      const sessionEnd = number(telemetry, 'LmuSessionEndTime');
      if (sessionEnd !== undefined) tape.sessionEnds.add(sessionEnd);

      const speed = number(telemetry, 'Speed') ?? 0;
      const position = numbers(telemetry, 'LmuPlayerWorldPos');
      const yawNorth = number(telemetry, 'YawNorth');
      if (position && yawNorth !== undefined) {
        position.forEach((value, axis) => widen(tape.position[axis], value));
        widen(tape.yawNorth, yawNorth);
        if (previous) {
          const alongX = position[0] - previous.position[0];
          const alongY = position[1] - previous.position[1];
          const alongZ = position[2] - previous.position[2];
          tape.pathLength += Math.hypot(alongX, alongY, alongZ);
          tape.speedDistance += speed * (sessionTime - previous.time);
          // The direction of travel, measured as the heading is: clockwise
          // from +Z, seen from above.
          const bearing = Math.atan2(alongX, alongZ);
          widen(tape.headingError, angleBetween(yawNorth, bearing));
        }
        previous = { time: sessionTime, position: [...position] };
      }

      const forwards = number(telemetry, 'VelocityX');
      const toTheLeft = number(telemetry, 'VelocityY');
      const upwards = number(telemetry, 'VelocityZ');
      if (
        forwards !== undefined &&
        toTheLeft !== undefined &&
        upwards !== undefined
      ) {
        widen(tape.velocity[0], forwards);
        widen(tape.velocity[1], toTheLeft);
        widen(tape.velocity[2], upwards);
        tape.speedError = Math.max(
          tape.speedError,
          Math.abs(Math.hypot(forwards, toTheLeft, upwards) - speed)
        );
      }

      const longAccel = number(telemetry, 'LongAccel');
      const latAccel = number(telemetry, 'LatAccel');
      if (longAccel !== undefined && latAccel !== undefined) {
        if ((raw.unfilteredBrake ?? 0) > 0.8) {
          widen(tape.longAccelBraking, longAccel);
        }
        if ((raw.unfilteredThrottle ?? 0) >= 1) {
          widen(tape.longAccelFullThrottle, longAccel);
        }
        // The sim's steering input is negative to the left.
        const steer = raw.unfilteredSteering ?? 0;
        if (steer < -CORNERING_STEER)
          widen(tape.latAccelSteeringLeft, latAccel);
        if (steer > CORNERING_STEER)
          widen(tape.latAccelSteeringRight, latAccel);
      }
    },
  });
  return tape;
};

const expectNear = (actual: number, expected: number, tolerance: number) =>
  expect(
    Math.abs(actual - expected),
    `${actual} is not within ${tolerance} of ${expected}`
  ).toBeLessThanOrEqual(tolerance);

const expectAllNear = (
  actual: number[],
  expected: number[],
  tolerance: number
) => {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((value, index) =>
    expectNear(actual[index], value, tolerance)
  );
};

/** Rounding only: a pinned extreme is quoted to fewer digits than it has. */
const QUOTED = 0.01;

/**
 * The highest reading on the recording. Never above the pinned figure; below
 * it by no more than `slack`, for a run that missed the frame that set it.
 */
const expectHighest = (actual: number, pinned: number, slack: number) => {
  expect(actual).toBeLessThanOrEqual(pinned + QUOTED);
  expect(actual).toBeGreaterThanOrEqual(pinned - slack);
};

/** The lowest reading, under the same rule the other way up. */
const expectLowest = (actual: number, pinned: number, slack: number) => {
  expect(actual).toBeGreaterThanOrEqual(pinned - QUOTED);
  expect(actual).toBeLessThanOrEqual(pinned + slack);
};

/**
 * The impacts a run is held to, given how many it saw: all five, or the
 * four that stand for more than a frame.
 */
const recordedImpacts = (seen: number) =>
  seen === IMPACTS.length
    ? IMPACTS
    : IMPACTS.filter((impact) => !impact.singleFrame);

/** A count over frames: the whole recording's, less the few frames missed. */
const expectCount = (actual: number, whole: number, missed: number) => {
  expect(actual).toBeLessThanOrEqual(whole);
  expect(actual).toBeGreaterThanOrEqual(whole - missed);
};

describe.skipIf(!lmuTapeAvailable())(
  'the wheel, chassis, damage, hybrid and pit keys on a recorded LMU race',
  () => {
    let tape = emptyRecording();
    const means = (key: WheelKey) => tape.wheels[key].ranges.map(meanOf);
    const lowest = (key: WheelKey) =>
      Math.min(...tape.wheels[key].ranges.map((range) => range.min));
    const highest = (key: WheelKey) =>
      Math.max(...tape.wheels[key].ranges.map((range) => range.max));

    beforeAll(async () => {
      tape = await readRecording();
    }, 120_000);

    it('sees the recording from end to end', () => {
      // 15,430 frames of the player's clock, less those the session reads
      // took.
      expectCount(tape.frames, 15_430, 490);
      expectNear(tape.firstTime, 139.92, 0.05);
      expectNear(tape.lastTime, 379.9, 0.05);
    });

    it('publishes what the car reads on every frame, and nothing it does not', () => {
      for (const key of PUBLISHED_KEYS) {
        expect(tape.present[key], key).toBe(tape.frames);
      }
      // Tyre load reads zero on all four wheels for every car, and an LMGT3
      // has no hybrid: absent, not published as 0.
      for (const key of WITHHELD_KEYS) {
        expect(tape.present[key], key).toBe(0);
      }
    });

    describe('per wheel', () => {
      it('gives ride height in millimetres', () => {
        // The setup screen says 54 mm at the front and 63 mm at the rear.
        expectAllNear(
          means('LmuWheelRideHeight'),
          [50.6, 49.8, 59.5, 58.7],
          0.2
        );
        expectHighest(highest('LmuWheelRideHeight'), 156.84, 12);
        // Not floored at zero: the right front reads below the road twice.
        expectLowest(lowest('LmuWheelRideHeight'), -1.54, 3);
        const { negatives } = tape.wheels.LmuWheelRideHeight;
        expect(negatives[0] + negatives[2] + negatives[3]).toBe(0);
        expect(negatives[1]).toBeLessThanOrEqual(2);
      });

      it('gives suspension travel in millimetres', () => {
        expectAllNear(
          means('LmuSuspensionPosition'),
          [64.8, 65.6, 76.6, 77.9],
          0.2
        );
        expectLowest(lowest('LmuSuspensionPosition'), 50.13, 1);
        expectHighest(highest('LmuSuspensionPosition'), 109.4, 3);
      });

      it('gives suspension force in newtons, negative on a drooping wheel', () => {
        expectLowest(lowest('LmuSuspensionForce'), -1677.84, 700);
        expectHighest(highest('LmuSuspensionForce'), 21_365.55, 3500);
        // The four together, which is what a load share is taken from while
        // the sim publishes no tyre load.
        const total = means('LmuSuspensionForce').reduce((sum, v) => sum + v);
        expectNear(total, 18_938, 15);
      });

      it('gives tyre deflection in millimetres, zero with the wheel in the air', () => {
        expectAllNear(
          means('LmuTyreDeflection'),
          [15.9, 17.1, 18.9, 20.1],
          0.1
        );
        expectHighest(highest('LmuTyreDeflection'), 67.59, 8);
        expect(lowest('LmuTyreDeflection')).toBe(0);
        // 277 wheel-frames off the ground on the whole recording: 97, 132,
        // 42 and 6.
        const { zeros } = tape.wheels.LmuTyreDeflection;
        expectCount(zeros[0], 97, 5);
        expectCount(zeros[1], 132, 5);
        expectCount(zeros[2], 42, 5);
        expectCount(zeros[3], 6, 5);
      });

      it('gives camber in degrees, negative on both sides', () => {
        // Against a setup of -2.0 at the front and -1.5 at the rear.
        expectAllNear(
          means('LmuWheelCamber'),
          [-2.01, -2.18, -1.7, -1.61],
          0.01
        );
        // Kerbs throw it a long way either side.
        expectHighest(highest('LmuWheelCamber'), 20.46, 4);
        expectLowest(lowest('LmuWheelCamber'), -24.82, 4);
      });

      it('gives toe in degrees, positive pointing right', () => {
        const [leftFront, rightFront, leftRear, rightRear] =
          tape.wheels.LmuWheelToe.ranges;
        // The rears are steady and toed in: positive on the left wheel,
        // negative on the right, a fifth of a degree between them.
        expectNear(leftRear.min, 0.0494, 0.002);
        expectNear(leftRear.max, 0.1372, 0.002);
        expectNear(rightRear.min, -0.1331, 0.002);
        expectNear(rightRear.max, -0.0434, 0.002);
        expectNear(meanOf(leftRear) - meanOf(rightRear), 0.208, 0.002);
        // The fronts carry the steering angle as well.
        expectLowest(Math.min(leftFront.min, rightFront.min), -11.37, 1);
        expectHighest(Math.max(leftFront.max, rightFront.max), 9.08, 1);
      });

      it('gives wheel rotation in radians a second, negative forwards', () => {
        expectLowest(lowest('LmuWheelRotation'), -192.41, 3);
        expectHighest(highest('LmuWheelRotation'), -43.09, 5);
        expect(tape.wheels.LmuWheelRotation.negatives).toEqual([
          tape.frames,
          tape.frames,
          tape.frames,
          tape.frames,
        ]);
      });

      it('gives the static tyre radius in metres, in one cell throughout', () => {
        expect([...tape.staticRadii]).toEqual(['0.34,0.34,0.36,0.36']);
        expect(tape.cells.LmuTyreStaticRadius.size).toBe(1);
      });

      it('gives the surface under each wheel as the sim numbers it', () => {
        // Road, the run-off (4) and kerbs (5): 57,200, 76 and 4,440
        // wheel-frames on the whole recording.
        expect(Object.keys(tape.surfaces)).toEqual(['0', '4', '5']);
        expectCount(tape.surfaces[4], 76, 8);
        expectCount(tape.surfaces[5], 4440, 160);
        expect(tape.surfaces[0] + tape.surfaces[4] + tape.surfaces[5]).toBe(
          tape.frames * 4
        );
        // A new cell only when a wheel changes surface: some six hundred of
        // them, not one per frame.
        expect(tape.cells.LmuWheelSurfaceType.size).toBeGreaterThan(100);
        expect(tape.cells.LmuWheelSurfaceType.size).toBeLessThan(800);
      });

      it('reports no flat tyre and no lost wheel, in one cell each', () => {
        expect(tape.flatWheelFrames).toBe(0);
        expect(tape.detachedWheelFrames).toBe(0);
        expect(tape.cells.LmuTyreFlat.size).toBe(1);
        expect(tape.cells.LmuWheelDetached.size).toBe(1);
      });
    });

    describe('the chassis', () => {
      it('gives third-spring deflection in millimetres, front then rear', () => {
        const [front, rear] = tape.thirdSprings;
        expectLowest(front.min, 52.0, 1);
        expectHighest(front.max, 85.4, 2);
        expectLowest(rear.min, 55.42, 1);
        expectHighest(rear.max, 106.18, 3);
        // This car has no third spring, and the sim fills the field with the
        // mean of the axle's two suspension travels.
        expect(tape.thirdSpringError).toBeLessThan(1e-9);
      });

      it('carries the five impacts, each on the clock SessionTime runs on', () => {
        const [before, ...impacts] = tape.impacts;
        // Nothing until the first one: zeros, not a sentinel.
        expect(before).toMatchObject({
          time: 0,
          magnitude: 0,
          position: [0, 0, 0],
        });

        const recorded = recordedImpacts(impacts.length);
        expectAllNear(
          impacts.map((impact) => impact.time),
          recorded.map((impact) => impact.time),
          0.001
        );
        expectAllNear(
          impacts.map((impact) => impact.magnitude),
          recorded.map((impact) => impact.magnitude),
          0.1
        );
        // Each is stamped a frame or so before the frame that first carries
        // it, or two where a frame was missed.
        for (const impact of impacts) {
          expect(impact.seenAt - impact.time).toBeGreaterThanOrEqual(0);
          expect(impact.seenAt - impact.time).toBeLessThan(0.05);
        }
      });

      it('says where each impact landed, in car axes, a new cell for each', () => {
        const impacts = tape.impacts.slice(1);
        const recorded = recordedImpacts(impacts.length);
        expect(impacts).toHaveLength(recorded.length);
        recorded.forEach((impact, index) =>
          expectAllNear(impacts[index].position, impact.position, 0.001)
        );
        // The zeros before the first, then one for each impact.
        expect(tape.cells.LmuLastImpactPos.size).toBe(1 + recorded.length);
      });

      it('raises the first dent level once, with the hardest impact', () => {
        expect(tape.dents.map((dent) => dent.levels)).toEqual([
          [0, 0, 0, 0, 0, 0, 0, 0],
          [1, 0, 0, 0, 0, 0, 0, 0],
        ]);
        expectNear(tape.dents[1].seenAt, 240.73, 0.03);
        // On the very frame the 3,017 impact first shows.
        expect(tape.dents[1].seenAt).toBe(tape.impacts[2].seenAt);
        expect(tape.cells.LmuDentSeverity.size).toBe(2);
      });

      it('reports nothing detached and no overheating', () => {
        expect(tape.bodyDetachedFrames).toBe(0);
        expect(tape.overheatingFrames).toBe(0);
      });
    });

    describe('the hybrid system', () => {
      it('says the LMGT3 has none, and is not lifting and coasting', () => {
        // State 0 is "not available", and with it the battery and the four
        // motor readings are left out: see the withheld keys above.
        expect(tape.motorState).toMatchObject({ min: 0, max: 0 });
        expect(tape.liftAndCoast).toMatchObject({ min: 0, max: 0 });
      });
    });

    describe('per car', () => {
      const all38 = (value: number | boolean) =>
        Array.from({ length: 38 }, () => value).join(',');

      it('has no car asking for a stop, stopping or in its garage', () => {
        // 38 cars in slots 0 to 37, so no slot reads the empty -1.
        expect([...tape.pitStates]).toEqual([all38(0)]);
        expect([...tape.pitStops]).toEqual([all38(0)]);
        expect([...tape.inGarage]).toEqual([all38(false)]);
      });

      it('publishes each of the three in one cell for the whole race', () => {
        expect(tape.cells.LmuCarIdxPitState.size).toBe(1);
        expect(tape.cells.LmuCarIdxPitStops.size).toBe(1);
        expect(tape.cells.LmuCarIdxInGarage.size).toBe(1);
      });
    });

    describe('the session', () => {
      it('ends at 1,035 s on the session clock', () => {
        expect([...tape.sessionEnds]).toEqual([1035]);
      });
    });

    describe('the car in the world', () => {
      it('gives the position in metres, with the elevation second', () => {
        const [x, y, z] = tape.position;
        expectLowest(x.min, -405.66, 5);
        expectHighest(x.max, 382.48, 5);
        expectLowest(z.min, -496.3, 5);
        expectHighest(z.max, 475.4, 5);
        // Laguna Seca climbs 55 m from its lowest point to the Corkscrew.
        expectLowest(y.min, -15.43, 1);
        expectHighest(y.max, 39.76, 1);
        // Metres: the distance from one position to the next adds up to
        // the distance Speed says the car covered, 9.8 km in four minutes.
        expectNear(tape.pathLength, 9816, 30);
        expectNear(tape.pathLength / tape.speedDistance, 1, 0.001);
      });

      it('gives a heading that stays on the direction of travel', () => {
        expect(tape.yawNorth.min).toBeGreaterThanOrEqual(0);
        expect(tape.yawNorth.max).toBeLessThan(2 * Math.PI);
        // The whole circle is used: two and a bit laps of a circuit.
        expect(tape.yawNorth.min).toBeLessThan(0.05);
        expect(tape.yawNorth.max).toBeGreaterThan(6.23);
        // Within 0.6 degrees of the way the car is moving on average, and
        // 11 degrees at the most, in a slide.
        expectNear(meanOf(tape.headingError), 0.011, 0.003);
        expect(tape.headingError.max).toBeLessThan(0.25);
      });

      it('gives velocity forwards, to the left and up', () => {
        const [forwards, toTheLeft, upwards] = tape.velocity;
        // Never slower than 17 m/s, never backwards.
        expectLowest(forwards.min, 16.85, 0.5);
        expectHighest(forwards.max, 64.37, 0.5);
        expectLowest(toTheLeft.min, -6.83, 1);
        expectHighest(toTheLeft.max, 2.45, 1);
        expectLowest(upwards.min, -0.54, 0.2);
        expectHighest(upwards.max, 1.21, 0.2);
        expect(tape.speedError).toBeLessThan(1e-9);
      });

      it('reads braking as negative and accelerating as positive', () => {
        // iRacing's sign. With the raw brake above 0.8, and flat out. One
        // frame of an impact reads 108 m/s2, so the braking mean moves by a
        // few tenths with which frames a run sees.
        expectNear(meanOf(tape.longAccelBraking), -17.8, 1);
        expectNear(tape.longAccelBraking.count, 301, 8);
        expectNear(meanOf(tape.longAccelFullThrottle), 3.49, 0.1);
        expect(tape.longAccelFullThrottle.count).toBeGreaterThan(8500);
      });

      it('reads a left-hand corner as positive lateral acceleration', () => {
        expectNear(meanOf(tape.latAccelSteeringLeft), 13.4, 0.5);
        expectNear(meanOf(tape.latAccelSteeringRight), -13.2, 0.5);
        expect(tape.latAccelSteeringLeft.count).toBeGreaterThan(3000);
        expect(tape.latAccelSteeringRight.count).toBeGreaterThan(1500);
      });
    });
  }
);
