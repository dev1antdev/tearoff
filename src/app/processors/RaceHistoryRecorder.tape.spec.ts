import { describe, expect, it } from 'vitest';
import type {
  RaceDriverChange,
  RaceLap,
  RaceStint,
  Telemetry,
} from '@irdashies/types';
import {
  LEDGER_LAP_CAUTION,
  LEDGER_LAP_FROM_START,
  LEDGER_LAP_IN_LAP,
  LEDGER_LAP_OUT_LAP,
  LEDGER_LAP_VOIDED,
} from '@irdashies/types';
import type { LmuRawSession, LmuRawTelemetry } from '../lmu/native';
import {
  LMU_CURATED_TAPE_PATH,
  lmuTapeAvailable,
  playLmuTape,
} from '../../testing/lmuTape';
import {
  RaceHistoryRecorder,
  type RaceHistoryListener,
  type RaceStart,
} from './RaceHistoryRecorder';

/**
 * The race history on a recorded Le Mans Ultimate race: four minutes at
 * Laguna Seca, 38 cars in three classes, two laps for most of them and a
 * third for the fourteen LMP2s ahead.
 *
 * As it stands the recording can show that every lap of every car is kept,
 * with the sim's own time and sectors, and that nothing is invented: nobody
 * stops on it and nobody changes driver. The cases after the first one are
 * STAGED, each by rewriting a few of the sim's per-car fields for one car
 * before they are mapped. They are not recordings of a stop or of a driver
 * change. What LMU really writes through one -- when the name in a slot
 * changes against the stop, whether the pit state passes through every
 * value -- only a recording of a real one can say.
 *
 * Windows only, like the other tape specs.
 */

const CARS = 38;

type Stage = <T extends LmuRawTelemetry>(raw: T) => T;

interface Played {
  recorder: RaceHistoryRecorder;
  starts: RaceStart[];
  ended: number;
  /** Every lap handed on as settled, in the order it first was. */
  settled: RaceLap[];
  /** How many times each of them was. */
  settledTimes: Map<RaceLap, number>;
  changes: RaceDriverChange[];
  /** What the sim itself said each car's last lap took, each time it moved. */
  timed: number[][];
  /** The sim's two running sector totals when each of those times came. */
  sectorsAtTime: [number, number][][];
  lastFrame: Telemetry | null;
  frames: number;
}

const clockOf = (raw: LmuRawTelemetry): number =>
  typeof raw.elapsedTime === 'number' && raw.elapsedTime >= 0
    ? raw.elapsedTime
    : raw.currentET;

const play = async (stage?: Stage): Promise<Played> => {
  const out: Played = {
    recorder: undefined as unknown as RaceHistoryRecorder,
    starts: [],
    ended: 0,
    settled: [],
    settledTimes: new Map(),
    changes: [],
    timed: [],
    sectorsAtTime: [],
    lastFrame: null,
    frames: 0,
  };
  const listener: RaceHistoryListener = {
    onRaceStarted: (start) => out.starts.push(start),
    onLap: (lap, settled) => {
      if (!settled) return;
      if (!out.settled.includes(lap)) out.settled.push(lap);
      out.settledTimes.set(lap, (out.settledTimes.get(lap) ?? 0) + 1);
    },
    onStint: () => undefined,
    onDriverChange: (change) => {
      if (!out.changes.includes(change)) out.changes.push(change);
    },
    onRaceInfoChanged: () => undefined,
    onCarReplaced: () => undefined,
    onRaceEnded: () => {
      out.ended += 1;
    },
  };
  out.recorder = new RaceHistoryRecorder(listener, {
    simulator: () => 'lmu',
    sessionIdsAreUnique: () => false,
    now: () => 1_800_000_000_000,
    bootId: 'tape',
  });
  const last: number[] = [];
  await playLmuTape({
    tapePath: LMU_CURATED_TAPE_PATH,
    transformRaw: stage,
    onFrame: ({ raw, telemetry, session, sessionChanged }) => {
      out.frames += 1;
      for (let carIdx = 0; carIdx < raw.vehLastLapTime.length; carIdx += 1) {
        const time = raw.vehLastLapTime[carIdx];
        out.timed[carIdx] ??= [];
        out.sectorsAtTime[carIdx] ??= [];
        if (out.frames > 1 && time > 0 && time !== last[carIdx]) {
          out.timed[carIdx].push(time);
          out.sectorsAtTime[carIdx].push([
            raw.vehLastSector1[carIdx],
            raw.vehLastSector2[carIdx],
          ]);
        }
        last[carIdx] = time;
      }
      if (sessionChanged) out.recorder.onSession(session);
      out.recorder.onFrame(telemetry);
      out.lastFrame = telemetry;
    },
  });
  return out;
};

