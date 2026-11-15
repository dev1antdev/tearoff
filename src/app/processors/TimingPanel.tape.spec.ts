import { beforeAll, describe, expect, it } from 'vitest';
import {
  LMU_CURATED_TAPE_PATH,
  lmuTapeAvailable,
  playLmuTape,
} from '../../testing/lmuTape';
import { LapDeltaProcessor } from './LapDeltaProcessor';
import { LapLogProcessor } from './LapLogProcessor';
import { ReferenceLapProcessor } from './ReferenceLapProcessor';
import { SectorTimingProcessor } from './SectorTimingProcessor';
import { SessionTimingProcessor } from './SessionTimingProcessor';

/**
 * What the Timing panel reads, on a recorded Le Mans Ultimate race: the
 * rolling start at Laguna Seca, two laps and the first sector of a third,
 * the player in car 0.
 *
 * The panel has no processor of its own. Its tiles are the lap number from
 * session timing, the last and best lap from the lap log, the sector times
 * from sector timing and the delta from the lap delta, so this plays the
 * tape through those four and checks each against the sim's own figures at
 * the moments a driver would look: at the line, and at each sector's end.
 *
 * The recording is all under green with no lap the sim refused to time, so
 * the mark for a lap that did not count can only be seen to stay off here.
 *
 * Windows only, like the other tape specs.
 */
const PLAYER = 0;

interface LineCrossing {
  sessionTime: number;
  /** The sim's own time for the lap just finished. */
  simLastLap: number;
  simBestLap: number;
  /** What the lap log published in the same frame. */
  lastLapTime: number;
  bestLapTime: number;
  /** The last sector as the sim gives it: the lap less its first two. */
  simSector3: number;
  /** The last sector the panel holds for the finished lap. */
  sector3: number | null;
  /** This lap's sector times in that frame: cleared with the lap. */
  currentLap: (number | null)[];
}

interface SectorAppearance {
  /** Zero-based sector whose time has just appeared. */
  sector: number;
  /** The lap tile at that moment. */
  lap: number;
  /** Where the car was when the time appeared. */
  lapDistPct: number;
  time: number;
  /** The sim's own figure for the sector in the same frame. */
  simTime: number | null;
}

interface DeltaSample {
  sessionTime: number;
  delta: number | null;
  referenceLapTime: number | null;
}

