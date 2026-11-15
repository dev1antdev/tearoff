import { describe, expect, it } from 'vitest';
import {
  LMU_CURATED_TAPE_PATH,
  lmuTapeAvailable,
  playLmuTape,
} from '../../testing/lmuTape';
import { SessionBarProcessor } from './SessionBarProcessor';
import {
  createTimeScaleEstimator,
  TIME_SCALE_WINDOW_SECONDS,
} from './timeScaleEstimator';

/**
 * The in-game clock on a recorded Le Mans Ultimate race: an offline race at
 * Laguna Seca on the sim's default start, ten past three in the afternoon,
 * with the day running in real time.
 *
 * Windows only, like the other tape specs.
 */
describe.skipIf(!lmuTapeAvailable())(
  'the in-game clock on a recorded LMU race',
  () => {
    it('starts the day at 15:10 and runs it at the pace of the session clock', async () => {
      // What the sim itself says, before any of the app's own arithmetic:
      // the time of day less the session clock is when the session began.
      let frames = 0;
      let earliest = Number.POSITIVE_INFINITY;
      let latest = Number.NEGATIVE_INFINITY;
      await playLmuTape({
        tapePath: LMU_CURATED_TAPE_PATH,
        speed: 40,
        onFrame: ({ raw }) => {
          frames += 1;
          const start = raw.timeOfDay - raw.currentET;
          earliest = Math.min(earliest, start);
          latest = Math.max(latest, start);
        },
      });

      expect(frames).toBeGreaterThan(5_000);
      // 54,600 s is 15:10:00, and it does not drift over the four minutes:
      // a time scale of exactly 1.
      expect(earliest).toBeCloseTo(54_600, 1);
      expect(latest).toBeCloseTo(54_600, 1);
    }, 90_000);

    it('publishes 15:12 at the first frame and a time scale of 1 from five seconds in', async () => {
      const processor = new SessionBarProcessor();
      let started = false;
      let firstTime = Number.NaN;
      let firstTimeOfDay: number | undefined;
      let lastTime = Number.NaN;
      let lastVersion = -1;
      let firstMeasuredAt = Number.NaN;
      const beforeMeasuring = new Set<number | undefined>();
      const scales = new Set<number | undefined>();
      // The processor's own measurement before rounding, from an estimator
      // fed the same frames, to see how far from a whole number it sits: the
      // time of day moves five times a second and the session clock a
      // hundred.
      const unrounded = createTimeScaleEstimator();
      let lastRatio: number | undefined;
      let lowestRatio = Number.POSITIVE_INFINITY;
      let highestRatio = Number.NEGATIVE_INFINITY;
      let windows = 0;
      // And what measuring between two publications, wherever they fall,
      // would have given.
      let referenceTime = Number.NaN;
      let referenceTimeOfDay = Number.NaN;
      let lowestUnaligned = Number.POSITIVE_INFINITY;
      let highestUnaligned = Number.NEGATIVE_INFINITY;

      await playLmuTape({
        tapePath: LMU_CURATED_TAPE_PATH,
        speed: 40,
        onFrame: ({ telemetry, session, sessionTime }) => {
          if (!started) {
            started = true;
            processor.init(session);
            processor.onLifecycle({ type: 'enter', replay: false });
          }
          processor.onFrame(telemetry);
          const frameTimeOfDay = telemetry.SessionTimeOfDay?.value?.[0];
          if (typeof frameTimeOfDay === 'number') {
            unrounded.update(sessionTime, frameTimeOfDay);
            const ratio = unrounded.lastRatio();
            if (ratio !== undefined && ratio !== lastRatio) {
              lastRatio = ratio;
              lowestRatio = Math.min(lowestRatio, ratio);
              highestRatio = Math.max(highestRatio, ratio);
              windows += 1;
            }
          }
          const snapshot = processor.snapshot();
          if (snapshot.version === lastVersion) return;
          lastVersion = snapshot.version;
          const timeOfDay = snapshot.sessionTimeOfDay;
          if (timeOfDay === undefined) return;

          if (Number.isNaN(firstTime)) {
            firstTime = sessionTime;
            firstTimeOfDay = timeOfDay;
            referenceTime = sessionTime;
            referenceTimeOfDay = timeOfDay;
          }
          lastTime = sessionTime;

          if (snapshot.timeScale === undefined) {
            beforeMeasuring.add(snapshot.timeScale);
          } else if (Number.isNaN(firstMeasuredAt)) {
            firstMeasuredAt = sessionTime;
          }
          if (!Number.isNaN(firstMeasuredAt)) scales.add(snapshot.timeScale);

          if (sessionTime - referenceTime > TIME_SCALE_WINDOW_SECONDS) {
            const ratio =
              (timeOfDay - referenceTimeOfDay) / (sessionTime - referenceTime);
            lowestUnaligned = Math.min(lowestUnaligned, ratio);
            highestUnaligned = Math.max(highestUnaligned, ratio);
            referenceTime = sessionTime;
            referenceTimeOfDay = timeOfDay;
          }
        },
      });

      // 15:12:19 at the first frame, 139.8 s into the session.
      expect(firstTime).toBeGreaterThan(139);
      expect(firstTime).toBeLessThan(141);
      expect(firstTimeOfDay).toBeDefined();
      const minuteOfDay = Math.floor((firstTimeOfDay ?? 0) / 60);
      expect([Math.floor(minuteOfDay / 60), minuteOfDay % 60]).toEqual([
        15, 12,
      ]);
      expect((firstTimeOfDay ?? 0) - firstTime).toBeCloseTo(54_600, 0);

      // Nothing for the first window: LMU states no scale to stand in.
      expect([...beforeMeasuring]).toEqual([undefined]);
      expect(firstMeasuredAt - firstTime).toBeGreaterThan(
        TIME_SCALE_WINDOW_SECONDS
      );
      expect(firstMeasuredAt - firstTime).toBeLessThan(
        TIME_SCALE_WINDOW_SECONDS + 0.5
      );
      // Then 1, at every publication to the end of the recording.
      expect([...scales]).toEqual([1]);
      expect(lastTime).toBeGreaterThan(375);

      // Each window on its own, before rounding: within a quarter of a
      // percent of 1 on this recording, so a day sixty times as fast would
      // still round to 60.
      expect(windows).toBeGreaterThan(40);
      expect(lowestRatio).toBeGreaterThan(0.99);
      expect(highestRatio).toBeLessThan(1.01);
      // Between two publications wherever they fall it was 0.984 to 1.034:
      // the age of the time of day, up to a fifth of a second, against a
      // five-second window. Enough to read 15 as 14 or 16.
      expect(highestUnaligned - lowestUnaligned).toBeGreaterThan(
        (highestRatio - lowestRatio) * 2
      );
      expect(lowestUnaligned).toBeGreaterThan(0.95);
      expect(highestUnaligned).toBeLessThan(1.05);
    }, 90_000);
  }
);
