import { beforeAll, describe, expect, it } from 'vitest';
import type { CruiseSnapshot, Telemetry } from '@irdashies/types';
import {
  LMU_CURATED_TAPE_PATH,
  lmuTapeAvailable,
  playLmuTape,
} from '../../testing/lmuTape';
import {
  CruiseProcessor,
  type DrivingTotalsPersistence,
} from './CruiseProcessor';
import { trackLengthFrom } from './lapTiming';
import {
  sessionSecondsFrameClock,
  takeTick,
  type TickSchedule,
} from './ProcessorHost';

/**
 * The cruise channel on the recorded Le Mans Ultimate race: four minutes in
 * an LMGT3 at Laguna Seca, from 139.9 s to 379.9 s on the session clock,
 * with the line crossed at 232.8 s and at 319.5 s.
 *
 * Played through the mapper and handed to the processor on the host's
 * schedule, ten times a second, as the app does, with a second processor
 * given every frame to see what the schedule costs.
 *
 * The replay drops a few dozen of the 15,430 frames, a different few on each
 * run (see frameKeys.tape.spec.ts), so a total is held between two figures
 * rather than to one.
 *
 * Windows only, like the other tape specs.
 */

const DEGREES = 180 / Math.PI;
/** Metres a second above which a heading is compared with the car's path. */
const AT_SPEED_MS = 20;

const numberAt = (
  telemetry: Telemetry,
  key: string,
  index = 0
): number | undefined => {
  const value = (
    telemetry as unknown as Record<string, { value?: unknown[] } | undefined>
  )[key]?.value?.[index];
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
};

/** An angle brought into -180 < angle <= 180. */
const signed = (degrees: number): number =>
  ((((degrees + 180) % 360) + 360) % 360) - 180;

const percentile = (sorted: readonly number[], share: number): number =>
  sorted[Math.min(Math.floor(sorted.length * share), sorted.length - 1)];

interface Recording {
  frames: number;
  ticks: number;
  /** Ticks on which the snapshot's version moved. */
  publishes: number;
  unavailableTicks: number;
  trackLengthM: number;
  carKey: string;
  /** Published heading minus the bearing the car is travelling on, at speed. */
  headingErrors: number[];
  /** Published drift minus (heading minus travel), at speed. */
  driftErrors: number[];
  lowestM: number;
  highestM: number;
  /** Largest gap between the published lap distance and the frame's own. */
  lapDistanceError: number;
  /** The session's metres at each crossing of the line. */
  metresAtCrossings: number[];
  crossingTimes: number[];
  added: { key: string; metres: number; seconds: number }[];
  /** The scheduled processor's snapshot when the tape ended. */
  last: CruiseSnapshot;
  /** The same from the processor given every frame. */
  everyFrame: CruiseSnapshot;
  /** What the store was handed when the sim went away. */
  afterDisconnect: { key: string; metres: number; seconds: number }[];
}

