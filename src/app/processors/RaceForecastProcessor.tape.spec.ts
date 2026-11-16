import { describe, expect, it } from 'vitest';
import type {
  CarPitSnapshot,
  FinishProjectionSnapshot,
  RaceForecastCar,
  RaceForecastSnapshot,
  Session,
  StandingsSnapshot,
  Telemetry,
} from '@irdashies/types';
import { stopDueLap } from '@irdashies/shared';
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
import { RaceForecastProcessor } from './RaceForecastProcessor';
import { ReferenceLapProcessor } from './ReferenceLapProcessor';
import { StandingsProcessor } from './StandingsProcessor';

/**
 * The race forecast on the recorded Le Mans Ultimate race: four minutes of
 * a fifteen-minute timed race at Laguna Seca, 38 cars in three classes, the
 * player (slot 0) in one of fourteen LMGT3s on virtual energy. Every frame
 * goes through the real mapping and the real processors the forecast reads,
 * with the finish projection run beside it on the same snapshots.
 *
 * What is recorded, and so confirmed here: that the forecast carries the
 * whole class where the finish projection carries three cars a side, and
 * agrees with it car for car at every tick; every class car's energy and
 * what a lap costs it; the class order and the race gaps.
 *
 * What is NOT, and is marked where it is used:
 *
 * - a pit lane. Nobody crosses a pit line in the four minutes, so the track
 *   is given a lane with lines at 95 % and 3 % of the lap, as the finish
 *   projection's own tape spec gives it. An assumption, not a measurement;
 * - a stop, a second stint, or a race long enough to need either. The
 *   stops owed, the lap a stop is due and the pit window are STAGED by
 *   adding two hours to the sim's race clock; the cars, their laps and
 *   their energy stay as recorded;
 * - a team-mate at the wheel. STAGED by rewriting every snapshot to what
 *   the sim writes when it names no player vehicle;
 * - five laps of anything. The recording crosses the line twice, so no
 *   mean of five laps and no forecast of "some laps ago" can come of it.
 *   Both rest on the unit spec alone.
 *
 * Windows only, like the other tape specs.
 */

const PLAYER = 0;
/** The processors that feed it run five times a second, it once. */
const FAST_TICK_SECONDS = 0.2;
const SLOW_TICK_SECONDS = 1;
/** An assumed lane for Laguna Seca: not measured, see above. */
const ASSUMED_LINES = { pitEntryPct: 0.95, pitExitPct: 0.03 };
/** scoring's mControl for a person on another machine. */
const CONTROL_REMOTE = 2;
/** The LMGT3s are the player's slot and slots 15 to 27. */
const CLASS_SLOTS = [PLAYER, ...Array.from({ length: 13 }, (_, i) => 15 + i)];

const REST_PATHS = [
  '/rest/garage/UIScreen/RepairAndRefuel',
  '/rest/strategy/pitstop-estimate',
];
const REST_TASKS = LMU_REST_TASKS.filter((task) =>
  REST_PATHS.includes(task.path)
);

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
  forecast: RaceForecastSnapshot;
  /** The finish projection on the same snapshots, on the same frame. */
  finish: FinishProjectionSnapshot;
  /** What each car has left and what a lap costs it, as they stood. */
  standings: StandingsSnapshot;
  carPit: CarPitSnapshot;
}

type Stage = <T extends LmuRawTelemetry>(raw: T, blockSlot: number) => T;

interface PlayOptions {
  stage?: Stage;
  gameState?: (raw: LmuRawTelemetry) => LmuGameState | undefined;
}

interface Frame {
  telemetry: Telemetry;
  sessionTime: number;
}

const play = async ({ stage, gameState }: PlayOptions = {}): Promise<
  Tick[]
