import { describe, expect, it } from 'vitest';
import type { CarPitSnapshot } from '@irdashies/types';
import { CAR_PIT_IN_LANE, CAR_PIT_ON_TRACK } from '@irdashies/types';
import type { LmuRawTelemetry } from '../lmu/native';
import {
  LMU_CURATED_TAPE_PATH,
  lmuTapeAvailable,
  playLmuTape,
} from '../../testing/lmuTape';
import { CarPitProcessor } from './CarPitProcessor';

/**
 * The per-car pit tracker on a recorded Le Mans Ultimate race: four minutes
 * at Laguna Seca, 38 cars, two laps for most of them and a third for the
 * fourteen LMP2s ahead.
 *
 * Nobody stops on the recording, so as it stands it can only say that the
 * tracker invents nothing: every count is 0 and every stint is as long as
 * the race. What it does give is every car's budget, lap after lap: virtual
 * energy for the fourteen LMGT3s, fuel for the prototypes.
 *
 * The second case stages a stop, by rewriting three of the sim's per-car
 * fields for one car before they are mapped. It is not a recording of a
 * stop: what LMU really writes through one -- when its count moves, whether
 * the pit state passes through every value -- only a recording can say.
 *
 * Windows only, like the other tape specs.
 */

const CARS = 38;
/** The processor's own rate, as the host would run it. */
const TICK_SECONDS = 0.2;

type Stage = <T extends LmuRawTelemetry>(raw: T) => T;

interface Played {
  frames: number;
  ticks: number;
  /** Laps each car had completed on the last frame. */
  laps: number[];
  snapshot: CarPitSnapshot;
}

const play = async (
  stage?: Stage,
  onTick?: (snapshot: CarPitSnapshot, sessionTime: number) => void
): Promise<Played> => {
  const processor = new CarPitProcessor();
  processor.onLifecycle({ type: 'enter', replay: false });
  let frames = 0;
  let ticks = 0;
  let lastTick = Number.NEGATIVE_INFINITY;
  let laps: number[] = [];
  await playLmuTape({
    tapePath: LMU_CURATED_TAPE_PATH,
    speed: 20,
    transformRaw: stage,
    onFrame: ({ telemetry, session, sessionChanged, sessionTime }) => {
      frames += 1;
      if (sessionChanged) processor.init(session);
      laps = telemetry.CarIdxLapCompleted?.value as number[];
      if (sessionTime - lastTick < TICK_SECONDS) return;
      lastTick = sessionTime;
      ticks += 1;
      processor.onFrame(telemetry);
      onTick?.(processor.snapshot(), sessionTime);
    },
  });
  return { frames, ticks, laps: [...laps], snapshot: processor.snapshot() };
};

const all = <T>(value: T): T[] => Array.from({ length: CARS }, () => value);

