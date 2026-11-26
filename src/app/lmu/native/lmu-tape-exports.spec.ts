import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { LmuRawTelemetry } from './index';

/**
 * Pins what the addon returns, on the recorded Le Mans Ultimate race, for the
 * shared-memory fields the wheel, damage, hybrid and start-light widgets read.
 *
 * The replay addon is the production lmu_node.cc over a tape, so this is the
 * export itself being checked: a field read from the wrong struct member, or
 * converted on the way out, shows here rather than in a widget.
 *
 * The figures were first measured by decoding the recording directly. They are
 * pinned here to what the addon returns, which differs in four places:
 *
 * - one frame fewer, because start() takes the first snapshot for itself;
 * - ride height dips to -1.5 mm, on two frames of the right front, so the
 *   range does not start at the 4 mm the left front bottoms out at;
 * - force feedback spans -0.753 to +0.950, not -0.70 to +0.92: seven frames
 *   lie outside the narrower range;
 * - the start light, which the decode did not look at, is not dark
 *   throughout: it reads 4 for the first five seconds and 0 after.
 *
 * Read at the addon's top speed; the tape is never skipped ahead, so every
 * recorded frame is seen however slowly this runs.
 *
 * Windows only, like the other tape specs.
 */

const addonPath = path.resolve('build/Release/lmu_tape_node.node');
const tapePath = path.resolve('test-data/telemetry/lmu-session.lmudt');
const available =
  fs.existsSync(addonPath) &&
  fs.existsSync(tapePath) &&
  fs.statSync(tapePath).size > 1024;

/** Every export under test, with the shape the addon gives it. */
const SHAPES = {
  // Per wheel, the player's car: LF, RF, LR, RR.
  wheelRideHeight: 'Float64Array(4)',
  suspensionForce: 'Float64Array(4)',
  tyreLoad: 'Float64Array(4)',
  tyreVerticalDeflection: 'Float64Array(4)',
  wheelCamber: 'Float64Array(4)',
  wheelToe: 'Float64Array(4)',
  wheelRotation: 'Float64Array(4)',
  tyreStaticRadius: 'Uint8Array(4)',
  wheelSurfaceType: 'Uint8Array(4)',
  tyreFlat: 'Uint8Array(4)',
  wheelDetached: 'Uint8Array(4)',
  // The player's car.
  front3rdDeflection: 'number',
  rear3rdDeflection: 'number',
  lastImpactET: 'number',
  lastImpactMagnitude: 'number',
  lastImpactPos: 'Float64Array(3)',
  dentSeverity: 'Uint8Array(8)',
  detached: 'boolean',
  overheating: 'boolean',
  electricBoostMotorState: 'number',
  electricBoostMotorTorque: 'number',
  electricBoostMotorRPM: 'number',
  electricBoostMotorTemperature: 'number',
  electricBoostWaterTemperature: 'number',
  liftAndCoastProgress: 'number',
  wiperState: 'number',
  physicalSteeringWheelRange: 'number',
  // The session.
  startLight: 'number',
  numRedLights: 'number',
  ffbTorque: 'number',
  // Per car: one entry for each of the 38 on the grid.
  vehNumPitstops: 'Int32Array(38)',
} as const satisfies Partial<Record<keyof LmuRawTelemetry, string>>;

type ExportName = keyof typeof SHAPES;
const EXPORTS = Object.keys(SHAPES) as ExportName[];

/** A frame with a car in it: every export, and the two fields read beside them. */
type ExportedFrame = LmuRawTelemetry &
  Required<
    Pick<LmuRawTelemetry, ExportName | 'elapsedTime' | 'suspensionDeflection'>
  >;

const hasExports = (frame: LmuRawTelemetry): frame is ExportedFrame =>
  frame.elapsedTime !== undefined &&
  frame.suspensionDeflection !== undefined &&
  EXPORTS.every((name) => frame[name] !== undefined);

