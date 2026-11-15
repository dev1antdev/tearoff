import { beforeAll, describe, expect, it } from 'vitest';
import {
  STANDARD_GRAVITY,
  type GForceSnapshot,
  type Telemetry,
} from '@irdashies/types';
import {
  LMU_CURATED_TAPE_PATH,
  lmuTapeAvailable,
  playLmuTape,
} from '../../testing/lmuTape';
import { GForceProcessor } from './GForceProcessor';
import {
  sessionSecondsFrameClock,
  takeTick,
  type TickSchedule,
} from './ProcessorHost';

/**
 * The friction circle's channel on the recorded Le Mans Ultimate race: four
 * minutes in an LMGT3 at Laguna Seca, with five knocks to the nose.
 *
 * Played through the mapper and handed to the processor on the host's
 * schedule, sixty times a second, as the app does.
 *
 * The replay drops a few dozen of the 15,430 frames, a different few on each
 * run (see frameKeys.tape.spec.ts), so an extreme is held from the outside
 * with room inside it for a run that missed the frame that set it.
 *
 * Windows only, like the other tape specs.
 */

const number = (telemetry: Telemetry, key: keyof Telemetry): number =>
  (telemetry[key]?.value?.[0] as number | undefined) ?? 0;

/** What a frame is without the sim's time of the last impact. */
const withoutImpactTime = (telemetry: Telemetry): Telemetry => ({
  ...telemetry,
  LmuLastImpactTime: undefined,
});

interface Mean {
  sum: number;
  count: number;
}

interface Recording {
  ticks: number;
  /** Ticks on which the snapshot's version moved. */
  publishes: number;
  unavailableTicks: number;
  /** Highest of each held figure over the whole recording. */
  maxLatG: number;
  maxLongG: number;
  sustainedLatG: number;
  /** The same two maxima from a processor that is told of no impact. */
  ungatedMaxLatG: number;
  ungatedMaxLongG: number;
  /** Largest readings of the frames themselves, g. */
  rawBraking: number;
  rawAccelerating: number;
  /** When the sustained figure last rose, and to what. */
  sustainedSetAt: number;
  /** Lateral g with the wheel turned each way. */
  steeringLeft: Mean;
  steeringRight: Mean;
  /** Ticks on which the published reading was not the frame's own. */
  readingMismatches: number;
  last: GForceSnapshot | null;
}

/** Radians of steering before a frame counts as cornering. */
const CORNERING_STEER = 0.1;

const play = async (): Promise<Recording> => {
  const processor = new GForceProcessor();
  const ungated = new GForceProcessor();
  const schedule: TickSchedule = {};
  const tape: Recording = {
    ticks: 0,
    publishes: 0,
    unavailableTicks: 0,
    maxLatG: 0,
    maxLongG: 0,
    sustainedLatG: 0,
    ungatedMaxLatG: 0,
    ungatedMaxLongG: 0,
    rawBraking: 0,
    rawAccelerating: 0,
    sustainedSetAt: 0,
    steeringLeft: { sum: 0, count: 0 },
    steeringRight: { sum: 0, count: 0 },
    readingMismatches: 0,
    last: null,
  };
  let started = false;
  let lastVersion = -1;
  await playLmuTape({
    tapePath: LMU_CURATED_TAPE_PATH,
    speed: 20,
    onFrame: ({ telemetry, session, sessionTime }) => {
      if (!started) {
        started = true;
        for (const each of [processor, ungated]) {
          each.init(session);
          each.onLifecycle({ type: 'enter', replay: false });
        }
      }
      const longG = number(telemetry, 'LongAccel') / STANDARD_GRAVITY;
      tape.rawBraking = Math.max(tape.rawBraking, -longG);
      tape.rawAccelerating = Math.max(tape.rawAccelerating, longG);

      if (!takeTick(schedule, 60, sessionSecondsFrameClock(telemetry))) return;
      tape.ticks += 1;
      processor.onFrame(telemetry);
      ungated.onFrame(withoutImpactTime(telemetry));

      const snapshot = processor.snapshot();
      if (snapshot.version !== lastVersion) tape.publishes += 1;
      lastVersion = snapshot.version;
      if (!snapshot.available) tape.unavailableTicks += 1;
      tape.maxLatG = Math.max(tape.maxLatG, snapshot.maxLatG);
      tape.maxLongG = Math.max(tape.maxLongG, snapshot.maxLongG);
      if (snapshot.sustainedLatG > tape.sustainedLatG) {
        tape.sustainedLatG = snapshot.sustainedLatG;
        tape.sustainedSetAt = sessionTime;
      }
      tape.ungatedMaxLatG = Math.max(
        tape.ungatedMaxLatG,
        ungated.snapshot().maxLatG
      );
      tape.ungatedMaxLongG = Math.max(
        tape.ungatedMaxLongG,
        ungated.snapshot().maxLongG
      );

      const latG = number(telemetry, 'LatAccel') / STANDARD_GRAVITY;
      if (
        Math.abs(snapshot.latG - latG) > 0.005 + 1e-9 ||
        Math.abs(snapshot.longG - longG) > 0.005 + 1e-9
      ) {
        tape.readingMismatches += 1;
      }
      const steer = number(telemetry, 'SteeringWheelAngle');
      if (steer > CORNERING_STEER) {
        tape.steeringLeft.sum += snapshot.latG;
        tape.steeringLeft.count += 1;
      }
      if (steer < -CORNERING_STEER) {
        tape.steeringRight.sum += snapshot.latG;
        tape.steeringRight.count += 1;
      }
      tape.last = snapshot;
    },
  });
  return tape;
};

