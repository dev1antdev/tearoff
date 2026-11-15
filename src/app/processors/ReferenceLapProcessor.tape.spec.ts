import { beforeAll, describe, expect, it } from 'vitest';
import type { LapInput } from '@irdashies/types';
import {
  LMU_CURATED_TAPE_PATH,
  lmuTapeAvailable,
  playLmuTape,
} from '../../testing/lmuTape';
import { ReferenceLapProcessor } from './ReferenceLapProcessor';
import { PlayerLapRecorder } from './PlayerLapRecorder';

/**
 * The reference recorder on a recorded Le Mans Ultimate race, joined as the
 * field rolls up to the start: four minutes at Laguna Seca, 38 cars in three
 * classes, the player in car 0.
 *
 * Until a car first crosses the line LMU measures it at a negative distance,
 * which the addon clamps to a lap fraction of exactly 0. On the first frame
 * of this recording that is 22 of the 38 cars, between 6 m and 210 m short
 * of the line at 130 km/h and more; the player is 145 m short. None of them
 * is anywhere on the lap yet, and no lap of theirs has begun.
 *
 * Two stagings of the same recording, both of which the app can be in:
 *
 * - Bridge order. The bridge hands each frame to the processors before the
 *   session snapshot it arrived with, so the recorder ignores the very first
 *   frame, having no track length yet, and first sees each car on the
 *   second. By then the lap-distance estimate had moved every one of the 22
 *   off 0 by speed, into the first ten metres of the lap, and the recorder
 *   took that for a lap just begun.
 * - A recorder created as the player crosses the line, as when a widget that
 *   wants reference laps is opened at that moment. Its first sight of the
 *   car is a real position a few centimetres into the lap, but not a
 *   crossing it saw.
 *
 * Windows only, like the other tape specs: the replay addon is a gyp target
 * gated on OS=='win'.
 */
const PLAYER = 0;
/** How far the app's lap time may sit from the sim's for the same lap. */
const SAME_LAP_SECONDS = 0.03;

interface BestLapEvent {
  carIdx: number;
  lapTime: number;
  startTime: number;
  /** Session time of the frame the lap became the car's session best. */
  at: number;
}

const numbers = (value: unknown): number[] => value as number[];

/** A reference recorder, and every session best it has published. */
const watchRecorder = () => {
  const processor = new ReferenceLapProcessor({
    load: () => null,
    save: () => undefined,
  });
  processor.onLifecycle({ type: 'enter', replay: false });
  const events: BestLapEvent[] = [];
  const held = new Map<number, number>();
  let version = processor.snapshot().version;
  let mostClassLaps = 0;
  return {
    processor,
    events,
    mostClassLaps: () => mostClassLaps,
    /** Notes what the frame just processed changed. */
    note(at: number) {
      const snapshot = processor.snapshot();
      if (snapshot.version === version) return;
      version = snapshot.version;
      mostClassLaps = Math.max(mostClassLaps, snapshot.persistedLaps.length);
      for (const [carIdx, lap] of snapshot.bestLaps) {
        const lapTime = lap.finishTime - lap.startTime;
        if (held.get(carIdx) === lapTime) continue;
        held.set(carIdx, lapTime);
        events.push({ carIdx, lapTime, startTime: lap.startTime, at });
      }
    },
  };
};

