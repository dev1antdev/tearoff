import { describe, expect, it } from 'vitest';
import type { PitStopSnapshot, Session, Telemetry } from '@irdashies/types';
import type { LmuRawTelemetry } from '../lmu/native';
import {
  LMU_CURATED_TAPE_PATH,
  lmuTapeAvailable,
  playLmuTape,
} from '../../testing/lmuTape';
import { createLmuRestData, type LmuRestCells } from '../lmu/rest/state';
import { LMU_REST_TASKS } from '../lmu/rest/tasks';
import { FuelProjectionProcessor } from './FuelProjectionProcessor';
import { LapTimesProcessor } from './LapTimesProcessor';
import {
  createMemoryPitLaneModelStore,
  PitStopEstimateProcessor,
  type PitLaneModelStore,
} from './PitStopEstimateProcessor';
import { ReferenceLapProcessor } from './ReferenceLapProcessor';

/**
 * The pit stop channel on the recorded Le Mans Ultimate race: four minutes
 * at Laguna Seca in a Ferrari 296 LMGT3, 38 cars, two laps of the player.
 *
 * Nobody stops on the recording. So what it confirms is what the channel
 * says of a car that stays out: the sim's estimate and its parts as they
 * move over the stint, the refuel level, and the cars the stop would be
 * measured against. Three things in here are NOT recorded and are marked
 * where they are used:
 *
 * - the pit lane. No car crosses either line, so there is nothing to learn
 *   one from; the cases that need a lane are given one, with lines at 95 %
 *   and 3 % of the lap that are an assumption about Laguna Seca and not a
 *   measurement of it;
 * - the stop. The last case stages one by rewriting two of the player's
 *   fields before they are mapped: in the pits for fifty seconds, at no
 *   speed for twenty-eight of them. The car is out on the circuit the whole
 *   time. It shows the timer and the storage working through the real
 *   mapping, and nothing about what the sim does at a stop: what its
 *   estimate reads in the lane, whether shared memory freezes, how long the
 *   lane really takes;
 * - anything a stop is made of besides fuel and energy.
 *
 * The REST cells are made the way the app makes them: each answer the
 * recording holds goes through the tasks' own parsers as the replay reaches
 * it, without the poller's timers.
 *
 * Windows only, like the other tape specs.
 */

const CARS = 38;
const PLAYER = 0;
/** The processor's own rate, as the host would run it. */
const TICK_SECONDS = 0.2;

const REPAIR_SCREEN = '/rest/garage/UIScreen/RepairAndRefuel';
const ESTIMATE = '/rest/strategy/pitstop-estimate';
const REST_TASKS = LMU_REST_TASKS.filter(
  (task) => task.path === REPAIR_SCREEN || task.path === ESTIMATE
);

/** An assumed lane for Laguna Seca: not measured, see above. */
const ASSUMED_LINES = { pitEntryPct: 0.95, pitExitPct: 0.03 };

type Stage = <T extends LmuRawTelemetry>(raw: T) => T;

/** The cells the poller would hold on each frame. */
const createTapeRestCells = () => {
  const data = createLmuRestData();
  const lastBody = new Map<string, string>();
  return (readRest: (path: string) => string | null): LmuRestCells => {
    for (const task of REST_TASKS) {
      const body = readRest(task.path);
      if (body === null || body === lastBody.get(task.path)) continue;
      lastBody.set(task.path, body);
      const payload: unknown = JSON.parse(body);
      for (const output of task.outputs) {
        if (output.target !== 'telemetry') continue;
        const value = output.parse(payload);
        if (value !== undefined) output.apply(data, value);
      }
    }
    return data.cells;
  };
};

interface Tick {
  at: number;
  snapshot: PitStopSnapshot;
  /** Race time behind the leader per car, as the frame had it. */
  gaps: number[];
  positions: number[];
  classPositions: number[];
  playerPct: number;
}

interface Played {
  frames: number;
  ticks: Tick[];
  trackId: string;
  carKey: string;
}

const numbers = (frame: Telemetry, key: keyof Telemetry): number[] => [
  ...((frame[key]?.value as number[] | undefined) ?? []),
];

