import { beforeAll, describe, expect, it } from 'vitest';
import { getWidgetDefaultConfig } from '@irdashies/types';
import { isPressureCold } from '@irdashies/shared';
import {
  LMU_CURATED_TAPE_PATH,
  lmuTapeAvailable,
  playLmuTape,
} from '../../testing/lmuTape';
import { takeTick, type TickSchedule } from './ProcessorHost';
import { TyreStateProcessor } from './TyreStateProcessor';

/**
 * The tyre pressures on a recorded Le Mans Ultimate race, and what the tyre
 * widget's two pressure rules make of them: four minutes at Laguna Seca in a
 * Ferrari 296 LMGT3 on warm tyres, set to 136 kPa cold.
 *
 * The recording starts with the tyres already hot and has no pit stop, so
 * the cold tint and a tyre change can only be seen to stay away here; what
 * they look like is left to the unit specs.
 *
 * A tick takes one frame in twenty, and not the same one on every run: the
 * replay loses a frame now and then, more of them on a busy machine, and a
 * tick whose frame is lost takes the next. The averages do not notice. The
 * highest pressure of the race does, being a kerb's work for a frame or two,
 * and so does a count of the ticks on which two pressures tie. Those are
 * pinned to the span they moved over when the ticks were shifted by up to
 * seventeen frames.
 *
 * Windows only, like the other tape specs.
 */

const TYRES = getWidgetDefaultConfig('tyres');

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

const perWheel = (): Range[] => [
  emptyRange(),
  emptyRange(),
  emptyRange(),
  emptyRange(),
];

interface Recording {
  ticks: number;
  unavailableTicks: number;
  pressure: Range[];
  carcass: Range[];
  deviation: Range[];
  /** The four deviations on the first tick. */
  firstDeviations: (number | null)[];
  /** Wheel-ticks with no deviation to show. */
  missingDeviations: number;
  /** Ticks on which no wheel read 0.0, which one always should. */
  ticksWithoutAHighest: number;
  /** Ticks on which each wheel was the one reading 0.0. */
  highest: number[];
  /** Wheel-ticks on which the pressure would be drawn as cold. */
  coldTicks: number;
}

const emptyRecording = (): Recording => ({
  ticks: 0,
  unavailableTicks: 0,
  pressure: perWheel(),
  carcass: perWheel(),
  deviation: perWheel(),
  firstDeviations: [],
  missingDeviations: 0,
  ticksWithoutAHighest: 0,
  highest: [0, 0, 0, 0],
  coldTicks: 0,
});