const playRace = async () => {
  const bridgeOrder = watchRecorder();
  const atTheLine = watchRecorder();
  /** When that recorder was created, and where the player was; -1 before. */
  const atTheLineStart = { at: -1, playerPct: -1 };

  const libraryLaps: LapInput[] = [];
  let clock = Date.UTC(2026, 9, 7, 20, 0, 0);
  const library = new PlayerLapRecorder(
    { record: (_session, lap) => libraryLaps.push(lap) },
    { simulator: 'lmu', bootId: 'tape', now: () => (clock += 1000) }
  );
  library.onEnter();

  /** Cars scoring has yet to give a place on the lap. */
  const unplaced = new Set<number>();
  let unplacedAtStart = 0;
  let unplacedFrames = 0;
  let movedWhileUnplaced = 0;
  let slowestUnplaced = Number.POSITIVE_INFINITY;
  /** The laps the sim itself timed from line to line, per car. */
  const simLaps: number[][] = [];
  const lastSimLap: number[] = [];
  let classIds: number[] = [];
  let frames = 0;

  await playLmuTape({
    tapePath: LMU_CURATED_TAPE_PATH,
    // Fast enough to finish in seconds, slow enough that every recorded
    // frame is read.
    speed: 40,
    onFrame: ({ raw, telemetry, session, sessionChanged, sessionTime }) => {
      frames += 1;
      const published = numbers(telemetry.CarIdxLapDistPct?.value);
      if (frames === 1) {
        for (let carIdx = 0; carIdx < raw.vehLapDistPct.length; carIdx += 1) {
          if (raw.vehLapDistPct[carIdx] === 0) unplaced.add(carIdx);
        }
        unplacedAtStart = unplaced.size;
      }
      for (const carIdx of [...unplaced]) {
        if (raw.vehLapDistPct[carIdx] !== 0) {
          unplaced.delete(carIdx);
          continue;
        }
        unplacedFrames += 1;
        if (published[carIdx] !== 0) movedWhileUnplaced += 1;
        const speed =
          carIdx === PLAYER ? (raw.speed ?? 0) : (raw.vehSpeed?.[carIdx] ?? 0);
        slowestUnplaced = Math.min(slowestUnplaced, speed);
      }

      // The sim's first lap of a race runs from the green flag, not from
      // the line, so only its later ones are laps to compare with.
      for (let carIdx = 0; carIdx < raw.vehLastLapTime.length; carIdx += 1) {
        const last = raw.vehLastLapTime[carIdx];
        if (last <= 0 || last === lastSimLap[carIdx]) continue;
        lastSimLap[carIdx] = last;
        if (raw.vehTotalLaps[carIdx] >= 2) (simLaps[carIdx] ??= []).push(last);
      }

      // As the bridge does: the frame first, then the session it came with.
      bridgeOrder.processor.onFrame(telemetry);
      bridgeOrder.note(sessionTime);
      library.onFrame(telemetry);
      if (sessionChanged) {
        bridgeOrder.processor.init(session);
        library.onSession(session);
        classIds = [
          ...new Set(
            session.DriverInfo.Drivers.map((driver) => driver.CarClassID)
          ),
        ].sort((a, b) => a - b);
      }

      // Created on the frame scoring first places the player, with the
      // session in hand, as the processor host starts one on demand.
      const created = atTheLineStart.at >= 0;
      if (!created && raw.vehLapDistPct[PLAYER] > 0) {
        atTheLineStart.at = sessionTime;
        atTheLineStart.playerPct = published[PLAYER];
        atTheLine.processor.init(session);
      } else if (created && sessionChanged) {
        atTheLine.processor.init(session);
      }
      if (atTheLineStart.at >= 0) {
        atTheLine.processor.onFrame(telemetry);
        atTheLine.note(sessionTime);
      }
    },
  });

  return {
    frames,
    unplacedAtStart,
    unplacedFrames,
    movedWhileUnplaced,
    slowestUnplaced,
    simLaps,
    classIds,
    libraryLaps,
    bridgeOrder,
    atTheLine,
    atTheLineStart,
  };
};

/** The session bests that are not a lap the sim timed for the same car. */
const notSimLaps = (events: BestLapEvent[], simLaps: number[][]) =>
  events.filter(
    ({ carIdx, lapTime }) =>
      !(simLaps[carIdx] ?? []).some(
        (simLap) => Math.abs(simLap - lapTime) < SAME_LAP_SECONDS
      )
  );