const play = async (
  store: PitLaneModelStore,
  stage?: Stage
): Promise<Played> => {
  const fuel = new FuelProjectionProcessor();
  const lapTimes = new LapTimesProcessor();
  const references = new ReferenceLapProcessor({
    load: () => null,
    save: () => undefined,
  });
  const processor = new PitStopEstimateProcessor({
    store,
    fuel: () => fuel.snapshot(),
    lapTimes: () => lapTimes.snapshot(),
    referenceLaps: () => references.snapshot(),
  });
  const all = [fuel, lapTimes, references, processor];
  for (const each of all) each.onLifecycle({ type: 'enter', replay: false });

  const restCells = createTapeRestCells();
  const played: Played = { frames: 0, ticks: [], trackId: '', carKey: '' };
  let lastTick = Number.NEGATIVE_INFINITY;
  await playLmuTape({
    tapePath: LMU_CURATED_TAPE_PATH,
    speed: 20,
    transformRaw: stage,
    restCells: (_raw, readRest) => restCells(readRest),
    onFrame: ({ telemetry, session, sessionChanged, sessionTime }) => {
      played.frames += 1;
      if (sessionChanged) {
        for (const each of all) each.init(session as Session);
        played.trackId = String(session.WeekendInfo?.TrackID ?? '');
        const own = session.DriverInfo?.Drivers?.find(
          (driver) => driver.CarIdx === session.DriverInfo?.DriverCarIdx
        );
        played.carKey = own?.CarModel ?? own?.CarPath ?? '';
      }
      // The two event processors see every frame, as under the host.
      lapTimes.onFrame(telemetry);
      references.onFrame(telemetry);
      if (sessionTime - lastTick < TICK_SECONDS) return;
      lastTick = sessionTime;
      fuel.onFrame(telemetry);
      processor.onFrame(telemetry);
      played.ticks.push({
        at: sessionTime,
        snapshot: structuredClone(processor.snapshot()),
        gaps: numbers(telemetry, 'CarIdxF2Time'),
        positions: numbers(telemetry, 'CarIdxPosition'),
        classPositions: numbers(telemetry, 'CarIdxClassPosition'),
        playerPct: (telemetry.LapDistPct?.value?.[0] as number) ?? -1,
      });
    },
  });
  return played;
};

const last = <T>(values: readonly T[]): T => values[values.length - 1];