const shapeOf = (value: unknown): string =>
  ArrayBuffer.isView(value)
    ? `${value.constructor.name}(${(value as unknown as ArrayLike<number>).length})`
    : typeof value;

const WHEEL_FLOATS = [
  'wheelRideHeight',
  'suspensionForce',
  'tyreLoad',
  'tyreVerticalDeflection',
  'wheelCamber',
  'wheelToe',
  'wheelRotation',
] as const;
type WheelFloat = (typeof WHEEL_FLOATS)[number];

const SCALARS = [
  'front3rdDeflection',
  'rear3rdDeflection',
  'electricBoostMotorState',
  'electricBoostMotorTorque',
  'electricBoostMotorRPM',
  'electricBoostMotorTemperature',
  'electricBoostWaterTemperature',
  'liftAndCoastProgress',
  'wiperState',
  'physicalSteeringWheelRange',
  'numRedLights',
  'ffbTorque',
] as const;
type Scalar = (typeof SCALARS)[number];

interface Range {
  min: number;
  max: number;
}

/** One entry per wheel in each array. */
interface WheelStats {
  min: number[];
  max: number[];
  sum: number[];
  /** Frames on which the wheel read exactly 0. */
  zeros: number[];
  /** Frames on which it read below 0. */
  negatives: number[];
}

interface Impact {
  /** The player's clock on the first frame to carry it. */
  seenAt: number;
  at: number;
  magnitude: number;
  position: number[];
}

interface Recording {
  /** False when the read stopped at its deadline rather than the tape's end. */
  complete: boolean;
  frames: number;
  /** Frames missing any of the exports. */
  incomplete: number;
  firstClock: number;
  lastClock: number;
  shapes: Record<string, string>;
  wheels: Record<WheelFloat, WheelStats>;
  scalars: Record<Scalar, Range>;
  staticRadii: Set<string>;
  /** Wheel-frames spent on each surface type. */
  surfaces: Record<number, number>;
  flatWheelFrames: number;
  detachedWheelFrames: number;
  /** Furthest a third-spring reading sat from the mean of its axle. */
  thirdSpringError: number;
  /** What the impact fields held on the first frame, then each change. */
  impacts: Impact[];
  /** The dent levels on the first frame, then each change. */
  dents: { seenAt: number; levels: number[] }[];
  detachedFrames: number;
  overheatingFrames: number;
  /** The start light on the first frame, then each change, by scoring's clock. */
  startLights: { at: number; light: number }[];
  pitStopSlots: Set<number>;
  pitStops: Range;
}

const emptyRange = (): Range => ({ min: Infinity, max: -Infinity });

const widen = (range: Range, value: number) => {
  range.min = Math.min(range.min, value);
  range.max = Math.max(range.max, value);
};

const emptyWheelStats = (): WheelStats => ({
  min: [Infinity, Infinity, Infinity, Infinity],
  max: [-Infinity, -Infinity, -Infinity, -Infinity],
  sum: [0, 0, 0, 0],
  zeros: [0, 0, 0, 0],
  negatives: [0, 0, 0, 0],
});

const emptyRecording = (): Recording => ({
  complete: false,
  frames: 0,
  incomplete: 0,
  firstClock: Number.NaN,
  lastClock: Number.NaN,
  shapes: {},
  wheels: Object.fromEntries(
    WHEEL_FLOATS.map((name) => [name, emptyWheelStats()])
  ) as Record<WheelFloat, WheelStats>,
  scalars: Object.fromEntries(
    SCALARS.map((name) => [name, emptyRange()])
  ) as Record<Scalar, Range>,
  staticRadii: new Set(),
  surfaces: {},
  flatWheelFrames: 0,
  detachedWheelFrames: 0,
  thirdSpringError: 0,
  impacts: [],
  dents: [],
  detachedFrames: 0,
  overheatingFrames: 0,
  startLights: [],
  pitStopSlots: new Set(),
  pitStops: emptyRange(),
});