const mean = ({ sum, count }: Mean): number => sum / count;

/**
 * The highest reading on the recording: never above the pinned figure, and
 * below it by no more than `slack`, for a run that missed its frame.
 */
const expectHighest = (actual: number, pinned: number, slack: number) => {
  expect(actual).toBeLessThanOrEqual(pinned + 0.005);
  expect(actual).toBeGreaterThanOrEqual(pinned - slack);
};

describe.skipIf(!lmuTapeAvailable())(
  'the g-force channel on a recorded LMU race',
  () => {
    let tape: Recording;

    beforeAll(async () => {
      tape = await play();
    }, 120_000);

    it('reads the whole recording, in the car throughout', () => {
      // 15,430 frames in 240 s, of which the host's sixty a second let
      // some 14,400 through.
      expect(tape.ticks).toBeGreaterThan(14_000);
      expect(tape.ticks).toBeLessThan(14_500);
      expect(tape.unavailableTicks).toBe(0);
      expect(tape.readingMismatches).toBe(0);
    });

    it('publishes on nearly every tick of a car that is being driven', () => {
      // The reading moves by a hundredth of a g from one tick to the next
      // almost always: 14,175 of 14,393 on one run.
      expect(tape.publishes).toBeGreaterThan(tape.ticks * 0.95);
      expect(tape.publishes).toBeLessThanOrEqual(tape.ticks);
    });

    it('reads a left-hand corner as positive lateral g', () => {
      // The wheel past 0.1 rad either way: +0.99 g and -0.90 g.
      expect(mean(tape.steeringLeft)).toBeGreaterThan(0.9);
      expect(mean(tape.steeringLeft)).toBeLessThan(1.1);
      expect(mean(tape.steeringRight)).toBeLessThan(-0.8);
      expect(mean(tape.steeringRight)).toBeGreaterThan(-1.0);
      expect(tape.steeringLeft.count).toBeGreaterThan(6_000);
      expect(tape.steeringRight.count).toBeGreaterThan(4_000);
    });

    it('holds a lateral maximum of 3.02 g', () => {
      expectHighest(tape.maxLatG, 3.02, 0.1);
    });

    it('keeps the longitudinal maximum under 2.5 g with the impacts gated', () => {
      // 2.43 g of braking at 239.0 s, on the way into the hardest impact.
      expectHighest(tape.maxLongG, 2.43, 0.1);
      expect(tape.maxLongG).toBeLessThan(2.5);
      // Accelerating never comes near it: 1.17 g at the most.
      expectHighest(tape.rawAccelerating, 1.17, 0.1);
    });

    it('would hold the impacts as maxima without the gate', () => {
      // One frame of the impact at 240.72 s reads 10.97 g, and without the
      // sim's impact time it stands as the maximum for five seconds. That
      // frame is one a run can miss; the frames around it and the other
      // impacts still read well over anything the car can brake at.
      expect(tape.ungatedMaxLongG).toBeGreaterThan(3);
      expect(tape.ungatedMaxLongG).toBeLessThanOrEqual(10.98);
      expect(tape.rawBraking).toBeLessThanOrEqual(10.98);
      expect(tape.rawBraking).toBeGreaterThanOrEqual(
        tape.ungatedMaxLongG - 0.005
      );
      // Lateral too: 4.34 g in the first impact, against 3.02 g cornering.
      expect(tape.ungatedMaxLatG).toBeGreaterThan(tape.maxLatG);
    });

    it('finds the sustained lateral grip at 2.68 g', () => {
      // At 191.2 s, where the car reads 2.7 to 3.0 g for 0.15 s. The widget
      // spec quotes 2.38 for this: that figure was worked out with every
      // recorded frame taken as 10 ms, and the frames are 15.6 ms apart on
      // average, which is the step the smoothing is given here.
      expectHighest(tape.sustainedLatG, 2.68, 0.1);
      expect(tape.sustainedSetAt).toBeGreaterThan(191.0);
      expect(tape.sustainedSetAt).toBeLessThan(191.4);
      expect(tape.sustainedLatG).toBeLessThan(tape.maxLatG);
    });

    it('ends with the maxima of the last five seconds, not of the race', () => {
      expect(tape.last?.maxLatG).toBeLessThan(tape.maxLatG);
      expect(tape.last?.maxLongG).toBeLessThanOrEqual(tape.maxLongG);
    });
  }
);
