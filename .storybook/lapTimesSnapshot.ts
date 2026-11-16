import type { LapTimesSnapshot, Telemetry } from '@irdashies/types';
import { LapTimesProcessor } from '../src/app/processors/LapTimesProcessor';

/**
 * Lap-time histories for stories: what the real LapTimesProcessor publishes
 * for a list of cars driven through staged laps.
 *
 * Run through the processor rather than written out by hand so that which
 * laps count as clean is the processor's answer, not the story's: a story
 * about the clean-lap averages would otherwise show whatever its author
 * believed a clean lap to be.
 *
 * Nothing here is imported through a path alias at run time, so a spec can
 * load this file and check the laps a story is told with.
 */

/** What of a staged car its laps are made from; a StoryGridCar has both. */
export interface StoryLapCar {
  /** Seconds. The last of its laps is this one. */
  lastLap: number;
  /** Seconds. No other lap is quicker. */
  bestLap: number;
}

export interface StoryLapPlan {
  /** How many laps the app has watched this car complete. */
  laps: number;
  /**
   * Which of them were in-laps, counted from 1: the car ends that lap in the
   * pit lane and begins the next one, its out-lap, from its box. A lap
   * equal to `laps` leaves the car in the pits now.
   */
  inLaps?: readonly number[];
}

/** Seconds a lap is over the car's best, lap after lap. One is the best. */
const SPREAD = [
  0.842, 0.317, 1.124, 0.468, 0.663, 0, 0.931, 0.254, 0.587, 1.366, 0.193,
  0.725, 0.409,
];
/** Seconds lost on the lap into the pit lane, and on the lap out of the box. */
const IN_LAP_LOSS = 13.4;
const OUT_LAP_LOSS = 51.7;
/** Session seconds from one staged lap to the next. */
const STEP_SECONDS = 240;

const APPROACHING_PITS = 2;
const ON_TRACK = 3;

/**
 * The lap times a car is given, oldest first. The last is the car's own
 * `lastLap`, so the average columns agree with the Last column beside them,
 * and one of the others is its `bestLap` unless the last already is.
 */
const lapTimesOf = (car: StoryLapCar, plan: StoryLapPlan): number[] =>
  Array.from({ length: plan.laps }, (_, index) => {
    const lap = index + 1;
    if (lap === plan.laps) return car.lastLap;
    const offset = SPREAD[index % SPREAD.length];
    // A second lap on the best time would have to be the last one.
    const pace =
      car.bestLap +
      (offset === 0 && car.lastLap === car.bestLap ? 0.5 : offset);
    if (plan.inLaps?.includes(lap)) return pace + IN_LAP_LOSS;
    if (plan.inLaps?.includes(lap - 1)) return pace + OUT_LAP_LOSS;
    return pace;
  });

/**
 * Builds `lap-times.snapshot` for a list of cars, a car's slot being its
 * place in the list as in `buildStoryGrid`. A car with fewer laps than the
 * others is first seen later, so every car's laps end now.
 */
export const buildStoryLapTimes = <Car extends StoryLapCar>(
  cars: readonly Car[],
  planOf: (car: Car) => StoryLapPlan
): LapTimesSnapshot => {
  const plans = cars.map(planOf);
  const times = cars.map((car, slot) => lapTimesOf(car, plans[slot]));
  const steps = Math.max(...plans.map((plan) => plan.laps));
  const processor = new LapTimesProcessor();
  processor.onLifecycle({ type: 'enter', replay: false });

  // The lap of its plan a car has completed at a step; 0 before it is seen.
  const lapAt = (slot: number, step: number) =>
    Math.max(0, step - (steps - plans[slot].laps));
  const frame = (step: number, atLine: boolean): Telemetry => {
    // Between two lines the car is on the lap after the one it completed.
    const onPitRoad = cars.map((_, slot) => {
      const completed = lapAt(slot, step);
      const driving = atLine ? completed : completed + 1;
      return plans[slot].inLaps?.includes(driving) ?? false;
    });
    return {
      SessionNum: { value: [0] },
      SessionTime: { value: [step * STEP_SECONDS + (atLine ? 0 : 120)] },
      CarIdxLapCompleted: {
        value: cars.map((_, slot) => lapAt(slot, step)),
      },
      CarIdxLastLapTime: {
        value: cars.map((_, slot) => {
          const completed = lapAt(slot, step);
          return completed > 0 ? times[slot][completed - 1] : -1;
        }),
      },
      CarIdxOnPitRoad: { value: onPitRoad },
      CarIdxTrackSurface: {
        value: onPitRoad.map((inPits) =>
          inPits ? APPROACHING_PITS : ON_TRACK
        ),
      },
    } as unknown as Telemetry;
  };

  processor.onFrame(frame(0, true));
  for (let step = 1; step <= steps; step += 1) {
    processor.onFrame(frame(step - 1, false));
    processor.onFrame(frame(step, true));
  }
  return processor.snapshot();
};