const playRace = async () => {
  const sessionTiming = new SessionTimingProcessor();
  const lapLog = new LapLogProcessor();
  const sectors = new SectorTimingProcessor();
  const reference = new ReferenceLapProcessor({
    load: () => null,
    save: () => undefined,
  });
  const lapDelta = new LapDeltaProcessor(reference);
  for (const processor of [
    sessionTiming,
    lapLog,
    sectors,
    reference,
    lapDelta,
  ]) {
    processor.onLifecycle({ type: 'enter', replay: false });
  }

  /** Every value the lap tile took, in order. */
  const lapTile: number[] = [];
  const crossings: LineCrossing[] = [];
  const appearances: SectorAppearance[] = [];
  const deltas: DeltaSample[] = [];
  let lastSimLap = 0;
  let lastCurrent: readonly (number | null)[] = [];
  let lastDeltaTick = Number.NEGATIVE_INFINITY;
  let invalidFrames = 0;
  let frames = 0;

  await playLmuTape({
    tapePath: LMU_CURATED_TAPE_PATH,
    // Fast enough to finish in seconds, slow enough that every recorded
    // frame is read.
    speed: 40,
    onFrame: ({ raw, telemetry, session, sessionChanged, sessionTime }) => {
      frames += 1;
      if (sessionChanged) {
        sessionTiming.init(session);
        lapLog.init(session);
        sectors.init(session);
        reference.init(session);
        lapDelta.init(session);
      }
      sessionTiming.onFrame(telemetry);
      lapLog.onFrame(telemetry);
      sectors.onFrame(telemetry);
      reference.onFrame(telemetry);

      const lap = sessionTiming.snapshot().currentLap;
      if (lap !== lapTile.at(-1)) lapTile.push(lap);

      const log = lapLog.snapshot();
      if (log.lastLapInvalid) invalidFrames += 1;

      const timing = sectors.snapshot().inclusive;
      const current = timing.currentLapSectorTimes;
      for (let sector = 0; sector < current.length; sector += 1) {
        const time = current[sector];
        if (time === null || (lastCurrent[sector] ?? null) !== null) continue;
        appearances.push({
          sector,
          lap,
          lapDistPct: telemetry.LapDistPct?.value?.[0] as number,
          time,
          simTime: telemetry.LmuCurrentSectorTimes?.value?.[sector] ?? null,
        });
      }
      lastCurrent = current;

      const simLastLap = raw.vehLastLapTime[PLAYER];
      if (simLastLap > 0 && simLastLap !== lastSimLap) {
        crossings.push({
          sessionTime,
          simLastLap,
          simBestLap: raw.vehBestLapTime[PLAYER],
          lastLapTime: log.lastLapTime,
          bestLapTime: log.bestLapTime,
          simSector3: simLastLap - raw.vehLastSector2[PLAYER],
          sector3: timing.previousLapSectorTimes[2] ?? null,
          currentLap: [...current],
        });
      }
      lastSimLap = simLastLap;

      // The delta processor is declared at 25 Hz; the host would feed it so.
      if (sessionTime - lastDeltaTick < 0.04) return;
      lastDeltaTick = sessionTime;
      lapDelta.onFrame(telemetry);
      const { sessionBest } = lapDelta.snapshot();
      deltas.push({
        sessionTime,
        delta: sessionBest.delta,
        referenceLapTime: sessionBest.lapTime,
      });
    },
  });

  return {
    frames,
    lapTile,
    crossings,
    appearances,
    deltas,
    invalidFrames,
    final: {
      lap: sessionTiming.snapshot().currentLap,
      lapLog: lapLog.snapshot(),
      sectors: sectors.snapshot(),
      lapDelta: lapDelta.snapshot(),
    },
  };
};