const play = async (): Promise<Recording> => {
  const added: Recording['added'] = [];
  const persistence: DrivingTotalsPersistence = {
    // 1,000 km and ten hours in this car on this track before today.
    load: () => ({ metres: 1_000_000, seconds: 36_000 }),
    add: (simulator, trackId, carKey, metres, seconds) => {
      added.push({ key: `${simulator}|${trackId}|${carKey}`, metres, seconds });
    },
  };
  const processor = new CruiseProcessor(persistence, 'lmu');
  const everyFrame = new CruiseProcessor(undefined, 'lmu');
  const schedule: TickSchedule = {};
  const tape = {
    frames: 0,
    ticks: 0,
    publishes: 0,
    unavailableTicks: 0,
    trackLengthM: 0,
    carKey: '',
    headingErrors: [] as number[],
    driftErrors: [] as number[],
    lowestM: Infinity,
    highestM: -Infinity,
    lapDistanceError: 0,
    metresAtCrossings: [] as number[],
    crossingTimes: [] as number[],
  };

  let started = false;
  let lastVersion = -1;
  let previousPct = -1;
  let previousX: number | undefined;
  let previousZ: number | undefined;
  /** Degrees clockwise from the world's +Z axis the car last moved along. */
  let travel: number | undefined;

  await playLmuTape({
    tapePath: LMU_CURATED_TAPE_PATH,
    speed: 20,
    onFrame: ({ telemetry, session, sessionChanged, sessionTime }) => {
      tape.frames += 1;
      if (!started) {
        started = true;
        for (const each of [processor, everyFrame]) {
          each.onLifecycle({ type: 'enter', replay: false });
        }
      }
      if (sessionChanged) {
        tape.trackLengthM = trackLengthFrom(session);
        tape.carKey =
          session.DriverInfo.Drivers.find(
            (driver) => driver.CarIdx === session.DriverInfo.DriverCarIdx
          )?.CarModel ?? '';
        processor.init(session);
        everyFrame.init(session);
      }

      // Which way the car went since the frame before, from where it is.
      const x = numberAt(telemetry, 'LmuPlayerWorldPos', 0);
      const z = numberAt(telemetry, 'LmuPlayerWorldPos', 2);
      if (x !== undefined && z !== undefined) {
        if (
          previousX !== undefined &&
          previousZ !== undefined &&
          Math.hypot(x - previousX, z - previousZ) > 0.2
        ) {
          travel = Math.atan2(x - previousX, z - previousZ) * DEGREES;
        }
        previousX = x;
        previousZ = z;
      }

      everyFrame.onFrame(telemetry);
      const pct = numberAt(telemetry, 'LapDistPct') ?? -1;
      if (previousPct > 0.95 && pct >= 0 && pct < 0.05) {
        tape.metresAtCrossings.push(everyFrame.snapshot().sessionMetres);
        tape.crossingTimes.push(sessionTime);
      }
      previousPct = pct;

      if (!takeTick(schedule, 10, sessionSecondsFrameClock(telemetry))) return;
      tape.ticks += 1;
      processor.onFrame(telemetry);
      const snapshot = processor.snapshot();
      if (snapshot.version !== lastVersion) tape.publishes += 1;
      lastVersion = snapshot.version;
      if (!snapshot.available) tape.unavailableTicks += 1;

      if (snapshot.elevationM !== null) {
        tape.lowestM = Math.min(tape.lowestM, snapshot.elevationM);
        tape.highestM = Math.max(tape.highestM, snapshot.elevationM);
      }
      if (snapshot.lapDistanceM !== null && pct >= 0) {
        tape.lapDistanceError = Math.max(
          tape.lapDistanceError,
          Math.abs(snapshot.lapDistanceM - pct * tape.trackLengthM)
        );
      }

      const speed = numberAt(telemetry, 'Speed') ?? 0;
      const yawNorth = numberAt(telemetry, 'YawNorth');
      if (
        speed > AT_SPEED_MS &&
        travel !== undefined &&
        yawNorth !== undefined &&
        snapshot.headingDeg !== null &&
        snapshot.driftDeg !== null
      ) {
        tape.headingErrors.push(signed(snapshot.headingDeg - travel));
        tape.driftErrors.push(
          signed(snapshot.driftDeg - (yawNorth * DEGREES - travel))
        );
      }
    },
  });

  const last = structuredClone(processor.snapshot());
  const everyFrameLast = structuredClone(everyFrame.snapshot());
  const before = added.length;
  processor.onLifecycle({ type: 'disconnect' });
  return {
    ...tape,
    headingErrors: tape.headingErrors.sort((a, b) => a - b),
    driftErrors: tape.driftErrors.sort((a, b) => a - b),
    added,
    last,
    everyFrame: everyFrameLast,
    afterDisconnect: added.slice(before),
  };
};

