import { describe, expect, it } from 'vitest';
import type { CarSectorsSnapshot } from '@irdashies/types';
import {
  LMU_CURATED_TAPE_PATH,
  lmuTapeAvailable,
  playLmuTape,
} from '../../testing/lmuTape';
import { CarSectorsProcessor } from './CarSectorsProcessor';

/**
 * The sector channel on a recorded Le Mans Ultimate race: four minutes at
 * Laguna Seca, 38 cars in three classes, two laps for most of them and a
 * third for the quickest.
 *
 * The recording is all under green and nobody stops, so every sector on it
 * is a racing sector: what a sector reads through a pit stop, on a lap the
 * sim refuses to time, or for a car in its garage is not in here.
 *
 * Windows only, like the other tape specs.
 */

const CARS = 38;
const SECTORS = 3;
/** The processor's own rate, as the host would run it. */
const TICK_SECONDS = 0.5;

type Cells = Record<string, { value?: unknown[] } | undefined>;

const millis = (value: unknown): number | null =>
  typeof value === 'number' && value > 0
    ? Math.round(value * 1000) / 1000
    : null;

interface Played {
  frames: number;
  ticks: number;
  /** Ticks on which the published snapshot had moved. */
  publications: number;
  snapshot: CarSectorsSnapshot;
  /** The class the session gives each slot. */
  classOf: number[];
  /**
   * The quickest time of each sector that any frame of the recording held
   * for each car, in `last` or in `current`: worked out here from every
   * frame, not from the two a second the processor reads.
   */
  quickest: (number | null)[];
  /** The sim's bests as the mapping writes them, on the last frame. */
  simBest: (number | null)[];
  /** Finished laps checked against the sim's lap time, and the worst miss. */
  lapsChecked: number;
  worstLapError: number;
}

const play = async (): Promise<Played> => {
  const processor = new CarSectorsProcessor();
  processor.onLifecycle({ type: 'enter', replay: false });
  let frames = 0;
  let ticks = 0;
  let publications = 0;
  let version = processor.snapshot().version;
  let lastTick = Number.NEGATIVE_INFINITY;
  let classOf: number[] = [];
  const quickest: (number | null)[] = [];
  let simBest: (number | null)[] = [];
  /** The last lap time each car's sectors were checked against. */
  const checked: number[] = [];
  let lapsChecked = 0;
  let worstLapError = 0;

  await playLmuTape({
    tapePath: LMU_CURATED_TAPE_PATH,
    onFrame: ({ telemetry, session, sessionChanged, sessionTime }) => {
      frames += 1;
      if (sessionChanged) {
        processor.init(session);
        classOf = [];
        for (const driver of session.DriverInfo?.Drivers ?? []) {
          classOf[driver.CarIdx] = driver.CarClassID;
        }
      }
      const cells = telemetry as unknown as Cells;
      const last = cells.LmuCarIdxLastSectorTimes?.value ?? [];
      const current = cells.LmuCarIdxCurrentSectorTimes?.value ?? [];
      for (let index = 0; index < CARS * SECTORS; index += 1) {
        for (const time of [millis(last[index]), millis(current[index])]) {
          const held = quickest[index] ?? null;
          if (time !== null && (held === null || time < held)) {
            quickest[index] = time;
          } else {
            quickest[index] = held;
          }
        }
      }
      simBest = (cells.LmuCarIdxBestSectorTimes?.value ?? []).map(millis);

      if (sessionTime - lastTick < TICK_SECONDS) return;
      lastTick = sessionTime;
      ticks += 1;
      processor.onFrame(telemetry);
      const snapshot = processor.snapshot();
      if (snapshot.version !== version) {
        version = snapshot.version;
        publications += 1;
      }

      // What the widget reads beside these sectors is the car's last lap.
      const lapTimes = (cells.CarIdxLastLapTime?.value ?? []) as number[];
      for (let carIdx = 0; carIdx < CARS; carIdx += 1) {
        const lapTime = lapTimes[carIdx];
        if (!(lapTime > 0) || checked[carIdx] === lapTime) continue;
        const [s1, s2, s3] = snapshot.last.slice(
          carIdx * SECTORS,
          carIdx * SECTORS + SECTORS
        );
        // The three of a lap arrive together, with its time.
        expect(s1, `car ${carIdx} at ${sessionTime}`).not.toBeNull();
        expect(s2, `car ${carIdx} at ${sessionTime}`).not.toBeNull();
        expect(s3, `car ${carIdx} at ${sessionTime}`).not.toBeNull();
        checked[carIdx] = lapTime;
        lapsChecked += 1;
        worstLapError = Math.max(
          worstLapError,
          Math.abs((s1 ?? 0) + (s2 ?? 0) + (s3 ?? 0) - lapTime)
        );
      }
    },
  });

  return {
    frames,
    ticks,
    publications,
    snapshot: processor.snapshot(),
    classOf,
    quickest,
    simBest,
    lapsChecked,
    worstLapError,
  };
};