describe.skipIf(!lmuTapeAvailable())(
  "the timing panel's channels on a recorded LMU race",
  () => {
    let race: Awaited<ReturnType<typeof playRace>>;
    beforeAll(async () => {
      race = await playRace();
    }, 90_000);

    it('reads the whole recording', () => {
      expect(race.frames).toBeGreaterThan(10_000);
      expect(race.deltas.at(-1)?.sessionTime).toBeGreaterThan(370);
    });

    it('counts the lap tile 1, 2, 3', () => {
      // The lap from the rolling start, the flying lap and the start of a
      // third, each the laps completed plus one.
      expect(race.lapTile.filter((lap) => lap > 0)).toEqual([1, 2, 3]);
      expect(race.final.lap).toBe(3);
    });

    it("shows the sim's own last and best lap from the frame it publishes them", () => {
      expect(race.crossings).toHaveLength(2);
      const [fromStart, flying] = race.crossings;

      // The sim times the opening lap from the green flag, not the line.
      expect(fromStart.simLastLap).toBeCloseTo(97.823, 3);
      expect(flying.simLastLap).toBeCloseTo(86.66, 3);
      for (const crossing of race.crossings) {
        expect(crossing.lastLapTime).toBe(crossing.simLastLap);
        expect(crossing.bestLapTime).toBe(crossing.simBestLap);
      }
      // The flying lap is the best of the two, and stays the last lap and
      // the best lap to the end of the recording.
      expect(flying.bestLapTime).toBe(flying.simLastLap);
      expect(race.final.lapLog.lastLapTime).toBe(flying.simLastLap);
      expect(race.final.lapLog.bestLapTime).toBe(flying.simLastLap);
    });

    it('never marks a last lap as not counted, the sim having timed both', () => {
      expect(race.invalidFrames).toBe(0);
      expect(race.final.lapLog.lastLapInvalid).toBe(false);
    });

    it("fills S1 and S2 as the car passes the sim's sector ends", () => {
      // The lap from the start has no first sector: it began before the car
      // was seen entering it. Then S2 of that lap, S1 and S2 of the flying
      // lap, and S1 of the third.
      expect(
        race.appearances.map(({ lap, sector }) => `lap ${lap} S${sector + 1}`)
      ).toEqual(['lap 1 S2', 'lap 2 S1', 'lap 2 S2', 'lap 3 S1']);

      for (const appearance of race.appearances) {
        // The sim's own figure, to the last digit.
        expect(appearance.time).toBe(appearance.simTime);
        // Where the sector ends: 39.0 % and 79.2 % round the lap, read up
        // to a fifth of a second late, which is the scoring block's rate.
        const sectorEnd = appearance.sector === 0 ? 0.39 : 0.792;
        expect(appearance.lapDistPct).toBeGreaterThan(sectorEnd - 0.001);
        expect(appearance.lapDistPct).toBeLessThan(sectorEnd + 0.006);
      }
      const [, s1, s2, s1Again] = race.appearances;
      expect(s1.time).toBeCloseTo(32.739, 2);
      expect(s2.time).toBeCloseTo(35.07, 2);
      expect(s1Again.time).toBeCloseTo(32.461, 2);
    });

    it('gets S3 with the lap time, as the previous lap’s and never this lap’s', () => {
      for (const crossing of race.crossings) {
        expect(crossing.sector3).not.toBeNull();
        expect(
          Math.abs((crossing.sector3 as number) - crossing.simSector3)
        ).toBeLessThan(0.002);
        // The line clears this lap's list in the same step, which is why
        // the panel holds the finished lap on its tiles for five seconds.
        expect(crossing.currentLap).toEqual([null, null, null]);
      }
      expect(race.crossings[1].sector3).toBeCloseTo(18.851, 2);
    });

    it('ends with a fresh S1 and the flying lap’s other two behind it', () => {
      const { sectors } = race.final;

      expect(sectors.currentSectorIdx).toBe(1);
      expect(sectors.inclusive.currentLapSectorTimes[0]).toBeCloseTo(32.461, 2);
      expect(sectors.inclusive.currentLapSectorTimes[1]).toBeNull();
      expect(sectors.inclusive.previousLapSectorTimes[1]).toBeCloseTo(35.07, 2);
      expect(sectors.inclusive.previousLapSectorTimes[2]).toBeCloseTo(
        18.851,
        2
      );
      // The third lap's first sector is the best of the session.
      expect(sectors.inclusive.sessionBestSectorTimes[0]).toBe(
        sectors.inclusive.currentLapSectorTimes[0]
      );
      // Nothing left the track or was voided.
      expect(sectors.clean).toEqual(sectors.inclusive);
    });

    it('reads dashes for the delta until a session best exists, a figure after', () => {
      // The opening lap was not driven from the line, so the first
      // reference is the flying lap, which ends 319.5 s in.
      const first = race.deltas.find((sample) => sample.delta !== null);
      expect(first?.sessionTime).toBeGreaterThan(319);
      expect(first?.sessionTime).toBeLessThan(320);
      for (const sample of race.deltas) {
        if (sample.sessionTime >= (first?.sessionTime ?? 0)) break;
        expect(sample.referenceLapTime).toBeNull();
      }

      // From there the third lap has a delta in every sample, against the
      // flying lap as this app times it: the sim's 86.660 s to a hundredth.
      const after = race.deltas.filter(
        (sample) => sample.sessionTime > (first?.sessionTime ?? 0) + 1
      );
      expect(after.length).toBeGreaterThan(1000);
      expect(after.every((sample) => sample.delta !== null)).toBe(true);
      expect(race.final.lapDelta.sessionBest.lapTime).toBeCloseTo(86.671, 2);
      // No lap library behind this run, so no all-time reference.
      expect(race.final.lapDelta.allTime.lapTime).toBeNull();
    });
  }
);
