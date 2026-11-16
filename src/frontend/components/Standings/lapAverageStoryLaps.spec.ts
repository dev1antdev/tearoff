import { describe, expect, it } from 'vitest';
import { averageOfLastLaps } from '@irdashies/shared';
import {
  buildStoryLapTimes,
  type StoryLapCar,
  type StoryLapPlan,
} from '../../../../.storybook/lapTimesSnapshot';

/**
 * The laps the "Lap averages" stories are told with. The real
 * LapTimesProcessor makes them from staged frames; this checks that the
 * staging says what a story's text says it does, so that a change to what
 * the processor calls a clean lap shows up as a failure here and not as a
 * story, and a screenshot, that quietly say something else.
 */
interface Car extends StoryLapCar {
  plan: StoryLapPlan;
}

const CARS = {
  // Never stopped.
  steady: { lastLap: 91.2, bestLap: 90, plan: { laps: 14 } },
  // In on its tenth lap, out on its eleventh.
  stopped: { lastLap: 92.4, bestLap: 91, plan: { laps: 14, inLaps: [10] } },
  // At its box now.
  inPits: { lastLap: 121.7, bestLap: 92, plan: { laps: 14, inLaps: [14] } },
  // Twice through the pits in eleven laps.
  twice: { lastLap: 93.9, bestLap: 93, plan: { laps: 11, inLaps: [3, 8] } },
  // First seen four laps ago.
  late: { lastLap: 94.5, bestLap: 94.5, plan: { laps: 4 } },
} satisfies Record<string, Car>;

const names = Object.keys(CARS) as (keyof typeof CARS)[];
const snapshot = buildStoryLapTimes<Car>(
  names.map((name) => CARS[name]),
  (car) => car.plan
);
const all = (name: keyof typeof CARS) =>
  snapshot.lapTimeHistory[names.indexOf(name)];
const clean = (name: keyof typeof CARS) =>
  snapshot.cleanLapTimeHistory?.[names.indexOf(name)] ?? [];

describe('the staged laps of the lap average stories', () => {
  it('give every car the laps of its plan, ending on its last lap', () => {
    for (const name of names) {
      expect(all(name), name).toHaveLength(CARS[name].plan.laps);
      expect(all(name).at(-1), name).toBe(CARS[name].lastLap);
    }
  });

  it('never go under a car’s best, and reach it once', () => {
    for (const name of names) {
      const { bestLap } = CARS[name];
      expect(Math.min(...all(name)), name).toBe(bestLap);
      // Once: the Best column must not be a time the car set twice.
      expect(all(name).filter((time) => time === bestLap)).toHaveLength(1);
    }
  });

  it('leave only the first lap seen out of the clean laps of a car that never stopped', () => {
    expect(clean('steady')).toEqual(all('steady').slice(1));
    expect(clean('late')).toEqual(all('late').slice(1));
  });

  it('leave an in-lap and the out-lap after it out of the clean laps', () => {
    const laps = all('stopped');

    expect(clean('stopped')).toEqual([...laps.slice(1, 9), ...laps.slice(11)]);
    // Both are slow laps, the lap out of the box the slower.
    expect(laps[9]).toBeGreaterThan(CARS.stopped.bestLap + 10);
    expect(laps[10]).toBeGreaterThan(laps[9] + 30);
    // Which is what sets the two ways of averaging apart.
    const cleanAverage = averageOfLastLaps(clean('stopped'), 5) ?? 0;
    const allAverage = averageOfLastLaps(laps, 5) ?? 0;
    expect(allAverage - cleanAverage).toBeGreaterThan(10);
  });

  it('count the lap that brought a car to its box as a lap, and not a clean one', () => {
    expect(clean('inPits')).toEqual(all('inPits').slice(1, 13));
  });

  it('leave a car that stopped twice short of ten clean laps, though not of ten laps', () => {
    expect(clean('twice')).toHaveLength(6);
    expect(averageOfLastLaps(all('twice'), 10)).not.toBeNull();
    expect(averageOfLastLaps(clean('twice'), 10)).toBeNull();
    expect(averageOfLastLaps(clean('twice'), 5)).not.toBeNull();
  });

  it('leave a car seen four laps ago short of both', () => {
    expect(averageOfLastLaps(all('late'), 5)).toBeNull();
    expect(averageOfLastLaps(clean('late'), 5)).toBeNull();
  });
});