describe.skipIf(!lmuTapeAvailable())(
  'the per-car pit tracker on a recorded LMU race',
  () => {
    it('counts no stop and keeps every stint as long as the race', async () => {
      const { frames, ticks, laps, snapshot } = await play();

      expect(frames).toBeGreaterThan(14_000);
      expect(ticks).toBeGreaterThan(1_000);
      expect(snapshot.sessionNum).not.toBeNull();

      expect(snapshot.where).toEqual(all(CAR_PIT_ON_TRACK));
      expect(snapshot.stops).toEqual(all(0));
      expect(snapshot.laneTimeS).toEqual(all(0));
      expect(snapshot.standingS).toEqual(all(0));
      expect(snapshot.lastPitLap).toEqual(all(-1));
      expect(snapshot.lastStopLap).toEqual(all(-1));
      expect(snapshot.longestStintLaps).toEqual(all(0));
      expect(snapshot.requested).toEqual(all(false));
      expect(snapshot.counts).toEqual({
        onTrack: CARS,
        inLane: 0,
        standingInLane: 0,
        requested: 0,
        inGarage: 0,
      });

      // The stint of a car that has not stopped is its race: three laps for
      // the fourteen LMP2s in slots 1 to 14, two for everyone else.
      expect(snapshot.stintLaps).toEqual(laps);
      expect(laps).toEqual(
        Array.from({ length: CARS }, (_, carIdx) =>
          carIdx >= 1 && carIdx <= 14 ? 3 : 2
        )
      );
    }, 120_000);

    it("measures every car's usage per lap, energy or fuel", async () => {
      const { ticks, snapshot } = await play();

      // The player's LMGT3, on virtual energy: 0.4276 of the allocation left
      // after its first lap and 0.4043 after its second.
      expect(snapshot.usedLastLap[0]).toBeCloseTo(0.0233, 3);
      expect(snapshot.usedAverage[0]).toBe(snapshot.usedLastLap[0]);
      expect(snapshot.lapsLeft[0]).toBeGreaterThan(17);
      expect(snapshot.lapsLeft[0]).toBeLessThan(17.7);
      // Two more of its class.
      expect(snapshot.usedLastLap[16]).toBeCloseTo(0.0238, 3);
      expect(snapshot.usedLastLap[15]).toBeCloseTo(0.0235, 3);

      // The LMP2 leader runs on fuel, which the sim states in 255ths of a
      // tank: six of them on its second lap and seven on its third.
      expect(snapshot.usedLastLap[8]).toBeCloseTo(7 / 255, 4);
      expect(snapshot.usedAverage[8]).toBeCloseTo(6 / 255 + 1 / 255 / 3, 4);
      expect(snapshot.lapsLeft[8]).toBeCloseTo(87 / 7, 1);

      // Every car has one by the end, and none is absurd. Slots 11 and 28
      // are the two whose fuel byte reads a full tank as they cross the
      // line: taken at the line, their laps cost two thirds of a tank.
      expect(snapshot.usedLastLap).toHaveLength(CARS);
      for (let carIdx = 0; carIdx < CARS; carIdx += 1) {
        const used = snapshot.usedLastLap[carIdx];
        expect(used, `car ${carIdx}`).toBeGreaterThan(0.012);
        expect(used, `car ${carIdx}`).toBeLessThan(0.04);
        expect(snapshot.lapsLeft[carIdx], `car ${carIdx}`).toBeGreaterThan(5);
        expect(snapshot.lapsLeft[carIdx], `car ${carIdx}`).toBeLessThan(25);
      }

      // Published on change: at each of the 90 lap completions on the
      // recording, and a second after it for the usage, not once a tick.
      expect(snapshot.version).toBeGreaterThan(90);
      expect(snapshot.version).toBeLessThan(190);
      expect(snapshot.version).toBeLessThan(ticks / 5);
    }, 120_000);

    it('follows a stop staged for one car', async () => {
      // Staged, not recorded: car 20, an LMGT3 that never leaves the track,
      // is given the fields of a stop on its second lap.
      const CAR = 20;
      const REQUESTED_AT = 240;
      const ENTERS_AT = 250;
      const STOPS_AT = 260;
      const GOES_AT = 290;
      const LEAVES_AT = 300;
      const stage: Stage = (raw) => {
        const clock =
          typeof raw.elapsedTime === 'number' && raw.elapsedTime >= 0
            ? raw.elapsedTime
            : raw.currentET;
        if (clock < REQUESTED_AT) return raw;
        const inLane = clock >= ENTERS_AT && clock < LEAVES_AT;
        const pitState =
          clock < ENTERS_AT
            ? 1
            : clock < STOPS_AT
              ? 2
              : clock < GOES_AT
                ? 3
                : clock < LEAVES_AT
                  ? 4
                  : 0;
        const stopsMade = clock >= GOES_AT ? 1 : 0;
        return {
          ...raw,
          vehInPits: Uint8Array.from(raw.vehInPits, (value, carIdx) =>
            carIdx === CAR ? Number(inLane) : value
          ),
          vehPitState: Uint8Array.from(raw.vehPitState, (value, carIdx) =>
            carIdx === CAR ? pitState : value
          ),
          vehNumPitstops: Array.from(
            raw.vehNumPitstops ?? [],
            (value, carIdx) => (carIdx === CAR ? stopsMade : value)
          ),
        };
      };

      let requestedTicks = 0;
      let standingTicks = 0;
      let stopSeenAt = Number.NaN;
      let lapAtStop = -1;
      const { laps, snapshot } = await play(stage, (current, sessionTime) => {
        if (current.requested[CAR]) {
          requestedTicks += 1;
          expect(current.counts.requested).toBe(1);
        }
        if (current.counts.standingInLane === 1) standingTicks += 1;
        if (Number.isNaN(stopSeenAt) && current.lastStopLap[CAR] >= 0) {
          stopSeenAt = sessionTime;
          lapAtStop = current.lastStopLap[CAR];
          expect(current.where[CAR]).toBe(CAR_PIT_IN_LANE);
          expect(current.stintLaps[CAR]).toBe(0);
          expect(current.counts).toMatchObject({
            onTrack: CARS - 1,
            inLane: 1,
            standingInLane: 1,
          });
          // Seen standing, and the sim has not counted it yet.
          expect(current.stops[CAR]).toBe(0);
        }
      });

      // Ten seconds asked for and thirty standing, at a little under five
      // ticks a second: a tick is the first frame a fifth of a second on.
      expect(requestedTicks).toBeGreaterThan(40);
      expect(requestedTicks).toBeLessThan(52);
      expect(standingTicks).toBeGreaterThan(132);
      expect(standingTicks).toBeLessThan(152);
      // A stop once it has stood for more than a second.
      expect(stopSeenAt).toBeGreaterThan(STOPS_AT + 1);
      expect(stopSeenAt).toBeLessThan(STOPS_AT + 1.6);
      // One lap done when it came in.
      expect(lapAtStop).toBe(1);

      expect(snapshot.where).toEqual(all(CAR_PIT_ON_TRACK));
      expect(snapshot.stops[CAR]).toBe(1);
      expect(snapshot.lastPitLap[CAR]).toBe(1);
      expect(snapshot.lastStopLap[CAR]).toBe(1);
      expect(snapshot.longestStintLaps[CAR]).toBe(1);
      expect(snapshot.stintLaps[CAR]).toBe(laps[CAR] - 1);
      expect(snapshot.laneTimeS[CAR]).toBeGreaterThan(49.5);
      expect(snapshot.laneTimeS[CAR]).toBeLessThan(50.5);
      expect(snapshot.standingS[CAR]).toBeGreaterThan(29.5);
      expect(snapshot.standingS[CAR]).toBeLessThan(30.5);

      // Nobody else was touched.
      for (let carIdx = 0; carIdx < CARS; carIdx += 1) {
        if (carIdx === CAR) continue;
        expect(snapshot.stops[carIdx], `car ${carIdx}`).toBe(0);
        expect(snapshot.lastPitLap[carIdx], `car ${carIdx}`).toBe(-1);
        expect(snapshot.stintLaps[carIdx], `car ${carIdx}`).toBe(laps[carIdx]);
      }
    }, 120_000);
  }
);
