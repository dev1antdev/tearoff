import { describe, expect, it } from 'vitest';
import type {
  CarPitSnapshot,
  FinishProjectionSnapshot,
  FuelProjectionSnapshot,
  PitStopSnapshot,
  Session,
  Telemetry,
} from '@irdashies/types';
import {
  carFinish,
  flagTime,
  projectFinish,
  type FinishProjectionOptions,
} from '@irdashies/shared';
import type { LmuGameState } from '../lmu/gameState';
import type { LmuRawTelemetry } from '../lmu/native';
import {
  LMU_CURATED_TAPE_PATH,
  lmuRawWithoutPlayerVehicle,
  lmuTapeAvailable,
  playLmuTape,
} from '../../testing/lmuTape';
import { createLmuRestData, type LmuRestCells } from '../lmu/rest/state';
import { LMU_REST_TASKS } from '../lmu/rest/tasks';
import { CarPitProcessor } from './CarPitProcessor';
import { FinishProjectionProcessor } from './FinishProjectionProcessor';
import { FuelProjectionProcessor } from './FuelProjectionProcessor';
import { LapTimesProcessor } from './LapTimesProcessor';
import {
  createMemoryPitLaneModelStore,
  PitStopEstimateProcessor,
} from './PitStopEstimateProcessor';
import { ReferenceLapProcessor } from './ReferenceLapProcessor';
import { StandingsProcessor } from './StandingsProcessor';

/**
 * The finish projection on the recorded Le Mans Ultimate race: four minutes
 * of a fifteen-minute timed race at Laguna Seca, 38 cars in three classes,
 * the player (slot 0) in one of fourteen LMGT3s on virtual energy. Every
 * frame goes through the real mapping and the real processors the channel
 * reads: the fuel projection, the lap times, the pit stop estimate, the
 * per-car pit tracker and the standings.
 *
 * What is recorded, and so confirmed here: how the race is counted and its
 * clock; that the rule of `src/shared/finishProjection/` lands on the lap
 * the fuel projection publishes; the refuelling rates, against the sim's
 * own estimate of the stop; every class rival's energy and what a lap costs
 * it; who the class neighbours are and the race gaps to them.
 *
 * What is NOT, and is marked where it is used:
 *
 * - a pit lane. Nobody crosses a pit line in the four minutes, so the cases
 *   that cost a stop are given a lane with lines at 95 % and 3 % of the
 *   lap, driven at the 60 km/h Le Mans Ultimate is taken to run. It is an
 *   assumption about Laguna Seca, not a measurement of it;
 * - a stop. No car stops, so no stint, no pit lane time and no standing
 *   time of a rival is ever observed: the `observed` basis, the last-stop
 *   column and a rival's own stop length rest on the unit spec alone;
 * - a race long enough to need a stop, a rival whose fuel is withheld, and
 *   a team-mate at the wheel. Each is STAGED by rewriting the sim's own
 *   fields before they are mapped, and each case says what it changed.
 *
 * The REST cells and the session's service rates are made the way the app
 * makes them: each answer the recording holds goes through the tasks' own
 * parsers as the replay reaches it, without the poller's timers.
 *
 * Windows only, like the other tape specs.
 */

const PLAYER = 0;
/** The LMP2 that leads the race throughout. */
const LEADER = 8;
/** The processors that feed it run five times a second, it once. */
const FAST_TICK_SECONDS = 0.2;
const SLOW_TICK_SECONDS = 1;
/** An assumed lane for Laguna Seca: not measured, see above. */
const ASSUMED_LINES = { pitEntryPct: 0.95, pitExitPct: 0.03 };
/** scoring's mControl for a person on another machine. */
const CONTROL_REMOTE = 2;

const REST_PATHS = [
  '/rest/garage/UIScreen/RepairAndRefuel',
  '/rest/strategy/pitstop-estimate',
];
const REST_TASKS = LMU_REST_TASKS.filter((task) =>
  REST_PATHS.includes(task.path)
);

/** The widget's own defaults. */
const DEFAULTS: FinishProjectionOptions = {
  scenarios: [30, 40, 50, 60],
  leaderStops: 'same',
  showPlanned: true,
  showToFinish: true,
  showLast: true,
  extraTimeS: 2,
  nearRangeS: 20,
  extraLaps: 1,
};

