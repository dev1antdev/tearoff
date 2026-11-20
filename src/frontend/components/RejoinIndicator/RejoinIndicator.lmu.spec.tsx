import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  defaultDashboard,
  type ChannelBridge,
  type DashboardLayout,
  type RejoinIndicatorWidgetSettings,
} from '@irdashies/types';
import { useSessionStore } from '@irdashies/context';
import { mountFixture } from '../../../testing/renderWithFixture';
import type { ReplayFixture } from '../../../testing/replayFixture';
import lmuRace from '../../../../test-data/fixtures/lmu-race-laguna-seca.json';
import { RejoinIndicator } from './RejoinIndicator';

/**
 * The Rejoin Indicator on a recorded Le Mans Ultimate race, cut from the
 * curated tape: Laguna Seca, early in the player's third lap, the nearest
 * car behind 2.4 s back. The frames go through the real processors and the
 * widget is the real one.
 *
 * The player is never slow on the recording, so the widget never shows on
 * it as it stands. The slow player is STAGED on its frames, and says so.
 */
const race = lmuRace as unknown as ReplayFixture;

const PLAYER = 0;

type Config = RejoinIndicatorWidgetSettings['config'];
type Frame = ReplayFixture['frames'][number];

const dashboardWith = (config: Partial<Config>): DashboardLayout => ({
  ...(defaultDashboard as DashboardLayout),
  widgets: (defaultDashboard as DashboardLayout).widgets.map((widget) =>
    widget.id === 'rejoin'
      ? {
          ...widget,
          enabled: true,
          config: { ...widget.config, ...config },
        }
      : widget
  ),
});

const staged = (
  fixture: ReplayFixture,
  change: (frame: Frame) => Frame
): ReplayFixture => ({ ...fixture, frames: fixture.frames.map(change) });

/** STAGED: the player's own speed reads 5 m/s, 18 km/h, in every frame. */
const crawling = (frame: Frame): Frame => ({ ...frame, Speed: 5 });

/** STAGED: scoring also has the player in the pit lane. */
const crawlingInPitLane = (frame: Frame): Frame => {
  const onPitRoad = [...(frame.CarIdxOnPitRoad as boolean[])];
  onPitRoad[PLAYER] = true;
  return { ...crawling(frame), OnPitRoad: true, CarIdxOnPitRoad: onPitRoad };
};

describe('the Rejoin Indicator on a recorded LMU race', () => {
  const previousBridge = window.channelBridge;

  beforeEach(() => {
    useSessionStore.getState().resetSession();
  });
  afterEach(() => {
    // Unmount first: the widget reads the bridge and the session it is
    // about to lose.
    cleanup();
    if (previousBridge === undefined) {
      Reflect.deleteProperty(window, 'channelBridge');
    } else {
      window.channelBridge = previousBridge as ChannelBridge;
    }
    useSessionStore.getState().resetSession();
  });

  const rejoin = (fixture: ReplayFixture, config: Partial<Config> = {}) => {
    const harness = mountFixture(fixture, { dashboard: dashboardWith(config) });
    return render(<RejoinIndicator />, { wrapper: harness.wrapper }).container;
  };

  it('as recorded stays hidden: the player is at racing speed', () => {
    expect(rejoin(race).textContent).toBe('');
  });

  it('staged: slow on the track, shows the gap to the car behind', () => {
    const container = rejoin(staged(race, crawling));
    // 2.45 s by the sim's time into the lap, which is over the care gap.
    expect(container.textContent).toContain('2.4s');
    expect(container.textContent).toContain('Clear');
    // Calm: the word tinted, no outline round the panel.
    expect(container.querySelector('.text-green-300')).not.toBeNull();
    expect(container.querySelector('[class*="outline-"]')).toBeNull();
  });

  it('staged: grades that gap by the thresholds set', () => {
    const caution = rejoin(staged(race, crawling), { careGap: 3, stopGap: 1 });
    expect(caution.textContent).toContain('Caution');
    // The word filled, the panel ringed in the caution's colour.
    expect(caution.querySelector('.bg-amber-500')).not.toBeNull();
    expect(caution.querySelector('.outline-amber-500')).not.toBeNull();
    cleanup();

    const stop = rejoin(staged(race, crawling), { careGap: 4, stopGap: 3 });
    expect(stop.textContent).toContain('Do Not Rejoin');
    expect(stop.querySelector('.bg-red-600')).not.toBeNull();
    expect(stop.querySelector('.outline-red-500')).not.toBeNull();
  });

  it('staged: a Care Gap under the Stop Gap still calls a gap over it clear', () => {
    // 2.45 s is over the 1 s care gap: Clear, as the widget always read,
    // although it is under the 3 s stop gap.
    const container = rejoin(staged(race, crawling), {
      careGap: 1,
      stopGap: 3,
    });
    expect(container.textContent).toContain('Clear');
  });

  it('staged: an imported Care Gap that is not a number leaves the Stop Gap red', () => {
    // A dashboard file can carry "2,0"; 2.45 s is inside the 3 s stop gap.
    const container = rejoin(staged(race, crawling), {
      careGap: '2,0' as unknown as number,
      stopGap: 3,
    });
    expect(container.textContent).toContain('Do Not Rejoin');
  });

  it('staged: slow in the pit lane, stays hidden', () => {
    expect(rejoin(staged(race, crawlingInPitLane)).textContent).toBe('');
  });
});