describe.skipIf(!lmuTapeAvailable())(
  'reference laps on a recorded LMU rolling start',
  () => {
    let race: Awaited<ReturnType<typeof playRace>>;
    beforeAll(async () => {
      race = await playRace();
    }, 90_000);

    it('reads the whole recording', () => {
      expect(race.frames).toBeGreaterThan(10_000);
      // Every car completed two laps the sim timed from the line, or one.
      expect(race.simLaps.filter((laps) => laps?.length > 0)).toHaveLength(38);
    });

    it('leaves a car at 0 until scoring places it on the lap', () => {
      // 22 cars short of the line on the first frame, none slower than
      // 130 km/h, for three thousand car-frames between them.
      expect(race.unplacedAtStart).toBe(22);
      expect(race.unplacedFrames).toBeGreaterThan(2_500);
      expect(race.slowestUnplaced).toBeGreaterThan(36);

      expect(race.movedWhileUnplaced).toBe(0);
    });

    it('takes no lap that began before its car reached the line', () => {
      const { events } = race.bridgeOrder;

      // Every car set a session best, and every one of them is a lap the
      // sim timed too. Advanced off 0 by speed, 23 cars had an opening
      // "lap" here that started on the second frame of the recording:
      // 92.9 s for the player, of which three were the run to the line.
      expect(new Set(events.map((event) => event.carIdx)).size).toBe(38);
      expect(notSimLaps(events, race.simLaps)).toEqual([]);
      // The first car to finish a lap begun at a crossing does so 215 s in.
      expect(
        Math.min(...events.map((event) => event.startTime))
      ).toBeGreaterThan(210);
    });

    it("makes the player's first lap from line to line the session best", () => {
      const playerBests = race.bridgeOrder.events.filter(
        (event) => event.carIdx === PLAYER
      );

      // One reference, 319.5 s in: the lap the sim timed at 86.660 s. The
      // two clocks stop at lines a couple of metres apart.
      expect(playerBests).toHaveLength(1);
      expect(playerBests[0].at).toBeGreaterThan(319);
      expect(playerBests[0].at).toBeLessThan(320);
      expect(playerBests[0].lapTime).toBeCloseTo(86.671, 2);
      expect(race.simLaps[PLAYER]).toHaveLength(1);
      expect(race.simLaps[PLAYER][0]).toBeCloseTo(86.66, 2);

      // The lap library's recorder, fed in the same order, passed on that
      // lap and no other.
      expect(race.libraryLaps).toHaveLength(1);
      expect(race.libraryLaps[0].lapTime).toBeCloseTo(
        playerBests[0].lapTime,
        6
      );
    });

    it('does not time the opening lap from a first sight at the line', () => {
      // The recorder was created on the frame scoring first placed the
      // player: 143.0 s in, a few centimetres past the line. Timed from
      // there the opening lap came out at 89.8 s and stood as the session
      // best for the whole of the next lap.
      expect(race.atTheLineStart.at).toBeGreaterThan(142.9);
      expect(race.atTheLineStart.at).toBeLessThan(143.1);
      expect(race.atTheLineStart.playerPct).toBeGreaterThan(0);
      expect(race.atTheLineStart.playerPct).toBeLessThan(0.001);

      const { events } = race.atTheLine;
      const playerBests = events.filter((event) => event.carIdx === PLAYER);
      expect(playerBests).toHaveLength(1);
      expect(playerBests[0].at).toBeGreaterThan(319);
      expect(playerBests[0].lapTime).toBeCloseTo(86.671, 2);
      expect(notSimLaps(events, race.simLaps)).toEqual([]);
    });

    it('keeps no class reference for a sim that stores none', () => {
      // Three classes, numbered in the order the sim listed them. Kept from
      // the session anyway, classes 1 and 2 had another car's lap as their
      // "stored" reference by the end and class 0 had none.
      expect(race.classIds).toEqual([0, 1, 2]);
      expect(race.bridgeOrder.processor.snapshot().bestLaps).toHaveLength(38);

      expect(race.bridgeOrder.mostClassLaps()).toBe(0);
      expect(race.bridgeOrder.processor.snapshot().persistedLaps).toEqual([]);
    });
  }
);