const observe = (tape: Recording, frame: ExportedFrame) => {
  const clock = frame.elapsedTime;
  if (tape.frames === 0) {
    tape.firstClock = clock;
    for (const name of EXPORTS) tape.shapes[name] = shapeOf(frame[name]);
  }
  tape.frames += 1;
  tape.lastClock = clock;

  for (const name of WHEEL_FLOATS) {
    const stats = tape.wheels[name];
    const values = frame[name];
    for (let wheel = 0; wheel < 4; wheel += 1) {
      const value = values[wheel];
      stats.min[wheel] = Math.min(stats.min[wheel], value);
      stats.max[wheel] = Math.max(stats.max[wheel], value);
      stats.sum[wheel] += value;
      if (value === 0) stats.zeros[wheel] += 1;
      if (value < 0) stats.negatives[wheel] += 1;
    }
  }
  for (const name of SCALARS) widen(tape.scalars[name], frame[name]);

  tape.staticRadii.add(Array.from(frame.tyreStaticRadius).join(','));
  for (let wheel = 0; wheel < 4; wheel += 1) {
    const surface = frame.wheelSurfaceType[wheel];
    tape.surfaces[surface] = (tape.surfaces[surface] ?? 0) + 1;
    if (frame.tyreFlat[wheel] !== 0) tape.flatWheelFrames += 1;
    if (frame.wheelDetached[wheel] !== 0) tape.detachedWheelFrames += 1;
  }

  const deflection = frame.suspensionDeflection;
  tape.thirdSpringError = Math.max(
    tape.thirdSpringError,
    Math.abs(frame.front3rdDeflection - (deflection[0] + deflection[1]) / 2),
    Math.abs(frame.rear3rdDeflection - (deflection[2] + deflection[3]) / 2)
  );

  const lastImpact = tape.impacts.at(-1);
  if (
    lastImpact?.at !== frame.lastImpactET ||
    lastImpact.magnitude !== frame.lastImpactMagnitude
  )
    tape.impacts.push({
      seenAt: clock,
      at: frame.lastImpactET,
      magnitude: frame.lastImpactMagnitude,
      position: Array.from(frame.lastImpactPos),
    });

  const levels = Array.from(frame.dentSeverity);
  if (tape.dents.at(-1)?.levels.join(',') !== levels.join(','))
    tape.dents.push({ seenAt: clock, levels });
  if (frame.detached) tape.detachedFrames += 1;
  if (frame.overheating) tape.overheatingFrames += 1;

  if (tape.startLights.at(-1)?.light !== frame.startLight)
    tape.startLights.push({ at: frame.currentET, light: frame.startLight });

  tape.pitStopSlots.add(frame.vehNumPitstops.length);
  for (const stops of Array.from(frame.vehNumPitstops))
    widen(tape.pitStops, stops);
};