/** What the poller would hold on each frame: the cells, and the session's rates. */
const createTapeRest = () => {
  const data = createLmuRestData();
  const lastBody = new Map<string, string>();
  return {
    data,
    read: (readRest: (path: string) => string | null): LmuRestCells => {
      for (const task of REST_TASKS) {
        const body = readRest(task.path);
        if (body === null || body === lastBody.get(task.path)) continue;
        lastBody.set(task.path, body);
        const payload: unknown = JSON.parse(body);
        for (const output of task.outputs) {
          const value = output.parse(payload);
          if (value !== undefined) output.apply(data, value);
        }
      }
      return data.cells;
    },
  };
};

interface Tick {
  at: number;
  snapshot: FinishProjectionSnapshot;
  /** The snapshots it was made from, as they stood. */
  fuel: FuelProjectionSnapshot;
  pitStop: PitStopSnapshot;
  carPit: CarPitSnapshot;
  /** The frame's own class places and race gaps. */
  classPositions: number[];
  gaps: number[];
}

type Stage = <T extends LmuRawTelemetry>(raw: T, blockSlot: number) => T;

interface PlayOptions {
  /** Give the track the assumed pit lane. */
  lane?: boolean;
  stage?: Stage;
  gameState?: (raw: LmuRawTelemetry) => LmuGameState | undefined;
  /** The slot the sim's camera is on, where that is staged. */
  focus?: (raw: LmuRawTelemetry) => number | undefined;
}

interface Played {
  frames: number;
  /** One a second, and one more on the recording's last frame. */
  ticks: Tick[];
}

interface Frame {
  telemetry: Telemetry;
  sessionTime: number;
}

const play = async ({
  lane = false,
  stage,
  gameState,
  focus,
}: PlayOptions = {}): Promise<Played> => {
  const fuel = new FuelProjectionProcessor();
  const lapTimes = new LapTimesProcessor();
  const references = new ReferenceLapProcessor({
    load: () => null,
    save: () => undefined,
  });
  const carPit = new CarPitProcessor();
  const standings = new StandingsProcessor();
  let pitStop: PitStopEstimateProcessor | null = null;
  let finish: FinishProjectionProcessor | null = null;
  const early = [fuel, lapTimes, references, carPit, standings];
  for (const each of early) each.onLifecycle({ type: 'enter', replay: false });

  const rest = createTapeRest();
  let knownService: unknown;
  let hasSession = false;
  let lastFast = Number.NEGATIVE_INFINITY;
  let lastSlow = Number.NEGATIVE_INFINITY;
  let frames = 0;
  const ticks: Tick[] = [];
  let lastFrame: Frame | null = null;
  /** The processors the channel reads from, at their own rate. */
  const runFast = ({ telemetry, sessionTime }: Frame): void => {
    if (!pitStop) return;
    lastFast = sessionTime;
    fuel.onFrame(telemetry);
    carPit.onFrame(telemetry);
    standings.onFrame(telemetry);
    pitStop.onFrame(telemetry);
  };
  /** The channel itself, and what it stood on. */
  const runSlow = ({ telemetry, sessionTime }: Frame): void => {
    if (!pitStop || !finish) return;
    lastSlow = sessionTime;
    finish.onFrame(telemetry);
    ticks.push({
      at: sessionTime,
      snapshot: structuredClone(finish.snapshot()),
      fuel: structuredClone(fuel.snapshot()),
      pitStop: structuredClone(pitStop.snapshot()),
      carPit: structuredClone(carPit.snapshot()),
      classPositions: [...(telemetry.CarIdxClassPosition?.value as number[])],
      gaps: [...(telemetry.CarIdxF2Time?.value as number[])],
    });
  };
  await playLmuTape({
    tapePath: LMU_CURATED_TAPE_PATH,
    speed: 20,
    transformRaw: stage,
    gameState,
    restCells: (raw, readRest) => {
      const cells = rest.read(readRest);
      const slot = focus?.(raw);
      return slot === undefined
        ? cells
        : { ...cells, focusCarIdx: { value: [slot] } };
    },
    onFrame: ({ telemetry, session, sessionChanged, sessionTime }) => {
      frames += 1;
      // The bridge republishes the session when a REST answer lands on it,
      // which is how the service rates reach a processor.
      const service = rest.data.session.pitService;
      if (sessionChanged || service !== knownService || !hasSession) {
        knownService = service;
        hasSession = true;
        const withRest = { ...session, LmuRest: rest.data.session } as Session;
        for (const each of early) each.init(withRest);
        if (!pitStop) {
          // The track's id is only known once the session is: the assumed
          // lane goes in under it.
          pitStop = new PitStopEstimateProcessor({
            store: createMemoryPitLaneModelStore(
              lane
                ? { [String(session.WeekendInfo?.TrackID)]: ASSUMED_LINES }
                : {}
            ),
            fuel: () => fuel.snapshot(),
            lapTimes: () => lapTimes.snapshot(),
            referenceLaps: () => references.snapshot(),
          });
          pitStop.onLifecycle({ type: 'enter', replay: false });
        }
        const pit = pitStop;
        if (!finish) {
          finish = new FinishProjectionProcessor({
            fuel: () => fuel.snapshot(),
            lapTimes: () => lapTimes.snapshot(),
            pitStop: () => pit.snapshot(),
            carPit: () => carPit.snapshot(),
            standings: () => standings.snapshot(),
          });
          finish.onLifecycle({ type: 'enter', replay: false });
        }
        pitStop.init(withRest);
        finish.init(withRest);
      }
      // The two event processors see every frame, as under the host.
      lapTimes.onFrame(telemetry);
      references.onFrame(telemetry);
      lastFrame = { telemetry, sessionTime };
      if (sessionTime - lastFast >= FAST_TICK_SECONDS) runFast(lastFrame);
      if (sessionTime - lastSlow >= SLOW_TICK_SECONDS) runSlow(lastFrame);
    },
  });
  // The recording's last frame, whatever the phase of the ticks: what stood
  // as it ended is then the same on every run.
  const final = lastFrame as Frame | null;
  if (final && final.sessionTime - lastSlow >= FAST_TICK_SECONDS) {
    if (final.sessionTime > lastFast) runFast(final);
    runSlow(final);
  }
  return { frames, ticks };
};

