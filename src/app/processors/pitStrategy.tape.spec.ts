import { describe, expect, it } from 'vitest';
import type {
  FuelProjectionSnapshot,
  PitStopSnapshot,
  Session,
} from '@irdashies/types';
import { FuelProjectionProcessor } from './FuelProjectionProcessor';
import { LapTimesProcessor } from './LapTimesProcessor';
import {
  createMemoryPitLaneModelStore,
  PitStopEstimateProcessor,
} from './PitStopEstimateProcessor';
import { ReferenceLapProcessor } from './ReferenceLapProcessor';
import { createLmuRestData, type LmuRestCells } from '../lmu/rest/state';
import { LMU_REST_TASKS } from '../lmu/rest/tasks';
import {
  computeSaverTable,
  pitLossS,
  plannedStandingS,
  projectRejoin,
  saverPerLap,
  timeInPitsS,
} from '@irdashies/shared';
import {
  LMU_CURATED_TAPE_PATH,
  lmuTapeAvailable,
  playLmuTape,
} from '../../testing/lmuTape';

/**
 * The two strategy widgets end to end on the recorded Le Mans Ultimate
 * race: the frames through the real mapping and the real processors, and
 * what the processors publish through the arithmetic the two widgets draw
 * (`src/shared/pitStop/`, `src/shared/fuel/saverTable.ts`). Here, with the
 * other tape specs, because the replay addon needs a process of its own.
 *
 * What is recorded: the field and its race gaps, the sim's estimate of the
 * stop, the player's energy and what a lap cost it.
 *
 * What is NOT: a pit lane. Nobody pits in the four minutes, so the lane the
 * rejoin is worked out with is an assumption -- lines at 95 % and 3 % of the
 * lap, driven at the 60 km/h Le Mans Ultimate is taken to run -- and the
 * position it gives is the arithmetic applied to the recorded field, not a
 * prediction that was ever put to the test by a stop.
 *
 * Windows only, like the other tape specs.
 */

const PLAYER = 0;
const TICK_SECONDS = 0.2;
const EXTRA_TIME_S = 2;
/** The fourteen LMGT3s: the player's slot and slots 15 to 27. */
const isPlayersClass = (carIdx: number): boolean =>
  carIdx === PLAYER || (carIdx >= 15 && carIdx <= 27);

/** An assumed lane for Laguna Seca: not measured. */
const ASSUMED_LINES = { pitEntryPct: 0.95, pitExitPct: 0.03 };

const REST_TASKS = LMU_REST_TASKS.filter(
  (task) =>
    task.path === '/rest/garage/UIScreen/RepairAndRefuel' ||
    task.path === '/rest/strategy/pitstop-estimate'
);

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

interface End {
  at: number;
  pitStop: PitStopSnapshot;
  fuel: FuelProjectionSnapshot;
  /** Race time behind the leader per car, on the last tick. */
  gaps: number[];
  onPitRoad: boolean[];
  classPositions: number[];
  positions: number[];
  /** Laps the player had completed. */
  lapsCompleted: number;
}

