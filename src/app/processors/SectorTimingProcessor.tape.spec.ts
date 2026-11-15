import { describe, expect, it } from 'vitest';
import {
  LMU_CURATED_TAPE_PATH,
  lmuTapeAvailable,
  playLmuTape,
} from '../../testing/lmuTape';
import { SectorTimingProcessor } from './SectorTimingProcessor';

/**
 * The player's sector times on a recorded Le Mans Ultimate race: the start
 * from the grid at Laguna Seca, two laps and the first sector of a third.
 *
 * LMU times its own sectors, which start 39 % and 79 % round this lap. The
 * session can only say thirds, and timed between those the widget showed
 * 28.98, 25.32 and 32.37 s for a lap the sim split 32.74, 35.07 and 18.85.
 *
 * Windows only, like the other tape specs.
 */
const SIM_SECONDS = 0.002;

interface TimedLap {
  /** The sim's own three sector times, from its last-lap block. */
  sim: number[];
  lapTime: number;
  /** What the processor held for the lap in the frame the sim published it. */
  inclusive: (number | null)[];
  clean: (number | null)[];
}

describe.skipIf(!lmuTapeAvailable())(
  'sector timing on a recorded LMU race',
  () => {
    it("reports the sim's own sectors, lap after lap", async () => {
      const processor = new SectorTimingProcessor();
      processor.onLifecycle({ type: 'enter', replay: false });
      const laps: TimedLap[] = [];
      /** Every sector entry the processor dated, beside the sim's own moment. */
      const entries: { dated: number; sim: number }[] = [];
      let lastLapTime = 0;
      let lastSectorIdx = -1;
      let frames = 0;
      await playLmuTape({
        tapePath: LMU_CURATED_TAPE_PATH,
        speed: 40,
        onFrame: ({ raw, telemetry, session, sessionChanged }) => {
          frames += 1;
          if (sessionChanged) processor.init(session);
          processor.onFrame(telemetry);
          const snapshot = processor.snapshot();
          const player = raw.playerVehicleIdx;

          if (snapshot.currentSectorIdx !== lastSectorIdx) {
            // The sim's lap started, and its sectors ended, at these times on
            // the session clock.
            const lapStart = raw.vehLapStartET[player];
            const into = [
              0,
              raw.vehCurSector1[player],
              raw.vehCurSector2[player],
            ][snapshot.currentSectorIdx];
            if (lastSectorIdx >= 0) {
              entries.push({
                dated: snapshot.sectorEntryTime,
                sim: lapStart + into,
              });
            }
            lastSectorIdx = snapshot.currentSectorIdx;
          }

          const lapTime = raw.vehLastLapTime[player];
          if (lapTime > 0 && lapTime !== lastLapTime) {
            const first = raw.vehLastSector1[player];
            const firstTwo = raw.vehLastSector2[player];
            laps.push({
              sim: [first, firstTwo - first, lapTime - firstTwo],
              lapTime,
              inclusive: [...snapshot.inclusive.previousLapSectorTimes],
              clean: [...snapshot.clean.previousLapSectorTimes],
            });
          }
          lastLapTime = lapTime;
        },
      });

      expect(frames).toBeGreaterThan(5_000);
      expect(laps).toHaveLength(2);
      const [fromGrid, flying] = laps;

      // The lap from the grid: its first sector began before the car was
      // seen entering it, so it is not recorded. The other two are.
      expect(fromGrid.inclusive[0]).toBeNull();
      expect(fromGrid.inclusive[1]).toBeCloseTo(fromGrid.sim[1], 3);
      expect(fromGrid.inclusive[2]).toBeCloseTo(fromGrid.sim[2], 3);

      // The flying lap, whole: the sim's sectors to the millisecond, adding
      // up to its lap time, and nothing like the thirds.
      const times = flying.inclusive as number[];
      for (let sector = 0; sector < 3; sector += 1) {
        expect(
          Math.abs(times[sector] - flying.sim[sector]),
          `sector ${sector + 1}`
        ).toBeLessThan(SIM_SECONDS);
      }
      expect(
        Math.abs(times[0] + times[1] + times[2] - flying.lapTime)
      ).toBeLessThan(SIM_SECONDS);
      expect(times[0]).toBeCloseTo(32.739, 2);
      expect(times[1]).toBeCloseTo(35.07, 2);
      expect(times[2]).toBeCloseTo(18.851, 2);
      // Nothing left the track or was voided, so the clean view agrees.
      expect(flying.clean).toEqual(flying.inclusive);

      // The first sector of the third lap, the last thing on the tape, is
      // the session's best first sector and the lap before's stands behind.
      const final = processor.snapshot();
      expect(final.currentSectorIdx).toBe(1);
      expect(final.inclusive.currentLapSectorTimes[0]).toBeCloseTo(32.461, 2);
      expect(final.inclusive.sessionBestSectorTimes[0]).toBe(
        final.inclusive.currentLapSectorTimes[0]
      );
      expect(final.inclusive.previousSessionBestSectorTimes[0]).toBe(times[0]);

      // Where the sectors start, learned from the car's own crossings.
      expect(final.sectors.map((sector) => sector.SectorNum)).toEqual([
        0, 1, 2,
      ]);
      expect(final.sectors[0].SectorStartPct).toBe(0);
      expect(final.sectors[1].SectorStartPct).toBeCloseTo(0.39, 2);
      expect(final.sectors[2].SectorStartPct).toBeCloseTo(0.792, 2);

      // Every sector entry is dated at the sim's own crossing, not at the
      // scoring update that reported it up to a fifth of a second later.
      expect(entries).toHaveLength(7);
      for (const entry of entries) {
        expect(Math.abs(entry.dated - entry.sim)).toBeLessThan(0.005);
      }
    }, 90_000);
  }
);
