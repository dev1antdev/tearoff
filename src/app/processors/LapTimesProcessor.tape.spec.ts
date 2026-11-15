import { describe, expect, it } from 'vitest';
import {
  LMU_CURATED_TAPE_PATH,
  lmuTapeAvailable,
  playLmuTape,
} from '../../testing/lmuTape';
import { LapTimesProcessor } from './LapTimesProcessor';

/**
 * The lap-time history on a recorded Le Mans Ultimate race: 38 cars, two
 * laps each and the leaders' third.
 *
 * Under LMU a lap's time and its count come from different places and
 * either can arrive first. Here the time is ahead of the count at more than
 * a quarter of the lap ends, and a history that waited for the count first
 * had lost or delayed a lap for 14 of the 38 cars by the end.
 *
 * Windows only, like the other tape specs.
 */
describe.skipIf(!lmuTapeAvailable())(
  'lap-time history on a recorded LMU race',
  () => {
    it('has every lap the sim timed, for every car, in order', async () => {
      const processor = new LapTimesProcessor();
      processor.onLifecycle({ type: 'enter', replay: false });
      // What the sim itself reported: each car's last lap time, each time it
      // changed to a real time.
      const timed: number[][] = [];
      const last: number[] = [];
      let frames = 0;
      await playLmuTape({
        tapePath: LMU_CURATED_TAPE_PATH,
        speed: 40,
        onFrame: ({ raw, telemetry }) => {
          frames += 1;
          for (
            let carIdx = 0;
            carIdx < raw.vehLastLapTime.length;
            carIdx += 1
          ) {
            const time = raw.vehLastLapTime[carIdx];
            timed[carIdx] ??= [];
            if (frames > 1 && time > 0 && time !== last[carIdx]) {
              timed[carIdx].push(time);
            }
            last[carIdx] = time;
          }
          processor.onFrame(telemetry);
        },
      });

      expect(frames).toBeGreaterThan(5_000);
      const history = processor.snapshot().lapTimeHistory;
      const laps = timed.reduce((sum, times) => sum + times.length, 0);
      // Two laps for all 38, and a third for the fourteen prototypes ahead.
      expect(laps).toBe(90);
      for (let carIdx = 0; carIdx < timed.length; carIdx += 1) {
        expect(history[carIdx], `car ${carIdx}`).toEqual(timed[carIdx]);
      }
    }, 90_000);
  }
);
