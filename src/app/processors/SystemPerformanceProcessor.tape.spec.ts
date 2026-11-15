import { describe, expect, it } from 'vitest';
import type { SystemLoadSample } from '../services/systemLoadSampler';
import {
  LMU_CURATED_TAPE_PATH,
  lmuTapeAvailable,
  playLmuTape,
} from '../../testing/lmuTape';
import { SystemPerformanceProcessor } from './SystemPerformanceProcessor';

const GB = 1024 ** 3;

/**
 * System performance on the recorded Le Mans Ultimate race.
 *
 * A recording says nothing about the machine it is replayed on, so the
 * sampler is stubbed and all the tape can confirm is the sim's side: LMU
 * publishes no frame rate and no CPU or GPU meters, on any frame of a
 * four-minute race, so the Sim row never has anything to draw.
 *
 * Windows only, like the other tape specs.
 */
describe.skipIf(!lmuTapeAvailable())(
  'system performance on a recorded LMU race',
  () => {
    it('has no meters of the sim and follows the sampler for the rest', async () => {
      let sample: SystemLoadSample | null = null;
      const processor = new SystemPerformanceProcessor({
        latest: () => sample,
      });

      let started = false;
      let lastTick = Number.NEGATIVE_INFINITY;
      let ticks = 0;
      let first = Number.POSITIVE_INFINITY;
      let last = 0;
      const simKeys = new Set<string>();
      const versions = new Set<number>();

      await playLmuTape({
        tapePath: LMU_CURATED_TAPE_PATH,
        speed: 20,
        onFrame: ({ telemetry, session, sessionTime }) => {
          if (!started) {
            started = true;
            processor.init(session);
            processor.onLifecycle({ type: 'enter', replay: false });
          }
          // Not one frame carries any of the three, whether it is ticked or not.
          for (const key of ['FrameRate', 'CpuUsageFG', 'GpuUsage'] as const) {
            if (telemetry[key] !== undefined) simKeys.add(key);
          }
          // The processor ticks once a second.
          if (sessionTime - lastTick < 1) return;
          lastTick = sessionTime;
          ticks += 1;
          first = Math.min(first, sessionTime);
          last = sessionTime;
          // The machine at a steady 40%, a reading a second.
          sample = {
            seq: ticks,
            systemCpuPercent: 40,
            systemMemoryUsedBytes: 16 * GB,
            systemMemoryTotalBytes: 32 * GB,
            appCpuPercent: 1.5,
            appMemoryKb: 400 * 1024,
          };
          processor.onFrame(telemetry);

          const snapshot = processor.snapshot();
          versions.add(snapshot.version);
          expect(snapshot.simFps).toBeNull();
          expect(snapshot.simCpuPercent).toBeNull();
          expect(snapshot.simGpuPercent).toBeNull();
          expect(snapshot.gpuPercent).toBeNull();
          expect(snapshot.systemCpuPercent).toBe(40);
          expect(snapshot.systemMemoryUsedGb).toBe(16);
          expect(snapshot.systemMemoryTotalGb).toBe(32);
          expect(snapshot.appCpuPercent).toBe(1.5);
          expect(snapshot.appMemoryMb).toBe(400);
        },
      });

      // The whole recording: 139.9 s to 379.9 s on the session clock.
      expect(ticks).toBeGreaterThan(230);
      expect(first).toBeLessThan(141);
      expect(last).toBeGreaterThan(378);
      expect([...simKeys]).toEqual([]);
      // A steady machine is published once, and never again in four minutes.
      expect([...versions]).toEqual([1]);
    }, 120_000);
  }
);