describe.skipIf(!lmuTapeAvailable())(
  'every car’s sectors on a recorded LMU race',
  () => {
    it('adds up to each car’s last lap time, to the rounding of three figures', async () => {
      const played = await play();

      expect(played.frames).toBeGreaterThan(14_000);
      expect(played.snapshot.available).toBe(true);
      // Every car finished two laps, and the quickest a third.
      expect(played.lapsChecked).toBeGreaterThanOrEqual(CARS * 2);
      // Three sector times each rounded to the millisecond.
      expect(played.worstLapError).toBeLessThan(0.002);
    }, 120_000);

    it('keeps the lap under way to its second sector, and never a third', async () => {
      const { snapshot } = await play();

      for (let carIdx = 0; carIdx < CARS; carIdx += 1) {
        expect(snapshot.current[carIdx * SECTORS + 2], `car ${carIdx}`).toBe(
          null
        );
      }
      // The recording ends with the field spread round its third lap: some
      // cars have a first sector of it and some have not.
      const firstSectors = Array.from(
        { length: CARS },
        (_, carIdx) => snapshot.current[carIdx * SECTORS]
      );
      expect(firstSectors.some((time) => time !== null)).toBe(true);
    }, 120_000);

    it('holds each car’s quickest sectors, none missed at two readings a second', async () => {
      const { snapshot, quickest, ticks, publications } = await play();

      for (let index = 0; index < CARS * SECTORS; index += 1) {
        const car = `car ${Math.trunc(index / SECTORS)} S${(index % SECTORS) + 1}`;
        expect(snapshot.best[index], car).not.toBeNull();
        // The quickest any frame of the recording held, read from all of
        // them: a time that came and went between two readings would show
        // here as a best the processor does not have.
        expect(snapshot.best[index], car).toBe(quickest[index]);
        // A best is never slower than the lap just driven.
        expect(snapshot.best[index] as number, car).toBeLessThanOrEqual(
          snapshot.last[index] as number
        );
      }
      // It publishes when a car ends a sector, which on a reading in two
      // or so is none.
      expect(ticks).toBeGreaterThan(400);
      expect(publications).toBeLessThan(ticks * 0.8);
    }, 120_000);

    it('agrees with the sim’s own best first sector, and not with what is made of its second', async () => {
      const { snapshot, simBest } = await play();

      let quickerSecond = 0;
      for (let carIdx = 0; carIdx < CARS; carIdx += 1) {
        const base = carIdx * SECTORS;
        // A sector best as the sim keeps it: the same figure.
        expect(snapshot.best[base], `car ${carIdx}`).toBe(simBest[base]);
        // The sim's best time to the end of the second sector, less its
        // best first, is no second sector: for these cars a quicker one
        // was driven.
        const second = snapshot.best[base + 1] as number;
        if (second < (simBest[base + 1] as number) - 0.0005) {
          quickerSecond += 1;
        }
      }
      expect(quickerSecond).toBeGreaterThan(0);
    }, 120_000);

    it('gives each of the three classes the quickest of its cars', async () => {
      const { snapshot, classOf } = await play();

      const classes = [...new Set(classOf.slice(0, CARS))];
      expect(classes).toHaveLength(3);
      expect([...snapshot.classIds].sort()).toEqual([...classes].sort());
      for (const classId of classes) {
        const slot = snapshot.classIds.indexOf(classId);
        for (let sector = 0; sector < SECTORS; sector += 1) {
          const times = classOf
            .slice(0, CARS)
            .flatMap((carClass, carIdx) =>
              carClass === classId
                ? [snapshot.best[carIdx * SECTORS + sector] as number]
                : []
            );
          expect(
            snapshot.classBest[slot * SECTORS + sector],
            `class ${classId} S${sector + 1}`
          ).toBe(Math.min(...times));
        }
      }
    }, 120_000);
  }
);
