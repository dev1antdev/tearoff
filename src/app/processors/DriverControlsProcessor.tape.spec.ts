import { beforeAll, describe, expect, it } from 'vitest';
import type { DriverControlsSnapshot } from '@irdashies/types';
import type { LmuRawTelemetry } from '../lmu/native';
import type { LmuRestCells } from '../lmu/rest/state';
import {
  LMU_CURATED_TAPE_PATH,
  lmuTapeAvailable,
  playLmuTape,
} from '../../testing/lmuTape';
import { DriverControlsProcessor } from './DriverControlsProcessor';

/**
 * The setup's steering lock as the recording's REST answers state it:
 * "476 (17.2) deg", which rest/tapeCurated.spec.ts pins. One cell for the
 * whole run, as the poller holds it.
 */
const SETUP_CELLS: LmuRestCells = { steerLockDeg: { value: [476] } };

/**
 * Plays the curated tape through the mapper and the driver-controls
 * processor, every frame, and hands each snapshot to `onFrame`.
 */
const playDriverControls = async (
  onFrame: (snapshot: DriverControlsSnapshot, raw: LmuRawTelemetry) => void,
  restCells?: LmuRestCells
): Promise<number> => {
  const processor = new DriverControlsProcessor();
  let started = false;
  const { frames } = await playLmuTape({
    tapePath: LMU_CURATED_TAPE_PATH,
    speed: 20,
    restCells: () => restCells,
    onFrame: ({ raw, telemetry, session }) => {
      if (!started) {
        started = true;
        processor.init(session);
        processor.onLifecycle({ type: 'enter', replay: false });
      }
      processor.onFrame(telemetry);
      onFrame(processor.snapshot(), raw);
    },
  });
  return frames;
};

const degrees = (radians: number) => (radians * 180) / Math.PI;

/**
 * The fewest frames a run may read and still be judged. The replay runs at
 * twenty times real speed and a busy machine reads fewer of the recording's
 * frames, about 15,400 at best, so counts are compared as shares of the
 * frames read and extremes with room for a peak frame that was not.
 */
const MIN_FRAMES = 10_000;

const median = (values: number[]): number =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

/**
 * The pedals, the wheel and the two assists on the recorded Le Mans Ultimate
 * race: four minutes in a Ferrari 296 LMGT3, with the setup's steering lock
 * supplied as the REST poller would hold it.
 *
 * This is what the Input widget's two sources read. `throttle` and `brake`
 * are the Car source, what the car received; `throttleRaw` and `brakeRaw`
 * are the Pedals source, what the driver pressed.
 *
 * Windows only, like the other tape specs.
 */