> => {
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
  let forecast: RaceForecastProcessor | null = null;
  const early = [fuel, lapTimes, references, carPit, standings];
  for (const each of early) each.onLifecycle({ type: 'enter', replay: false });

  const rest = createTapeRest();
  let knownService: unknown;
  let hasSession = false;
  let lastFast = Number.NEGATIVE_INFINITY;
  let lastSlow = Number.NEGATIVE_INFINITY;
  const ticks: Tick[] = [];
  let lastFrame: Frame | null = null;
  const runFast = ({ telemetry, sessionTime }: Frame): void => {
    if (!pitStop) return;
    lastFast = sessionTime;
    fuel.onFrame(telemetry);
    carPit.onFrame(telemetry);
    standings.onFrame(telemetry);
    pitStop.onFrame(telemetry);
  };
  const runSlow = ({ telemetry, sessionTime }: Frame): void => {
    if (!finish || !forecast) return;
    lastSlow = sessionTime;
    finish.onFrame(telemetry);
    forecast.onFrame(telemetry);
    ticks.push({
      at: sessionTime,
      forecast: structuredClone(forecast.snapshot()),
      finish: structuredClone(finish.snapshot()),
      standings: structuredClone(standings.snapshot()),
      carPit: structuredClone(carPit.snapshot()),
    });
  };
  await playLmuTape({
    tapePath: LMU_CURATED_TAPE_PATH,
    speed: 20,
    transformRaw: stage,
    gameState,
    restCells: (_raw, readRest) => rest.read(readRest),
    onFrame: ({ telemetry, session, sessionChanged, sessionTime }) => {
      // The bridge republishes the session when a REST answer lands on it,
      // which is how the service rates reach a processor.
      const service = rest.data.session.pitService;
      if (sessionChanged || service !== knownService || !hasSession) {
        knownService = service;
        hasSession = true;
        const withRest = { ...session, LmuRest: rest.data.session } as Session;
        for (const each of early) each.init(withRest);
        if (!pitStop) {
          pitStop = new PitStopEstimateProcessor({
            store: createMemoryPitLaneModelStore({
              [String(session.WeekendInfo?.TrackID)]: ASSUMED_LINES,
            }),
            fuel: () => fuel.snapshot(),
            lapTimes: () => lapTimes.snapshot(),
            referenceLaps: () => references.snapshot(),
          });
          pitStop.onLifecycle({ type: 'enter', replay: false });
        }
        const pit = pitStop;
        const dependencies = {
          fuel: () => fuel.snapshot(),
          lapTimes: () => lapTimes.snapshot(),
          pitStop: () => pit.snapshot(),
          carPit: () => carPit.snapshot(),
          standings: () => standings.snapshot(),
        };
        if (!finish || !forecast) {
          finish = new FinishProjectionProcessor(dependencies);
          forecast = new RaceForecastProcessor(dependencies);
          finish.onLifecycle({ type: 'enter', replay: false });
          forecast.onLifecycle({ type: 'enter', replay: false });
        }
        pitStop.init(withRest);
        finish.init(withRest);
        forecast.init(withRest);
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
  return ticks;
};

/** The recording as it stands, with the assumed lane: played once. */
let recordedRun: Promise<Tick[]> | undefined;
const recorded = (): Promise<Tick[]> => (recordedRun ??= play());

const last = <T>(values: readonly T[]): T => values[values.length - 1];

/** Two hours more on the race clock: the same cars in a long race. */
const TWO_HOURS = 7200;
const longRace: Stage = (raw) => ({
  ...raw,
  sessionTimeRemaining: raw.sessionTimeRemaining + TWO_HOURS,
  endET: raw.endET + TWO_HOURS,
});
let longRun: Promise<Tick[]> | undefined;
const long = (): Promise<Tick[]> => (longRun ??= play({ stage: longRace }));

const ownOf = (forecast: RaceForecastSnapshot): RaceForecastCar => {
  const own = forecast.cars.find((car) => car.own);
  if (!own) throw new Error('the forecast has no own car');
  return own;
};

describe.skipIf(!lmuTapeAvailable())(
  'the race forecast on a recorded LMU race',
  () => {
    it('carries the whole class from the first frame, the own entry among them', async () => {
      const ticks = await recorded();
      expect(ticks.length).toBeGreaterThan(230);

      for (const { at, forecast } of ticks) {
        expect(forecast, `at ${at}`).toMatchObject({
          valid: true,
          reason: null,
          raceType: 'time',
          lapLimit: null,
          ownCarIdx: PLAYER,
        });
        // All fourteen LMGT3s and nobody else, each once.
        expect(
          forecast.cars.map((car) => car.carIdx).sort((a, b) => a - b),
          `at ${at}`
        ).toEqual(CLASS_SLOTS);
        expect(
          forecast.cars.filter((car) => car.own).map((car) => car.carIdx),
          `at ${at}`
        ).toEqual([PLAYER]);
        // In the order of the places now.
        const places = forecast.cars.map((car) => car.classPosition);
        expect(places, `at ${at}`).toEqual([...places].sort((a, b) => a - b));
      }

      // Second of the fourteen as the recording ends, on its third lap.
      const end = last(ticks).forecast;
      expect(ownOf(end)).toMatchObject({ classPosition: 2, gapS: 0 });
      expect(end.ownLap).toBe(3);
      expect(end.cars.map((car) => car.classPosition)).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
      ]);
      // The flag is the same one the finish projection's laps are counted
      // to: 655 s on the clock, and the leader's lap after it.
      expect(end.timeLeftS).toBe(last(ticks).finish.timeLeftS);
      expect(end.flagInS).toBeGreaterThan(end.timeLeftS ?? 0);
      expect(end.flagInS).toBeLessThan((end.timeLeftS ?? 0) + 80);
    }, 120_000);

    it('agrees with the finish projection car for car, at every tick', async () => {
      const ticks = await recorded();
      let compared = 0;
      for (const { at, forecast, finish } of ticks) {
        expect(finish.valid, `at ${at}`).toBe(true);
        for (const rival of finish.rivals) {
          const car = forecast.cars.find(
            (entry) => entry.carIdx === rival.carIdx
          );
          expect(car, `car ${rival.carIdx} at ${at}`).toMatchObject({
            classPosition: rival.classPosition,
            gapS: rival.gapS,
            lapsLeft: rival.lapsLeft,
            stopsOwed: rival.stopsOwed,
            stopLossS: rival.stopLossS,
            basis: rival.basis,
            // Until the own car has a lap measured the projection counts
            // it as owing no stop, and the forecast projects no gap to it.
            netGapS: forecast.place ? rival.projectedGapS : null,
            inPit: rival.inPit,
          });
          compared += 1;
        }
        expect(ownOf(forecast).progress, `at ${at}`).toBe(
          finish.player?.progress
        );
        expect(ownOf(forecast).paceS, `at ${at}`).toBe(finish.player?.paceS);
      }
      // Four rivals a tick on this recording: one ahead, three behind.
      expect(compared).toBeGreaterThan(900);
    }, 120_000);

    it('owes nobody a stop in a race with eight laps left, and finishes the class as it stands', async () => {
      const ticks = await recorded();
      const end = last(ticks).forecast;
      for (const car of end.cars) {
        expect(car.stopsOwed, `car ${car.carIdx}`).toBe(0);
        expect(car.nextStopLap, `car ${car.carIdx}`).toBeNull();
        expect(car.basis, `car ${car.carIdx}`).toBe('energy');
        // Nobody has been near the pit lane.
        expect(car, `car ${car.carIdx}`).toMatchObject({
          inPit: false,
          stops: 0,
          lastStopLap: null,
          lastStopLaneS: null,
        });
        // With no stop to make the gap is the gap, and two laps in no car
        // has a pace of its own to move it by.
        expect(car.netGapS, `car ${car.carIdx}`).toBe(car.gapS);
        expect(car.finishGapS, `car ${car.carIdx}`).toBe(car.gapS);
        expect(car.finishPosition, `car ${car.carIdx}`).toBe(car.classPosition);
        // Two laps are not five.
        expect(car.avg5S, `car ${car.carIdx}`).toBeNull();
      }
      expect(end.place).toMatchObject({
        now: 2,
        finish: 2,
        uncertain: false,
        // Two laps of memory are not five either.
        was: null,
      });
      // A third of a second off the class lead, 2.5 s clear of third.
      expect(end.place?.ahead?.carIdx).toBe(16);
      expect(end.place?.ahead?.gapS).toBeCloseTo(0.3, 0);
      expect(end.place?.behind?.carIdx).toBe(15);
      expect(end.place?.behind?.gapS).toBeCloseTo(2.5, 0);
    }, 120_000);

    it('states the own entry’s stint from what the sim says is aboard', async () => {
      const ticks = await recorded();
      // Nothing to count with until the first lap is complete.
      const counted = ticks.filter(({ forecast }) => forecast.stint !== null);
      expect(counted[0].at).toBeGreaterThan(230);
      expect(counted.length).toBeGreaterThan(140);
      for (const { at, forecast } of ticks) {
        if (forecast.stint === null) {
          // No place either, while the own car's stops cannot be told.
          expect(forecast.place, `at ${at}`).toBeNull();
          expect(ownOf(forecast).stopsOwed, `at ${at}`).toBeNull();
        }
      }

      // 38.8 % at 2.28 % a lap: seventeen laps of energy in hand.
      const { stint } = last(ticks).forecast;
      expect(stint).toMatchObject({
        isVirtualEnergy: true,
        capacity: 100,
        window: null,
      });
      expect(stint?.aboard).toBeCloseTo(38.8, 0);
      expect(stint?.perLap).toBeCloseTo(2.28, 1);
      // The tank is read for the car the user is in, and whichever of the
      // two is empty first is the one the stint ends on.
      expect(stint?.tankLapsLeft).toBeGreaterThan(10);
      const energyLaps = (stint?.aboard ?? 0) / (stint?.perLap ?? 1);
      expect(stint?.lapsLeft).toBeCloseTo(
        Math.min(energyLaps, stint?.tankLapsLeft ?? Infinity),
        0
      );
      expect(stint?.limit).toBe(
        (stint?.tankLapsLeft ?? Infinity) < energyLaps ? 'fuel' : 'energy'
      );
    }, 120_000);

    it('places the planned stop among the class, down the assumed pit lane', async () => {
      // The lane is an assumption, not a measurement: see the top of the
      // file. 11.1 s lost in it and the 4.3 s the pit menu's stop stands.
      const ticks = await recorded();
      const end = last(ticks);
      expect(ownOf(end.forecast).stopLossS).toBeCloseTo(15.4, 0);
      const { rejoin } = end.forecast;
      if (!rejoin) throw new Error('no rejoin as the recording ends');
      // Second now; every class car closer behind than the stop is long
      // comes past.
      const passed = end.forecast.cars.filter(
        (car) => car.gapS > 0 && car.gapS < (ownOf(end.forecast).stopLossS ?? 0)
      ).length;
      expect(rejoin.position).toBe(2 + passed);
      expect(passed).toBeGreaterThan(0);
      for (const beside of [rejoin.ahead, rejoin.behind]) {
        if (beside) expect(CLASS_SLOTS).toContain(beside.carIdx);
      }
      expect(rejoin.inPits).toBe(0);
    }, 120_000);

    it('names the lap each car’s next stop is due in the same race run for two hours more (staged)', async () => {
      // STAGED: two hours added to the sim's race clock and to its end
      // time, on every frame and every session snapshot. The cars, their
      // laps and their energy are as recorded.
      const ticks = await long();
      const end = last(ticks);
      const own = ownOf(end.forecast);

      // Seventeen laps in hand and 43.8 to a full budget, with 91 to go.
      expect(own).toMatchObject({ stopsOwed: 2, basis: 'energy' });
      expect(own.lapsLeft).toBeGreaterThan(89);
      expect(own.lapsLeft).toBeLessThan(93);
      expect(own.stintLaps).toBeGreaterThan(42);
      expect(own.stintLaps).toBeLessThan(46);

      let exact = 0;
      for (const car of end.forecast.cars) {
        if (car.own) continue;
        const id = `car ${car.carIdx}`;
        expect(car, id).toMatchObject({ basis: 'energy', stopsOwed: 2 });
        // From its own reading: what scoring says it has left over what a
        // lap has cost it.
        const remaining = end.standings.carIdxEnergyRemaining[car.carIdx];
        const usage = end.carPit.usedAverage[car.carIdx];
        expect(usage, id).toBeGreaterThan(0.02);
        const due = stopDueLap(car.progress, remaining / usage);
        expect(Math.abs((car.nextStopLap ?? 0) - due), id).toBeLessThanOrEqual(
          1
        );
        if (car.nextStopLap === due) exact += 1;
        // About 37 % at 2.4 % a lap, on the third lap: the high teens.
        expect(car.nextStopLap, id).toBeGreaterThan(13);
        expect(car.nextStopLap, id).toBeLessThan(24);
        expect(car.stintLaps, id).toBeCloseTo(1 / usage, 1);
      }
      // The published progress is rounded, which can move a car that is on
      // a line by a lap: never more than one of the thirteen.
      expect(exact).toBeGreaterThanOrEqual(12);
    }, 120_000);

    it('gives the own entry a pit window that ends on its last lap in hand (staged)', async () => {
      // STAGED: the long race above.
      const ticks = await long();
      const end = last(ticks).forecast;
      const own = ownOf(end);
      const window = end.stint?.window;
      if (!window) throw new Error('no pit window in the long race');
      expect(window.closeLap).toBe(own.nextStopLap);
      expect(window.closeLap).toBe(
        stopDueLap(own.progress, end.stint?.lapsLeft ?? 0)
      );
      // Two stints of 43.8 laps are 87.6, and 91 are left: a stop before
      // the end of the seventh lap would leave more than two stints to
      // drive, and the race would take a third stop.
      expect(window.openLap).toBe(
        Math.ceil(own.progress + own.lapsLeft - 2 * own.stintLaps)
      );
      expect(window.openLap).toBe(7);
      expect(window.openLap).toBeGreaterThan(end.ownLap ?? 0);
      expect(window.openLap).toBeLessThan(window.closeLap);

      // Everybody owes the same two stops at the same cost, for want of a
      // stop to have seen: the class finishes as it stands.
      expect(end.place).toMatchObject({ now: 2, finish: 2, uncertain: false });
      for (const car of end.cars) {
        expect(car.finishPosition, `car ${car.carIdx}`).toBe(car.classPosition);
        expect(car.netGapS, `car ${car.carIdx}`).toBeCloseTo(car.gapS, 6);
      }
    }, 120_000);

    it('goes on forecasting through a team-mate’s stint, without the tank (staged)', async () => {
      // STAGED: the long race, and from a minute into the recording every
      // snapshot rewritten to what the sim writes when it names no player
      // vehicle, with scoring saying a person on another machine has the
      // car; the car that was the player's goes on lapping in its slot.
      // The game state follows 1.2 s late, as the sim's REST API gives it.
      // Not a recording of a driver change: see teamMateStint.tape.spec.ts.
      const OUT_FROM = 60;
      const STATE_LAG_SECONDS = 1.2;
      let startET: number | null = null;
      const since = (raw: LmuRawTelemetry): number =>
        raw.currentET - (startET ?? raw.currentET);
      const stint: Stage = (raw, blockSlot) => {
        startET ??= raw.currentET;
        const staged = longRace(raw, blockSlot);
        if (since(raw) < OUT_FROM) return staged;
        return {
          ...lmuRawWithoutPlayerVehicle(staged, blockSlot),
          vehControl: Uint8Array.from(raw.vehControl ?? [], (was, slot) =>
            slot === PLAYER ? CONTROL_REMOTE : was
          ),
        };
      };
      const ticks = await play({
        stage: stint,
        gameState: (raw) =>
          since(raw) - STATE_LAG_SECONDS >= OUT_FROM ? 'monitor' : 'driving',
      });
      const driven = last(await long()).forecast;
      const end = last(ticks).forecast;

      // The same class, the same car, the same stops: the sim goes on
      // writing the car's virtual energy while somebody else drives it.
      expect(end).toMatchObject({ valid: true, ownCarIdx: PLAYER });
      expect(end.cars.map((car) => car.carIdx)).toEqual(
        driven.cars.map((car) => car.carIdx)
      );
      expect(ownOf(end)).toMatchObject({ stopsOwed: 2, basis: 'energy' });
      expect(end.stint?.aboard).toBeCloseTo(driven.stint?.aboard ?? 0, 0);
      expect(end.stint?.window?.closeLap).toBeGreaterThan(13);
      expect(end.place).toMatchObject({ now: 2, finish: 2 });
      // Its litres are not sent, so the tank is no part of the stint: it
      // ends on the energy.
      expect(end.stint).toMatchObject({ limit: 'energy', tankLapsLeft: null });
      expect(driven.stint?.tankLapsLeft).not.toBeNull();
    }, 240_000);
  }
);
