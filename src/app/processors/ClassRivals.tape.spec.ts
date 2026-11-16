import { describe, expect, it } from 'vitest';
import type { LmuRawTelemetry } from '../lmu/native';
import { lmuTapeAvailable } from '../../testing/lmuTape';
import {
  playLmuTapeRivals,
  type LmuTapeRivalsTick,
  type LmuTapeStage,
} from '../../testing/lmuTapeRivals';

/**
 * The rivals box on a recorded Le Mans Ultimate race: four minutes from the
 * green flag at Laguna Seca, 38 cars in three classes, the player (slot 0)
 * in one of fourteen LMGT3s. He starts seventh in class and works up to
 * second, so his class neighbours change five times.
 *
 * The box has no processor of its own. It is built in the renderer from the
 * standings, the per-car pit tracker, the lap history and the relative
 * gaps, by a pure function; the tape harness plays the recording through
 * those four processors and that function, five times a second as the
 * widget reads them, and this holds the gaps against the sim's own time
 * behind the next car.
 *
 * The recording has nobody lapped and nobody in the pits. Those rows are
 * STAGED: the same recording with the sim's fields changed before they are
 * mapped, and each test that does so says what it changed. What LMU really
 * writes through a stop only a recording of one can say.
 *
 * Windows only, like the other tape specs.
 */

const PLAYER = 0;
const CARS = 38;
/** The class the player's LMGT3 runs in, by the id the addon gives it. */
const GT_CLASS = 1;
/** The rolling start is over and the order has settled. */
const SETTLED_AT = 160;

type Stage = LmuTapeStage;
type Tick = LmuTapeRivalsTick;

const clockOf = (raw: LmuRawTelemetry): number =>
  typeof raw.elapsedTime === 'number' && raw.elapsedTime >= 0
    ? raw.elapsedTime
    : raw.currentET;

const playRivals = (onTick: (tick: Tick) => void, stage?: Stage) =>
  playLmuTapeRivals({ ownCarIdx: PLAYER, stage, onTick });

/** The car one place ahead of `carIdx` overall, by the sim's own order. */
const nextCarOverall = (raw: LmuRawTelemetry, carIdx: number): number =>
  Array.from(raw.vehPlaces).indexOf(raw.vehPlaces[carIdx] - 1);

