import type { DriverControlsSnapshot } from '@irdashies/types';

/**
 * A made-up corner, braking to exit, as the driver-controls channel would
 * publish it at 60 Hz: for the stories that need a history in the trace and
 * a known moment to stand on. Not a recording.
 *
 * The car is shaped on the recorded Le Mans Ultimate LMGT3: a 476 degree
 * wheel at 13.8:1, a brake the sim reports the same in both sources, and a
 * throttle the car receives less of while traction control cuts. It ends
 * mid-cut, with the pedal flat and the car getting about half of it.
 */
export interface CornerExitOptions {
  /**
   * End with the left foot on the brake as well, ABS working, so that both
   * assists are marked on the same frame.
   */
  brakeOverlap?: boolean;
  /**
   * Leave the raw pedals out, as for a car that is being watched: the sim
   * gives what the car receives and nothing of the pedals.
   */
  withoutRawInputs?: boolean;
}

const FRAMES = 400;
const STEERING_RANGE_DEG = 476;
const STEERING_RATIO = 13.8;

const clamp = (value: number) => Math.max(0, Math.min(1, value));
/** 0 before `from`, 1 after `to`, a smooth step between. */
const ramp = (frame: number, from: number, to: number) => {
  const t = clamp((frame - from) / (to - from));
  return t * t * (3 - 2 * t);
};
const round = (value: number, perUnit: number) =>
  Math.round(value * perUnit) / perUnit;

export const cornerExitFrames = ({
  brakeOverlap = false,
  withoutRawInputs = false,
}: CornerExitOptions = {}): DriverControlsSnapshot[] =>
  Array.from({ length: FRAMES }, (_, frame) => {
    // Flat on the straight, off for the corner, then back to the floor.
    const pedalThrottle = clamp(
      1 -
        ramp(frame, 38, 46) +
        0.2 * ramp(frame, 130, 150) * (1 - ramp(frame, 170, 215)) +
        ramp(frame, 170, 215)
    );
    // Two cuts on the way out, with the car hooked up between them.
    const tcActive =
      (frame >= 204 && frame < 292) || (frame >= 336 && frame < FRAMES);
    // About half the pedal, a little uneven, as a cut is.
    const cut =
      0.52 + 0.06 * Math.sin(frame * 0.31) + 0.03 * Math.sin(frame * 0.83);
    const carThrottle = tcActive ? pedalThrottle * cut : pedalThrottle;

    // Hard on the brake, trailed off into the corner.
    const corner = 0.95 * ramp(frame, 44, 54) * (1 - ramp(frame, 88, 132));
    const overlap = brakeOverlap ? 0.62 * ramp(frame, 350, 372) : 0;
    const brake = clamp(corner + overlap);
    const brakeAbsActive =
      (frame >= 58 && frame < 86 && frame % 12 < 9) ||
      (brakeOverlap && frame >= 366);

    // Turned in to 110 degrees, unwound on the exit. Left is positive.
    const steerDeg =
      110 * ramp(frame, 92, 150) * (1 - 0.7 * ramp(frame, 180, 380));
    const gear =
      frame < 60 ? 5 : frame < 84 ? 4 : frame < 108 ? 3 : frame < 300 ? 2 : 3;
    const speed =
      62 - 38 * ramp(frame, 44, 140) + 22 * ramp(frame, 180, FRAMES);

    return {
      throttle: carThrottle,
      throttleRaw: withoutRawInputs ? undefined : pedalThrottle,
      brake,
      brakeRaw: withoutRawInputs ? undefined : brake,
      // iRacing's sense: 1 is the pedal up.
      clutch: 1,
      clutchRaw: withoutRawInputs ? undefined : 1,
      gear,
      speed,
      displayUnits: 1,
      steeringWheelAngle: (steerDeg * Math.PI) / 180,
      steeringRangeDeg: STEERING_RANGE_DEG,
      frontWheelAngleDeg: round(steerDeg / STEERING_RATIO, 10),
      brakeAbsActive,
      tcActive,
      ffb: round(0.25 + 0.5 * (steerDeg / 110) + 0.08 * Math.sin(frame), 100),
      brakePressure: round(brake / 0.95, 100),
      version: frame + 1,
    } satisfies DriverControlsSnapshot;
  });

/** The moment the run ends on, for a story that needs no history. */
export const cornerExitMoment = (
  options?: CornerExitOptions
): DriverControlsSnapshot => {
  const frames = cornerExitFrames(options);
  return frames[frames.length - 1];
};
