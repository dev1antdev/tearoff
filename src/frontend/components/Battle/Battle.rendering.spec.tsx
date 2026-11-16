import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getWidgetDefaultConfig,
  type ChannelBridge,
  type TrackStateSnapshot,
} from '@irdashies/types';
import type { ClassRivals } from '@irdashies/domain';
import { Battle } from './Battle';

/**
 * How often the Battle widget renders for the track-state channel, which it
 * reads only for the sim's display units. The channel itself is the real
 * one, fed by hand; everything else the widget reads is held still.
 */
const renders = vi.hoisted(() => ({ count: 0 }));

const NO_RIVALS: ClassRivals = {
  focusCarIdx: 4,
  isRace: true,
  ahead: undefined,
  focus: undefined,
  behind: undefined,
  available: { pitStops: false, energy: false, trackLimits: false },
  trackLimitsPointsMax: 0,
};

vi.mock('@irdashies/context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@irdashies/context')>()),
  useDrivingState: () => ({
    isDriving: true,
    isWatching: false,
    isWatchingOwnCar: false,
    isWatchingOtherCar: false,
  }),
  useSessionVisibility: () => true,
  useGeneralSettings: () => undefined,
  useWeekendInfoNumCarClasses: () => 1,
  useCarIdxSpeed: () => [],
}));

vi.mock('@irdashies/domain', () => ({
  useHighlightColor: () => 0xffffff,
  // The same object every time: the rivals themselves are held still.
  useClassRivals: () => NO_RIVALS,
}));

vi.mock('./hooks/useBattleSettings', () => ({
  // Called once for every render of the widget.
  useBattleSettings: () => {
    renders.count += 1;
    return getWidgetDefaultConfig('battle');
  },
}));

describe('Battle and the track-state channel', () => {
  let now: number;
  let version: number;
  let publish: ((snapshot: TrackStateSnapshot) => void) | undefined;

  /** One 25 Hz snapshot: the cars have moved on, the units as given. */
  const snapshot = (displayUnits: number) => {
    now += 40;
    version += 1;
    act(() =>
      publish?.({
        displayUnits,
        lapDistPct: (version * 0.001) % 1,
        carIdxLapDistPct: [(version * 0.001) % 1, (version * 0.002) % 1],
        sessionTime: version * 0.04,
        speed: 50 + (version % 7),
        version,
      } as unknown as TrackStateSnapshot)
    );
  };

  beforeEach(() => {
    now = 0;
    version = 0;
    renders.count = 0;
    publish = undefined;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    window.channelBridge = {
      subscribe: (
        channel: string,
        callback: (payload: TrackStateSnapshot) => void
      ) => {
        if (channel === 'track-state.snapshot') publish = callback;
        return () => undefined;
      },
    } as unknown as ChannelBridge;
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, 'channelBridge');
  });

  it('does not render as the cars move, only when the display units change', () => {
    const { container } = render(<Battle />);
    expect(container.querySelector('table')).not.toBeNull();
    expect(publish).toBeDefined();

    snapshot(1);
    const withUnits = renders.count;

    // A second of driving: 25 snapshots, the same units in every one.
    for (let index = 0; index < 25; index++) snapshot(1);
    expect(renders.count).toBe(withUnits);

    // The driver switches the sim to imperial.
    snapshot(0);
    expect(renders.count).toBe(withUnits + 1);
    for (let index = 0; index < 25; index++) snapshot(0);
    expect(renders.count).toBe(withUnits + 1);
  });
});
