import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TrackLocation, type ChannelBridge } from '@irdashies/types';
import { useSessionStore } from '@irdashies/context';
import { mountFixture } from '../../../testing/renderWithFixture';
import type { ReplayFixture } from '../../../testing/replayFixture';
import lmuRace from '../../../../test-data/fixtures/lmu-race-laguna-seca.json';
import lmuPractice from '../../../../test-data/fixtures/lmu-practice-laguna-seca.json';
import { useClassRivals } from './useClassRivals';
import {
  useFieldSize,
  useFocusCarPlace,
  useGridPlaceChange,
} from './useFocusCarPlace';

/**
 * The rivals and the focus car's place on a recorded Le Mans Ultimate race,
 * cut from the curated tape: 38 cars in three classes at Laguna Seca, the
 * last 48 seconds of the recording, early in the third lap. The player's
 * LMGT3, slot 0, runs second of fourteen in class and 26th overall, having
 * started seventh and 31st; slot 16 leads the class a third of a second up
 * the road and slot 15 follows two and a half seconds back.
 *
 * The frames go through the real processors (standings, relative gaps, the
 * per-car pit tracker, the lap history). The recording has nobody lapped,
 * nobody in the pits and no camera off the player, so those cases are
 * STAGED on its frames, and each test that does so says what it changed.
 */
const race = lmuRace as unknown as ReplayFixture;
const practice = lmuPractice as unknown as ReplayFixture;

const PLAYER = 0;
const AHEAD = 16;
const BEHIND = 15;
const CARS = 38;

type Frame = ReplayFixture['frames'][number];

/** The same recording with every frame changed. */
const staged = (
  fixture: ReplayFixture,
  change: (frame: Frame) => Frame
): ReplayFixture => ({ ...fixture, frames: fixture.frames.map(change) });

const numbers = (frame: Frame, key: string): number[] => frame[key] as number[];

