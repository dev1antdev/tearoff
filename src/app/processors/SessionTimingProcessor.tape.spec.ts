import { describe, expect, it } from 'vitest';
import {
  LMU_CURATED_TAPE_PATH,
  lmuTapeAvailable,
  playLmuTape,
} from '../../testing/lmuTape';
import { SessionTimingProcessor } from './SessionTimingProcessor';

/**
 * The race clock on a recorded Le Mans Ultimate race: fifteen minutes, joined
 * a few seconds after the green flag.
 *
 * Windows only, like the other tape specs.
 */
describe.skipIf(!lmuTapeAvailable())(
  'session timing on a recorded LMU race',
  () => {
    it('reads the sim’s time remaining as a countdown to the race’s end', async () => {
      // What the processor's rule for LMU rests on.
      let frames = 0;
      let worst = 0;
      await playLmuTape({
        tapePath: LMU_CURATED_TAPE_PATH,
        speed: 40,
        onFrame: ({ raw }) => {
          frames += 1;
          worst = Math.max(
            worst,
            Math.abs(raw.sessionTimeRemaining - (raw.endET - raw.currentET))
          );
        },
      });
      expect(frames).toBeGreaterThan(5_000);
      // To four hundredths: the sim holds it as a single-precision float.
      expect(worst).toBeLessThan(0.1);
    }, 90_000);

    it('shows the time the sim says is left, however late it starts watching', async () => {
      // Started two minutes into the recording, as after the app is opened
      // mid-race or the processor is made again. The time the header shows
      // is the race's length less the time since the green flag.
      const processor = new SessionTimingProcessor();
      let started = false;
      let compared = 0;
      let worst = 0;
      let lastRemaining = Number.POSITIVE_INFINITY;
      let lastVersion = -1;
      await playLmuTape({
        tapePath: LMU_CURATED_TAPE_PATH,
        speed: 40,
        onFrame: ({ raw, telemetry, session, sessionTime }) => {
          if (sessionTime < 260) return;
          if (!started) {
            started = true;
            processor.init(session);
            processor.onLifecycle({ type: 'enter', replay: false });
          }
          processor.onFrame(telemetry);
          const snapshot = processor.snapshot();
          if (snapshot.version === lastVersion) return;
          lastVersion = snapshot.version;
          const shown =
            snapshot.timeTotal - (snapshot.time - snapshot.greenFlagTimestamp);
          // The sim's figure moves five times a second and the clock a
          // hundred, so the two are a fifth of a second apart at most.
          worst = Math.max(worst, Math.abs(shown - raw.sessionTimeRemaining));
          expect(shown).toBeLessThanOrEqual(lastRemaining + 1e-6);
          lastRemaining = shown;
          compared += 1;
        },
      });

      expect(compared).toBeGreaterThan(400);
      expect(worst).toBeLessThan(0.25);
      // About eleven minutes of the fifteen left when the recording ends.
      expect(lastRemaining).toBeGreaterThan(640);
      expect(lastRemaining).toBeLessThan(670);
    }, 90_000);
  }
);
