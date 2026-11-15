import { beforeAll, describe, expect, it } from 'vitest';
import {
  getWidgetDefaultConfig,
  type WheelDynamicsSnapshot,
} from '@irdashies/types';
import {
  chassisAngleDeg,
  isBottoming,
  isLoadLow,
  isWheelLifted,
  loadSharePercent,
  toeDirection,
  type ToeDirection,
} from '@irdashies/shared';
import {
  LMU_CURATED_TAPE_PATH,
  lmuTapeAvailable,
  playLmuTape,
} from '../../testing/lmuTape';
import { takeTick, type TickSchedule } from './ProcessorHost';
import { WheelDynamicsProcessor } from './WheelDynamicsProcessor';

/**
 * The wheel channel on a recorded Le Mans Ultimate race, and what the tyre
 * and chassis widgets make of it: four minutes at Laguna Seca in a Ferrari
 * 296 LMGT3, whose setup screen says 54 mm of ride height at the front and
 * 63 mm at the rear, -2.0 and -1.5 degrees of camber, and toe-out at the
 * front with toe-in at the rear.
 *
 * The frame keys the processor reads are pinned, frame by frame and in the
 * frame's units, in lmu/frameKeys.tape.spec.ts. This is the next step along:
 * the same recording through the processor at its own 25 ticks a second, and
 * then through the rules the two widgets draw by, with their default
 * settings.
 *
 * A tick takes one frame in four, and which one is not the same on every
 * run: the replay hands each frame out once and loses up to one per session
 * read, more of them on a busy machine, and a tick whose frame is lost takes
 * the next. A mean does not notice. An extreme that lasted a frame or two
 * does, and so does a count of such frames: the kerb strikes, the wheels in
 * the air, the two frames on which the right front reads below the road. So
 * the means are pinned closely, and the extremes and counts to the span they
 * moved over when the ticks were shifted by one, two and three frames and
 * when a frame was dropped every half second.
 *
 * Windows only, like the other tape specs.
 */

const TYRES = getWidgetDefaultConfig('tyres');
const CHASSIS = getWidgetDefaultConfig('chassis');

/**
 * How far the wheel is turned, as a share of its range, before a tick counts
 * as cornering: a corner, and not a correction on a straight.
 */
const CORNERING_STEER = 0.1;
/** And how little before it counts as a straight. */
const STRAIGHT_STEER = 0.01;

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

const total = (counts: readonly number[]) =>
  counts.reduce((sum, count) => sum + count, 0);

interface Recording {
  ticks: number;
  firstTime: number;
  lastTime: number;
  /** Ticks on which the snapshot's version had moved. */
  publishes: number;
  unavailableTicks: number;
  /** Ticks on which each field of the snapshot was null. */
  nulls: Partial<Record<keyof WheelDynamicsSnapshot, number>>;
  loadSources: Set<WheelDynamicsSnapshot['loadSource']>;

  rideHeight: Range[];
  suspension: Range[];
  deflection: Range[];
  camber: Range[];
  toe: Range[];
  loadShare: Range[];
  /** The two front wheels' shares together, and the two left wheels'. */
  frontShare: Range;
  leftShare: Range;
  /** The four shares added up, as published and as the bars' percentages. */
  shareSum: Range;
  percentSum: Range;
  loadTotal: Range;

  rake: Range;
  rakeAngle: Range;
  /** Front, then rear. */
  roll: Range[];
  rollAngle: Range[];
  frontRollSteeringLeft: Range;
  frontRollSteeringRight: Range;
  rollShare: Range;
  /** Front, then rear. */
  toeTotal: Range[];
  frontToeOnStraights: Range;
  frontToeWordsOnStraights: Set<ToeDirection | null>;
  rearToeWords: Set<ToeDirection | null>;

  /** Ticks on which each corner was below the default threshold, and 10 mm. */
  bottoming: number[];
  bottomingAtTen: number[];
  /** Ticks on which each wheel's deflection and load were drawn red. */
  lifted: number[];
  inTheAir: number[];
  lowLoad: number[];
  /** Ticks on which each wheel's camber was at zero or above. */
  uprightCamber: number[];
}