/** Plays the recording once and keeps what stood at its end. */
const playToTheEnd = async (): Promise<End> => {
  const fuel = new FuelProjectionProcessor();
  const lapTimes = new LapTimesProcessor();
  const references = new ReferenceLapProcessor({
    load: () => null,
    save: () => undefined,
  });
  let processor: PitStopEstimateProcessor | null = null;
  const others = [fuel, lapTimes, references];
  for (const each of others) each.onLifecycle({ type: 'enter', replay: false });

  const restCells = createTapeRestCells();
  const held: { end: End | null } = { end: null };
  let lastTick = Number.NEGATIVE_INFINITY;
  await playLmuTape({
    tapePath: LMU_CURATED_TAPE_PATH,
    speed: 20,
    restCells: (_raw, readRest) => restCells(readRest),
    onFrame: ({ telemetry, session, sessionChanged, sessionTime }) => {
      if (sessionChanged) {
        for (const each of others) each.init(session as Session);
        // The track's id is only known once the session is: the assumed
        // lane goes in under it.
        processor ??= (() => {
          const made = new PitStopEstimateProcessor({
            store: createMemoryPitLaneModelStore({
              [String(session.WeekendInfo?.TrackID)]: ASSUMED_LINES,
            }),
            fuel: () => fuel.snapshot(),
            lapTimes: () => lapTimes.snapshot(),
            referenceLaps: () => references.snapshot(),
          });
          made.onLifecycle({ type: 'enter', replay: false });
          return made;
        })();
        processor.init(session as Session);
      }
      lapTimes.onFrame(telemetry);
      references.onFrame(telemetry);
      if (!processor || sessionTime - lastTick < TICK_SECONDS) return;
      lastTick = sessionTime;
      fuel.onFrame(telemetry);
      processor.onFrame(telemetry);
      held.end = {
        at: sessionTime,
        pitStop: processor.snapshot(),
        fuel: fuel.snapshot(),
        gaps: [...(telemetry.CarIdxF2Time?.value as number[])],
        onPitRoad: [...(telemetry.CarIdxOnPitRoad?.value as boolean[])],
        classPositions: [...(telemetry.CarIdxClassPosition?.value as number[])],
        positions: [...(telemetry.CarIdxPosition?.value as number[])],
        lapsCompleted: (telemetry.LapCompleted?.value?.[0] as number) ?? 0,
      };
    },
  });
  if (!held.end) throw new Error('The recording gave no frame');
  return held.end;
};

