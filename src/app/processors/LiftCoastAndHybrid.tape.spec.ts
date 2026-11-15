import { beforeAll, describe, expect, it } from 'vitest';
import type { Telemetry } from '@irdashies/types';
import {
  LMU_CURATED_TAPE_PATH,
  lmuTapeAvailable,
  playLmuTape,
} from '../../testing/lmuTape';
import { DriverControlsProcessor } from './DriverControlsProcessor';
import { HybridProcessor } from './HybridProcessor';

type Cell = { value?: unknown[] } | undefined;

const read = (telemetry: Telemetry, key: string): unknown =>
  (telemetry as Record<string, Cell>)[key]?.value?.[0];

/**
 * The fewest frames a run may read and still be judged. The replay runs at
 * twenty times real speed and a busy machine reads fewer of the recording's
 * frames, about 15,400 at best.
 */
const MIN_FRAMES = 10_000;

/**
 * What the lift-and-coast strip and the hybrid widget read, on the recorded
 * Le Mans Ultimate race: four minutes in a Ferrari 296 LMGT3, which has no
 * hybrid system and runs with no energy-saving target.
 *
 * So the recording can show one thing only, and it is the thing that would
 * be worst to get wrong: neither widget is handed a reading for a car that
 * has none. The strip is a pure function of the driver-controls snapshot
 * (liftCoastDisplay.spec.ts): a signal of 0 lights nothing, and ABS or
 * traction control takes it whole. The hybrid widget draws nothing while
 * its channel says `available: false`. What a Hypercar deploying, or a
 * target building up, looks like is left to the unit specs on hand-built
 * frames; no recording holds either.
 *
 * Played through the app's own mapper and the two processors, every frame.
 * Windows only, like the other tape specs.
 */
describe.skipIf(!lmuTapeAvailable())(
  'lift-and-coast and the hybrid on a recorded LMU race in a GT3',
  () => {
    const seen = {
      frames: 0,
      inCarFrames: 0,
      // What the sim wrote, before the mapper.
      rawCharges: new Set<number | undefined>(),
      // The frames themselves.
      motorStates: new Set<unknown>(),
      batteryFrames: 0,
      motorReadingFrames: 0,
      // The driver-controls channel, which the strip reads.
      liftAndCoast: new Set<number | undefined>(),
      tcFrames: 0,
      absFrames: 0,
      bothFrames: 0,
      // The hybrid channel.
      availableFrames: 0,
      hybridVersions: new Set<number>(),
    };

    const hybrid = new HybridProcessor();

    beforeAll(async () => {
      const controls = new DriverControlsProcessor();
      let started = false;

      const { frames } = await playLmuTape({
        tapePath: LMU_CURATED_TAPE_PATH,
        speed: 20,
        onFrame: ({ raw, telemetry, session, sessionChanged }) => {
          if (!started) {
            started = true;
            controls.onLifecycle({ type: 'enter', replay: false });
            hybrid.onLifecycle({ type: 'enter', replay: false });
          }
          if (sessionChanged) {
            controls.init(session);
            hybrid.init(session);
          }
          if (read(telemetry, 'IsOnTrack') === true) seen.inCarFrames += 1;
          seen.rawCharges.add(raw.batteryChargeFraction);
          seen.motorStates.add(read(telemetry, 'LmuMotorState'));
          if (read(telemetry, 'LmuBatteryCharge') !== undefined) {
            seen.batteryFrames += 1;
          }
          if (
            read(telemetry, 'LmuMotorTorque') !== undefined ||
            read(telemetry, 'LmuMotorRPM') !== undefined ||
            read(telemetry, 'LmuMotorTemp') !== undefined ||
            read(telemetry, 'LmuMotorCoolantTemp') !== undefined
          ) {
            seen.motorReadingFrames += 1;
          }

          controls.onFrame(telemetry);
          const snapshot = controls.snapshot();
          seen.liftAndCoast.add(snapshot.liftAndCoast);
          if (snapshot.tcActive) seen.tcFrames += 1;
          if (snapshot.brakeAbsActive) seen.absFrames += 1;
          if (snapshot.tcActive && snapshot.brakeAbsActive) {
            seen.bothFrames += 1;
          }

          hybrid.onFrame(telemetry);
          if (hybrid.snapshot().available) seen.availableFrames += 1;
          seen.hybridVersions.add(hybrid.snapshot().version);
        },
      });
      seen.frames = frames;
    }, 120_000);

    it('reads the whole race from inside the car', () => {
      expect(seen.frames).toBeGreaterThan(MIN_FRAMES);
      // Which is what makes the rest worth asserting: a car nobody is in
      // would show no hybrid either.
      expect(seen.inCarFrames).toBe(seen.frames);
    });

    it('has a lift-and-coast signal on every frame, and it is always 0', () => {
      // A reading of none, not a missing one: the addon exports the byte.
      // The strip's progressive stage never lights.
      expect([...seen.liftAndCoast]).toEqual([0]);
    });

    it('has the two assists that take the strip, each for part of the race', () => {
      // About eleven seconds of ABS and twelve of traction control, never
      // both on one frame: those, and only those, are the frames lit.
      expect(seen.absFrames / seen.frames).toBeGreaterThan(0.043);
      expect(seen.absFrames / seen.frames).toBeLessThan(0.063);
      expect(seen.tcFrames / seen.frames).toBeGreaterThan(0.045);
      expect(seen.tcFrames / seen.frames).toBeLessThan(0.065);
      expect(seen.bothFrames).toBe(0);
    });

    it('states no motor and publishes no battery for the GT3', () => {
      // The sim's own charge field is exactly 0 throughout. The mapper
      // publishes a charge above 0 whatever the motor state says, so this
      // is what keeps the key off the frame of a car without a battery.
      expect([...seen.rawCharges]).toEqual([0]);
      expect([...seen.motorStates]).toEqual([0]);
      expect(seen.batteryFrames).toBe(0);
      expect(seen.motorReadingFrames).toBe(0);
    });

    it('never says the car has a hybrid, and never publishes', () => {
      expect(seen.availableFrames).toBe(0);
      // The blank snapshot a subscriber is seeded with, and nothing after.
      expect([...seen.hybridVersions]).toEqual([0]);
      expect(hybrid.snapshot()).toMatchObject({
        available: false,
        chargePct: null,
        motorState: 0,
        drainLapPct: 0,
        regenLapPct: 0,
        netLapEstimatePct: null,
        sessionNum: null,
      });
    });
  }
);
