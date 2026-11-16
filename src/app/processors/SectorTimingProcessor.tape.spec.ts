import { describe, expect, it } from 'vitest';
import {
  LMU_CURATED_TAPE_PATH,
  lmuTapeAvailable,
  playLmuTape,
} from '../../testing/lmuTape';
import { sectorSum, type SectorBests } from '../../shared/sectorBests';
import { SectorTimingProcessor } from './SectorTimingProcessor';

/**
 * The player's sector times on a recorded Le Mans Ultimate race: the start
 * from the grid at Laguna Seca, two laps and the first sector of a third.
 *
 * LMU times its own sectors, which start 39 % and 79 % round this lap. The
 * session can only say thirds, and timed between those the widget showed
 * 28.98, 25.32 and 32.37 s for a lap the sim split 32.74, 35.07 and 18.85.
 *
 * The same run feeds the all-time bests, into a stand-in for the store that
 * keeps them: what a first session on a track leaves behind for the next.
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
      // The store, empty and already read: nothing was ever driven here.
      const saves: { key: string; bests: SectorBests }[] = [];
      const kept = new Map<string, SectorBests>();
      let revision = 1;
      const processor = new SectorTimingProcessor({
        simulator: 'lmu',
        store: {
          load: (key) => kept.get(key) ?? null,
          save: (key, bests) => {
            kept.set(key, bests);
            saves.push({ key, bests });
            revision += 1;
          },
          revision: () => revision,
        },
      });
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

      // The best lap of the session is the flying lap, sector for sector:
      // the lap from the rolling start has no first sector and is no lap.
      const bestLap = final.clean.sessionBestLapSectorTimes as number[];
      expect(bestLap[0]).toBeCloseTo(32.739, 2);
      expect(bestLap[1]).toBeCloseTo(35.07, 2);
      expect(bestLap[2]).toBeCloseTo(18.851, 2);
      expect(sectorSum(bestLap)).toBeCloseTo(flying.lapTime, 2);
      expect(final.inclusive.sessionBestLapSectorTimes).toEqual(bestLap);
      expect(final.clean.finishedLapSectorTimes).toEqual(bestLap);

      // The theoretical best is quicker than any lap driven: the third
      // lap's first sector with the flying lap's other two.
      const theoretical = sectorSum(final.clean.sessionBestSectorTimes);
      expect(theoretical).toBeCloseTo(86.382, 2);
      expect(theoretical).toBeLessThan(flying.lapTime);

      // Nothing left the track, was voided or touched pit road, so the
      // all-time bests are the session's, and what they replaced with them.
      expect(final.allTime?.bestSectorTimes).toEqual(
        final.clean.sessionBestSectorTimes
      );
      expect(final.allTime?.bestLapSectorTimes).toEqual(bestLap);
      expect(final.allTime?.previousBestSectorTimes[0]).toBe(bestLap[0]);
      expect(final.allTime?.previousBestSectorTimes[1]).toBeCloseTo(
        fromGrid.sim[1],
        3
      );

      // And they are in the store, under the simulator, the track, the car
      // model and the sim's own sector layout: written at each improvement,
      // the last of them the third lap's first sector.
      expect(saves.length).toBeGreaterThanOrEqual(5);
      const stored = saves.at(-1);
      expect(stored?.key).toMatch(/^lmu\|\d+\|Ferrari 296 LMGT3 Evo\|sim3$/);
      expect(new Set(saves.map((save) => save.key)).size).toBe(1);
      expect(stored?.bests.bestSectorTimes[0]).toBeCloseTo(32.461, 2);
      expect(stored?.bests.bestSectorTimes[1]).toBeCloseTo(35.07, 2);
      expect(stored?.bests.bestSectorTimes[2]).toBeCloseTo(18.851, 2);
      expect(stored?.bests.bestLapSectorTimes).toEqual(bestLap);
    }, 90_000);

    it('leaves nothing of the lap before in a lap the sim did not time (staged)', async () => {
      // STAGED: the recording has no lap the sim refused to time, so the
      // flying lap is made one. From the scoring update that publishes its
      // 86.660 s, the player's last lap time reads -1 instead, as it does
      // for a lap that did not count. Everything else is as recorded: the
      // sim's sector index, its first two sector times, the car.
      const processor = new SectorTimingProcessor();
      processor.onLifecycle({ type: 'enter', replay: false });
      /** The snapshot in the frame each lap ended, and the sim's own S3. */
      const atLine: {
        previous: (number | null)[];
        cleanPrevious: (number | null)[];
        finished: (number | null)[];
        current: (number | null)[];
        entryValid: boolean;
        simSector3: number;
      }[] = [];
      let lastSectorIdx = -1;
      let withheld = 0;
      await playLmuTape({
        tapePath: LMU_CURATED_TAPE_PATH,
        transformRaw: (raw) => {
          const player = raw.playerVehicleIdx;
          const lapTime = raw.vehLastLapTime[player];
          if (!(lapTime > 86 && lapTime < 87)) return raw;
          withheld += 1;
          return {
            ...raw,
            vehLastLapTime: Float64Array.from(
              raw.vehLastLapTime,
              (time, carIdx) => (carIdx === player ? -1 : time)
            ),
          };
        },
        onFrame: ({ raw, telemetry, session, sessionChanged }) => {
          if (sessionChanged) processor.init(session);
          processor.onFrame(telemetry);
          const snapshot = processor.snapshot();
          if (snapshot.currentSectorIdx === 0 && lastSectorIdx === 2) {
            const player = raw.playerVehicleIdx;
            atLine.push({
              previous: [...snapshot.inclusive.previousLapSectorTimes],
              cleanPrevious: [...snapshot.clean.previousLapSectorTimes],
              finished: [...snapshot.inclusive.finishedLapSectorTimes],
              current: [...snapshot.inclusive.currentLapSectorTimes],
              entryValid: snapshot.sectorEntryValid,
              simSector3:
                raw.vehLastLapTime[player] - raw.vehLastSector2[player],
            });
          }
          lastSectorIdx = snapshot.currentSectorIdx;
        },
      });

      expect(withheld).toBeGreaterThan(3_000);
      expect(atLine).toHaveLength(2);
      const [fromGrid, untimed] = atLine;

      // The lap from the grid is timed as recorded: its third sector is the
      // sim's own, 19.007 s of the 97.823 s it gave the lap.
      expect(fromGrid.previous[0]).toBeNull();
      expect(fromGrid.previous[1]).not.toBeNull();
      expect(fromGrid.previous[2]).toBeCloseTo(fromGrid.simSector3, 3);
      expect(fromGrid.previous[2]).toBeCloseTo(19.007, 2);

      // The lap after it has its first two sectors and, with no lap time,
      // no third. What is published as the previous lap is that lap: the
      // third sector of the lap from the grid is not left standing in it,
      // where the panel would hold it up for five seconds as just driven.
      expect(untimed.finished[0]).toBeCloseTo(32.739, 2);
      expect(untimed.finished[1]).toBeCloseTo(35.07, 2);
      expect(untimed.finished[2]).toBeNull();
      expect(untimed.previous).toEqual(untimed.finished);
      expect(untimed.cleanPrevious).toEqual(untimed.finished);
      // The frame the panel's hold begins in: over the line, in the first
      // sector, this lap's list cleared.
      expect(untimed.entryValid).toBe(true);
      expect(untimed.current).toEqual([null, null, null]);

      // And it stays so through the third lap's first sector, the last
      // thing on the tape: a fresh S1, the untimed lap's S2, no S3.
      const final = processor.snapshot();
      expect(final.currentSectorIdx).toBe(1);
      expect(final.inclusive.previousLapSectorTimes[0]).toBeCloseTo(32.461, 2);
      expect(final.inclusive.previousLapSectorTimes[1]).toBeCloseTo(35.07, 2);
      expect(final.inclusive.previousLapSectorTimes[2]).toBeNull();
      // The session's best third sector is still the one that was timed.
      expect(final.inclusive.sessionBestSectorTimes[2]).toBeCloseTo(
        fromGrid.simSector3,
        3
      );
    }, 90_000);
  }
);