/** Reads the whole tape once, keeping only what the cases below assert on. */
const readRecording = async (): Promise<Recording> => {
  vi.stubEnv('IRDASHIES_LMU_REPLAY', tapePath);
  vi.stubEnv('IRDASHIES_LMU_REPLAY_SPEED', '100');
  vi.stubEnv('IRDASHIES_LMU_REPLAY_LOOP', '0');
  const { LmuSdkNode } = createRequire(import.meta.url)(addonPath) as {
    LmuSdkNode: new () => {
      start(): boolean;
      stop(): boolean;
      read(): LmuRawTelemetry;
    };
  };
  const sdk = new LmuSdkNode();
  const tape = emptyRecording();
  try {
    // A tape that will not open leaves `complete` false, which the first
    // case reports, rather than waiting out the deadline below.
    if (!sdk.start()) return tape;
    const deadline = performance.now() + 100_000;
    let lastClock: number | undefined;
    let reads = 0;
    while (!tape.complete && performance.now() < deadline) {
      const frame = sdk.read();
      if (!frame.running) {
        // Not running before the first frame is the tape still opening;
        // after it, the tape has run out.
        if (reads > 0) tape.complete = true;
        else await new Promise((resolve) => setTimeout(resolve, 2));
        continue;
      }
      reads += 1;
      // Between two recorded frames the addon hands back the one it has,
      // as shared memory would. Each is counted once.
      if (reads > 1 && frame.elapsedTime === lastClock) continue;
      lastClock = frame.elapsedTime;
      if (hasExports(frame)) observe(tape, frame);
      else tape.incomplete += 1;
    }
  } finally {
    sdk.stop();
    vi.unstubAllEnvs();
  }
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

describe.skipIf(!available)('LMU exports on a recorded race', () => {
  let tape = emptyRecording();
  const meanOf = (name: WheelFloat) =>
    tape.wheels[name].sum.map((sum) => sum / tape.frames);
  const lowest = (name: WheelFloat) => Math.min(...tape.wheels[name].min);
  const highest = (name: WheelFloat) => Math.max(...tape.wheels[name].max);

  beforeAll(async () => {
    tape = await readRecording();
  }, 120_000);

  it('reads the recording to its end, with every export on every frame', () => {
    expect(tape.complete).toBe(true);
    expect(tape.incomplete).toBe(0);
    // The recording holds 15,430 player frames. start() captures the first to
    // answer whether the sim is there, so a read begins at the second one --
    // unless it comes before that frame's recorded moment, when the addon
    // hands the first back again, as shared memory would. Which of the two a
    // run sees first is the machine's timing, not the recording's, so both
    // are accepted and the count follows from it.
    const startedOnTheFirstFrame = Math.abs(tape.firstClock - 139.9125) < 0.001;
    expect(tape.frames).toBe(startedOnTheFirstFrame ? 15_430 : 15_429);
    expectNear(
      tape.firstClock,
      startedOnTheFirstFrame ? 139.9125 : 139.9325,
      0.001
    );
    expectNear(tape.lastClock, 379.9025, 0.001);
  });

  it('gives every export the shape the widgets were specified against', () => {
    expect(tape.shapes).toEqual(SHAPES);
  });

  describe('per wheel', () => {
    it('reports ride height in metres', () => {
      // The setup screen says 5.4 cm at the front and 6.3 cm at the rear.
      expectAllNear(
        meanOf('wheelRideHeight'),
        [0.0506, 0.0498, 0.0595, 0.0587],
        0.0002
      );
      expectNear(highest('wheelRideHeight'), 0.1568, 0.0005);
      // Not floored at zero: the right front reads below the road twice.
      expectNear(lowest('wheelRideHeight'), -0.0015, 0.0002);
      expect(tape.wheels.wheelRideHeight.negatives).toEqual([0, 2, 0, 0]);
    });

    it('reports suspension force in newtons, negative on a drooping wheel', () => {
      expectNear(lowest('suspensionForce'), -1677.8, 1);
      expectNear(highest('suspensionForce'), 21_365.5, 1);
      // The four together, which is the figure a load share is taken from
      // while the sim publishes no tyre load.
      const total = meanOf('suspensionForce').reduce((sum, v) => sum + v, 0);
      expectNear(total, 18_938.6, 1);
    });

    it('reports no tyre load at all', () => {
      // The sim leaves mTireLoad at zero, so a consumer has to fall back on
      // suspension force. Counted rather than compared, so -0 would pass.
      const every = [tape.frames, tape.frames, tape.frames, tape.frames];
      expect(tape.wheels.tyreLoad.zeros).toEqual(every);
    });

    it('reports tyre deflection in metres, zero with the wheel in the air', () => {
      expectAllNear(
        meanOf('tyreVerticalDeflection'),
        [0.0159, 0.0171, 0.0189, 0.0201],
        0.0002
      );
      expectNear(highest('tyreVerticalDeflection'), 0.0676, 0.0005);
      // 277 wheel-frames off the ground, and never a negative reading.
      expect(tape.wheels.tyreVerticalDeflection.zeros).toEqual([
        97, 132, 42, 6,
      ]);
      expect(tape.wheels.tyreVerticalDeflection.negatives).toEqual([
        0, 0, 0, 0,
      ]);
    });

    it('reports camber in radians, negative on both sides', () => {
      // -2.01, -2.18, -1.70 and -1.61 degrees against a setup of -2.0 front
      // and -1.5 rear.
      expectAllNear(
        meanOf('wheelCamber'),
        [-0.0351, -0.038, -0.0297, -0.0282],
        0.0001
      );
      // Kerbs throw it a long way either side.
      expectNear(highest('wheelCamber'), 0.3571, 0.001);
      expectNear(lowest('wheelCamber'), -0.4332, 0.001);
    });

    it('reports toe in radians, positive pointing right', () => {
      const { min, max } = tape.wheels.wheelToe;
      // The rears are steady and toed in: positive on the left wheel,
      // negative on the right.
      expectNear(min[2], 0.0009, 0.0001);
      expectNear(max[2], 0.0024, 0.0001);
      expectNear(min[3], -0.0023, 0.0001);
      expectNear(max[3], -0.0008, 0.0001);
      // The fronts carry the steering angle as well.
      expectNear(Math.min(min[0], min[1]), -0.1984, 0.001);
      expectNear(Math.max(max[0], max[1]), 0.1584, 0.001);
    });

    it('reports wheel rotation in radians a second, negative forwards', () => {
      expectNear(lowest('wheelRotation'), -192.41, 0.1);
      expectNear(highest('wheelRotation'), -43.09, 0.1);
      expect(tape.wheels.wheelRotation.negatives).toEqual([
        tape.frames,
        tape.frames,
        tape.frames,
        tape.frames,
      ]);
    });

    it('reports the static tyre radius in whole centimetres', () => {
      expect([...tape.staticRadii]).toEqual(['34,34,36,36']);
    });

    it('reports the surface under each wheel as the sim numbers it', () => {
      // Road, the run-off (4, whether the terrain is dirt or gravel) and
      // kerbs. The four wheels of every frame are counted.
      expect(tape.surfaces).toEqual({ 0: 57_200, 4: 76, 5: 4440 });
    });

    it('reports no flat tyre and no lost wheel', () => {
      expect(tape.flatWheelFrames).toBe(0);
      expect(tape.detachedWheelFrames).toBe(0);
    });
  });

  describe('the player’s car', () => {
    it('reports third-spring deflection in metres', () => {
      expectNear(tape.scalars.front3rdDeflection.min, 0.052, 0.0005);
      expectNear(tape.scalars.front3rdDeflection.max, 0.0854, 0.0005);
      expectNear(tape.scalars.rear3rdDeflection.min, 0.0554, 0.0005);
      expectNear(tape.scalars.rear3rdDeflection.max, 0.1062, 0.0005);
      // This car has no third spring, and the sim fills the field with the
      // mean of the axle's two suspension deflections.
      expect(tape.thirdSpringError).toBeLessThan(1e-9);
    });

    it('reports five impacts, each on the player’s own clock', () => {
      const [before, ...impacts] = tape.impacts;
      // Nothing until the first one: zeros, not a sentinel.
      expect(before.at).toBe(0);
      expect(before.magnitude).toBe(0);
      expect(before.position).toEqual([0, 0, 0]);

      expectAllNear(
        impacts.map((impact) => impact.at),
        [147.2, 240.72, 278.34, 284.98, 285.0],
        0.001
      );
      // Unitless. The fourth and fifth are one brush, 20 ms apart.
      expectAllNear(
        impacts.map((impact) => impact.magnitude),
        [1422.7, 3016.9, 1232.9, 39.6, 63.0],
        0.1
      );
      // The same clock as elapsedTime: each impact is stamped a frame or so
      // before the frame that first carries it.
      for (const impact of impacts) {
        expect(impact.seenAt - impact.at).toBeGreaterThanOrEqual(0);
        expect(impact.seenAt - impact.at).toBeLessThan(0.02);
      }
    });

    it('reports where each impact landed, in car axes', () => {
      // All five at the nose, two to two and a half metres ahead of the
      // car's origin, which is consistent with metres and with -z forwards.
      const expected = [
        [-1.007, -0.139, -2.049],
        [-0.567, -0.153, -2.453],
        [0.048, -0.102, -2.538],
        [0.523, -0.224, -2.499],
        [0.499, -0.223, -2.5],
      ];
      const positions = tape.impacts.slice(1).map((impact) => impact.position);
      expect(positions).toHaveLength(expected.length);
      expected.forEach((position, index) =>
        expectAllNear(positions[index], position, 0.001)
      );
    });

    it('raises the first dent level once, with the hardest impact', () => {
      expect(tape.dents.map((dent) => dent.levels)).toEqual([
        [0, 0, 0, 0, 0, 0, 0, 0],
        [1, 0, 0, 0, 0, 0, 0, 0],
      ]);
      expectNear(tape.dents[1].seenAt, 240.7325, 0.001);
      // On the very frame the 3,017 impact first shows.
      expect(tape.dents[1].seenAt).toBe(tape.impacts[2].seenAt);
    });

    it('reports nothing detached and no overheating', () => {
      expect(tape.detachedFrames).toBe(0);
      expect(tape.overheatingFrames).toBe(0);
    });

    it('reports no hybrid on an LMGT3', () => {
      // State 0 is "not available". The other four read 0 with it, so this
      // recording says nothing about their units: the motor's torque, speed
      // and both temperatures stay unconfirmed until a Hypercar is recorded.
      const none = { min: 0, max: 0 };
      expect(tape.scalars.electricBoostMotorState).toEqual(none);
      expect(tape.scalars.electricBoostMotorTorque).toEqual(none);
      expect(tape.scalars.electricBoostMotorRPM).toEqual(none);
      expect(tape.scalars.electricBoostMotorTemperature).toEqual(none);
      expect(tape.scalars.electricBoostWaterTemperature).toEqual(none);
    });

    it('reports no lift and coast, wipers at 1 and no physical wheel range', () => {
      expect(tape.scalars.liftAndCoastProgress).toEqual({ min: 0, max: 0 });
      // 1 for the whole of a dry race, which is why its meaning ("auto" by
      // TinyPedal's reading) is still unconfirmed.
      expect(tape.scalars.wiperState).toEqual({ min: 1, max: 1 });
      // Never filled in here, while the visual range reads 719 degrees.
      expect(tape.scalars.physicalSteeringWheelRange).toEqual({
        min: 0,
        max: 0,
      });
    });
  });

  describe('the session', () => {
    it('reads one past the red lights for five seconds, then nothing', () => {
      // Three reds in the sequence, so 4 is one past them, which fits a
      // green light: the recording opens with the race already under way,
      // and the reading drops to 0 when scoring's clock reaches 145 s. The
      // countdown through the reds is not on this recording.
      expect(tape.scalars.numRedLights).toEqual({ min: 3, max: 3 });
      expect(tape.startLights.map((step) => step.light)).toEqual([4, 0]);
      expectNear(tape.startLights[0].at, 139.8, 0.01);
      expectNear(tape.startLights[1].at, 145, 0.01);
    });

    it('reports force feedback as a signed fraction of full force', () => {
      expectNear(tape.scalars.ffbTorque.min, -0.7531, 0.001);
      expectNear(tape.scalars.ffbTorque.max, 0.9498, 0.001);
    });
  });

  describe('per car', () => {
    it('counts no pit stop for any of the 38 cars', () => {
      expect([...tape.pitStopSlots]).toEqual([38]);
      expect(tape.pitStops).toEqual({ min: 0, max: 0 });
    });
  });
});