const lapsOf = (played: Played, carIdx: number): readonly RaceLap[] =>
  played.recorder.carLaps(carIdx);

const stintsOf = (played: Played, carIdx: number): readonly RaceStint[] =>
  played.recorder.carStints(carIdx);

/** One car's pit fields for a spell of the recording, as a stop writes them. */
const stagePitVisit =
  (
    car: number,
    at: { enters: number; stops?: number; goes?: number; leaves: number }
  ): Stage =>
  (raw) => {
    const clock = clockOf(raw);
    if (clock < at.enters) return raw;
    const inLane = clock < at.leaves;
    const stopped =
      at.stops !== undefined &&
      at.goes !== undefined &&
      clock >= at.stops &&
      clock < at.goes;
    const pitState = !inLane
      ? 0
      : stopped
        ? 3
        : at.goes !== undefined && clock >= at.goes
          ? 4
          : 2;
    return {
      ...raw,
      vehInPits: Uint8Array.from(raw.vehInPits, (value, carIdx) =>
        carIdx === car ? Number(inLane) : value
      ),
      vehPitState: Uint8Array.from(raw.vehPitState, (value, carIdx) =>
        carIdx === car ? pitState : value
      ),
    };
  };

/** Another name in one car's slot from a moment of the recording on. */
const stageDriver =
  (car: number, from: number, name: string): Stage =>
  (raw) => {
    if (clockOf(raw) < from || !('drivers' in raw)) return raw;
    const session = raw as unknown as LmuRawSession;
    return {
      ...raw,
      drivers: session.drivers.map((driver) =>
        driver.id === car ? { ...driver, name } : driver
      ),
    };
  };

const both =
  (first: Stage, second: Stage): Stage =>
  (raw) =>
    second(first(raw));