describe.skipIf(!lmuTapeAvailable())(
  'the pit stop and the fuel saver on a recorded LMU race',
  () => {
    it('works out where a stop would put the player in the recorded field', async () => {
      const end = await playToTheEnd();
      const { lane, estimate, rejoin } = end.pitStop;
      expect(end.at).toBeGreaterThan(375);

      // The stop as the sim estimates it at the end of the recording, down
      // the assumed lane at the assumed limit.
      const standing = plannedStandingS(estimate);
      expect(standing).toBe(4.3);
      expect(timeInPitsS(lane, standing, EXTRA_TIME_S)).toBeCloseTo(
        17.2 + 4.3 + EXTRA_TIME_S,
        6
      );
      const loss = pitLossS(lane, standing, EXTRA_TIME_S);
      expect(loss).not.toBeNull();
      if (loss === null) return;
      // 23.5 s in the pits less the 4 to 8 s that stretch takes on track.
      expect(loss).toBeGreaterThan(15);
      expect(loss).toBeLessThan(20);

      // Counted again from the frame the snapshot was made of: a car behind
      // the player on the race clock by less than the loss gets past.
      const getsPast = (carIdx: number): boolean => {
        if (carIdx === PLAYER || end.onPitRoad[carIdx]) return false;
        if (!(end.positions[carIdx] > 0)) return false;
        const gap = Math.round((end.gaps[carIdx] - end.gaps[PLAYER]) * 10) / 10;
        const behind =
          gap > 0 ||
          (gap === 0 && end.positions[carIdx] > end.positions[PLAYER]);
        return behind && gap < loss;
      };
      const cars = end.gaps.map((_, carIdx) => carIdx);

      // In class: every LMGT3 that close.
      const passedInClass = cars.filter(
        (carIdx) => isPlayersClass(carIdx) && getsPast(carIdx)
      ).length;
      const inClass = projectRejoin(rejoin, loss, 'class');
      expect(inClass?.positionNow).toBe(end.classPositions[PLAYER]);
      expect(inClass?.positionAfter).toBe(
        end.classPositions[PLAYER] + passedInClass
      );
      expect(inClass?.inPits).toBe(0);
      // Fourteen cars in the class: there is a car to rejoin behind.
      expect(inClass?.ahead).not.toBeNull();
      expect(inClass?.positionAfter).toBeLessThanOrEqual(14);

      // Over the whole field, where the gaps across classes are rougher.
      const passedOverall = cars.filter(getsPast).length;
      const overall = projectRejoin(rejoin, loss, 'overall');
      expect(overall?.positionNow).toBe(end.positions[PLAYER]);
      expect(overall?.positionAfter).toBe(
        end.positions[PLAYER] + passedOverall
      );
      expect(passedOverall).toBeGreaterThanOrEqual(passedInClass);

      // What that comes to on the recording. The player is second of the
      // fourteen LMGT3s four minutes into the race, with the other twelve
      // inside eleven seconds behind: a stop that costs 17.4 s, most of it
      // the assumed lane, puts the car last in class and last overall, 6 to
      // 7 s behind the car that was at the back.
      expect(loss).toBeCloseTo(17.4, 0);
      expect(inClass).toMatchObject({
        positionNow: 2,
        positionAfter: 14,
        behind: null,
        inPits: 0,
        closeCall: false,
      });
      expect(inClass?.ahead?.carIdx).toBe(21);
      expect(inClass?.ahead?.gapS).toBeGreaterThan(5.5);
      expect(inClass?.ahead?.gapS).toBeLessThan(7.5);
      expect(overall).toMatchObject({ positionNow: 26, positionAfter: 38 });

      // The cars either side after the stop are the ones the gaps say.
      if (inClass?.ahead && passedInClass > 0) {
        const gap = end.gaps[inClass.ahead.carIdx] - end.gaps[PLAYER];
        expect(inClass.ahead.gapS).toBeCloseTo(loss - gap, 0);
        expect(isPlayersClass(inClass.ahead.carIdx)).toBe(true);
      }
      if (inClass?.behind) {
        const gap = end.gaps[inClass.behind.carIdx] - end.gaps[PLAYER];
        expect(inClass.behind.gapS).toBeCloseTo(gap - loss, 0);
        expect(isPlayersClass(inClass.behind.carIdx)).toBe(true);
      }
    }, 120_000);

    it('gives the saver table of the recorded car at the end of the recording', async () => {
      const end = await playToTheEnd();
      const { fuel } = end;

      // An LMGT3, on virtual energy: 38.7 % left, 2.33 % on the last lap
      // and about 1.7 % into this one.
      expect(fuel.budget).toBe('virtualEnergy');
      expect(fuel.fuelLevel).toBeCloseTo(38.7, 0);
      expect(fuel.lastLapUsage).toBeCloseTo(2.33, 1);
      expect(fuel.currentLapUsage).toBeGreaterThan(1.3);
      expect(fuel.currentLapUsage).toBeLessThan(2.1);
      expect(end.lapsCompleted).toBe(2);

      const perLap = saverPerLap(fuel, 'last', 5);
      const table = computeSaverTable({
        level: fuel.fuelLevel,
        usedThisLap: fuel.currentLapUsage,
        perLap,
        reserve: 0.2,
        pitEntryShare: 0,
        // The two laps of the recording, both in the stint the green flag
        // opened; the stint record itself has a tape spec of its own.
        stintLapsDone: end.lapsCompleted,
        fewerLaps: 0,
        moreLaps: 3,
        lapsLeftInRace: fuel.hasValidRaceEstimate
          ? fuel.estimatedLapsRemaining
          : null,
        capacity: fuel.fuelTankCapacity ?? null,
      });

      // 17 laps from the start of this one, against the pit menu's own
      // "45% 20 laps" for the level the car started with.
      expect(table.columns.map((column) => column.laps)).toEqual([
        17, 18, 19, 20,
      ]);
      expect(table.columns[0].isCurrent).toBe(true);
      // The caption of the centre column reads 2/19.
      expect(table.columns[0].stintLaps).toBe(19);
      [2.37, 2.23, 2.12, 2.01].forEach((target, index) =>
        expect(table.columns[index].target).toBeCloseTo(target, 1)
      );
      // The car is inside the target for the laps it has, and each lap
      // more asks for a little less.
      expect(table.columns[0].saving).toBeLessThan(0.05);
      expect(table.columns[1].saving).toBeGreaterThan(0);
      expect(table.columns[3].saving).toBeGreaterThan(table.columns[2].saving);
      // About eight laps to the finish and seventeen aboard: no stop to
      // drop.
      expect(table.stopTarget).toBeNull();
    }, 120_000);
  }
);