describe.skipIf(!lmuTapeAvailable())(
  'the cruise channel on a recorded LMU race at Laguna Seca',
  () => {
    let tape: Recording;

    beforeAll(async () => {
      tape = await play();
    }, 120_000);

    it('reads the whole recording, in the car throughout', () => {
      expect(tape.frames).toBeGreaterThan(14_000);
      // Four minutes at ten ticks a second.
      expect(tape.ticks).toBeGreaterThan(2_350);
      expect(tape.ticks).toBeLessThan(2_420);
      expect(tape.unavailableTicks).toBe(0);
      expect(tape.trackLengthM).toBeCloseTo(3590.35, 1);
    });

    it('moves on nearly every tick: the lap distance is in whole metres', () => {
      expect(tape.publishes).toBeGreaterThan(tape.ticks * 0.95);
      expect(tape.publishes).toBeLessThanOrEqual(tape.ticks);
    });

    it('points the compass along the way the car is going', () => {
      const errors = tape.headingErrors;
      // Some 2,100 ticks above 20 m/s.
      expect(errors.length).toBeGreaterThan(1_800);
      // North is the world's +Z axis: the heading and the bearing of the
      // car's own path agree to the degree the heading is published to.
      expect(Math.abs(percentile(errors, 0.5))).toBeLessThan(1);
      // The car's nose is seldom more than a few degrees off its path.
      expect(percentile(errors, 0.05)).toBeGreaterThan(-4);
      expect(percentile(errors, 0.95)).toBeLessThan(4);
    });

    it('reads the drift as the heading against the path, in sign and size', () => {
      const errors = tape.driftErrors;
      expect(errors.length).toBeGreaterThan(1_800);
      expect(Math.abs(percentile(errors, 0.5))).toBeLessThan(0.5);
      expect(percentile(errors, 0.05)).toBeGreaterThan(-2);
      expect(percentile(errors, 0.95)).toBeLessThan(2);
    });

    it("publishes the track model's own height, from -15 m to 39 m", () => {
      // -15.4 m in the flat run after the hairpin, 38.9 m at the Corkscrew
      // on the laps the car drove, in whole metres.
      expect(tape.lowestM).toBeGreaterThanOrEqual(-16);
      expect(tape.lowestM).toBeLessThanOrEqual(-15);
      expect(tape.highestM).toBeGreaterThanOrEqual(38);
      expect(tape.highestM).toBeLessThanOrEqual(40);
    });

    it('publishes the distance into the lap in whole metres', () => {
      expect(tape.lapDistanceError).toBeLessThanOrEqual(0.5 + 1e-6);
      expect(tape.last.lapDistanceM).toBeGreaterThan(0);
      expect(tape.last.lapDistanceM).toBeLessThan(3591);
    });

    it('adds up 9.8 km and four minutes of driving', () => {
      // 9,816.6 m from the speed of every frame, and 240.0 s.
      expect(tape.everyFrame.sessionMetres).toBeGreaterThan(9_770);
      expect(tape.everyFrame.sessionMetres).toBeLessThan(9_830);
      expect(tape.everyFrame.sessionSeconds).toBeGreaterThan(239);
      expect(tape.everyFrame.sessionSeconds).toBeLessThan(240.1);
    });

    it('loses nothing to speak of at ten ticks a second', () => {
      expect(
        Math.abs(tape.last.sessionMetres - tape.everyFrame.sessionMetres)
      ).toBeLessThan(10);
      expect(
        Math.abs(tape.last.sessionSeconds - tape.everyFrame.sessionSeconds)
      ).toBeLessThan(0.2);
    });

    it('drives one lap of 3,590 m between two crossings of the line', () => {
      expect(tape.crossingTimes).toHaveLength(2);
      expect(tape.crossingTimes[0]).toBeGreaterThan(232.5);
      expect(tape.crossingTimes[0]).toBeLessThan(233.1);
      expect(tape.crossingTimes[1]).toBeGreaterThan(319.2);
      expect(tape.crossingTimes[1]).toBeLessThan(319.8);

      // What the odometer added between them is the lap, to within the
      // difference between the car's own line and the centre of the road.
      const lap = tape.metresAtCrossings[1] - tape.metresAtCrossings[0];
      expect(lap / tape.trackLengthM).toBeGreaterThan(0.98);
      expect(lap / tape.trackLengthM).toBeLessThan(1.02);
    });

    it('adds the session to what was stored for the track and car', () => {
      expect(tape.carKey).toMatch(/296/);
      expect(tape.last.totalMetres).toBeCloseTo(
        1_000_000 + tape.last.sessionMetres,
        6
      );
      expect(tape.last.totalSeconds).toBeCloseTo(
        36_000 + tape.last.sessionSeconds,
        6
      );
    });

    it('hands the store what was driven every thirty seconds, each metre once', () => {
      // Seven hand-overs in four minutes, the eighth due as the tape ends.
      const during = tape.added.length - tape.afterDisconnect.length;
      expect(during).toBeGreaterThanOrEqual(7);
      expect(during).toBeLessThanOrEqual(8);
      for (const each of tape.added) {
        expect(each.key).toBe(
          `lmu|${tape.added[0].key.split('|')[1]}|${tape.carKey}`
        );
      }
      // Some 1,230 m in thirty seconds at the pace of the race.
      for (const each of tape.added.slice(0, during)) {
        expect(each.seconds).toBeGreaterThan(29.8);
        expect(each.seconds).toBeLessThan(30.3);
        expect(each.metres).toBeGreaterThan(900);
        expect(each.metres).toBeLessThan(1_600);
      }
      // The rest goes when the sim does, and the sum is the session.
      expect(tape.afterDisconnect.length).toBeLessThanOrEqual(1);
      const handed = tape.added.reduce((sum, each) => sum + each.metres, 0);
      expect(handed).toBeCloseTo(tape.last.sessionMetres, 6);
    });
  }
);