describe.skipIf(!lmuTapeAvailable())(
  'the driver controls on a recorded LMU race',
  () => {
    const seen = {
      frames: 0,
      tcFrames: 0,
      tcFramesCarBelowPedal: 0,
      carBelowPedal: 0,
      largestCut: 0,
      brakeFramesApart: 0,
      clutchFramesPressed: 0,
      pedalThrottleMax: 0,
      pedalBrakeMax: 0,
      absFrames: 0,
      absWithTcFrames: 0,
      ranges: new Set<number | undefined>(),
      steerLeftMax: 0,
      steerRightMax: 0,
      ffbMin: 0,
      ffbMax: 0,
      pressureMin: 0,
      pressureMax: 0,
      summedPressureMax: 0,
      wheelLeftMax: 0,
      wheelRightMax: 0,
      /** Steering wheel degrees per road-wheel degree, in the corners. */
      ratios: [] as number[],
    };

    /** A count of frames as a share of the frames read. */
    const share = (count: number) => count / seen.frames;

    beforeAll(async () => {
      seen.frames = await playDriverControls((snapshot, raw) => {
        const car = snapshot.throttle ?? 0;
        const pedal = snapshot.throttleRaw ?? 0;
        if (snapshot.tcActive) {
          seen.tcFrames += 1;
          if (car < pedal) seen.tcFramesCarBelowPedal += 1;
        }
        if (car < pedal) seen.carBelowPedal += 1;
        seen.largestCut = Math.max(seen.largestCut, pedal - car);
        if (snapshot.brake !== snapshot.brakeRaw) seen.brakeFramesApart += 1;
        // iRacing's sense: 1 is the pedal up.
        if (snapshot.clutch !== 1 || snapshot.clutchRaw !== 1) {
          seen.clutchFramesPressed += 1;
        }
        seen.pedalThrottleMax = Math.max(seen.pedalThrottleMax, pedal);
        seen.pedalBrakeMax = Math.max(
          seen.pedalBrakeMax,
          snapshot.brakeRaw ?? 0
        );
        if (snapshot.brakeAbsActive) seen.absFrames += 1;
        if (snapshot.brakeAbsActive && snapshot.tcActive) {
          seen.absWithTcFrames += 1;
        }

        seen.ranges.add(snapshot.steeringRangeDeg);
        const steer = degrees(snapshot.steeringWheelAngle ?? 0);
        seen.steerLeftMax = Math.max(seen.steerLeftMax, steer);
        seen.steerRightMax = Math.max(seen.steerRightMax, -steer);
        seen.ffbMin = Math.min(seen.ffbMin, snapshot.ffb ?? 0);
        seen.ffbMax = Math.max(seen.ffbMax, snapshot.ffb ?? 0);
        seen.pressureMin = Math.min(
          seen.pressureMin,
          snapshot.brakePressure ?? 0
        );
        seen.pressureMax = Math.max(
          seen.pressureMax,
          snapshot.brakePressure ?? 0
        );
        seen.summedPressureMax = Math.max(
          seen.summedPressureMax,
          Array.from(raw.brakePressure ?? []).reduce(
            (sum, pressure) => sum + pressure,
            0
          )
        );
        const wheel = snapshot.frontWheelAngleDeg ?? 0;
        seen.wheelLeftMax = Math.max(seen.wheelLeftMax, wheel);
        seen.wheelRightMax = Math.max(seen.wheelRightMax, -wheel);
        if (Math.abs(wheel) >= 4) seen.ratios.push(steer / wheel);
      }, SETUP_CELLS);
    }, 120_000);

    it('gives the car less throttle than the pedal on every frame traction control cuts', () => {
      expect(seen.frames).toBeGreaterThan(MIN_FRAMES);
      // About twelve seconds of traction control in the four minutes.
      expect(share(seen.tcFrames)).toBeGreaterThan(0.045);
      expect(share(seen.tcFrames)).toBeLessThan(0.065);
      // On every one of them the two sources read differently: the pedal is
      // where the driver holds it and the car gets less, down to nothing
      // with the pedal flat.
      expect(seen.tcFramesCarBelowPedal).toBe(seen.tcFrames);
      expect(seen.largestCut).toBeGreaterThan(0.9);
      // And on a few frames more, either side of the flag: 6 to 7 % of the
      // recording in all.
      expect(seen.carBelowPedal).toBeGreaterThan(seen.tcFrames);
      expect(share(seen.carBelowPedal)).toBeGreaterThan(0.05);
      expect(share(seen.carBelowPedal)).toBeLessThan(0.08);
      expect(seen.pedalThrottleMax).toBe(1);
    });

    it('leaves the brake and the clutch the same in both sources', () => {
      // ABS works for about eleven seconds, and the sim still reports the
      // brake the car receives as the pedal: only the flag says it worked.
      expect(share(seen.absFrames)).toBeGreaterThan(0.043);
      expect(share(seen.absFrames)).toBeLessThan(0.063);
      expect(seen.brakeFramesApart).toBe(0);
      expect(seen.pedalBrakeMax).toBeGreaterThan(0.97);
      // Never both assists on one frame, and the clutch is never touched.
      expect(seen.absWithTcFrames).toBe(0);
      expect(seen.clutchFramesPressed).toBe(0);
    });

    it('scales the wheel by the 476 degrees of the setup', () => {
      // The driver's own wheel reads 0 throughout, so the range falls
      // through to the setup's on every frame.
      expect([...seen.ranges]).toEqual([476]);
      // 65 % of the lock to the left and 52 % to the right, of 238 degrees:
      // 155 and 123.
      expect(seen.steerLeftMax).toBeGreaterThan(150);
      expect(seen.steerLeftMax).toBeLessThan(156);
      expect(seen.steerRightMax).toBeGreaterThan(119);
      expect(seen.steerRightMax).toBeLessThan(124.5);
      // The road wheels turn 11 degrees at most, signed like the wheel.
      expect(seen.wheelLeftMax).toBeGreaterThan(10);
      expect(seen.wheelLeftMax).toBeLessThan(11.5);
      expect(seen.wheelRightMax).toBeGreaterThan(8);
      expect(seen.wheelRightMax).toBeLessThan(9.2);
      // Which is what says the range is the right one: in the corners the
      // wheel turns about 14 degrees for each one at the road, where the
      // setup's own figures, 476 over 17.2, give 13.8. At the animation's
      // 719 it would be 21.
      expect(share(seen.ratios.length)).toBeGreaterThan(0.07);
      expect(Math.min(...seen.ratios)).toBeGreaterThan(13);
      expect(Math.max(...seen.ratios)).toBeLessThan(15.5);
      expect(median(seen.ratios)).toBeGreaterThan(13.8);
      expect(median(seen.ratios)).toBeLessThan(14.6);
    });

    it('reads force feedback that never clips and a self-scaled brake pressure', () => {
      // -0.75 to 0.95 of full force.
      expect(seen.ffbMin).toBeLessThan(-0.6);
      expect(seen.ffbMin).toBeGreaterThan(-0.8);
      expect(seen.ffbMax).toBeGreaterThan(0.8);
      expect(seen.ffbMax).toBeLessThan(1);
      // The four line pressures sum to just under 2 at most, in the sim's
      // own unit; over the largest sum so far that is a fraction of 1.
      expect(seen.summedPressureMax).toBeGreaterThan(1.7);
      expect(seen.summedPressureMax).toBeLessThan(2.05);
      expect(seen.pressureMin).toBe(0);
      expect(seen.pressureMax).toBe(1);
    });

    it('scales the wheel by the 719 degrees of the cockpit animation until the setup is known', async () => {
      const ranges = new Set<number | undefined>();
      let steerLeftMax = 0;
      await playDriverControls((snapshot) => {
        ranges.add(snapshot.steeringRangeDeg);
        steerLeftMax = Math.max(
          steerLeftMax,
          degrees(snapshot.steeringWheelAngle ?? 0)
        );
      });

      // With no REST answer the animation's range is all there is, and the
      // same 65 % of lock is drawn half as far round again: 234 degrees.
      expect([...ranges]).toEqual([719]);
      expect(steerLeftMax).toBeGreaterThan(226);
      expect(steerLeftMax).toBeLessThan(236);
    }, 120_000);
  }
);