/** The recording as it stands, with the assumed lane: played once. */
let recordedRun: Promise<Played> | undefined;
const recorded = (): Promise<Played> => (recordedRun ??= play({ lane: true }));

const last = <T>(values: readonly T[]): T => values[values.length - 1];

/** Two hours more on the race clock: the same cars in a long race. */
const TWO_HOURS = 7200;
const longRace: Stage = (raw) => ({
  ...raw,
  sessionTimeRemaining: raw.sessionTimeRemaining + TWO_HOURS,
  endET: raw.endET + TWO_HOURS,
});

const fraction = (value: number): number => value - Math.floor(value);

describe.skipIf(!lmuTapeAvailable())(
  'the finish projection on a recorded LMU race',
  () => {
    it('reads a timed race from the first frame, and counts its clock down', async () => {
      const { frames, ticks } = await recorded();

      // The whole recording, once a second.
      expect(frames).toBeGreaterThan(14_000);
      expect(ticks.length).toBeGreaterThan(230);

      // Under green from the first frame to the last.
      for (const { at, snapshot } of ticks) {
        expect(snapshot, `at ${at}`).toMatchObject({
          valid: true,
          reason: null,
          raceType: 'time',
          lapLimit: null,
        });
        expect(snapshot.leader?.carIdx, `at ${at}`).toBe(LEADER);
        expect(snapshot.player?.carIdx, `at ${at}`).toBe(PLAYER);
        expect(snapshot.leader?.lastStopLossS, `at ${at}`).toBe(0);
        expect(snapshot.player?.lastStopLossS, `at ${at}`).toBe(0);
      }

      // 895 s left as the recording starts and 655 s as it ends, 240 s on.
      expect(ticks[0].snapshot.timeLeftS).toBeGreaterThan(894.5);
      expect(ticks[0].snapshot.timeLeftS).toBeLessThan(895.6);
      expect(last(ticks).snapshot.timeLeftS).toBeGreaterThan(654.8);
      expect(last(ticks).snapshot.timeLeftS).toBeLessThan(656);
      for (let index = 1; index < ticks.length; index += 1) {
        expect(ticks[index].snapshot.timeLeftS ?? 0).toBeLessThan(
          ticks[index - 1].snapshot.timeLeftS ?? 0
        );
      }

      // Both paces are the sim's one estimate for the whole grid until each
      // class's leader has a lap at speed behind it: 76.6 s for the LMP2s,
      // 86.9 s for the LMGT3s.
      expect(ticks[0].snapshot.leader?.paceS).toBeCloseTo(84.233, 2);
      expect(ticks[0].snapshot.player?.paceS).toBeCloseTo(84.233, 2);
      const end = last(ticks).snapshot;
      expect(end.leader?.paceS).toBeCloseTo(76.56, 1);
      expect(end.player?.paceS).toBeCloseTo(86.92, 1);
      // A little over three laps for the leader, 2.7 for the player.
      expect(end.leader?.progress).toBeGreaterThan(3.1);
      expect(end.leader?.progress).toBeLessThan(3.2);
      expect(end.player?.progress).toBeGreaterThan(2.68);
      expect(end.player?.progress).toBeLessThan(2.74);
    }, 120_000);

    it('lands on the lap the fuel projection publishes, at every tick', async () => {
      const { ticks } = await recorded();

      let agreed = 0;
      const held: number[] = [];
      for (const { at, snapshot, fuel } of ticks) {
        const { leader, player } = snapshot;
        if (!leader || !player) throw new Error(`no cars at ${at}`);
        const end = { timeLeftS: snapshot.timeLeftS, lapLimit: null };
        const flag = flagTime(leader, end);
        const finish = flag && carFinish(player, flag.tFlagS, 0, null);
        if (!flag || !finish) throw new Error(`no finish at ${at}`);

        // The published laps to go are the fuel projection's own.
        expect(fuel.hasValidRaceEstimate, `at ${at}`).toBe(true);
        expect(snapshot.lapsToGo, `at ${at}`).toBeCloseTo(
          fuel.estimatedLapsRemaining,
          1
        );
        if (finish.finishLap === fuel.calculatedTotalRaceLaps) {
          agreed += 1;
          continue;
        }
        // Where the two differ the fuel projection is holding a lap the
        // sums have just given up: one lap more, with the leader or the
        // player inside its hold band short of a line.
        held.push(at);
        expect(
          fuel.calculatedTotalRaceLaps - finish.finishLap,
          `at ${at}`
        ).toBe(1);
        const leaderAtClock =
          leader.progress + (snapshot.timeLeftS ?? 0) / leader.paceS;
        const playerAtFlag = player.progress + flag.tFlagS / player.paceS;
        expect(
          Math.max(fraction(leaderAtClock), fraction(playerAtFlag)),
          `at ${at}`
        ).toBeGreaterThan(0.74);
      }

      // On this recording that never happens: eleven laps throughout, by
      // both.
      expect(agreed).toBeGreaterThan(ticks.length - 12);
      expect(held.length).toBeLessThan(12);
      expect(last(ticks).fuel.calculatedTotalRaceLaps).toBe(11);
      // Eleven laps to go from the start line, 8.3 with 2.7 done.
      expect(ticks[0].snapshot.lapsToGo).toBe(11);
      expect(last(ticks).snapshot.lapsToGo).toBeGreaterThan(8.2);
      expect(last(ticks).snapshot.lapsToGo).toBeLessThan(8.4);
    }, 120_000);

    it('counts the player’s energy, and owes no stop', async () => {
      const { ticks } = await recorded();

      // Nothing to count with until the first lap is complete, 93 s in.
      const counted = ticks.filter(({ snapshot }) => snapshot.energy !== null);
      expect(counted[0].at).toBeGreaterThan(230);
      expect(counted[0].at).toBeLessThan(240);
      expect(counted.length).toBeGreaterThan(140);

      // 38.8 % aboard at the end, at 2.28 % a lap: seventeen laps in hand
      // against 8.3 to go.
      expect(last(ticks).snapshot.energy).toMatchObject({
        isVirtualEnergy: true,
        capacity: 100,
      });
      expect(last(ticks).snapshot.energy?.perLap).toBeCloseTo(2.28, 1);
      expect(last(ticks).snapshot.energy?.aboard).toBeCloseTo(38.8, 0);
      for (const { at, snapshot } of ticks) {
        expect(snapshot.playerStopsOwed, `at ${at}`).toBe(0);
      }
    }, 120_000);

    it('costs a refuelling stop as the sim’s own estimate does', async () => {
      const { ticks } = await recorded();

      // The rates are there from the first answers of the recording on.
      const rated = ticks.filter(({ snapshot }) => snapshot.refuelLines);
      expect(rated.length).toBeGreaterThan(ticks.length - 5);

      let compared = 0;
      let worstEnergy = 0;
      let worstFuel = 0;
      for (const { at, snapshot, pitStop } of rated) {
        const lines = snapshot.refuelLines ?? [];
        expect(lines, `at ${at}`).toHaveLength(2);
        const [energy, fuelLine] = lines;
        // 2.5 % of the energy a second and nothing to connect; a second
        // each to put the fuel hose on and take it off, then 3.4 L a second
        // at 1.03 L to the percent.
        expect(energy, `at ${at}`).toEqual({ fixedS: 0, perUnitS: 0.4 });
        expect(fuelLine.perUnitS, `at ${at}`).toBe(0.3029);
        expect(fuelLine.fixedS, `at ${at}`).toBeGreaterThan(2.3);
        expect(fuelLine.fixedS, `at ${at}`).toBeLessThan(2.5);

        // Against the sim's estimate for the level the pit menu is set to,
        // part by part. Both sides are rounded to a tenth.
        const toAdd = pitStop.refuel?.toAdd;
        const parts = pitStop.estimate.parts;
        if (toAdd === null || toAdd === undefined || !parts) continue;
        compared += 1;
        worstEnergy = Math.max(
          worstEnergy,
          Math.abs(energy.fixedS + toAdd * energy.perUnitS - parts.energy)
        );
        worstFuel = Math.max(
          worstFuel,
          Math.abs(fuelLine.fixedS + toAdd * fuelLine.perUnitS - parts.fuel)
        );
      }
      expect(compared).toBeGreaterThan(ticks.length - 10);
      // 0.06 s at the worst for either hose over the recording; the toAdd
      // and the parts it is held against are each a tenth coarse.
      expect(worstEnergy).toBeLessThan(0.12);
      expect(worstFuel).toBeLessThan(0.12);

      // As the recording ends the menu's 45 % is 6.2 % above what is
      // aboard: 2.5 s of energy and 4.3 s of fuel, side by side.
      const end = last(ticks);
      expect(end.pitStop.refuel?.toAdd).toBeCloseTo(6.2, 0);
      expect(end.pitStop.estimate.parts).toMatchObject({
        fuel: 4.3,
        energy: 2.5,
      });
      expect(end.snapshot.plannedStandingS).toBe(4.3);
      expect(end.snapshot).toMatchObject({ separateS: 0, overlapS: 0 });
    }, 120_000);

    it('names the class cars around the player, with the race gap to each', async () => {
      const { ticks } = await recorded();
      const end = last(ticks);
      const rivals = end.snapshot.rivals;

      // Second of the fourteen LMGT3s: one car ahead and three behind.
      expect(end.classPositions[PLAYER]).toBe(2);
      expect(rivals.map((rival) => rival.carIdx)).toEqual([16, 15, 17, 19]);
      expect(rivals.map((rival) => rival.ahead)).toEqual([
        true,
        false,
        false,
        false,
      ]);
      expect(rivals.map((rival) => rival.classPosition)).toEqual([1, 3, 4, 5]);
      for (const rival of rivals) {
        // The same place the frame gives the car, and the difference of
        // the two cars' times behind the leader.
        expect(rival.classPosition, `car ${rival.carIdx}`).toBe(
          end.classPositions[rival.carIdx]
        );
        expect(rival.gapS, `car ${rival.carIdx}`).toBeCloseTo(
          end.gaps[rival.carIdx] - end.gaps[PLAYER],
          0
        );
        expect(rival.inPit, `car ${rival.carIdx}`).toBe(false);
      }
      // A third of a second off the class lead, 2.5 s clear of third.
      expect(rivals[0].gapS).toBeCloseTo(-0.3, 0);
      expect(rivals[1].gapS).toBeCloseTo(2.5, 0);

      // Never more than three a side, nearest first, and never a car of
      // another class: the LMGT3s are the player's slot and slots 15 to 27.
      for (const { at, snapshot } of ticks) {
        const ahead = snapshot.rivals.filter((rival) => rival.ahead);
        const behind = snapshot.rivals.filter((rival) => !rival.ahead);
        expect(ahead.length, `at ${at}`).toBeLessThanOrEqual(3);
        expect(behind.length, `at ${at}`).toBeLessThanOrEqual(3);
        for (const rival of snapshot.rivals) {
          expect(rival.carIdx, `at ${at}`).toBeGreaterThanOrEqual(15);
          expect(rival.carIdx, `at ${at}`).toBeLessThanOrEqual(27);
        }
        const places = (side: typeof ahead) =>
          side.map((rival) => rival.classPosition);
        expect(places(ahead), `at ${at}`).toEqual(
          [...places(ahead)].sort((a, b) => b - a)
        );
        expect(places(behind), `at ${at}`).toEqual(
          [...places(behind)].sort((a, b) => a - b)
        );
      }
    }, 120_000);

    it('reckons every class rival from its energy once it has a lap to measure', async () => {
      const { ticks } = await recorded();

      // A usage needs two line crossings. The class crosses for the second
      // time 180 s into the recording, around 320 s on the session clock:
      // until then nothing has been seen of any of them.
      for (const { at, snapshot } of ticks) {
        for (const rival of snapshot.rivals) {
          if (at < 300) {
            expect(rival.basis, `car ${rival.carIdx} at ${at}`).toBe('assumed');
          }
          if (at > 330) {
            expect(rival.basis, `car ${rival.carIdx} at ${at}`).toBe('energy');
          }
          // Nobody has a stop to make in a race with eight laps left.
          expect(rival.stopsOwed, `car ${rival.carIdx} at ${at}`).toBe(0);
          expect(rival.projectedGapS, `car ${rival.carIdx} at ${at}`).toBe(
            rival.gapS
          );
        }
      }

      const end = last(ticks);
      expect(end.snapshot.rivals).toHaveLength(4);
      for (const rival of end.snapshot.rivals) {
        // Of the order of the player's own 2.33 % a lap.
        const used = end.carPit.usedAverage[rival.carIdx];
        expect(used, `car ${rival.carIdx}`).toBeGreaterThan(0.02);
        expect(used, `car ${rival.carIdx}`).toBeLessThan(0.027);
        // Counted at the class's pace, two laps in: the same finishing lap
        // as the player, who has 8.3 to go.
        expect(rival.lapsLeft, `car ${rival.carIdx}`).toBeGreaterThan(8.2);
        expect(rival.lapsLeft, `car ${rival.carIdx}`).toBeLessThan(8.4);
        expect(rival.paceDeltaS, `car ${rival.carIdx}`).toBe(0);
      }
      expect(end.carPit.usedAverage[PLAYER]).toBeCloseTo(0.0233, 3);
    }, 120_000);

    it('gives the table of the recorded race, down the assumed pit lane', async () => {
      // The lane is an assumption, not a measurement: see the top of the
      // file. 17.2 s at the limit against 6.1 s on the racing line.
      const { ticks } = await recorded();
      const end = last(ticks);
      expect(end.snapshot.laneLossS).toBeCloseTo(11.1, 0);
      for (const rival of end.snapshot.rivals) {
        // Nobody has stopped: the lane with the player's own planned 4.3 s.
        expect(rival.stopLossS, `car ${rival.carIdx}`).toBeCloseTo(15.4, 0);
      }

      const { columns, lapLostPerLap } = projectFinish(end.snapshot, DEFAULTS);
      expect(columns.map((column) => column.scenarioS ?? column.kind)).toEqual([
        'now',
        30,
        40,
        50,
        60,
        'planned',
        'toFinish',
      ]);
      const [now, , , , sixty, planned, toFinish] = columns;

      // The leader reaches 11.72 laps as the clock runs out and takes the
      // flag on lap 12, 21.5 s later. The player is then half way round
      // lap 11: 8.3 laps to go, far from a line either way.
      expect(now.lapsToGo).toBeCloseTo(end.fuel.estimatedLapsRemaining, 1);
      expect(now.leaderMarginS).toBeGreaterThan(20.5);
      expect(now.leaderMarginS).toBeLessThan(22.5);
      expect(now.near).toBeNull();
      // A stop of a minute for both leaves the leader short of the line
      // when the clock runs out: the race is a lap shorter, and so is the
      // player's.
      expect(sixty.leaderMarginS).toBeGreaterThan(3.5);
      expect(sixty.leaderMarginS).toBeLessThan(6.5);
      expect(sixty.leaderNear).toBe(true);
      expect(now.lapsToGo - sixty.lapsToGo).toBeCloseTo(1, 6);
      for (const column of columns.slice(1, 4)) {
        expect(column.lapsToGo).toBeCloseTo(now.lapsToGo, 1);
      }

      // The planned stop: the lane, 4.3 s standing and 2 s extra.
      expect(planned.playerLossS).toBeCloseTo(17.4, 0);
      expect(planned.lapsToGo).toBeCloseTo(now.lapsToGo, 1);
      // 8.3 laps need 19 % and 38.8 % is aboard: nothing to add in any
      // column, and the stop to finish is no stop.
      for (const column of columns) {
        expect(column.toAdd).toBeLessThan(-15);
        expect(column.overCapacity).toBe(false);
      }
      expect(now.needed).toBeGreaterThan(18);
      expect(now.needed).toBeLessThan(20);
      expect(toFinish.playerLossS).toBe(0);

      // Ten seconds a lap slower than the LMP2 in front: 0.12 of a lap.
      expect(lapLostPerLap).toBeCloseTo(0.12, 2);
    }, 120_000);

    it('has no stop to cost on the recording as it stands: no car crosses a pit line', async () => {
      const { ticks } = await play();
      for (const { at, snapshot } of ticks) {
        expect(snapshot.valid, `at ${at}`).toBe(true);
        expect(snapshot.laneLossS, `at ${at}`).toBeNull();
        for (const rival of snapshot.rivals) {
          expect(rival.stopLossS, `car ${rival.carIdx} at ${at}`).toBeNull();
          // With no stop owed the gap needs no costing.
          expect(rival.projectedGapS, `car ${rival.carIdx} at ${at}`).toBe(
            rival.gapS
          );
        }
      }
      const kinds = projectFinish(last(ticks).snapshot, DEFAULTS).columns.map(
        (column) => column.kind
      );
      expect(kinds).toEqual([
        'now',
        'scenario',
        'scenario',
        'scenario',
        'scenario',
      ]);
    }, 120_000);

    it('owes two stops in the same race run for two hours more (staged)', async () => {
      // STAGED: two hours added to the sim's race clock and to its end
      // time, on every frame and every session snapshot. The cars, their
      // laps and their energy are as recorded.
      const { ticks } = await play({ lane: true, stage: longRace });
      const end = last(ticks);

      expect(end.snapshot.timeLeftS).toBeGreaterThan(654.8 + TWO_HOURS);
      expect(end.snapshot.timeLeftS).toBeLessThan(656 + TWO_HOURS);
      // 94 laps where it was 11: 91.3 to go.
      expect(end.fuel.calculatedTotalRaceLaps).toBeGreaterThan(92);
      expect(end.fuel.calculatedTotalRaceLaps).toBeLessThan(96);
      expect(end.snapshot.lapsToGo).toBeGreaterThan(89);
      expect(end.snapshot.lapsToGo).toBeLessThan(93);
      // Seventeen laps in hand and 43.8 to a full budget: two stops.
      expect(end.snapshot.playerStopsOwed).toBe(2);

      expect(end.snapshot.rivals.map((rival) => rival.carIdx)).toEqual([
        16, 15, 17, 19,
      ]);
      for (const rival of end.snapshot.rivals) {
        // Each from its own reading: about 37 % left at 2.4 % a lap.
        expect(rival, `car ${rival.carIdx}`).toMatchObject({
          basis: 'energy',
          stopsOwed: 2,
        });
        expect(rival.lapsLeft, `car ${rival.carIdx}`).toBeGreaterThan(89);
        expect(rival.lapsLeft, `car ${rival.carIdx}`).toBeLessThan(93);
        // Two stops each of the same length, which is the player's own
        // plan for want of a stop to have seen: the gap comes out as it
        // went in.
        expect(rival.projectedGapS, `car ${rival.carIdx}`).toBeCloseTo(
          rival.gapS,
          6
        );
      }

      // The stop that would add it all: 170 % is more than the car holds,
      // and at 2.5 % a second it would stand for over a minute.
      const columns = projectFinish(end.snapshot, DEFAULTS).columns;
      const toFinish = columns.find((column) => column.kind === 'toFinish');
      expect(toFinish?.overCapacity).toBe(true);
      expect(toFinish?.toAdd).toBeGreaterThan(150);
      expect(toFinish?.playerLossS).toBeGreaterThan(70);
      expect(toFinish?.playerLossS).toBeLessThan(90);
    }, 120_000);

    it('assumes the rivals’ stints where their readings are withheld (staged)', async () => {
      // STAGED: the long race above, with every other car's fuel byte and
      // virtual energy written as the sim writes them for a car it gives no
      // reading for, as online. The player's own are as recorded.
      const online: Stage = (raw, blockSlot) => ({
        ...longRace(raw, blockSlot),
        vehFuelFraction: Array.from(raw.vehFuelFraction ?? [], (value, slot) =>
          slot === PLAYER ? value : 0
        ),
        vehVirtualEnergy: Array.from(
          raw.vehVirtualEnergy ?? [],
          (value, slot) => (slot === PLAYER ? value : -1)
        ),
      });
      const { ticks } = await play({ lane: true, stage: online });

      let rivalsSeen = 0;
      for (const { at, snapshot } of ticks) {
        for (const rival of snapshot.rivals) {
          rivalsSeen += 1;
          // No reading, and no stop seen: nothing but an assumption.
          expect(rival.basis, `car ${rival.carIdx} at ${at}`).toBe('assumed');
        }
      }
      expect(rivalsSeen).toBeGreaterThan(800);

      const end = last(ticks);
      expect(end.snapshot.playerStopsOwed).toBe(2);
      for (const rival of end.snapshot.rivals) {
        // The player's own 43.8 laps to a budget, two of them done.
        expect(rival.stopsOwed, `car ${rival.carIdx}`).toBe(2);
      }
      // Before the player has a lap measured there is nothing to assume
      // from, and no stop is counted.
      const first = ticks.find(({ snapshot }) => snapshot.rivals.length > 0);
      expect(first?.snapshot.energy).toBeNull();
      for (const rival of first?.snapshot.rivals ?? []) {
        expect(rival.stopsOwed, `car ${rival.carIdx}`).toBe(0);
      }
    }, 120_000);

    it('stays on the own entry through a team-mate’s stint, and says nothing with the camera on a rival (staged)', async () => {
      // STAGED: from a minute into the recording every snapshot is rewritten
      // to what the sim writes when it names no player vehicle, with
      // scoring saying a person on another machine has the car; the car
      // that was the player's goes on lapping in its slot. The game state
      // follows 1.2 s late, as the sim's REST API gives it, and for twenty
      // seconds the sim's camera is put on slot 16. Not a recording of a
      // driver change: see teamMateStint.tape.spec.ts.
      const OUT_FROM = 60;
      const RIVAL_FROM = 200;
      const RIVAL_UNTIL = 220;
      const STATE_LAG_SECONDS = 1.2;
      let startET: number | null = null;
      const since = (raw: LmuRawTelemetry): number =>
        raw.currentET - (startET ?? raw.currentET);
      const stint: Stage = (raw, blockSlot) => {
        startET ??= raw.currentET;
        if (since(raw) < OUT_FROM) return raw;
        return {
          ...lmuRawWithoutPlayerVehicle(raw, blockSlot),
          vehControl: Uint8Array.from(raw.vehControl ?? [], (was, slot) =>
            slot === PLAYER ? CONTROL_REMOTE : was
          ),
        };
      };
      const { ticks } = await play({
        lane: true,
        stage: stint,
        gameState: (raw) =>
          since(raw) - STATE_LAG_SECONDS >= OUT_FROM ? 'monitor' : 'driving',
        focus: (raw) =>
          since(raw) >= RIVAL_FROM && since(raw) < RIVAL_UNTIL ? 16 : undefined,
      });

      const start = ticks[0].at;
      const into = (tick: Tick): number => tick.at - start;
      const atWheel = ticks.filter((tick) => into(tick) < OUT_FROM - 1);
      // Clear of the two seconds either side of each change.
      const onRival = ticks.filter(
        (tick) => into(tick) > RIVAL_FROM + 2 && into(tick) < RIVAL_UNTIL - 2
      );
      const watchingOwn = ticks.filter(
        (tick) =>
          into(tick) > OUT_FROM + 3 &&
          (into(tick) < RIVAL_FROM - 2 || into(tick) > RIVAL_UNTIL + 2)
      );
      expect(atWheel.length).toBeGreaterThan(50);
      expect(onRival.length).toBeGreaterThan(12);
      expect(watchingOwn.length).toBeGreaterThan(140);

      // Through the stint the channel goes on describing the team car.
      for (const tick of watchingOwn) {
        const at = `at ${tick.at}`;
        expect(tick.fuel.isOnTrack, at).toBe(false);
        expect(tick.snapshot, at).toMatchObject({ valid: true, reason: null });
        expect(tick.snapshot.player?.carIdx, at).toBe(PLAYER);
        expect(tick.snapshot.leader?.carIdx, at).toBe(LEADER);
        expect(tick.snapshot.rivals.length, at).toBeGreaterThan(0);
        // The sim sends the fuel of no car the user is not in, so there are
        // no litres to cost the fuel hose from, and no stop to finish.
        expect(tick.snapshot.refuelLines, at).toBeNull();
      }
      // Its energy is still written, so what is aboard goes on being
      // counted once a lap has been measured.
      const end = last(ticks);
      expect(end.fuel.watched).toBe(true);
      expect(end.snapshot.energy?.aboard).toBeCloseTo(38.8, 0);
      expect(end.snapshot.lapsToGo).toBeGreaterThan(8.2);
      expect(end.snapshot.lapsToGo).toBeLessThan(8.4);
      expect(end.snapshot.rivals.map((rival) => rival.carIdx)).toEqual([
        16, 15, 17, 19,
      ]);
      // The same race as at the wheel: the two never part by a lap.
      const { ticks: own } = await recorded();
      expect(end.snapshot.lapsToGo).toBeCloseTo(
        last(own).snapshot.lapsToGo ?? 0,
        0
      );

      // With the camera on a rival the fuel projection follows that car,
      // and nothing of it is passed off as the user's own.
      for (const tick of onRival) {
        const at = `at ${tick.at}`;
        expect(tick.fuel.race?.playerCarIdx, at).toBe(16);
        expect(tick.snapshot, at).toMatchObject({
          valid: false,
          reason: 'otherCar',
          player: null,
          leader: null,
          energy: null,
          rivals: [],
        });
      }
    }, 240_000);
  }
);
