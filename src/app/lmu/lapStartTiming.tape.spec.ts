import { describe, expect, it } from 'vitest';
import {
  LMU_CURATED_TAPE_PATH,
  lmuTapeAvailable,
  playLmuTape,
} from '../../testing/lmuTape';
import { createLmuLapStartState, observeLmuLapStarts } from './lapStartTiming';

/**
 * Laps timed from their starts, against the sim's own lap times, on a
 * recorded Le Mans Ultimate race.
 *
 * The recording has no lap the sim refused to time, which is the case the
 * measuring is for. What it can show is that the measure is the right one:
 * where the sim did time a lap, start to start comes to the same figure.
 *
 * Windows only, like the other tape specs.
 */
describe.skipIf(!lmuTapeAvailable())(
  'lap times from lap starts on a recorded LMU race',
  () => {
    it('come to the sim’s own lap times', async () => {
      const state = createLmuLapStartState();
      const lastSeen: number[] = [];
      let compared = 0;
      let worst = 0;
      await playLmuTape({
        tapePath: LMU_CURATED_TAPE_PATH,
        speed: 40,
        onFrame: ({ raw }) => {
          observeLmuLapStarts(state, {
            lapStartETs: raw.vehLapStartET,
            lapDistPcts: raw.vehLapDistPct,
            estimatedLapTimes: raw.vehEstimatedLapTime,
          });
          for (
            let carIdx = 0;
            carIdx < raw.vehLastLapTime.length;
            carIdx += 1
          ) {
            const official = raw.vehLastLapTime[carIdx];
            const measured = state.measured[carIdx];
            // Each lap once, when the sim's time for it arrives and the
            // lap has been measured from start to start.
            if (
              official > 0 &&
              official !== lastSeen[carIdx] &&
              measured !== undefined &&
              measured > 0
            ) {
              worst = Math.max(worst, Math.abs(measured - official));
              compared += 1;
            }
            lastSeen[carIdx] = official;
          }
        },
      });

      // The laps that began after the recording did: the second lap of all
      // 38 cars and the third of the fourteen prototypes.
      expect(compared).toBeGreaterThanOrEqual(38);
      expect(worst).toBeLessThan(0.01);
    }, 90_000);
  }
);