describe.skipIf(!lmuTapeAvailable())(
  'the class rivals on a recorded LMU race',
  () => {
    it('follows the player’s class neighbours as he works up the order', async () => {
      const pairs: string[] = [];
      /** The tick nearest each instant: ahead, behind and their gaps. */
      const at = new Map<number, Tick>();
      const instants = [179.6, 299.6];
      const { frames, ticks, last } = await playRivals((tick) => {
        if (tick.sessionTime < SETTLED_AT) return;
        const pair = `${tick.rivals.ahead?.carIdx}/${tick.rivals.behind?.carIdx}`;
        if (pair !== pairs.at(-1)) pairs.push(pair);
        for (const instant of instants) {
          const held = at.get(instant);
          if (
            !held ||
            Math.abs(tick.sessionTime - instant) <
              Math.abs(held.sessionTime - instant)
          ) {
            // The rivals are rebuilt each tick; the tick itself is kept.
            at.set(instant, { ...tick });
          }
        }
      });

      // The whole recording, five times a second.
      expect(frames).toBeGreaterThan(14_000);
      expect(ticks).toBeGreaterThan(1_100);

      // Fifth in class behind slot 19; past slot 15, then 17; second
      // behind slot 16, with slot 15 back up to third behind him.
      expect(pairs).toEqual(['19/18', '15/19', '17/15', '16/17', '16/15']);

      const early = at.get(179.6)?.rivals;
      expect(early?.focus?.classPosition).toBe(5);
      expect(early?.ahead?.interval.seconds).toBeCloseTo(0.43, 1);
      expect(early?.behind?.interval.seconds).toBeCloseTo(0.49, 1);

      const later = at.get(299.6)?.rivals;
      expect(later?.focus?.classPosition).toBe(2);
      expect(later?.ahead?.carIdx).toBe(16);
      expect(later?.ahead?.interval.seconds).toBeCloseTo(1.98, 1);
      expect(later?.behind?.carIdx).toBe(17);
      expect(later?.behind?.interval.seconds).toBeCloseTo(0.4, 1);

      // The end of the recording: a third of a second off the class lead.
      const end = last?.rivals;
      expect(last?.sessionTime).toBeGreaterThan(379.5);
      expect(end?.focus).toMatchObject({ carIdx: PLAYER, classPosition: 2 });
      expect(end?.ahead?.interval).toEqual({
        laps: 0,
        seconds: expect.closeTo(0.303, 2),
      });
      expect(end?.behind?.interval).toEqual({
        laps: 0,
        seconds: expect.closeTo(2.512, 2),
      });
      // Seventh on the class grid.
      expect(end?.focus?.positionChange).toBe(5);
      expect(end?.ahead?.positionChange).toBe(1);
      expect(end?.behind?.positionChange).toBe(0);
    }, 120_000);

    it('measures each gap as the sim does: its own time behind the next car', async () => {
      // The yardstick is the sim's figure for the car behind in each pair,
      // which exists whenever the class car ahead is also the next car
      // overall. Every LMGT3 runs behind every prototype here, so that is
      // nearly always.
      let aheadCompared = 0;
      let aheadWorst = 0;
      let behindCompared = 0;
      let behindWorst = 0;
      let notTheNextCar = 0;
      let liveOrderDiffers = 0;
      let settledTicks = 0;
      await playRivals(({ sessionTime, rivals, standings, recorded }) => {
        if (sessionTime < SETTLED_AT) return;
        settledTicks += 1;
        if (
          standings.liveClassPosition[PLAYER] !==
          standings.carIdxClassPosition[PLAYER]
        ) {
          liveOrderDiffers += 1;
        }
        const { ahead, behind } = rivals;
        if (ahead && ahead.interval.seconds !== null) {
          if (nextCarOverall(recorded, PLAYER) === ahead.carIdx) {
            aheadCompared += 1;
            aheadWorst = Math.max(
              aheadWorst,
              Math.abs(
                ahead.interval.seconds - recorded.vehTimeBehindNext[PLAYER]
              )
            );
          } else notTheNextCar += 1;
        }
        if (
          behind &&
          behind.interval.seconds !== null &&
          nextCarOverall(recorded, behind.carIdx) === PLAYER
        ) {
          behindCompared += 1;
          behindWorst = Math.max(
            behindWorst,
            Math.abs(
              behind.interval.seconds -
                recorded.vehTimeBehindNext[behind.carIdx]
            )
          );
        }
      });

      expect(settledTicks).toBeGreaterThan(1_000);
      expect(aheadCompared).toBeGreaterThan(1_000);
      expect(behindCompared).toBeGreaterThan(1_000);
      // To the hundredth, on every tick: the gap is the sim's own.
      expect(aheadWorst).toBeLessThan(0.05);
      expect(behindWorst).toBeLessThan(0.05);
      // The order on the road and the sim's order part for a tick or two at
      // each pass, and no more.
      expect(notTheNextCar).toBeLessThan(15);
      expect(liveOrderDiffers).toBeLessThan(15);
    }, 120_000);

    it('never forecasts a catch: no pair has three laps behind it', async () => {
      // Two laps and a little: the most any pair of neighbours shares is
      // the two line crossings at the ends of laps one and two, which is
      // one lap-to-lap change. That is a trend to show and not a forecast.
      let forecasts = 0;
      let longestTrend = 0;
      const { last } = await playRivals(({ rivals }) => {
        for (const rival of [rivals.ahead, rivals.behind]) {
          if (rival && rival.forecastLaps !== null) forecasts += 1;
          longestTrend = Math.max(longestTrend, rival?.trend?.laps ?? 0);
        }
      });

      expect(forecasts).toBe(0);
      expect(longestTrend).toBe(1);

      // Slot 16 crossed the line 1.93 s ahead at the end of lap one and
      // 1.69 s ahead at the end of lap two: closing, a quarter of a second
      // a lap.
      const ahead = last?.rivals.ahead;
      expect(ahead?.previousLineGap).toBeCloseTo(1.69, 1);
      expect(ahead?.trend).toMatchObject({ laps: 1, closingLaps: 1 });
      expect(ahead?.trend?.perLap).toBeCloseTo(-0.24, 1);
      expect(ahead?.forecastLaps).toBeNull();

      // Slot 15 was ahead at the end of lap one and is behind at the end of
      // lap two: the gap is signed, so that reads as opening by two
      // seconds, not as closing.
      const behind = last?.rivals.behind;
      expect(behind?.previousLineGap).toBeCloseTo(1.18, 1);
      expect(behind?.trend?.closingLaps).toBe(0);
      expect(behind?.trend?.perLap).toBeGreaterThan(1.5);
    }, 120_000);

    it('carries each car’s stint, what a lap costs it and how far it can go', async () => {
      const { last } = await playRivals(() => undefined);
      const rivals = last?.rivals;

      // What the sim publishes for every car of the recording.
      expect(rivals?.available).toEqual({
        pitStops: true,
        energy: true,
        trackLimits: true,
      });
      // The player, on virtual energy: 2.33 % a lap, seventeen laps left
      // after two: the stint can reach lap nineteen.
      expect(rivals?.focus).toMatchObject({
        stintLaps: 2,
        stintEstimate: 19,
        energyIsVirtual: true,
        pitStops: 0,
        pitRequested: false,
        inPitLane: false,
        onOutLap: false,
        lastLapInvalid: false,
      });
      expect(rivals?.focus?.usedLastLap).toBeCloseTo(0.0233, 3);
      expect(rivals?.focus?.energyRemaining).toBeCloseTo(0.3875, 3);
      // The class leader started with less and uses more.
      expect(rivals?.ahead).toMatchObject({ stintLaps: 2, stintEstimate: 15 });
      expect(rivals?.ahead?.usedLastLap).toBeCloseTo(0.0238, 3);
      expect(rivals?.behind).toMatchObject({ stintLaps: 2, stintEstimate: 15 });
      expect(rivals?.behind?.usedLastLap).toBeCloseTo(0.0235, 3);

      // Nobody stops and nobody asks to, in the whole field.
      expect(last?.standings.carIdxPitStops).toEqual(
        Array.from({ length: CARS }, () => 0)
      );
      expect(last?.standings.carIdxPitState).toEqual(
        Array.from({ length: CARS }, () => 0)
      );
    }, 120_000);

    it('reads a rival two laps down in laps (staged)', async () => {
      // STAGED: the LMGT3s running behind the player put two laps down,
      // frame by frame, so the order is as recorded and the class car
      // behind is two laps and a little back. Done by giving two laps to
      // every other car, the player included, so that no count goes below
      // zero on the first laps. Nothing else is touched.
      const stage: Stage = (raw) => {
        const behindPlayer = (carIdx: number) =>
          raw.vehClass[carIdx] === GT_CLASS &&
          raw.vehPlaces[carIdx] > raw.vehPlaces[PLAYER];
        return {
          ...raw,
          vehTotalLaps: Int32Array.from(raw.vehTotalLaps, (laps, carIdx) =>
            behindPlayer(carIdx) ? laps : laps + 2
          ),
          ...(raw.vehLapNumber
            ? {
                vehLapNumber: Int32Array.from(
                  raw.vehLapNumber,
                  (lap, carIdx) => (behindPlayer(carIdx) ? lap : lap + 2)
                ),
              }
            : {}),
        };
      };
      let lapsShown = 0;
      let secondsShown = 0;
      const { last } = await playRivals(({ sessionTime, rivals }) => {
        if (sessionTime < SETTLED_AT || !rivals.behind) return;
        if (rivals.behind.gap.source === 'laps') lapsShown += 1;
        else secondsShown += 1;
      }, stage);

      // The same neighbours as recorded.
      expect(last?.rivals.ahead?.carIdx).toBe(16);
      expect(last?.rivals.behind?.carIdx).toBe(15);
      expect(last?.rivals.behind?.interval.laps).toBe(2);
      expect(last?.rivals.behind?.gap).toEqual({
        text: '2L',
        seconds: null,
        source: 'laps',
      });
      // Laps, with no trend and no forecast hung on them.
      expect(last?.rivals.behind?.trend).toBeNull();
      expect(last?.rivals.behind?.previousLineGap).toBeNull();
      expect(last?.rivals.behind?.forecastLaps).toBeNull();
      // On all but a tick or two around each pass.
      expect(lapsShown).toBeGreaterThan(1_000);
      expect(secondsShown).toBeLessThan(15);
      // The car ahead is on the player's lap, and reads its seconds.
      expect(last?.rivals.ahead?.gap.source).not.toBe('laps');
      expect(last?.rivals.ahead?.interval.seconds).toBeCloseTo(0.303, 2);
    }, 120_000);

    it('shows a rival asking for a stop and then in the pit lane (staged)', async () => {
      // STAGED: slot 16, the class leader the player is chasing at the end,
      // is given the fields of a stop: the request at 350 s, the pit lane
      // from 360 s to the end of the recording. It goes on lapping as
      // recorded, so the order and the gap are untouched.
      const CAR = 16;
      const REQUESTED_AT = 350;
      const ENTERS_AT = 360;
      const stage: Stage = (raw) => {
        const clock = clockOf(raw);
        if (clock < REQUESTED_AT) return raw;
        const inLane = clock >= ENTERS_AT;
        return {
          ...raw,
          vehInPits: Uint8Array.from(raw.vehInPits, (value, carIdx) =>
            carIdx === CAR ? Number(inLane) : value
          ),
          vehPitState: Uint8Array.from(raw.vehPitState, (value, carIdx) =>
            carIdx === CAR ? (inLane ? 2 : 1) : value
          ),
        };
      };
      let requestedTicks = 0;
      let inLaneTicks = 0;
      let forecastsInLane = 0;
      const { last } = await playRivals(({ rivals }) => {
        const ahead = rivals.ahead;
        if (ahead?.carIdx !== CAR) return;
        if (ahead.pitRequested) {
          requestedTicks += 1;
          expect(ahead.inPitLane).toBe(false);
        }
        if (ahead.inPitLane) {
          inLaneTicks += 1;
          if (ahead.trend !== null || ahead.forecastLaps !== null) {
            forecastsInLane += 1;
          }
        }
      }, stage);

      // Ten seconds asked for and twenty in the lane, five ticks a second.
      expect(requestedTicks).toBeGreaterThan(40);
      expect(requestedTicks).toBeLessThan(52);
      expect(inLaneTicks).toBeGreaterThan(90);
      expect(inLaneTicks).toBeLessThan(102);
      // A gap that moves because of a stop is not a pace.
      expect(forecastsInLane).toBe(0);

      const ahead = last?.rivals.ahead;
      expect(ahead).toMatchObject({
        carIdx: CAR,
        inPitLane: true,
        inGarage: false,
        onOutLap: false,
        pitRequested: false,
        // The sim has not counted the stop: the car is still in the lane.
        pitStops: 0,
      });
      expect(ahead?.pitLaneSeconds).toBeGreaterThan(19);
      expect(ahead?.pitLaneSeconds).toBeLessThan(20.5);
      // The gap itself is still the race's.
      expect(ahead?.interval.seconds).toBeCloseTo(0.303, 2);
      // Nobody else is in the pits.
      expect(last?.rivals.behind?.inPitLane).toBe(false);
      expect(last?.rivals.focus?.inPitLane).toBe(false);
    }, 120_000);
  }
);