describe('the focus car and its class rivals on a recorded LMU race', () => {
  const previousBridge = window.channelBridge;

  beforeEach(() => {
    useSessionStore.getState().resetSession();
  });
  afterEach(() => {
    // Unmount first: the hooks read the bridge and the session they are
    // about to lose.
    cleanup();
    if (previousBridge === undefined) {
      Reflect.deleteProperty(window, 'channelBridge');
    } else {
      window.channelBridge = previousBridge as ChannelBridge;
    }
    useSessionStore.getState().resetSession();
  });

  const rivalsOf = (fixture: ReplayFixture) => {
    const harness = mountFixture(fixture);
    return renderHook(() => useClassRivals(), { wrapper: harness.wrapper })
      .result.current;
  };

  const placeOf = (fixture: ReplayFixture) => {
    const harness = mountFixture(fixture);
    return renderHook(
      () => {
        const focus = useFocusCarPlace();
        return {
          focus,
          fieldSize: useFieldSize(focus?.carIdx),
          inClass: useGridPlaceChange('class'),
          overall: useGridPlaceChange('overall'),
        };
      },
      { wrapper: harness.wrapper }
    ).result.current;
  };

  describe('useClassRivals', () => {
    it('finds the class cars either side of the player', () => {
      const rivals = rivalsOf(race);

      expect(rivals.isRace).toBe(true);
      expect(rivals.focusCarIdx).toBe(PLAYER);
      expect(rivals.focus).toMatchObject({
        carIdx: PLAYER,
        classPosition: 2,
        name: 'Valtteri Bottas',
        carNumber: '74',
      });
      expect(rivals.ahead).toMatchObject({
        carIdx: AHEAD,
        classPosition: 1,
        name: 'Graham Hill',
        carNumber: '33',
      });
      expect(rivals.behind).toMatchObject({
        carIdx: BEHIND,
        classPosition: 3,
        name: 'Alberto Ascari',
        carNumber: '23',
      });
    });

    it('measures each gap as the race does: a third of a second, two and a half', () => {
      const rivals = rivalsOf(race);

      // The difference of the times behind the leader in the last frame.
      expect(rivals.ahead?.interval).toEqual({
        laps: 0,
        seconds: expect.closeTo(0.315, 2),
      });
      expect(rivals.behind?.interval).toEqual({
        laps: 0,
        seconds: expect.closeTo(2.448, 2),
      });
      // Within half a lap the relative's live delta is what is printed, and
      // it measures the same gap: within a few tenths of the interval.
      for (const rival of [rivals.ahead, rivals.behind]) {
        expect(rival?.gap.source).toBe('live');
        expect(
          Math.abs((rival?.gap.seconds ?? 99) - (rival?.interval.seconds ?? 0))
        ).toBeLessThan(0.4);
      }
    });

    it('carries the laps, the energy, the stint and the places gained', () => {
      const rivals = rivalsOf(race);

      expect(rivals.focus).toMatchObject({
        lastTime: expect.closeTo(86.66, 2),
        bestTime: expect.closeTo(86.66, 2),
        // The fastest LMGT3 lap of the race so far, set last time round.
        bestIsClassBest: true,
        lastTimeState: 'session-fastest',
        lastLapInvalid: undefined,
        energyIsVirtual: true,
        energyRemaining: expect.closeTo(0.388, 2),
        // Started seventh in class, now second.
        positionChange: 5,
        stintLaps: 2,
        inPitLane: false,
        onOutLap: false,
      });
      expect(rivals.ahead).toMatchObject({
        lastTime: expect.closeTo(86.922, 2),
        lastTimeState: 'personal-best',
        energyRemaining: expect.closeTo(0.296, 2),
        positionChange: 1,
        stintLaps: 2,
      });
      expect(rivals.behind).toMatchObject({
        lastTime: expect.closeTo(88.644, 2),
        energyRemaining: expect.closeTo(0.308, 2),
        positionChange: 0,
        stintLaps: 2,
      });
      // The fixture was cut before the sim's stop count was mapped, and no
      // lap is completed inside its window: nothing is made up for either.
      expect(rivals.available).toEqual({
        pitStops: false,
        energy: true,
        trackLimits: true,
      });
      expect(rivals.ahead?.pitStops).toBeUndefined();
      expect(rivals.ahead?.usedLastLap).toBeUndefined();
      expect(rivals.ahead?.stintEstimate).toBeUndefined();
    });

    it('withholds the trend and the forecast: no line is crossed in the window', () => {
      const rivals = rivalsOf(race);

      for (const rival of [rivals.ahead, rivals.behind]) {
        expect(rival?.previousLineGap).toBeNull();
        expect(rival?.trend).toBeNull();
        expect(rival?.forecastLaps).toBeNull();
      }
    });

    it('reads a rival two laps down in laps (staged)', () => {
      // STAGED: two laps taken off every LMGT3 behind the player, so the
      // order is as recorded and the car behind is two laps and a little
      // back. Its time behind the leader is left as recorded.
      const session = race.session;
      const playerClass = session?.DriverInfo?.Drivers?.find(
        (driver) => driver.CarIdx === PLAYER
      )?.CarClassID;
      const sameClass = new Set(
        (session?.DriverInfo?.Drivers ?? [])
          .filter((driver) => driver.CarClassID === playerClass)
          .map((driver) => driver.CarIdx)
      );
      const lapped = staged(race, (frame) => {
        const places = numbers(frame, 'CarIdxClassPosition');
        const down = (laps: number, carIdx: number) =>
          sameClass.has(carIdx) && places[carIdx] > places[PLAYER]
            ? laps - 2
            : laps;
        return {
          ...frame,
          CarIdxLap: numbers(frame, 'CarIdxLap').map(down),
          CarIdxLapCompleted: numbers(frame, 'CarIdxLapCompleted').map(down),
        };
      });
      const rivals = rivalsOf(lapped);

      expect(rivals.behind?.carIdx).toBe(BEHIND);
      expect(rivals.behind?.interval.laps).toBe(2);
      expect(rivals.behind?.gap).toEqual({
        text: '2L',
        seconds: null,
        source: 'laps',
      });
      expect(rivals.behind?.forecastLaps).toBeNull();
      // The car ahead is on the player's lap, as recorded.
      expect(rivals.ahead?.carIdx).toBe(AHEAD);
      expect(rivals.ahead?.gap.source).toBe('live');
    });

    it('shows a rival in the pit lane, with its time there and its stops (staged)', () => {
      // STAGED: the class leader in the pit lane for the last twelve
      // seconds of the recording, having asked for the stop before that,
      // with the sim's stop count as the mapper now publishes it. It goes
      // on moving as recorded, so the order is untouched.
      const from = race.frames.length - 6;
      const pitting = staged(race, (frame) => {
        const inLane = race.frames.indexOf(frame) >= from;
        return {
          ...frame,
          CarIdxOnPitRoad: (frame.CarIdxOnPitRoad as boolean[]).map(
            (flag, carIdx) => (carIdx === AHEAD ? inLane : flag)
          ),
          CarIdxTrackSurface: numbers(frame, 'CarIdxTrackSurface').map(
            (surface, carIdx) =>
              carIdx === AHEAD && inLane
                ? TrackLocation.ApproachingPits
                : surface
          ),
          LmuCarIdxPitState: Array.from({ length: CARS }, (_, carIdx) =>
            carIdx === AHEAD ? (inLane ? 2 : 1) : 0
          ),
          LmuCarIdxPitStops: Array.from({ length: CARS }, (_, carIdx) =>
            carIdx === AHEAD ? 1 : 0
          ),
        };
      });
      const rivals = rivalsOf(pitting);

      expect(rivals.ahead?.carIdx).toBe(AHEAD);
      expect(rivals.ahead).toMatchObject({
        inPitLane: true,
        inGarage: false,
        onOutLap: false,
        pitStops: 1,
        pitRequested: false,
      });
      // Five steps of the fixture's two seconds since it turned in.
      expect(rivals.ahead?.pitLaneSeconds).toBeGreaterThan(9);
      expect(rivals.ahead?.pitLaneSeconds).toBeLessThan(11);
      expect(rivals.available.pitStops).toBe(true);
      expect(rivals.behind).toMatchObject({ inPitLane: false, pitStops: 0 });
      // The gap is still measured; nothing is forecast from it.
      expect(rivals.ahead?.interval.seconds).toBeCloseTo(0.315, 2);
      expect(rivals.ahead?.forecastLaps).toBeNull();
    });

    it('shows the stop a rival has asked for (staged)', () => {
      // STAGED: the car behind with LMU's pit state 1 on every frame.
      const asking = staged(race, (frame) => ({
        ...frame,
        LmuCarIdxPitState: Array.from({ length: CARS }, (_, carIdx) =>
          carIdx === BEHIND ? 1 : 0
        ),
      }));
      const rivals = rivalsOf(asking);

      expect(rivals.behind?.pitRequested).toBe(true);
      expect(rivals.behind?.inPitLane).toBe(false);
      expect(rivals.ahead?.pitRequested).toBe(false);
    });

    it('follows the camera to the car being watched (staged)', () => {
      // STAGED: the camera on the class leader, as while watching it. It
      // has nobody ahead in class, and the player is the car behind it.
      const watching = staged(race, (frame) => ({
        ...frame,
        CamCarIdx: AHEAD,
      }));
      const rivals = rivalsOf(watching);

      expect(rivals.focusCarIdx).toBe(AHEAD);
      expect(rivals.focus).toMatchObject({ carIdx: AHEAD, isFocus: true });
      expect(rivals.ahead).toBeUndefined();
      expect(rivals.behind).toMatchObject({ carIdx: PLAYER, isFocus: false });
      expect(rivals.behind?.interval.seconds).toBeCloseTo(0.315, 2);
    });

    it('measures by best laps in a practice session, with nothing forecast', () => {
      const rivals = rivalsOf(practice);

      expect(rivals.isRace).toBe(false);
      for (const rival of [rivals.ahead, rivals.behind]) {
        if (!rival) continue;
        expect(rival.gap.source).not.toBe('live');
        expect(rival.positionChange).toBeUndefined();
        expect(rival.forecastLaps).toBeNull();
        expect(rival.trend).toBeNull();
      }
    });
  });

  describe('the focus car’s place', () => {
    it('is 26th of 38 and second in class, up five on both grids', () => {
      const place = placeOf(race);

      expect(place.focus).toEqual({
        carIdx: PLAYER,
        position: 26,
        classPosition: 2,
        sessionNum: 10,
      });
      expect(place.fieldSize).toBe(CARS);
      // Seventh in class and 31st overall on the grid.
      expect(place.inClass).toBe(5);
      expect(place.overall).toBe(5);
    });

    it('follows the camera to the car being watched (staged)', () => {
      // STAGED: the camera on the class leader, 25th overall, which
      // started second in class and 26th overall.
      const place = placeOf(
        staged(race, (frame) => ({ ...frame, CamCarIdx: AHEAD }))
      );

      expect(place.focus).toMatchObject({
        carIdx: AHEAD,
        position: 25,
        classPosition: 1,
      });
      expect(place.fieldSize).toBe(CARS);
      expect(place.inClass).toBe(1);
    });

    it('has no grid change outside a race', () => {
      const place = placeOf(practice);

      expect(place.inClass).toBeUndefined();
      expect(place.overall).toBeUndefined();
    });
  });
});