describe.skipIf(!lmuTapeAvailable())(
  'the race history on a recorded LMU race',
  () => {
    it('keeps every lap of every car, with the sim’s own time and sectors', async () => {
      const played = await play();
      const { recorder } = played;

      expect(played.frames).toBeGreaterThan(14_000);
      // One race from the first frame to the last, never restarted.
      expect(played.starts).toHaveLength(1);
      expect(played.ended).toBe(0);
      expect(played.starts[0].info).toMatchObject({
        id: null,
        simulator: 'lmu',
        sessionKey: '',
        sessionType: 'Race',
        trackName: expect.stringContaining('Laguna Seca'),
      });
      expect(played.starts[0].info.entries).toHaveLength(CARS);

      let laps = 0;
      for (let carIdx = 0; carIdx < CARS; carIdx += 1) {
        const held = lapsOf(played, carIdx);
        const timed = played.timed[carIdx];
        // Two laps for all 38, and a third for the fourteen prototypes
        // ahead, numbered from 1 without a hole.
        expect(
          held.map((lap) => lap.lap),
          `car ${carIdx}`
        ).toEqual(timed.map((_, index) => index + 1));
        // Each with the sim's own last lap time for that lap.
        expect(
          held.map((lap) => lap.lapTime),
          `car ${carIdx}`
        ).toEqual(timed);
        expect(recorder.missingLaps(carIdx)).toEqual([]);
        laps += held.length;

        held.forEach((lap, index) => {
          const [first, firstAndSecond] = played.sectorsAtTime[carIdx][index];
          // The three sectors, from the sim's two running totals, are the
          // lap: to what a float keeps of a subtraction.
          expect(lap.sectors).toHaveLength(3);
          const [s1, s2, s3] = lap.sectors as number[];
          expect(s1).toBe(first);
          expect(s2).toBeCloseTo(firstAndSecond - first, 9);
          expect(s1 + s2 + s3).toBeCloseTo(lap.lapTime as number, 9);
          // The line time is the car's own: laps are as far apart as the
          // sim says they took, to the frame the count moved on.
          if (index > 0) {
            expect(lap.sessionTime - held[index - 1].sessionTime).toBeCloseTo(
              lap.lapTime as number,
              0
            );
          }
          expect(lap.driver).not.toBe('');
          expect(lap.position).toBeGreaterThan(0);
          expect(lap.classPosition).toBeGreaterThan(0);
          // What it has left to run on: energy or fuel, never nothing.
          expect(lap.energy).toBeGreaterThan(0.2);
          expect(lap.energy).toBeLessThan(1);
          expect(lap.compounds).toHaveLength(4);
          // The first lap of a race begins on the grid; nobody pits, the
          // sim times every lap and there is no caution.
          expect(lap.flags & LEDGER_LAP_FROM_START).toBe(
            index === 0 ? LEDGER_LAP_FROM_START : 0
          );
          expect(
            lap.flags &
              (LEDGER_LAP_IN_LAP |
                LEDGER_LAP_OUT_LAP |
                LEDGER_LAP_VOIDED |
                LEDGER_LAP_CAUTION)
          ).toBe(0);
        });
      }
      expect(laps).toBe(90);
      // Every one of them was handed on to be stored, once, when it had its
      // time.
      expect(played.settled).toHaveLength(90);
      expect(played.settled.every((lap) => lap.lapTime !== null)).toBe(true);
      expect([...played.settledTimes.values()].every((n) => n === 1)).toBe(
        true
      );
    }, 120_000);

    it('measures each lap’s gap to the first car of its class at the line', async () => {
      const played = await play();
      const classOf = new Map(
        played.starts[0].info.entries.map((entry) => [
          entry.carIdx,
          entry.classId,
        ])
      );

      const byClassAndLap = new Map<string, RaceLap[]>();
      for (let carIdx = 0; carIdx < CARS; carIdx += 1) {
        for (const lap of lapsOf(played, carIdx)) {
          const key = `${classOf.get(carIdx)}:${lap.lap}`;
          byClassAndLap.set(key, [...(byClassAndLap.get(key) ?? []), lap]);
        }
      }
      expect(new Set(classOf.values()).size).toBe(3);
      expect(byClassAndLap.size).toBe(3 + 3 + 1);
      for (const [key, laps] of byClassAndLap) {
        const first = laps.reduce((a, b) =>
          a.sessionTime <= b.sessionTime ? a : b
        );
        // The recording begins before anyone has completed a lap, so every
        // class leader's crossing was seen and every gap is known.
        expect(first.classGap, key).toBe(0);
        expect(first.classPosition, key).toBe(1);
        for (const lap of laps) {
          expect(lap.classGap, key).toBeCloseTo(
            lap.sessionTime - first.sessionTime,
            9
          );
        }
        expect(laps.filter((lap) => lap.classGap === 0)).toHaveLength(1);
      }
    }, 120_000);

    it('has one stint for every car, as long as its race, and no driver change', async () => {
      const played = await play();
      const summary = played.recorder.summary();

      expect(played.changes).toEqual([]);
      expect(played.recorder.driverChanges()).toEqual([]);
      expect(summary.raceToken).toBe('tape:1');
      expect(summary.raceId).toBeNull();
      expect(summary.resumed).toBe(false);
      expect(summary.laps).toHaveLength(CARS);
      for (let carIdx = 0; carIdx < CARS; carIdx += 1) {
        const held = lapsOf(played, carIdx);
        const stints = stintsOf(played, carIdx);
        expect(stints, `car ${carIdx}`).toHaveLength(1);
        expect(stints[0]).toMatchObject({
          carIdx,
          ordinal: 1,
          openedBy: 'start',
          closedBy: null,
          firstLap: 1,
          lastLap: held.length,
          laps: held.length,
          // The lap from the grid is not a clean one.
          cleanLaps: held.length - 1,
          stop: null,
        });
        expect(stints[0].driver).toBe(held[0].driver);
        const clean = held.slice(1).map((lap) => lap.lapTime as number);
        expect(stints[0].bestLap).toBe(Math.min(...clean));
        expect(stints[0].avgLap).toBeCloseTo(
          clean.reduce((sum, time) => sum + time, 0) / clean.length,
          9
        );

        expect(summary.laps[carIdx]).toBe(held.length);
        expect(summary.lastLap[carIdx]).toBe(held.length);
        expect(summary.missingLaps[carIdx]).toBe(0);
        expect(summary.stintFirstLap[carIdx]).toBe(1);
        expect(summary.stintLaps[carIdx]).toBe(held.length);
        expect(summary.stintDriver[carIdx]).toBe(held[0].driver);
        // The pace of the one stint, as the stint itself has it.
        expect(summary.stintCleanLaps[carIdx]).toBe(held.length - 1);
        expect(summary.stintAvgLap[carIdx]).toBe(stints[0].avgLap);
        expect(summary.previousStintAvgLap[carIdx]).toBe(-1);
        expect(summary.previousStintDriver[carIdx]).toBe('');
        expect(summary.previousDriverStintAvgLap[carIdx]).toBe(-1);
        expect(summary.previousDriverStintDriver[carIdx]).toBe('');
        expect(summary.driverChanges[carIdx]).toBe(0);
        expect(summary.stops[carIdx]).toBe(0);
        expect(summary.revision[carIdx]).toBeGreaterThan(0);
      }
    }, 120_000);

    it('ends a stint at a stop staged for one car', async () => {
      // Staged, not recorded: car 20, an LMGT3 that never leaves the track,
      // is given the fields of a stop on its second lap.
      const CAR = 20;
      const played = await play(
        stagePitVisit(CAR, { enters: 250, stops: 260, goes: 290, leaves: 300 })
      );
      const held = lapsOf(played, CAR);
      const stints = stintsOf(played, CAR);

      expect(held.map((lap) => lap.lap)).toEqual([1, 2]);
      // It came in on its second lap and was still on it when it left.
      expect(held[0].flags & (LEDGER_LAP_IN_LAP | LEDGER_LAP_OUT_LAP)).toBe(0);
      expect(held[1].flags & (LEDGER_LAP_IN_LAP | LEDGER_LAP_OUT_LAP)).toBe(
        LEDGER_LAP_IN_LAP | LEDGER_LAP_OUT_LAP
      );

      expect(stints).toHaveLength(2);
      expect(stints[0]).toMatchObject({
        ordinal: 1,
        openedBy: 'start',
        closedBy: 'stop',
        firstLap: 1,
        lastLap: 1,
        laps: 1,
      });
      // It ended where the car left the track, not where it stood still.
      expect(stints[0].endTime).toBeGreaterThan(249.9);
      expect(stints[0].endTime).toBeLessThan(250.3);
      expect(stints[0].stop?.driverChanged).toBe(false);
      expect(stints[0].stop?.laneTime).toBeGreaterThan(49.5);
      expect(stints[0].stop?.laneTime).toBeLessThan(50.5);
      expect(stints[0].stop?.standingTime).toBeGreaterThan(29.5);
      expect(stints[0].stop?.standingTime).toBeLessThan(30.5);
      // The one after it is driven from the pit exit, by the same driver,
      // and the lap the stop was made on is its first.
      expect(stints[1]).toMatchObject({
        ordinal: 2,
        openedBy: 'stop',
        closedBy: null,
        driver: stints[0].driver,
        firstLap: 2,
        laps: 1,
        cleanLaps: 0,
      });
      expect(stints[1].startTime).toBeGreaterThan(299.9);
      expect(stints[1].startTime).toBeLessThan(300.3);

      const summary = played.recorder.summary();
      expect(summary.stops[CAR]).toBe(1);
      expect(summary.driverChanges[CAR]).toBe(0);
      expect(summary.stintFirstLap[CAR]).toBe(2);
      expect(summary.stintLaps[CAR]).toBe(1);
      expect(summary.previousStintDriver[CAR]).toBe(stints[0].driver);
      // The lap of the stop is no clean one, so the new stint has no pace
      // yet; and the stint before it was the same driver's, not another's.
      expect(summary.stintCleanLaps[CAR]).toBe(0);
      expect(summary.stintAvgLap[CAR]).toBe(-1);
      expect(summary.previousDriverStintDriver[CAR]).toBe('');
      expect(summary.previousDriverStintAvgLap[CAR]).toBe(-1);
      // Nobody else was touched.
      for (let carIdx = 0; carIdx < CARS; carIdx += 1) {
        if (carIdx === CAR) continue;
        expect(stintsOf(played, carIdx), `car ${carIdx}`).toHaveLength(1);
        expect(summary.stops[carIdx], `car ${carIdx}`).toBe(0);
      }
    }, 120_000);

    it('keeps a stint through a drive-through staged for one car', async () => {
      // Staged: the same car through the pit lane without standing still.
      const CAR = 20;
      const played = await play(
        stagePitVisit(CAR, { enters: 250, leaves: 275 })
      );
      const held = lapsOf(played, CAR);
      const stints = stintsOf(played, CAR);

      expect(stints).toHaveLength(1);
      expect(stints[0]).toMatchObject({
        closedBy: null,
        laps: 2,
        firstLap: 1,
        lastLap: 2,
        stop: null,
      });
      // The lap it was made on is a pit lap all the same, and not a clean
      // one: nothing of its pace is in the stint's.
      expect(held[1].flags & (LEDGER_LAP_IN_LAP | LEDGER_LAP_OUT_LAP)).toBe(
        LEDGER_LAP_IN_LAP | LEDGER_LAP_OUT_LAP
      );
      expect(stints[0].cleanLaps).toBe(0);
      expect(played.recorder.summary().stops[CAR]).toBe(0);
    }, 120_000);

    it('puts a driver change staged during a stop down to that stop', async () => {
      // Staged: another name in the slot while the car stands in its box.
      const CAR = 20;
      const played = await play(
        both(
          stagePitVisit(CAR, {
            enters: 250,
            stops: 260,
            goes: 290,
            leaves: 300,
          }),
          stageDriver(CAR, 270, 'A Team-Mate')
        )
      );
      const held = lapsOf(played, CAR);
      const stints = stintsOf(played, CAR);
      const first = held[0].driver;

      expect(first).not.toBe('A Team-Mate');
      expect(stints).toHaveLength(2);
      expect(stints[0]).toMatchObject({ driver: first, closedBy: 'stop' });
      expect(stints[0].stop?.driverChanged).toBe(true);
      expect(stints[1]).toMatchObject({
        driver: 'A Team-Mate',
        openedBy: 'stop',
        closedBy: null,
      });
      // The lap that ended after the change is the new driver's.
      expect(held.map((lap) => lap.driver)).toEqual([first, 'A Team-Mate']);

      const changes = played.recorder.driverChanges();
      expect(changes).toHaveLength(1);
      expect(changes[0]).toMatchObject({
        carIdx: CAR,
        seq: 1,
        lap: 1,
        from: first,
        to: 'A Team-Mate',
        atStop: true,
      });
      // Seen with the session that named them, read every half second.
      expect(changes[0].sessionTime).toBeGreaterThan(269.9);
      expect(changes[0].sessionTime).toBeLessThan(271);
      expect(played.recorder.summary().driverChanges[CAR]).toBe(1);
      expect(played.recorder.summary().stops[CAR]).toBe(1);
    }, 120_000);

    it('puts a name that changes a while after a staged stop down to it too', async () => {
      // Staged: the session goes on naming the driver who got out for a
      // minute after the car has left the pits, and through the end of the
      // lap the stop was made on.
      const CAR = 20;
      const played = await play(
        both(
          stagePitVisit(CAR, {
            enters: 240,
            stops: 250,
            goes: 270,
            leaves: 280,
          }),
          stageDriver(CAR, 340, 'A Team-Mate')
        )
      );
      const held = lapsOf(played, CAR);
      const stints = stintsOf(played, CAR);
      const first = held[0].driver;

      expect(stints).toHaveLength(2);
      expect(stints[0]).toMatchObject({ driver: first, closedBy: 'stop' });
      expect(stints[0].stop?.driverChanged).toBe(true);
      expect(stints[1]).toMatchObject({
        driver: 'A Team-Mate',
        closedBy: null,
        firstLap: 2,
        laps: 1,
      });
      expect(played.recorder.driverChanges()).toMatchObject([
        { carIdx: CAR, lap: 2, from: first, to: 'A Team-Mate', atStop: true },
      ]);
      // The lap of the stint the stop began is theirs, though the session
      // was still naming the other driver when it ended. It was handed on
      // again once it was known whose it was.
      expect(held.map((lap) => lap.driver)).toEqual([first, 'A Team-Mate']);
      expect(played.settledTimes.get(held[0])).toBe(1);
      expect(played.settledTimes.get(held[1])).toBe(2);
    }, 120_000);

    it('ends a stint at a driver change staged with no stop', async () => {
      // Staged: another name in the slot of a car out on the circuit.
      const CAR = 20;
      const played = await play(stageDriver(CAR, 250, 'A Team-Mate'));
      const held = lapsOf(played, CAR);
      const stints = stintsOf(played, CAR);
      const first = held[0].driver;

      expect(stints).toHaveLength(2);
      expect(stints[0]).toMatchObject({
        driver: first,
        closedBy: 'driver',
        firstLap: 1,
        lastLap: 1,
        stop: null,
      });
      expect(stints[0].endTime).toBeGreaterThan(249.9);
      expect(stints[0].endTime).toBeLessThan(251);
      expect(stints[1]).toMatchObject({
        driver: 'A Team-Mate',
        openedBy: 'driver',
        closedBy: null,
        firstLap: 2,
      });
      expect(held.map((lap) => lap.driver)).toEqual([first, 'A Team-Mate']);
      expect(played.recorder.driverChanges()).toMatchObject([
        { carIdx: CAR, seq: 1, lap: 1, from: first, to: 'A Team-Mate' },
      ]);
      expect(played.recorder.driverChanges()[0].atStop).toBe(false);

      const summary = played.recorder.summary();
      expect(summary.stops[CAR]).toBe(0);
      expect(summary.driverChanges[CAR]).toBe(1);
      expect(summary.stintDriver[CAR]).toBe('A Team-Mate');
      expect(summary.previousStintDriver[CAR]).toBe(first);
      // The stint before is another driver's, so it is both of the stints
      // a pace can be held against. Its one lap began on the grid: no pace.
      expect(summary.previousDriverStintDriver[CAR]).toBe(first);
      expect(summary.previousDriverStintAvgLap[CAR]).toBe(-1);
      expect(summary.previousStintAvgLap[CAR]).toBe(-1);
    }, 120_000);
  }
);