const emptyRecording = (): Recording => ({
  ticks: 0,
  firstTime: Number.NaN,
  lastTime: Number.NaN,
  publishes: 0,
  unavailableTicks: 0,
  nulls: {},
  loadSources: new Set(),
  rideHeight: perWheel(),
  suspension: perWheel(),
  deflection: perWheel(),
  camber: perWheel(),
  toe: perWheel(),
  loadShare: perWheel(),
  frontShare: emptyRange(),
  leftShare: emptyRange(),
  shareSum: emptyRange(),
  percentSum: emptyRange(),
  loadTotal: emptyRange(),
  rake: emptyRange(),
  rakeAngle: emptyRange(),
  roll: [emptyRange(), emptyRange()],
  rollAngle: [emptyRange(), emptyRange()],
  frontRollSteeringLeft: emptyRange(),
  frontRollSteeringRight: emptyRange(),
  rollShare: emptyRange(),
  toeTotal: [emptyRange(), emptyRange()],
  frontToeOnStraights: emptyRange(),
  frontToeWordsOnStraights: new Set(),
  rearToeWords: new Set(),
  bottoming: [0, 0, 0, 0],
  bottomingAtTen: [0, 0, 0, 0],
  lifted: [0, 0, 0, 0],
  inTheAir: [0, 0, 0, 0],
  lowLoad: [0, 0, 0, 0],
  uprightCamber: [0, 0, 0, 0],
});