/** Plays the tape once, keeping only what the cases below assert on. */
const readRecording = async (): Promise<Recording> => {
  const tape = emptyRecording();
  const processor = new TyreStateProcessor();
  // The host's own schedule, so a tick falls where it would in the app.
  const schedule: TickSchedule = {};
  let started = false;

  await playLmuTape({
    tapePath: LMU_CURATED_TAPE_PATH,
    speed: 20,
    onFrame: ({ telemetry, session, sessionTime }) => {
      if (!started) {
        started = true;
        processor.init(session);
        processor.onLifecycle({ type: 'enter', replay: false });
      }
      if (!takeTick(schedule, processor.tickRateHz, sessionTime)) return;
      processor.onFrame(telemetry);
      const { available, wheels } = processor.snapshot();
      tape.ticks += 1;
      if (!available) tape.unavailableTicks += 1;
      if (tape.ticks === 1) {
        tape.firstDeviations = wheels.map(
          (wheel) => wheel.pressureDeviationKpa
        );
      }

      let hasHighest = false;
      wheels.forEach((wheel, index) => {
        if (wheel.pressureKpa !== null) {
          widen(tape.pressure[index], wheel.pressureKpa);
        }
        if (wheel.carcassTempC !== null) {
          widen(tape.carcass[index], wheel.carcassTempC);
        }
        if (isPressureCold(wheel.carcassTempC, TYRES.pressureColdBelow)) {
          tape.coldTicks += 1;
        }
        const deviation = wheel.pressureDeviationKpa;
        if (deviation === null) {
          tape.missingDeviations += 1;
          return;
        }
        widen(tape.deviation[index], deviation);
        if (deviation === 0) {
          hasHighest = true;
          tape.highest[index] += 1;
        }
      });
      if (!hasHighest) tape.ticksWithoutAHighest += 1;
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

/** A figure that depends on which frames the ticks took: anywhere in a span. */
const expectWithin = (actual: number, low: number, high: number) => {
  expect(actual).toBeGreaterThanOrEqual(low);
  expect(actual).toBeLessThanOrEqual(high);
};

describe.skipIf(!lmuTapeAvailable())(
  'the tyre pressures on a recorded LMU race',
  () => {
    let tape = emptyRecording();

    beforeAll(async () => {
      tape = await readRecording();
    }, 120_000);

    it('ticks five times a second from end to end, with the wheels read', () => {
      // 240 s of the session clock.
      expectNear(tape.ticks, 1200, 5);
      expect(tape.unavailableTicks).toBe(0);
    });

    it('reads the four pressures hot, within 9 kPa of each other', () => {
      expectAllNear(
        tape.pressure.map(meanOf),
        [170.28, 171.1, 169.44, 170.04],
        0.1
      );
      // A kerb squeezes a tyre for a frame or two, so the highest a tick
      // sees is anything from 175.5 to 176.3 kPa.
      expectWithin(
        Math.min(...tape.pressure.map((range) => range.min)),
        167,
        168
      );
      expectWithin(
        Math.max(...tape.pressure.map((range) => range.max)),
        175,
        176.6
      );
    });

    it('has a deviation for every wheel from the first tick', () => {
      expect(tape.missingDeviations).toBe(0);
      // The four start within 0.2 kPa of each other, so the first offsets
      // are 0.0 on one wheel and no more than 0.2 on the others.
      expect(tape.firstDeviations).toHaveLength(4);
      const first = tape.firstDeviations.map((deviation) => deviation ?? -1);
      expect(Math.min(...first)).toBe(0);
      expect(Math.max(...first)).toBeLessThanOrEqual(0.3);
    });

    it('keeps every deviation within a few kPa', () => {
      // The widget's row has room for "-0.5" in psi: 3.5 kPa is the most.
      const most = tape.deviation.map((range) => range.max);
      expectAllNear(most, [2.2, 0.6, 3.45, 1.9], 0.3);
      expect(Math.max(...most)).toBeLessThanOrEqual(5);
      expect(Math.min(...tape.deviation.map((range) => range.min))).toBe(0);
      expectAllNear(tape.deviation.map(meanOf), [0.82, 0.03, 1.63, 1.05], 0.05);
    });

    it('always has a wheel that reads 0.0, on nine ticks in ten the right front', () => {
      expect(tape.ticksWithoutAHighest).toBe(0);
      // Some 120, 1,090, 30 and 12 ticks of 1,200, two wheels sharing a tick
      // now and then: each of the four is the highest at some point, and
      // the right front by far the most often.
      const [leftFront, rightFront, leftRear, rightRear] = tape.highest;
      expect(rightFront).toBeGreaterThan(tape.ticks * 0.85);
      expectWithin(leftFront, 80, 160);
      expect(leftRear).toBeGreaterThan(0);
      expect(rightRear).toBeGreaterThan(0);
      expect(leftRear + rightRear).toBeLessThan(tape.ticks * 0.06);
    });

    it('never draws a pressure as cold on tyres that are up to temperature', () => {
      // Carcasses between 77.5 and 82.8 C against a threshold of 65.
      expect(
        Math.min(...tape.carcass.map((range) => range.min))
      ).toBeGreaterThan(TYRES.pressureColdBelow + 10);
      expectNear(
        Math.max(...tape.carcass.map((range) => range.max)),
        82.8,
        0.3
      );
      expect(tape.coldTicks).toBe(0);
    });
  }
);
