import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  defaultDashboard,
  type ChannelBridge,
  type DashboardLayout,
  type FasterCarsFromBehindWidgetSettings,
} from '@irdashies/types';
import { useSessionStore } from '@irdashies/context';
import { mountFixture } from '../../../../testing/renderWithFixture';
import type { ReplayFixture } from '../../../../testing/replayFixture';
import lmuRace from '../../../../../test-data/fixtures/lmu-race-laguna-seca.json';
import { useCarBehind } from './useCarBehind';

/**
 * Faster Cars From Behind on a recorded Le Mans Ultimate race, cut from the
 * curated tape: Laguna Seca, early in the player's third lap, the nearest
 * car behind a GT3 of their own class 2.4 s back. The frames go through the
 * real processors.
 *
 * No prototype is behind the player on the recording, so the one in the
 * last case is STAGED on its frames, and says so.
 */
const race = lmuRace as unknown as ReplayFixture;

const PLAYER = 0;
const GT3_BEHIND = 15;
const LMP2 = 8;

type Config = FasterCarsFromBehindWidgetSettings['config'];
type Frame = ReplayFixture['frames'][number];

const numbers = (frame: Frame, key: string): number[] => frame[key] as number[];

const dashboardWith = (config: Partial<Config>): DashboardLayout => ({
  ...(defaultDashboard as DashboardLayout),
  widgets: (defaultDashboard as DashboardLayout).widgets.map((widget) =>
    widget.id === 'fastercarsfrombehind'
      ? { ...widget, config: { ...widget.config, ...config } }
      : widget
  ),
});

/**
 * STAGED: one car is put a hundredth of a lap behind the player with a
 * second less on the sim's time into the lap, in every frame.
 */
const withCarOneSecondBehind = (
  fixture: ReplayFixture,
  carIdx: number
): ReplayFixture => ({
  ...fixture,
  frames: fixture.frames.map((frame) => {
    const pcts = [...numbers(frame, 'CarIdxLapDistPct')];
    const times = [...numbers(frame, 'CarIdxEstTime')];
    const laps = [...numbers(frame, 'CarIdxLap')];
    pcts[carIdx] = pcts[PLAYER] - 0.01;
    times[carIdx] = times[PLAYER] - 1;
    laps[carIdx] = laps[PLAYER];
    return {
      ...frame,
      CarIdxLapDistPct: pcts,
      CarIdxEstTime: times,
      CarIdxLap: laps,
    };
  }),
});

describe('Faster Cars From Behind on a recorded LMU race', () => {
  const previousBridge = window.channelBridge;

  beforeEach(() => {
    useSessionStore.getState().resetSession();
  });
  afterEach(() => {
    // Unmount first: the hook reads the bridge and the session it is about
    // to lose.
    cleanup();
    if (previousBridge === undefined) {
      Reflect.deleteProperty(window, 'channelBridge');
    } else {
      window.channelBridge = previousBridge as ChannelBridge;
    }
    useSessionStore.getState().resetSession();
  });

  const carsBehind = (fixture: ReplayFixture, config: Partial<Config> = {}) => {
    const dashboard = dashboardWith(config);
    const harness = mountFixture(fixture, { dashboard });
    const settings = dashboard.widgets.find(
      (widget) => widget.id === 'fastercarsfrombehind'
    )?.config as unknown as Config;
    const { result } = renderHook(
      () => useCarBehind({ distanceThreshold: settings.distanceThreshold }),
      { wrapper: harness.wrapper }
    );
    return result.current;
  };

  it('as recorded shows nothing: the car behind is of the player’s class', () => {
    expect(carsBehind(race)).toEqual([]);
  });

  it('as recorded lists that car once every class is asked for', () => {
    const cars = carsBehind(race, {
      onlyShowFasterClasses: false,
      distanceThreshold: 3,
    });

    expect(cars).toHaveLength(1);
    expect(cars[0].carIdx).toBe(GT3_BEHIND);
    expect(cars[0].className).toBe('LMGT3');
    expect(typeof cars[0].name).toBe('string');
    expect(cars[0].name).not.toBe('');
    // 2.45 s behind on the sim's time into the lap.
    expect(cars[0].distance).toBeCloseTo(-2.45, 1);
    // That far into a 3 s window the bar is a fifth full.
    expect(cars[0].percent).toBeCloseTo((1 - 2.45 / 3) * 100, 0);
    expect(cars[0].classPosition).toBeGreaterThan(0);
  });

  it('staged: lists a prototype a second behind, by its class', () => {
    const cars = carsBehind(withCarOneSecondBehind(race, LMP2));

    expect(cars).toHaveLength(1);
    expect(cars[0].carIdx).toBe(LMP2);
    // LMU's class is faster than the player's by the session's own ranking.
    expect(cars[0].className).toBe('LMP2');
    expect(cars[0].distance).toBeCloseTo(-1, 2);
    expect(cars[0].percent).toBeCloseTo((1 - 1 / 1.5) * 100, 0);
    expect(cars[0].classColor).toBeGreaterThan(0);
  });
});