/** Plays the tape once, keeping only what the cases below assert on. */
const readRecording = async (): Promise<Recording> => {
  const tape = emptyRecording();
  const processor = new WheelDynamicsProcessor();
  // The host's own schedule, so a tick falls where it would in the app.
  const schedule: TickSchedule = {};
  let started = false;
  let lastVersion = -1;

  await playLmuTape({
    tapePath: LMU_CURATED_TAPE_PATH,
    speed: 20,
    onFrame: ({ raw, telemetry, session, sessionTime }) => {
      if (!started) {
        started = true;
        processor.init(session);
        processor.onLifecycle({ type: 'enter', replay: false });
        tape.firstTime = sessionTime;
      }
      if (!takeTick(schedule, processor.tickRateHz, sessionTime)) return;
      processor.onFrame(telemetry);
      const snapshot = processor.snapshot();
      tape.ticks += 1;
      tape.lastTime = sessionTime;
      if (snapshot.version !== lastVersion) tape.publishes += 1;
      lastVersion = snapshot.version;
      if (!snapshot.available) tape.unavailableTicks += 1;
      tape.loadSources.add(snapshot.loadSource);
      for (const key of Object.keys(snapshot) as (keyof typeof snapshot)[]) {
        if (snapshot[key] === null)
          tape.nulls[key] = (tape.nulls[key] ?? 0) + 1;
      }
      // The sim's steering input is negative to the left.
      const steer = raw.unfilteredSteering ?? 0;

      snapshot.rideHeightMm?.forEach((height, wheel) => {
        widen(tape.rideHeight[wheel], height);
        const threshold =
          wheel < 2 ? CHASSIS.bottomingFront : CHASSIS.bottomingRear;
        if (isBottoming(height, threshold)) tape.bottoming[wheel] += 1;
        if (isBottoming(height, 10)) tape.bottomingAtTen[wheel] += 1;
      });
      snapshot.suspensionPositionMm?.forEach((travel, wheel) =>
        widen(tape.suspension[wheel], travel)
      );
      snapshot.tyreDeflectionMm?.forEach((deflection, wheel) => {
        widen(tape.deflection[wheel], deflection);
        if (deflection === 0) tape.inTheAir[wheel] += 1;
        if (isWheelLifted(deflection, TYRES.liftOffThreshold)) {
          tape.lifted[wheel] += 1;
        }
      });
      snapshot.camberDeg?.forEach((camber, wheel) => {
        widen(tape.camber[wheel], camber);
        if (camber >= 0) tape.uprightCamber[wheel] += 1;
      });
      snapshot.toeDeg?.forEach((toe, wheel) => widen(tape.toe[wheel], toe));

      const shares = snapshot.loadShare;
      if (shares) {
        let shareSum = 0;
        let percentSum = 0;
        shares.forEach((share, wheel) => {
          widen(tape.loadShare[wheel], share);
          shareSum += share;
          percentSum += loadSharePercent(share);
          if (isLoadLow(share, TYRES.lowLoadThreshold)) {
            tape.lowLoad[wheel] += 1;
          }
        });
        widen(tape.shareSum, shareSum);
        widen(tape.percentSum, percentSum);
        widen(tape.frontShare, shares[0] + shares[1]);
        widen(tape.leftShare, shares[0] + shares[2]);
      }
      if (snapshot.loadTotalN !== null) {
        widen(tape.loadTotal, snapshot.loadTotalN);
      }

      if (snapshot.rakeMm !== null) {
        widen(tape.rake, snapshot.rakeMm);
        widen(
          tape.rakeAngle,
          chassisAngleDeg(snapshot.rakeMm, CHASSIS.wheelbase)
        );
      }
      if (snapshot.rollMm) {
        const front = chassisAngleDeg(snapshot.rollMm[0], CHASSIS.trackFront);
        const rear = chassisAngleDeg(snapshot.rollMm[1], CHASSIS.trackRear);
        widen(tape.roll[0], snapshot.rollMm[0]);
        widen(tape.roll[1], snapshot.rollMm[1]);
        widen(tape.rollAngle[0], front);
        widen(tape.rollAngle[1], rear);
        if (steer < -CORNERING_STEER) widen(tape.frontRollSteeringLeft, front);
        if (steer > CORNERING_STEER) widen(tape.frontRollSteeringRight, front);
      }
      if (snapshot.rollShareFront !== null) {
        widen(tape.rollShare, snapshot.rollShareFront);
      }
      if (snapshot.toeTotalDeg) {
        const [front, rear] = snapshot.toeTotalDeg;
        widen(tape.toeTotal[0], front);
        widen(tape.toeTotal[1], rear);
        tape.rearToeWords.add(toeDirection(rear));
        if (Math.abs(steer) < STRAIGHT_STEER) {
          widen(tape.frontToeOnStraights, front);
          tape.frontToeWordsOnStraights.add(toeDirection(front));
        }
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

/** A figure that depends on which frames the ticks took: anywhere in a span. */
const expectWithin = (actual: number, low: number, high: number) => {
  expect(actual).toBeGreaterThanOrEqual(low);
  expect(actual).toBeLessThanOrEqual(high);
};

describe.skipIf(!lmuTapeAvailable())(
  'the wheels and chassis on a recorded LMU race',
  () => {
    let tape = emptyRecording();
    const means = (ranges: Range[]) => ranges.map(meanOf);
    const lowest = (ranges: Range[]) =>
      Math.min(...ranges.map((range) => range.min));
    const highest = (ranges: Range[]) =>
      Math.max(...ranges.map((range) => range.max));

    beforeAll(async () => {
      tape = await readRecording();
    }, 120_000);

    describe('the channel', () => {
      it('ticks 25 times a second from end to end', () => {
        // 240 s of the session clock.
        expectNear(tape.ticks, 6000, 10);
        expectNear(tape.firstTime, 139.92, 0.05);
        expectNear(tape.lastTime, 379.9, 0.05);
      });

      it('has every figure on every tick', () => {
        expect(tape.unavailableTicks).toBe(0);
        // Not one field is null on one tick: this car is given ride height,
        // camber and toe, and its suspension force stands in for tyre load.
        expect(tape.nulls).toEqual({});
      });

      it('moves on every tick of a car being driven', () => {
        // Ride height to a tenth of a millimetre does not stand still, so
        // the channel's rate, not the version, is what paces the widgets.
        expect(tape.publishes).toBe(tape.ticks);
      });

      it('gives ride height in millimetres, a little under the setup figures', () => {
        // The setup screen says 54 mm at the front and 63 mm at the rear,
        // standing still.
        expectAllNear(means(tape.rideHeight), [50.6, 49.8, 59.5, 58.7], 0.2);
        // The recording's highest is 156.84 mm, over the crest, and it lasts.
        expectWithin(highest(tape.rideHeight), 155, 156.9);
        // Its lowest is 1.54 mm below the road, for a frame: a tick sees
        // that, or the frames beside it.
        expectWithin(lowest(tape.rideHeight), -1.6, 4);
      });

      it('gives suspension travel in millimetres', () => {
        expectAllNear(means(tape.suspension), [64.8, 65.6, 76.6, 77.9], 0.2);
        expectNear(lowest(tape.suspension), 50.2, 0.5);
        expectNear(highest(tape.suspension), 109.3, 0.5);
      });

      it('gives tyre deflection in millimetres, zero with the wheel in the air', () => {
        expectAllNear(
          means(tape.deflection),
          [15.86, 17.12, 18.91, 20.14],
          0.1
        );
        expect(lowest(tape.deflection)).toBe(0);
        // The recording's most is 67.59 mm, landing on the right rear.
        expectWithin(highest(tape.deflection), 60, 67.7);
        expect(highest(tape.deflection)).toBeLessThan(70);
        // The fronts and the left rear leave the ground over the kerbs for
        // some forty, fifty and eighteen ticks. The right rear does for six
        // frames of the recording, which is one to three ticks.
        const [leftFront, rightFront, leftRear, rightRear] = tape.inTheAir;
        expect(leftFront).toBeGreaterThan(25);
        expect(rightFront).toBeGreaterThan(35);
        expect(leftRear).toBeGreaterThan(10);
        expect(rightRear).toBeLessThanOrEqual(6);
        expectNear(total(tape.inTheAir), 111, 20);
      });

      it('takes the load share from suspension force, tyre load being withheld', () => {
        expect([...tape.loadSources]).toEqual(['suspensionForce']);
        // 18.9 kN on the four pushrods on average, from about 5 kN over a
        // crest to over 41 kN in a compression.
        expectNear(meanOf(tape.loadTotal), 18_947, 30);
        expectWithin(tape.loadTotal.min, 4500, 6000);
        expectWithin(tape.loadTotal.max, 40_500, 44_500);
      });

      it('puts 46 % of that estimate on the front axle and 48 % on the left', () => {
        expectAllNear(
          means(tape.loadShare),
          [0.219, 0.238, 0.262, 0.281],
          0.002
        );
        expectNear(meanOf(tape.frontShare), 0.457, 0.003);
        expectNear(meanOf(tape.leftShare), 0.481, 0.003);
        // Each published to a thousandth, so the four add up to one within
        // a thousandth.
        expect(tape.shareSum.min).toBeGreaterThanOrEqual(0.9985);
        expect(tape.shareSum.max).toBeLessThanOrEqual(1.0015);
      });

      it('gives rake in millimetres, the rear the higher end', () => {
        expectNear(meanOf(tape.rake), 8.9, 0.1);
        // Smoothed over a tenth of a second: crests and compressions throw
        // the readings themselves further than this.
        expectNear(tape.rake.min, -43.4, 4);
        expectNear(tape.rake.max, 44.4, 4);
      });

      it('gives roll in millimetres at each axle, and the front axle a share of it', () => {
        expectNear(tape.roll[0].min, -38.8, 4);
        expectNear(tape.roll[0].max, 35.5, 4);
        expectNear(tape.roll[1].min, -38.8, 6);
        expectNear(tape.roll[1].max, 25, 4);
        // About half each over the race, and never all on one axle.
        expectNear(meanOf(tape.rollShare), 0.514, 0.01);
        expect(tape.rollShare.min).toBeGreaterThan(0.1);
        expect(tape.rollShare.max).toBeLessThan(0.85);
      });

      it('gives camber in degrees, smoothed, close to the setup', () => {
        // Against a setup of -2.0 at the front and -1.5 at the rear.
        expectAllNear(means(tape.camber), [-2.01, -2.18, -1.7, -1.615], 0.02);
        // The kerbs throw the readings to +20 and -25 degrees for a frame
        // or two. Smoothed, and seen one frame in four, the furthest a wheel
        // goes is 1 to 7 degrees one way and 5 to 11 the other, depending on
        // which frames the ticks took.
        expectWithin(highest(tape.camber), 0.8, 8);
        expectWithin(lowest(tape.camber), -12, -4);
        // Upright or leaning out, which the chassis widget draws amber,
        // only over those kerbs: some hundred ticks of 6,000, half of them
        // the left front.
        expect(tape.uprightCamber[0]).toBeGreaterThan(35);
        expectNear(total(tape.uprightCamber), 99, 25);
      });

      it('gives toe with toe-in positive on both sides', () => {
        const [, , leftRear, rightRear] = tape.toe;
        // The sim signs the two rears opposite ways; turned round, both
        // read a tenth of a degree of toe-in and hold it.
        expectNear(meanOf(leftRear), 0.104, 0.002);
        expectNear(meanOf(rightRear), 0.103, 0.002);
        expect(Math.min(leftRear.min, rightRear.min)).toBeGreaterThan(0.04);
        expect(Math.max(leftRear.max, rightRear.max)).toBeLessThan(0.15);
        // The fronts carry the steering angle: up to 11 degrees.
        expectNear(lowest(tape.toe.slice(0, 2)), -11.15, 0.5);
        expectNear(highest(tape.toe.slice(0, 2)), 10.45, 0.5);
      });

      it('gives the total toe of each axle, the steering cancelled out', () => {
        const [front, rear] = tape.toeTotal;
        // Rear: the setup says 0.188 degrees of toe-in.
        expectNear(meanOf(rear), 0.208, 0.002);
        expect(rear.min).toBeGreaterThanOrEqual(0.1);
        expect(rear.max).toBeLessThanOrEqual(0.26);
        // Front: toe-out throughout, and more of it with lock on, where the
        // inner wheel turns further than the outer.
        expect(front.max).toBeLessThan(0);
        expectNear(front.min, -0.72, 0.05);
        expectNear(meanOf(front), -0.155, 0.005);
      });
    });

    describe('as the tyre widget draws it', () => {
      it('always has a load bar to draw', () => {
        expect(tape.nulls.loadShare).toBeUndefined();
        expect(tape.loadShare[0].count).toBe(tape.ticks);
      });

      it('shows four percentages that add up to 100, give or take two', () => {
        // Each is rounded on its own, so the four can be a point or two out
        // together: 99 to 102 on the recording.
        expectWithin(tape.percentSum.min, 98, 100);
        expectWithin(tape.percentSum.max, 100, 102);
        expectNear(meanOf(tape.percentSum), 100.2, 0.1);
      });

      it('turns a load bar red while its wheel carries next to nothing', () => {
        // Some 45, 62, 20 and 6 ticks at or under 1 %.
        const [leftFront, rightFront, leftRear] = tape.lowLoad;
        expect(leftFront).toBeGreaterThan(30);
        expect(rightFront).toBeGreaterThan(45);
        expect(leftRear).toBeGreaterThan(10);
        expectNear(total(tape.lowLoad), 134, 20);
      });

      it('turns a deflection red on every tick its wheel is in the air, and those beside', () => {
        // Some 62, 67, 27 and 8 ticks at or under 1 mm.
        tape.lifted.forEach((ticks, wheel) =>
          expect(ticks).toBeGreaterThanOrEqual(tape.inTheAir[wheel])
        );
        expect(tape.lifted[0]).toBeGreaterThan(45);
        expect(tape.lifted[1]).toBeGreaterThan(50);
        expect(tape.lifted[2]).toBeGreaterThan(15);
        expectNear(total(tape.lifted), 164, 20);
      });
    });

    describe('as the chassis widget draws it', () => {
      it('reads the rake as +0.18 degrees on the default wheelbase', () => {
        expectNear(meanOf(tape.rakeAngle), 0.182, 0.003);
        // Nose up by nearly a degree over the crest, and down by as much
        // under braking.
        expectNear(tape.rakeAngle.min, -0.89, 0.08);
        expectNear(tape.rakeAngle.max, 0.91, 0.08);
      });

      it('reads the roll within a degree and a third either way', () => {
        const [front, rear] = tape.rollAngle;
        expectNear(front.min, -1.235, 0.12);
        expectNear(front.max, 1.13, 0.12);
        expectNear(rear.min, -1.235, 0.2);
        expectNear(rear.max, 0.8, 0.12);
      });

      it('reads a left-hand corner as negative roll and a right-hand one as positive', () => {
        // The outside of the corner is pressed down, so the inside rides
        // higher: the left side in a left-hander.
        expectNear(meanOf(tape.frontRollSteeringLeft), -0.31, 0.02);
        expectNear(meanOf(tape.frontRollSteeringRight), 0.335, 0.02);
        expect(tape.frontRollSteeringLeft.count).toBeGreaterThan(1200);
        expect(tape.frontRollSteeringRight.count).toBeGreaterThan(650);
      });

      it('draws next to nothing as bottoming with the default threshold of 0', () => {
        // The right front reads below the road on two frames of the
        // recording, and nothing else ever does: two ticks at the very
        // most, and none on most runs.
        const [leftFront, rightFront, leftRear, rightRear] = tape.bottoming;
        expect(leftFront + leftRear + rightRear).toBe(0);
        expect(rightFront).toBeLessThanOrEqual(2);
      });

      it('would draw the kerb strikes with the threshold at 10 mm', () => {
        // Some five ticks on the right front and six on the right rear, two
        // on the left rear, and one at the most on the left front.
        const [leftFront, rightFront, , rightRear] = tape.bottomingAtTen;
        expect(leftFront).toBeLessThanOrEqual(2);
        expect(rightFront).toBeGreaterThan(0);
        expect(rightRear).toBeGreaterThan(0);
        expectNear(total(tape.bottomingAtTen), 15, 8);
      });

      it('reads the rear toe as "in" throughout', () => {
        expect([...tape.rearToeWords]).toEqual(['in']);
      });

      it('reads the front toe as "out" on the straights', () => {
        // The setup says 0.125 degrees of toe-out.
        expect([...tape.frontToeWordsOnStraights]).toEqual(['out']);
        expectNear(meanOf(tape.frontToeOnStraights), -0.101, 0.005);
        expectNear(tape.frontToeOnStraights.count, 828, 30);
      });
    });
  }
);