describe.skipIf(!lmuTapeAvailable())(
  'the pit stop channel on a recorded LMU race',
  () => {
    it("carries the sim's estimate of a stop nobody makes", async () => {
      const { frames, ticks } = await play(createMemoryPitLaneModelStore());

      expect(frames).toBeGreaterThan(14_000);
      expect(ticks.length).toBeGreaterThan(1_000);
      const estimated = ticks.filter(
        ({ snapshot }) => snapshot.estimate.standingS !== null
      );
      // The estimate is there from the first answers of the recording on.
      expect(estimated.length).toBeGreaterThan(ticks.length - 5);

      for (const { at, snapshot } of estimated) {
        const { estimate } = snapshot;
        expect(estimate.source, `at ${at}`).toBe('sim');
        expect(estimate.penalty, `at ${at}`).toBeNull();
        const parts = estimate.parts;
        expect(parts, `at ${at}`).not.toBeNull();
        if (!parts) continue;
        // Fuel and energy go in side by side: the stop is as long as the
        // longer of the two, not their sum. Nothing else is in it.
        expect(estimate.standingS, `at ${at}`).toBe(
          Math.max(parts.fuel, parts.energy)
        );
        expect(
          parts.tyres +
            parts.damage +
            parts.driverSwap +
            parts.brakes +
            parts.brakeDucts +
            parts.penalties,
          `at ${at}`
        ).toBe(0);
      }

      // A splash of fuel at the start, with the car at the level the menu
      // asks for; four minutes on both go in, fuel the longer.
      expect(estimated[0].snapshot.estimate).toMatchObject({
        standingS: 2.4,
        parts: { fuel: 2.4, energy: 0 },
      });
      expect(last(estimated).snapshot.estimate).toMatchObject({
        standingS: 4.3,
        parts: { fuel: 4.3, energy: 2.5 },
      });
      // It only grows as the car burns what the menu will put back.
      for (let index = 1; index < estimated.length; index += 1) {
        expect(
          estimated[index].snapshot.estimate.standingS ?? 0
        ).toBeGreaterThanOrEqual(
          estimated[index - 1].snapshot.estimate.standingS ?? 0
        );
      }
    }, 120_000);

    it('stays in planning with no stop asked for, timed or made', async () => {
      const { ticks } = await play(createMemoryPitLaneModelStore());

      for (const { at, snapshot } of ticks) {
        expect(snapshot.phase, `at ${at}`).toBe('planning');
        expect(snapshot.requested, `at ${at}`).toBe(false);
        expect(snapshot.planned, `at ${at}`).toBeNull();
        expect(snapshot.last, `at ${at}`).toBeNull();
        expect(snapshot.timer, `at ${at}`).toEqual({
          enteredAt: null,
          stoppedAt: null,
          standingS: 0,
          exitedAt: null,
        });
      }

      // Nobody crosses a pit line in four minutes, so no lane is learned,
      // and without one there is no loss to give and no exit to pass.
      const { lane, rejoin } = last(ticks).snapshot;
      expect(lane.entryPct).toBeNull();
      expect(lane.exitPct).toBeNull();
      expect(lane.lengthM).toBeNull();
      expect(lane.driveAtLimitS).toBeNull();
      // The limit is the 60 km/h Le Mans Ultimate is taken to run.
      expect(lane.speedLimitMs).toBeCloseTo(16.67, 2);
      expect(lane.speedLimitSource).toBe('assumed');
      expect(rejoin?.driveToExitS).toBeNull();
      expect(rejoin?.passes).toEqual([]);
    }, 120_000);

    it('reads the refuel level off the pit menu', async () => {
      const { ticks } = await play(createMemoryPitLaneModelStore());
      const first = ticks.find(
        ({ snapshot }) => snapshot.refuel?.target != null
      );
      const final = last(ticks).snapshot.refuel;

      // A level of 45 %, with the car at 45.0 % as the recording starts.
      expect(first?.snapshot.refuel).toMatchObject({
        isVirtualEnergy: true,
        target: 45,
        toAdd: 0,
      });
      // 38.7 % aboard at the end, so the stop puts 6.3 % back.
      expect(final).toMatchObject({ isVirtualEnergy: true, target: 45 });
      expect(final?.aboard).toBeCloseTo(38.7, 0);
      expect(final?.toAdd).toBeCloseTo(45 - (final?.aboard ?? 0), 1);
      // The pit menu's own words for that level are "45% 20 laps".
      expect(final?.runLaps).toBeGreaterThan(18);
      expect(final?.runLaps).toBeLessThan(21);
      expect(final?.runMinutes).toBeGreaterThan(26);
      expect(final?.runMinutes).toBeLessThan(33);
      // A short race: about eight more laps at 2.3 % a lap, against 38.7 %
      // aboard. The car needs nothing to finish, and the figure says so by
      // being negative.
      expect(final?.toFinish).toBeLessThan(-10);
      expect(final?.toFinish).toBeGreaterThan(-30);
    }, 120_000);

    it('lists the cars a stop would be measured against, and the pit exit once given a lane', async () => {
      // The lane is an assumption, not a measurement: see the top of the
      // file.
      const { ticks, trackId } = await play(
        createMemoryPitLaneModelStore({}),
        undefined
      );
      expect(trackId).toMatch(/^[1-9]\d*$/);
      const withLane = await play(
        createMemoryPitLaneModelStore({ [trackId]: ASSUMED_LINES })
      );
      const tick = last(withLane.ticks);
      const { lane, rejoin } = tick.snapshot;

      // 8 % of the 3590.4 m lap, at the assumed 60 km/h.
      expect(lane).toMatchObject({
        entryPct: 0.95,
        exitPct: 0.03,
        lengthM: 287.2,
        speedLimitSource: 'assumed',
        driveAtLimitS: 17.2,
        driveMeasuredS: null,
      });
      // The same stretch on the racing line: 8 % of a lap of about 87 s is
      // 7 s, and the start-finish straight is quicker than the lap's mean.
      expect(lane.trackTimeS).toBeGreaterThan(4);
      expect(lane.trackTimeS).toBeLessThan(8);

      expect(rejoin).not.toBeNull();
      if (!rejoin) return;
      expect(rejoin.position).toBe(tick.positions[PLAYER]);
      expect(rejoin.classPosition).toBe(tick.classPositions[PLAYER]);

      // The ladder: by gap, each the difference of two race gaps, at most
      // two cars ahead and nobody further back than four minutes.
      const ladder = rejoin.ladder;
      expect(ladder.length).toBeGreaterThan(5);
      expect(ladder.length).toBeLessThanOrEqual(30);
      expect(
        ladder.filter((rival) => rival.gapS < 0).length
      ).toBeLessThanOrEqual(2);
      for (let index = 0; index < ladder.length; index += 1) {
        const rival = ladder[index];
        if (index > 0) {
          expect(rival.gapS).toBeGreaterThanOrEqual(ladder[index - 1].gapS);
        }
        expect(rival.gapS).toBeLessThanOrEqual(240);
        expect(rival.gapS, `car ${rival.carIdx}`).toBeCloseTo(
          tick.gaps[rival.carIdx] - tick.gaps[PLAYER],
          1
        );
        expect(rival.inPit).toBe(false);
      }
      // The player's own class is the fourteen LMGT3s in slots 0 and 15 to
      // 27: the rivals marked as of its class are among them.
      for (const rival of ladder) {
        expect(rival.sameClass, `car ${rival.carIdx}`).toBe(
          rival.carIdx >= 15 && rival.carIdx <= 27
        );
      }

      // Every other car is out on the circuit and will come past the exit.
      expect(rejoin.passes).toHaveLength(CARS - 1);
      for (let index = 0; index < rejoin.passes.length; index += 1) {
        const pass = rejoin.passes[index];
        expect(pass.carIdx).not.toBe(PLAYER);
        expect(pass.passAt).toBeGreaterThanOrEqual(tick.at);
        // Within a lap, at a pace no slower than a GT3's first lap.
        expect(pass.passAt).toBeLessThan(tick.at + 110);
        expect(pass.lapTimeS).toBeGreaterThan(70);
        expect(pass.lapTimeS).toBeLessThan(105);
        if (index > 0) {
          expect(pass.passAt).toBeGreaterThanOrEqual(
            rejoin.passes[index - 1].passAt
          );
        }
      }
      expect(new Set(rejoin.passes.map((pass) => pass.carIdx)).size).toBe(
        CARS - 1
      );

      // From where the player is to the exit line: the track to the entry
      // line, then the lane at the limit.
      expect(rejoin.driveToExitS).toBeGreaterThan(17.2);
      expect(rejoin.driveToExitS).toBeLessThan(17.2 + 100);
      // And none of this was there without the lane.
      expect(last(ticks).snapshot.rejoin?.passes).toEqual([]);
    }, 240_000);

    it('times a stop staged for the player, and files what it measured', async () => {
      // STAGED, not recorded: from 250 s to 300 s the player's car is
      // marked as in the pits, and from 262 s to 290 s its speed is zeroed.
      // It is on the racing line the whole time.
      const ENTERS_AT = 250;
      const STOPS_AT = 262;
      const GOES_AT = 290;
      const LEAVES_AT = 300;
      const stage: Stage = (raw) => {
        const clock =
          typeof raw.elapsedTime === 'number' && raw.elapsedTime >= 0
            ? raw.elapsedTime
            : raw.currentET;
        if (clock < ENTERS_AT || clock >= LEAVES_AT) return raw;
        return {
          ...raw,
          vehInPits: Uint8Array.from(raw.vehInPits, (value, carIdx) =>
            carIdx === PLAYER ? 1 : value
          ),
          ...(clock >= STOPS_AT && clock < GOES_AT ? { speed: 0 } : {}),
        };
      };

      const store = createMemoryPitLaneModelStore();
      const { ticks, trackId, carKey } = await play(store, stage);
      const at = (time: number): Tick =>
        ticks.find((tick) => tick.at >= time) ?? last(ticks);

      // Before it: the plan, and no timer.
      expect(at(ENTERS_AT - 2).snapshot).toMatchObject({
        phase: 'planning',
        planned: null,
        timer: { enteredAt: null },
      });
      const expected = at(ENTERS_AT - 1).snapshot.estimate.standingS;
      expect(expected).toBeGreaterThan(2.4);

      // Rolling down the "lane": the plan is frozen at the entry line.
      const rolling = at(ENTERS_AT + 5).snapshot;
      expect(rolling.phase).toBe('lane');
      expect(rolling.timer.enteredAt).toBeGreaterThanOrEqual(ENTERS_AT);
      expect(rolling.timer.enteredAt).toBeLessThan(ENTERS_AT + 0.5);
      expect(rolling.timer.stoppedAt).toBeNull();
      expect(rolling.planned?.standingS).toBe(expected);

      // At rest.
      const standing = at(STOPS_AT + 10).snapshot;
      expect(standing.phase).toBe('service');
      expect(standing.timer.stoppedAt).toBeGreaterThanOrEqual(STOPS_AT);
      expect(standing.timer.stoppedAt).toBeLessThan(STOPS_AT + 0.5);
      expect(standing.timer.standingS).toBe(0);
      // The sim's figure has moved on; the plan has not.
      expect(standing.planned?.standingS).toBe(expected);

      // Away again, the standing stretch counted.
      const leaving = at(GOES_AT + 5).snapshot;
      expect(leaving.phase).toBe('lane');
      expect(leaving.timer.stoppedAt).toBeNull();
      expect(leaving.timer.standingS).toBeGreaterThan(27.5);
      expect(leaving.timer.standingS).toBeLessThan(28.5);

      // Over the exit line.
      const done = last(ticks).snapshot;
      expect(done.phase).toBe('planning');
      expect(done.planned).toBeNull();
      expect(done.timer.exitedAt).toBeGreaterThanOrEqual(LEAVES_AT);
      expect(done.timer.exitedAt).toBeLessThan(LEAVES_AT + 0.5);
      expect(done.last?.laneS).toBeGreaterThan(49.5);
      expect(done.last?.laneS).toBeLessThan(50.5);
      expect(done.last?.standingS).toBeGreaterThan(27.5);
      expect(done.last?.standingS).toBeLessThan(28.5);
      expect(done.last?.plannedStandingS).toBe(expected);
      // The player had one lap done when it "came in".
      expect(done.last?.lap).toBe(1);

      // What the visit measured is filed under the track and the car: one
      // drive time of the 22 s that were not spent at rest, one standing
      // time. Both are the staging's own figures.
      const record = store.get(trackId);
      expect(carKey).not.toBe('');
      expect(record?.timing?.driveS).toHaveLength(1);
      expect(record?.timing?.driveS[0]).toBeGreaterThan(21);
      expect(record?.timing?.driveS[0]).toBeLessThan(23);
      expect(record?.timing?.standingS[carKey]).toHaveLength(1);
      expect(record?.timing?.standingS[carKey][0]).toBeGreaterThan(27.5);
      expect(record?.timing?.standingS[carKey][0]).toBeLessThan(28.5);
      expect(done.lane.driveMeasuredS).toBe(
        Math.round((record?.timing?.driveS[0] ?? 0) * 10) / 10
      );

      // The two "lines" are where the staging put the edges: the player's
      // place on the lap as the flag went up and came down. They show the
      // learning working on mapped frames and are no pit lane's lines.
      expect(record?.pitEntryPct).toBeCloseTo(at(ENTERS_AT).playerPct, 2);
      expect(record?.pitExitPct).toBeCloseTo(at(LEAVES_AT).playerPct, 2);
      expect(done.lane.entryPct).toBe(record?.pitEntryPct);
      expect(done.lane.exitPct).toBe(record?.pitExitPct);
    }, 120_000);
  }
);
